"use strict";

const { extractAckToken } = require("../lib/ack-token");
const registry = require("../lib/runtime-registry");
const { chunkUidRanges } = require("../lib/uid-range");
const { parseNumber } = require("../lib/imap-utils");

module.exports = function registerImapQueueAck(RED) {
  function ImapQueueAckNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    node.account = RED.nodes.getNode(config.account);
    node.name = config.name || "";
    node.mailbox = config.mailbox || "";
    node.batchSize = parseNumber(config.batchSize, 100, 1, 10000);
    node.flushMs = parseNumber(config.flushMs, 500, 1, 60000);
    node.maxUidPerCommand = parseNumber(config.maxUidPerCommand, 500, 1, 5000);
    node.maxBatchesPerFlush = parseNumber(config.maxBatchesPerFlush, 20, 1, 1000);

    node.pending = [];
    node.timer = null;
    node.running = false;
    node.closed = false;
    node.closeDone = null;

    if (!node.account) {
      node.status({ fill: "red", shape: "ring", text: "missing account" });
      node.error("Missing imap-queue-account configuration");
      return;
    }

    function defaultTokenValues() {
      return {
        accountId: node.account.id,
        host: node.account.host,
        port: node.account.port,
        secure: node.account.secure,
        user: node.account.getUsername(),
        mailbox: node.mailbox || "INBOX"
      };
    }

    node.scheduleFlush = function scheduleFlush(delayMs) {
      if (node.closed || node.timer) {
        return;
      }
      node.timer = setTimeout(() => {
        node.timer = null;
        node.flush().catch((err) => {
          node.status({ fill: "red", shape: "ring", text: err.message });
          node.error(err);
        });
      }, Math.max(1, delayMs));
    };

    node.groupItems = function groupItems(items) {
      const groups = new Map();

      for (const item of items) {
        const token = item.token;
        const key = [
          token.accountId || node.account.id,
          token.host || node.account.host,
          token.user || node.account.getUsername(),
          token.mailbox || node.mailbox || "INBOX",
          token.uidValidity
        ].join("|");

        if (!groups.has(key)) {
          groups.set(key, {
            token,
            items: [],
            uids: []
          });
        }

        groups.get(key).items.push(item);
        groups.get(key).uids.push(token.uid);
      }

      return Array.from(groups.values());
    };

    node.flush = async function flush() {
      if (node.running || node.pending.length === 0) {
        return;
      }

      node.running = true;

      const maxItems = node.batchSize * node.maxBatchesPerFlush;
      const items = node.pending.splice(0, maxItems);
      const groups = node.groupItems(items);
      let okCount = 0;
      let errorCount = 0;

      node.status({ fill: "blue", shape: "dot", text: `ACK batch ${items.length}` });

      try {
        for (const group of groups) {
          let client;
          let lock;
          const token = group.token;
          const mailbox = token.mailbox || node.mailbox || "INBOX";

          try {
            client = node.account.createClient();
            await client.connect();
            lock = await client.getMailboxLock(mailbox);

            const currentUidValidity = String(client.mailbox && client.mailbox.uidValidity || "");
            if (token.uidValidity && currentUidValidity !== String(token.uidValidity)) {
              throw new Error(`UIDVALIDITY mismatch for ${mailbox}: token=${token.uidValidity}, current=${currentUidValidity}`);
            }

            const uidRanges = chunkUidRanges(group.uids, node.maxUidPerCommand);
            for (const range of uidRanges) {
              await client.messageDelete(range, { uid: true });
            }

            for (const item of group.items) {
              const ackToken = item.token;
              const queueKey = ackToken.queueKey;
              if (queueKey) {
                registry.removeInflight(queueKey, ackToken.uidValidity, ackToken.uid);
              }

              item.msg.imapAck = {
                ok: true,
                mailbox,
                uid: ackToken.uid,
                uidValidity: ackToken.uidValidity,
                batchSize: group.items.length,
                ranges: uidRanges
              };

              item.send([item.msg, null]);
              if (item.done) {
                item.done();
              }
              okCount += 1;
            }
          } catch (err) {
            errorCount += group.items.length;
            for (const item of group.items) {
              item.msg.imapAck = {
                ok: false,
                mailbox,
                uid: item.token.uid,
                uidValidity: item.token.uidValidity,
                error: err.message
              };
              item.send([null, item.msg]);
              if (item.done) {
                item.done();
              }
            }
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
          }
        }
      } finally {
        node.running = false;
        node.status({
          fill: errorCount > 0 ? "red" : "green",
          shape: errorCount > 0 ? "ring" : "dot",
          text: `ACK ok ${okCount}, err ${errorCount}, pending ${node.pending.length}`
        });

        if (node.pending.length > 0 && !node.closed) {
          node.scheduleFlush(1);
        }

        if (node.closeDone && node.pending.length === 0 && !node.running) {
          const done = node.closeDone;
          node.closeDone = null;
          done();
        }
      }
    };

    node.on("input", function onInput(msg, send, done) {
      send = send || function fallbackSend(output) { node.send(output); };

      let token;
      try {
        token = extractAckToken(msg, defaultTokenValues());
      } catch (err) {
        msg.imapAck = {
          ok: false,
          error: err.message
        };
        send([null, msg]);
        if (done) {
          done();
        }
        return;
      }

      node.pending.push({
        msg,
        send,
        done,
        token,
        enqueuedAt: Date.now()
      });

      node.status({ fill: "yellow", shape: "ring", text: `ACK pending ${node.pending.length}` });

      if (node.pending.length >= node.batchSize) {
        if (node.timer) {
          clearTimeout(node.timer);
          node.timer = null;
        }
        node.flush().catch((err) => {
          node.status({ fill: "red", shape: "ring", text: err.message });
          node.error(err);
        });
      } else {
        node.scheduleFlush(node.flushMs);
      }
    });

    node.on("close", function onClose(removed, done) {
      node.closed = true;
      if (node.timer) {
        clearTimeout(node.timer);
        node.timer = null;
      }

      if (node.pending.length > 0 && !node.running) {
        node.flush().then(() => done()).catch((err) => {
          node.error(err);
          done();
        });
        return;
      }

      if (node.running) {
        node.closeDone = done;
      } else {
        done();
      }
    });
  }

  RED.nodes.registerType("imap-queue-ack", ImapQueueAckNode);
};
