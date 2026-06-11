"use strict";

const { extractAckToken } = require("../lib/ack-token");
const registry = require("../lib/runtime-registry");
const { chunkUids, compressUids } = require("../lib/uid-range");
const { parseNumber } = require("../lib/imap-utils");
const {
  normalizeAckAction,
  normalizeAckActionFromMessage,
  buildImapAckResult,
  buildImapAckError,
  executeAckActionRange,
  actionPlanKey
} = require("../lib/imap-ack-actions");
const diagnostics = require("../lib/diagnostics");

module.exports = function registerImapEmailAck(RED) {
  function ImapEmailAckNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    node.account = RED.nodes.getNode(config.account);
    node.name = config.name || "";
    node.mailbox = config.mailbox || "";
    node.batchSize = parseNumber(config.batchSize, 100, 1, 10000);
    node.flushMs = parseNumber(config.flushMs, 500, 1, 60000);
    node.maxUidPerCommand = parseNumber(config.maxUidPerCommand, 500, 1, 5000);
    node.maxBatchesPerFlush = parseNumber(config.maxBatchesPerFlush, 20, 1, 1000);
    node.actionMode = config.actionMode || config.action || "delete";
    node.targetMailbox = config.targetMailbox || "";
    node.actionProperty = config.actionProperty || "imap.ackAction";
    node.seenAction = config.seenAction || "ignore";
    node.answeredAction = config.answeredAction || "ignore";
    node.flaggedAction = config.flaggedAction || "ignore";
    node.diagnostics = diagnostics.normalizeDiagnostics(config.diagnostics, "stats");
    node.actionPlan = null;
    node.configError = null;

    node.pending = [];
    node.timer = null;
    node.running = false;
    node.closed = false;
    node.closeDone = null;

    if (!node.account) {
      node.status({ fill: "red", shape: "ring", text: "missing account" });
      node.error("Missing imap email account configuration");
      return;
    }

    if (node.actionMode !== "message") {
      try {
        const actionConfig = { action: node.actionMode };
        if (node.actionMode === "move") {
          actionConfig.targetMailbox = node.targetMailbox;
        } else if (node.actionMode === "flag") {
          actionConfig.seenAction = node.seenAction;
          actionConfig.answeredAction = node.answeredAction;
          actionConfig.flaggedAction = node.flaggedAction;
        }
        node.actionPlan = normalizeAckAction(actionConfig);
      } catch (err) {
        node.configError = err;
        node.status({ fill: "red", shape: "ring", text: err.message });
        node.error(err);
      }
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

    function addTiming(timings, name, startedAt) {
      const ms = Math.max(0, Date.now() - startedAt);
      timings[name] = Math.max(0, Number(timings[name] || 0) + ms);
    }

    function emitFlushStats(stats) {
      if (diagnostics.wantsStats(node.diagnostics)) {
        node.send([null, null, { payload: stats }]);
      }
      diagnostics.debug(node, node.diagnostics, "imap email ack.flush", stats);
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
          token.uidValidity,
          actionPlanKey(item.plan)
        ].join("|");

        if (!groups.has(key)) {
          groups.set(key, {
            token,
            plan: item.plan,
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

      const startedAt = Date.now();
      const maxItems = node.batchSize * node.maxBatchesPerFlush;
      const items = node.pending.splice(0, maxItems);
      const groups = node.groupItems(items);
      const stats = {
        ok: true,
        type: "imap email ack stats",
        diagnostics: node.diagnostics,
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: null,
        requested: items.length,
        groups: groups.length,
        okCount: 0,
        errorCount: 0,
        pendingAfter: 0,
        actions: {},
        chunks: [],
        ranges: [],
        errors: [],
        timings: {}
      };

      node.status({ fill: "blue", shape: "dot", text: `ACK batch ${items.length}` });

      try {
        for (const group of groups) {
          let client;
          let lock;
          const token = group.token;
          const plan = group.plan;
          const mailbox = token.mailbox || node.mailbox || "INBOX";
          const actionCounter = stats.actions[plan.action] || { requested: 0, ok: 0, error: 0 };
          actionCounter.requested += group.items.length;
          stats.actions[plan.action] = actionCounter;

          function itemsForChunk(uidChunk) {
            const wanted = new Set(uidChunk.map((uid) => Number(uid)));
            return group.items.filter((item) => wanted.has(Number(item.token.uid)));
          }

          function completeItems(chunkItems, range) {
            for (const item of chunkItems) {
              const ackToken = item.token;
              if (ackToken.queueKey) {
                registry.removeInflight(ackToken.queueKey, ackToken.uidValidity, ackToken.uid);
              }

              item.msg.imapAck = buildImapAckResult({
                token: ackToken,
                plan,
                mailbox,
                range
              });

              item.send([item.msg, null, null]);
              if (item.done) {
                item.done();
              }
              stats.okCount += 1;
              actionCounter.ok += 1;
            }
          }

          function failItems(chunkItems, range, err) {
            stats.ok = false;
            stats.errorCount += chunkItems.length;
            actionCounter.error += chunkItems.length;
            stats.errors.push({
              mailbox,
              action: plan.action,
              disposition: plan.disposition,
              targetMailbox: plan.targetMailbox || undefined,
              uidValidity: token.uidValidity,
              range: range || undefined,
              count: chunkItems.length,
              error: err.message
            });

            for (const item of chunkItems) {
              item.msg.imapAck = buildImapAckError({
                token: item.token,
                plan,
                mailbox,
                range,
                error: err
              });
              item.send([null, item.msg, null]);
              if (item.done) {
                item.done();
              }
            }
          }

          try {
            const uidChunks = chunkUids(group.uids, node.maxUidPerCommand);
            const needsImap = plan.action !== "flag"
              || plan.flags.add.length > 0
              || plan.flags.remove.length > 0;

            if (needsImap) {
              client = node.account.createClient({ node, context: "imap email ack" });

              let t = Date.now();
              await client.connect();
              addTiming(stats.timings, "connectMs", t);

              t = Date.now();
              lock = await client.getMailboxLock(mailbox);
              addTiming(stats.timings, "lockMs", t);

              const currentUidValidity = String(client.mailbox && client.mailbox.uidValidity || "");
              if (token.uidValidity && currentUidValidity !== String(token.uidValidity)) {
                throw new Error(`UIDVALIDITY mismatch for ${mailbox}: token=${token.uidValidity}, current=${currentUidValidity}`);
              }
            }

            let targetMailboxEnsured = false;
            for (const uidChunk of uidChunks) {
              const range = compressUids(uidChunk);
              const chunkItems = itemsForChunk(uidChunk);

              stats.ranges.push({
                mailbox,
                uidValidity: token.uidValidity,
                action: plan.action,
                disposition: plan.disposition,
                targetMailbox: plan.targetMailbox || undefined,
                flags: plan.flags,
                range,
                count: chunkItems.length
              });

              try {
                if (needsImap) {
                  const t = Date.now();
                  await executeAckActionRange({
                    client,
                    plan,
                    range,
                    mailbox,
                    ensureTargetMailbox: plan.action !== "move" || !targetMailboxEnsured
                  });
                  if (plan.action === "move") {
                    targetMailboxEnsured = true;
                  }
                  addTiming(stats.timings, `${plan.action}Ms`, t);
                }

                stats.chunks.push({
                  ok: true,
                  mailbox,
                  uidValidity: token.uidValidity,
                  action: plan.action,
                  disposition: plan.disposition,
                  targetMailbox: plan.targetMailbox || undefined,
                  range,
                  count: chunkItems.length
                });
                completeItems(chunkItems, range);
              } catch (err) {
                stats.chunks.push({
                  ok: false,
                  mailbox,
                  uidValidity: token.uidValidity,
                  action: plan.action,
                  disposition: plan.disposition,
                  targetMailbox: plan.targetMailbox || undefined,
                  range,
                  count: chunkItems.length,
                  error: err.message
                });
                failItems(chunkItems, range, err);
                node.warn(`IMAP ACK failed for ${mailbox} ${range}: ${err.message}`);
              }
            }
          } catch (err) {
            failItems(group.items, "", err);
            node.warn(`IMAP ACK failed for ${mailbox}: ${err.message}`);
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
                const t = Date.now();
                await client.logout();
                addTiming(stats.timings, "logoutMs", t);
              }
            } catch (err) {
              // ignore
            }
          }
        }
      } finally {
        node.running = false;
        stats.pendingAfter = node.pending.length;
        stats.finishedAt = new Date().toISOString();
        stats.timings.totalMs = Math.max(0, Date.now() - startedAt);
        emitFlushStats(stats);

        node.status({
          fill: stats.errorCount > 0 ? "red" : "green",
          shape: stats.errorCount > 0 ? "ring" : "dot",
          text: `ACK ok ${stats.okCount}, err ${stats.errorCount}, pending ${node.pending.length}`
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
        msg.imapAck = buildImapAckError({
          plan: node.actionPlan || normalizeAckAction({ action: "delete" }),
          mailbox: node.mailbox || "INBOX",
          error: err
        });
        send([null, msg, null]);
        if (done) {
          done();
        }
        return;
      }

      let plan;
      try {
        if (node.configError) {
          throw node.configError;
        }
        plan = node.actionMode === "message"
          ? normalizeAckActionFromMessage(msg, node.actionProperty)
          : node.actionPlan;
      } catch (err) {
        msg.imapAck = buildImapAckError({
          token,
          plan: node.actionPlan || {
            action: node.actionMode,
            disposition: "keep",
            targetMailbox: "",
            flags: { add: [], remove: [] }
          },
          mailbox: token.mailbox || node.mailbox || "INBOX",
          error: err
        });
        send([null, msg, null]);
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
        plan,
        enqueuedAt: Date.now()
      });

      node.status({ fill: "yellow", shape: "ring", text: `ACK pending ${node.pending.length}` });
      diagnostics.debug(node, node.diagnostics, "imap email ack.queued", {
        pending: node.pending.length,
        mailbox: token.mailbox || node.mailbox || "INBOX",
        action: plan.action,
        uid: token.uid,
        uidValidity: token.uidValidity
      });

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

  RED.nodes.registerType("imap email ack", ImapEmailAckNode);
};
