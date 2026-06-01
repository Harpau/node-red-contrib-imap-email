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

    node.closed = false;
    node.running = false;
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

    function buildBaseStats(triggerMsg) {
      return {
        ok: true,
        type: "imap-queue-in-stats",
        triggerMode: "external",
        trigger: triggerMsg ? {
          _msgid: triggerMsg._msgid,
          topic: triggerMsg.topic
        } : undefined,
        mailbox: node.mailbox,
        exists: 0,
        uidValidity: null,
        frontWindowSize: node.frontWindowSize,
        frontWindowRead: 0,
        activeInflight: 0,
        maxInflight: node.maxInflight,
        capacity: 0,
        candidates: 0,
        emitted: 0,
        parseErrors: 0,
        deletedFlagged: 0,
        deletedExpunged: 0,
        deletedSkippedDuringFetch: 0,
        missingSource: 0,
        queueKey: node.queueKey
      };
    }

    node.runFetchCycle = async function runFetchCycle(triggerMsg, send) {
      if (node.closed) {
        return;
      }

      const fallbackSend = function fallbackSend(output) { node.send(output); };
      send = send || fallbackSend;

      if (node.running) {
        const stats = buildBaseStats(triggerMsg);
        stats.skipped = true;
        stats.reason = "already running";
        stats.activeInflight = registry.countActiveInflight(node.queueKey, node.retryAfterMs);
        stats.activeInflightAfter = stats.activeInflight;
        stats.inflightTotal = registry.countAllInflight(node.queueKey);

        node.status({ fill: "yellow", shape: "ring", text: "trigger skipped: running" });
        send([null, null, { payload: stats }]);
        return;
      }

      node.running = true;
      node.status({ fill: "blue", shape: "dot", text: "triggered" });

      const activeInflight = registry.countActiveInflight(node.queueKey, node.retryAfterMs);
      const capacity = Math.max(0, node.maxInflight - activeInflight);

      const stats = buildBaseStats(triggerMsg);
      stats.activeInflight = activeInflight;
      stats.capacity = capacity;

      let client;
      let lock;

      try {
        if (capacity <= 0) {
          stats.skipped = true;
          stats.reason = "max inflight reached";
          stats.activeInflightAfter = activeInflight;
          stats.inflightTotal = registry.countAllInflight(node.queueKey);

          node.status({ fill: "yellow", shape: "ring", text: `inflight ${activeInflight}/${node.maxInflight}` });
          send([null, null, { payload: stats }]);
          return;
        }

        client = node.account.createClient();
        await client.connect();
        lock = await client.getMailboxLock(node.mailbox);

        const mailboxInfo = client.mailbox || {};
        const exists = Number(mailboxInfo.exists || 0);
        const uidValidity = String(mailboxInfo.uidValidity || "");
        stats.exists = exists;
        stats.uidValidity = uidValidity;

        if (exists < 1) {
          stats.activeInflightAfter = registry.countActiveInflight(node.queueKey, node.retryAfterMs);
          stats.inflightTotal = registry.countAllInflight(node.queueKey);

          node.status({ fill: "green", shape: "ring", text: "empty" });
          send([null, null, { payload: stats }]);
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
            registry.removeInflight(node.queueKey, uidValidity, uid);
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

          // These messages are already removed or marked for removal. They must not
          // continue to occupy transient inflight capacity.
          for (const uid of toExpunge) {
            registry.removeInflight(node.queueKey, uidValidity, uid);
          }
        }

        stats.candidates = candidates.length;
        const uidsToFetch = candidates.slice(0, Math.min(node.batchSize, capacity));
        const deletedSeenDuringFetch = new Set();

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
            if (!Number.isSafeInteger(uid) || uid < 1) {
              continue;
            }

            const messageDeleted = isDeleted(imapMessage.flags);
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

            // Race-safe guard: while this node is between the lightweight front-window
            // scan and the full source fetch, another ACK/cleanup operation may mark
            // the same UID as \Deleted. Some servers then return metadata but no
            // BODY[] source. Such messages are no longer queue items and must not be
            // sent to mailparser.
            if (messageDeleted && node.skipDeleted) {
              stats.deletedSkippedDuringFetch += 1;
              deletedSeenDuringFetch.add(uid);
              registry.removeInflight(node.queueKey, uidValidity, uid);
              continue;
            }

            if (imapMessage.source === undefined || imapMessage.source === null) {
              stats.missingSource += 1;

              // If the server reports a deleted message without source, treat it as a
              // cleanup case instead of a parse error. A non-deleted message without
              // source is still reported on output 2 below.
              if (messageDeleted) {
                deletedSeenDuringFetch.add(uid);
                registry.removeInflight(node.queueKey, uidValidity, uid);
                continue;
              }
            }

            try {
              const parsed = await simpleParser(imapMessage.source);
              registry.markInflight(node.queueKey, ackToken, {
                messageId: parsed.messageId,
                subject: parsed.subject
              });

              const out = {
                topic: parsed.subject || "",
                payload: parsed.text || "",
                email: {
                  topic: parsed.subject || "",
                  messageId: parsed.messageId || "",
                  date: parsed.date || imapMessage.internalDate,
                  from: parsed.from ? parsed.from.text : "",
                  to: parsed.to ? parsed.to.text : "",
                  cc: parsed.cc ? parsed.cc.text : "",
                  bcc: parsed.bcc ? parsed.bcc.text : "",
                  text: parsed.text || "",
                  html: parsed.html || undefined,
                  header: headersToObject(parsed.headers)
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
              }

              if (node.emitRaw) {
                out.raw = imapMessage.source;
              }

              stats.emitted += 1;
              send([out, null, null]);
            } catch (err) {
              registry.markInflight(node.queueKey, ackToken, {
                subject: imapMessage.envelope && imapMessage.envelope.subject
              });

              stats.parseErrors += 1;
              send([
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

        if (node.expungeDeletedFront && deletedSeenDuringFetch.size > 0 && node.expungeDeletedFrontLimit > 0) {
          const remainingLimit = Math.max(0, node.expungeDeletedFrontLimit - stats.deletedExpunged);
          const toExpunge = Array.from(deletedSeenDuringFetch).slice(0, remainingLimit);
          for (const range of chunkUidRanges(toExpunge, node.maxUidPerCommand)) {
            await client.messageDelete(range, { uid: true });
          }
          stats.deletedExpunged += toExpunge.length;
        }

        stats.activeInflightAfter = registry.countActiveInflight(node.queueKey, node.retryAfterMs);
        stats.inflightTotal = registry.countAllInflight(node.queueKey);

        send([null, null, { payload: stats }]);
        node.status({
          fill: stats.emitted > 0 ? "green" : "grey",
          shape: "dot",
          text: `sent ${stats.emitted}, inflight ${stats.activeInflightAfter}/${node.maxInflight}`
        });
      } catch (err) {
        node.status({ fill: "red", shape: "ring", text: err.message });
        send([
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
        node.error(err, triggerMsg);
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
        }
      }
    };

    node.on("input", function onInput(msg, send, done) {
      send = send || function fallbackSend(output) { node.send(output); };
      node.runFetchCycle(msg, send).then(() => {
        if (done) {
          done();
        }
      }).catch((err) => {
        node.status({ fill: "red", shape: "ring", text: err.message });
        node.error(err, msg);
        if (done) {
          done(err);
        }
      });
    });

    node.on("close", function onClose(removed, done) {
      node.closed = true;
      if (node.running) {
        node.closeDone = done;
      } else {
        done();
      }
    });

    node.status({ fill: "grey", shape: "ring", text: "waiting for trigger" });
  }

  RED.nodes.registerType("imap-queue-in", ImapQueueInNode);
};
