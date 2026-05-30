"use strict";

const { simpleParser } = require("mailparser");
const { buildAckToken } = require("../lib/ack-token");
const registry = require("../lib/runtime-registry");
const { chunkUidRanges } = require("../lib/uid-range");
const {
  parseNumber,
  parseBoolean,
  isDeleted,
  flagsToArray,
  headersToObject
} = require("../lib/imap-utils");

module.exports = function registerImapQueueIn(RED) {
  function ImapQueueInNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    node.account = RED.nodes.getNode(config.account);
    node.name = config.name || "";
    node.mailbox = config.mailbox || "INBOX";
    node.pollIntervalMs = parseNumber(config.pollIntervalMs, 1000, 100, 3600000);
    node.drainIntervalMs = parseNumber(config.drainIntervalMs, 200, 0, 3600000);
    node.batchSize = parseNumber(config.batchSize, 50, 1, 5000);
    node.frontWindowSize = parseNumber(config.frontWindowSize, 500, 1, 100000);
    node.maxInflight = parseNumber(config.maxInflight, 500, 1, 100000);
    node.retryAfterMs = parseNumber(config.retryAfterMs, 30 * 60 * 1000, 1000, 7 * 24 * 60 * 60 * 1000);
    node.maxUidPerCommand = parseNumber(config.maxUidPerCommand, 500, 1, 5000);
    node.skipDeleted = parseBoolean(config.skipDeleted, true);
    node.expungeDeletedFront = parseBoolean(config.expungeDeletedFront, true);
    node.expungeDeletedFrontLimit = parseNumber(config.expungeDeletedFrontLimit, 200, 0, 10000);
    node.includeAttachments = parseBoolean(config.includeAttachments, false);
    node.emitRaw = parseBoolean(config.emitRaw, false);
    node.autoStart = parseBoolean(config.autoStart, true);

    node.closed = false;
    node.running = false;
    node.timer = null;
    node.closeDone = null;

    if (!node.account) {
      node.status({ fill: "red", shape: "ring", text: "missing account" });
      node.error("Missing imap-queue-account configuration");
      return;
    }

    node.queueKey = registry.makeQueueKey({
      accountId: node.account.id,
      host: node.account.host,
      user: node.account.getUsername(),
      mailbox: node.mailbox
    });

    node.schedule = function schedule(delayMs) {
      if (node.closed) {
        return;
      }
      if (node.timer) {
        clearTimeout(node.timer);
      }
      node.timer = setTimeout(() => {
        node.timer = null;
        node.poll().catch((err) => {
          node.status({ fill: "red", shape: "ring", text: err.message });
          node.error(err);
          node.schedule(node.pollIntervalMs);
        });
      }, Math.max(0, delayMs));
    };

    node.poll = async function poll() {
      if (node.closed || node.running) {
        return;
      }

      node.running = true;

      const activeInflight = registry.countActiveInflight(node.queueKey, node.retryAfterMs);
      const capacity = Math.max(0, node.maxInflight - activeInflight);

      if (capacity <= 0) {
        node.status({ fill: "yellow", shape: "ring", text: `inflight ${activeInflight}/${node.maxInflight}` });
        node.running = false;
        node.schedule(node.pollIntervalMs);
        return;
      }

      const stats = {
        ok: true,
        type: "imap-queue-in-stats",
        mailbox: node.mailbox,
        exists: 0,
        uidValidity: null,
        frontWindowSize: node.frontWindowSize,
        frontWindowRead: 0,
        activeInflight,
        maxInflight: node.maxInflight,
        capacity,
        candidates: 0,
        emitted: 0,
        parseErrors: 0,
        deletedFlagged: 0,
        deletedExpunged: 0,
        queueKey: node.queueKey
      };

      let client;
      let lock;

      try {
        client = node.account.createClient();
        await client.connect();
        lock = await client.getMailboxLock(node.mailbox);

        const mailboxInfo = client.mailbox || {};
        const exists = Number(mailboxInfo.exists || 0);
        const uidValidity = String(mailboxInfo.uidValidity || "");
        stats.exists = exists;
        stats.uidValidity = uidValidity;

        if (exists < 1) {
          node.status({ fill: "green", shape: "ring", text: "empty" });
          node.send([null, null, { payload: stats }]);
          return;
        }

        const frontEnd = Math.min(exists, node.frontWindowSize);
        stats.frontWindowRead = frontEnd;

        const front = await client.fetchAll(`1:${frontEnd}`, {
          uid: true,
          flags: true,
          internalDate: true,
          size: true,
          envelope: true
        });

        const deletedUids = [];
        const candidates = [];
        const now = Date.now();

        for (const item of front) {
          const uid = Number(item.uid);
          if (!Number.isSafeInteger(uid) || uid < 1) {
            continue;
          }

          const deleted = isDeleted(item.flags);
          if (deleted) {
            stats.deletedFlagged += 1;
            deletedUids.push(uid);
            if (node.skipDeleted) {
              continue;
            }
          }

          if (registry.isActiveInflight(node.queueKey, uidValidity, uid, node.retryAfterMs, now)) {
            continue;
          }

          candidates.push(uid);
        }

        if (node.expungeDeletedFront && deletedUids.length > 0 && node.expungeDeletedFrontLimit > 0) {
          const toExpunge = deletedUids.slice(0, node.expungeDeletedFrontLimit);
          for (const range of chunkUidRanges(toExpunge, node.maxUidPerCommand)) {
            await client.messageDelete(range, { uid: true });
          }
          stats.deletedExpunged = toExpunge.length;
        }

        stats.candidates = candidates.length;
        const uidsToFetch = candidates.slice(0, Math.min(node.batchSize, capacity));

        for (const range of chunkUidRanges(uidsToFetch, node.maxUidPerCommand)) {
          const messages = await client.fetchAll(range, {
            uid: true,
            source: true,
            envelope: true,
            flags: true,
            internalDate: true,
            size: true
          }, { uid: true });

          for (const imapMessage of messages) {
            const uid = Number(imapMessage.uid);
            const ackToken = buildAckToken({
              accountId: node.account.id,
              queueKey: node.queueKey,
              host: node.account.host,
              port: node.account.port,
              secure: node.account.secure,
              user: node.account.getUsername(),
              mailbox: node.mailbox,
              uid,
              uidValidity
            });

            try {
              const parsed = await simpleParser(imapMessage.source);
              registry.markInflight(node.queueKey, ackToken, {
                messageId: parsed.messageId,
                subject: parsed.subject
              });

              const out = {
                topic: parsed.subject || "",
                payload: parsed.text || "",
                html: parsed.html || undefined,
                email: {
                  subject: parsed.subject || "",
                  messageId: parsed.messageId || "",
                  date: parsed.date || imapMessage.internalDate,
                  from: parsed.from ? parsed.from.text : "",
                  to: parsed.to ? parsed.to.text : "",
                  cc: parsed.cc ? parsed.cc.text : "",
                  bcc: parsed.bcc ? parsed.bcc.text : "",
                  text: parsed.text || "",
                  html: parsed.html || undefined,
                  headers: headersToObject(parsed.headers)
                },
                imap: {
                  accountId: node.account.id,
                  mailbox: node.mailbox,
                  uid,
                  uidValidity,
                  flags: flagsToArray(imapMessage.flags),
                  internalDate: imapMessage.internalDate,
                  size: imapMessage.size,
                  ackToken,
                  delivery: {
                    mode: "at-least-once",
                    duplicatePossible: true
                  }
                }
              };

              if (node.includeAttachments) {
                out.email.attachments = parsed.attachments || [];
                out.attachments = parsed.attachments || [];
              }

              if (node.emitRaw) {
                out.raw = imapMessage.source;
              }

              stats.emitted += 1;
              node.send([out, null, null]);
            } catch (err) {
              registry.markInflight(node.queueKey, ackToken, {
                subject: imapMessage.envelope && imapMessage.envelope.subject
              });

              stats.parseErrors += 1;
              node.send([
                null,
                {
                  payload: imapMessage.source,
                  error: {
                    message: err.message,
                    stack: err.stack
                  },
                  imap: {
                    accountId: node.account.id,
                    mailbox: node.mailbox,
                    uid,
                    uidValidity,
                    size: imapMessage.size,
                    flags: flagsToArray(imapMessage.flags),
                    ackToken,
                    delivery: {
                      mode: "at-least-once",
                      duplicatePossible: true
                    }
                  }
                },
                null
              ]);
            }
          }
        }

        stats.activeInflightAfter = registry.countActiveInflight(node.queueKey, node.retryAfterMs);
        stats.inflightTotal = registry.countAllInflight(node.queueKey);

        node.send([null, null, { payload: stats }]);
        node.status({
          fill: stats.emitted > 0 ? "green" : "grey",
          shape: "dot",
          text: `sent ${stats.emitted}, inflight ${stats.activeInflightAfter}/${node.maxInflight}`
        });
      } catch (err) {
        node.status({ fill: "red", shape: "ring", text: err.message });
        node.send([
          null,
          {
            error: {
              message: err.message,
              stack: err.stack
            },
            imap: {
              mailbox: node.mailbox,
              queueKey: node.queueKey
            }
          },
          { payload: { ...stats, ok: false, error: err.message } }
        ]);
        node.error(err);
      } finally {
        try {
          if (lock) {
            lock.release();
          }
        } catch (err) {
          // ignore
        }
        try {
          if (client) {
            await client.logout();
          }
        } catch (err) {
          // ignore
        }

        node.running = false;

        if (node.closeDone) {
          const done = node.closeDone;
          node.closeDone = null;
          done();
          return;
        }

        if (!node.closed) {
          const nextDelay = stats.emitted > 0 && stats.activeInflightAfter < node.maxInflight
            ? node.drainIntervalMs
            : node.pollIntervalMs;
          node.schedule(nextDelay);
        }
      }
    };

    node.on("close", function onClose(removed, done) {
      node.closed = true;
      if (node.timer) {
        clearTimeout(node.timer);
        node.timer = null;
      }
      if (node.running) {
        node.closeDone = done;
      } else {
        done();
      }
    });

    if (node.autoStart) {
      node.schedule(250);
    } else {
      node.status({ fill: "grey", shape: "ring", text: "stopped" });
    }
  }

  RED.nodes.registerType("imap-queue-in", ImapQueueInNode);
};
