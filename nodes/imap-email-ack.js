"use strict";

const { extractAckToken } = require("../lib/ack-token");
const registry = require("../lib/runtime-registry");
const { chunkUidRanges } = require("../lib/uid-range");
const { parseNumber, parseBoolean } = require("../lib/imap-utils");
const {
  normalizeAckAction,
  normalizeAckActionFromMessage,
  buildImapAckResult,
  buildImapAckError,
  executeAckActionBatch,
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
    node.actionMode = config.actionMode || config.mode || "delete";
    node.targetMailbox = config.targetMailbox || "";
    node.createTargetMailbox = parseBoolean(config.createTargetMailbox, true);
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
        node.actionPlan = normalizeAckAction({
          mode: node.actionMode,
          targetMailbox: node.targetMailbox,
          createTargetMailbox: node.createTargetMailbox,
          seenAction: node.seenAction,
          answeredAction: node.answeredAction,
          flaggedAction: node.flaggedAction
        });
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
          const groupStats = {
            mailbox,
            action: plan.mode,
            disposition: plan.disposition,
            targetMailbox: plan.targetMailbox || undefined,
            uidValidity: token.uidValidity,
            count: group.items.length,
            ranges: []
          };

          try {
            const uidRanges = chunkUidRanges(group.uids, node.maxUidPerCommand);
            groupStats.ranges = uidRanges;
            stats.ranges.push({
              mailbox,
              uidValidity: token.uidValidity,
              action: plan.mode,
              disposition: plan.disposition,
              targetMailbox: plan.targetMailbox || undefined,
              flags: plan.flags,
              ranges: uidRanges,
              count: group.items.length
            });

            const actionCounter = stats.actions[plan.mode] || { requested: 0, ok: 0, error: 0 };
            actionCounter.requested += group.items.length;
            stats.actions[plan.mode] = actionCounter;

            const needsImap = plan.disposition !== "keep"
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

              t = Date.now();
              await executeAckActionBatch({ client, plan, uidRanges, mailbox });
              addTiming(stats.timings, `${plan.disposition}Ms`, t);
            }

            for (const item of group.items) {
              const ackToken = item.token;
              const queueKey = ackToken.queueKey;
              const inflightRemoved = plan.requeue !== "later";
              if (queueKey && inflightRemoved) {
                registry.removeInflight(queueKey, ackToken.uidValidity, ackToken.uid);
              }

              item.msg.imapAck = buildImapAckResult({
                token: ackToken,
                plan,
                mailbox,
                ranges: uidRanges,
                batchSize: group.items.length,
                inflightRemoved
              });

              item.send([item.msg, null, null]);
              if (item.done) {
                item.done();
              }
              stats.okCount += 1;
              actionCounter.ok += 1;
            }
          } catch (err) {
            stats.ok = false;
            stats.errorCount += group.items.length;
            const actionCounter = stats.actions[plan.mode] || { requested: 0, ok: 0, error: 0 };
            actionCounter.error += group.items.length;
            stats.actions[plan.mode] = actionCounter;
            stats.errors.push({
              mailbox,
              action: plan.mode,
              disposition: plan.disposition,
              targetMailbox: plan.targetMailbox || undefined,
              uidValidity: token.uidValidity,
              count: group.items.length,
              error: err.message
            });

            for (const item of group.items) {
              item.msg.imapAck = buildImapAckError({
                token: item.token,
                plan,
                mailbox,
                error: err
              });
              item.send([null, item.msg, null]);
              if (item.done) {
                item.done();
              }
            }
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
          plan: node.actionPlan || normalizeAckAction({ mode: "delete" }),
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
            mode: node.actionMode,
            disposition: "keep",
            targetMailbox: "",
            requeue: "later",
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
        action: plan.mode,
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
