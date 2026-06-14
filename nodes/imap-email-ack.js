"use strict";

const { extractAckToken } = require("../lib/ack-token");
const registry = require("../lib/runtime-registry");
const { chunkUids, compressUids } = require("../lib/uid-range");
const { parseInteger } = require("../lib/imap-utils");
const {
  isTransientImapConnectionError,
  safeClose,
  safeLogout
} = require("../lib/imap-connection");
const {
  normalizeAckAction,
  normalizeAckActionFromMessage,
  buildImapAckResult,
  buildImapAckError,
  executeAckActionRange,
  actionPlanKey
} = require("../lib/imap-ack-actions");
const diagnostics = require("../lib/diagnostics");

const DEFAULT_CLOSE_TIMEOUT_MS = 10000;

module.exports = function registerImapEmailAck(RED) {
  function ImapEmailAckNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    node.account = RED.nodes.getNode(config.account);
    node.name = config.name || "";
    node.batchSize = parseInteger(config.batchSize, 100, 1, 10000);
    node.flushMs = parseInteger(config.flushMs, 500, 1, 60000);
    node.maxUidPerCommand = parseInteger(config.maxUidPerCommand, 500, 1, 5000);
    node.maxBatchesPerFlush = parseInteger(config.maxBatchesPerFlush, 20, 1, 1000);
    node.closeTimeoutMs = parseInteger(config.closeTimeoutMs, DEFAULT_CLOSE_TIMEOUT_MS, 1, 14000);
    node.actionMode = config.actionMode || "delete";
    node.targetMailbox = config.targetMailbox || "";
    node.actionProperty = "imap.ackAction";
    node.seenAction = config.seenAction || "ignore";
    node.answeredAction = config.answeredAction || "ignore";
    node.flaggedAction = config.flaggedAction || "ignore";
    node.flagAdd = config.flagAdd || "";
    node.flagRemove = config.flagRemove || "";
    node.diagnostics = diagnostics.normalizeDiagnostics(config.diagnostics, "stats");
    node.actionPlan = null;
    node.configError = null;

    node.pending = [];
    node.timer = null;
    node.running = false;
    node.closed = false;
    node.closing = false;
    node.closeDone = null;
    node.closeTimer = null;
    node.closeFinalized = false;
    node.closeAbortError = null;
    node.activeClients = new Set();
    node.inflightItems = new Set();

    if (!node.account) {
      node.status({ fill: "red", shape: "ring", text: "missing account" });
      node.error("Missing imap email account configuration");
      return;
    }

    if (node.actionMode !== "message") {
      try {
        const actionConfig = { action: node.actionMode };
        if (node.actionMode === "move" || node.actionMode === "copy") {
          actionConfig.targetMailbox = node.targetMailbox;
        }
        if (node.actionMode === "flag" || node.actionMode === "move" || node.actionMode === "copy") {
          actionConfig.seenAction = node.seenAction;
          actionConfig.answeredAction = node.answeredAction;
          actionConfig.flaggedAction = node.flaggedAction;
          actionConfig.flagAdd = node.flagAdd;
          actionConfig.flagRemove = node.flagRemove;
        }
        node.actionPlan = normalizeAckAction(actionConfig);
      } catch (err) {
        node.configError = err;
        node.status({ fill: "red", shape: "ring", text: err.message });
        node.error(err);
      }
    }

    function expectedQueueKey(mailbox) {
      return registry.makeQueueKey({
        accountId: node.account.id,
        host: node.account.host,
        user: node.account.getUsername(),
        mailbox
      });
    }

    function validateAckTokenScope(token) {
      if (String(token.accountId) !== String(node.account.id)) {
        throw new Error("ACK token accountId does not match configured account");
      }

      if (String(token.host).trim().toLowerCase() !== String(node.account.host || "").trim().toLowerCase()) {
        throw new Error("ACK token host does not match configured account");
      }

      if (Number(token.port) !== Number(node.account.port)) {
        throw new Error("ACK token port does not match configured account");
      }

      if (Boolean(token.secure) !== Boolean(node.account.secure)) {
        throw new Error("ACK token secure setting does not match configured account");
      }

      if (String(token.user) !== String(node.account.getUsername() || "")) {
        throw new Error("ACK token user does not match configured account");
      }

      if (String(token.queueKey) !== expectedQueueKey(token.mailbox)) {
        throw new Error("ACK token queueKey does not match configured account and mailbox");
      }
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

    function buildCloseError() {
      const err = new Error("ACK not completed before node close");
      err.code = "IMAP_EMAIL_ACK_CLOSE";
      return err;
    }

    function trackClient(client) {
      if (client) {
        node.activeClients.add(client);
      }
      return client;
    }

    function untrackClient(client) {
      if (client) {
        node.activeClients.delete(client);
      }
    }

    function closeActiveClients() {
      for (const client of Array.from(node.activeClients)) {
        safeClose(client);
      }
    }

    function markItemSettled(item) {
      if (!item || item._imapEmailAckSettled) {
        return false;
      }
      item._imapEmailAckSettled = true;
      node.inflightItems.delete(item);
      return true;
    }

    function failItemsForClose(items, err) {
      let count = 0;
      for (const item of items) {
        if (!markItemSettled(item)) {
          continue;
        }

        const token = item.token || {};
        item.msg.imapAck = buildImapAckError({
          token,
          plan: item.plan || {
            action: node.actionMode,
            disposition: "keep",
            targetMailbox: "",
            flags: { add: [], remove: [] }
          },
          mailbox: token.mailbox || "",
          error: err
        });
        item.send([null, item.msg, null]);
        if (item.done) {
          item.done();
        }
        count += 1;
      }
      return count;
    }

    function clearCloseTimer() {
      if (node.closeTimer) {
        clearTimeout(node.closeTimer);
        node.closeTimer = null;
      }
    }

    function finishCloseNow() {
      if (node.closeFinalized) {
        return;
      }

      node.closeFinalized = true;
      node.closeAbortError = node.closeAbortError || buildCloseError();
      clearCloseTimer();
      closeActiveClients();
      failItemsForClose(node.pending.splice(0), node.closeAbortError);
      failItemsForClose(Array.from(node.inflightItems), node.closeAbortError);

      if (node.closeDone) {
        const done = node.closeDone;
        node.closeDone = null;
        done();
      }
    }

    function completeCloseIfReady() {
      if (!node.closeDone || node.closeFinalized || node.running) {
        return;
      }

      const closeErr = buildCloseError();
      failItemsForClose(node.pending.splice(0), closeErr);
      finishCloseNow();
    }

    function scheduleCloseDeadline() {
      if (node.closeTimer) {
        return;
      }

      node.closeTimer = setTimeout(() => {
        node.closeAbortError = node.closeAbortError || buildCloseError();
        finishCloseNow();
      }, node.closeTimeoutMs);
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
          token.accountId,
          token.host,
          token.user,
          token.mailbox,
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
      for (const item of items) {
        node.inflightItems.add(item);
      }
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
          const mailbox = token.mailbox;
          const actionCounter = stats.actions[plan.action] || { requested: 0, ok: 0, error: 0 };
          actionCounter.requested += group.items.length;
          stats.actions[plan.action] = actionCounter;

          function itemsForChunk(uidChunk) {
            const wanted = new Set(uidChunk.map((uid) => Number(uid)));
            return group.items.filter((item) => wanted.has(Number(item.token.uid)));
          }

          function completeItems(chunkItems, range) {
            for (const item of chunkItems) {
              if (!markItemSettled(item)) {
                continue;
              }

              const ackToken = item.token;
              registry.removeInflight(ackToken.queueKey, ackToken.uidValidity, ackToken.uid);

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
            let failedCount = 0;
            for (const item of chunkItems) {
              if (!markItemSettled(item)) {
                continue;
              }

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
              failedCount += 1;
            }

            if (failedCount === 0) {
              return;
            }

            stats.ok = false;
            stats.errorCount += failedCount;
            actionCounter.error += failedCount;
            stats.errors.push({
              mailbox,
              action: plan.action,
              disposition: plan.disposition,
              targetMailbox: plan.targetMailbox || undefined,
              uidValidity: token.uidValidity,
              range: range || undefined,
              count: failedCount,
              partial: err && err.partial ? true : undefined,
              error: err.message
            });
          }

          try {
            const uidChunks = chunkUids(group.uids, node.maxUidPerCommand);
            const needsImap = plan.action !== "flag"
              || plan.flags.add.length > 0
              || plan.flags.remove.length > 0;

            if (needsImap) {
              client = trackClient(node.account.createClient({ node, context: "imap email ack" }));

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
            let connectionInterrupted = null;
            for (const uidChunk of uidChunks) {
              if (node.closeAbortError) {
                throw node.closeAbortError;
              }

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
                if (node.closeAbortError) {
                  throw node.closeAbortError;
                }

                if (connectionInterrupted) {
                  throw connectionInterrupted;
                }

                if (needsImap) {
                  const t = Date.now();
                  await executeAckActionRange({
                    client,
                    plan,
                    range,
                    mailbox,
                    ensureTargetMailbox: !["move", "copy"].includes(plan.action) || !targetMailboxEnsured
                  });
                  if (plan.action === "move" || plan.action === "copy") {
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
                  partial: err && err.partial ? true : undefined,
                  error: err.message
                });
                failItems(chunkItems, range, err);
                node.warn(`IMAP ACK failed for ${mailbox} ${range}: ${err.message}`);
                if (isTransientImapConnectionError(err) || err.partial) {
                  connectionInterrupted = err;
                }
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
                const result = await safeLogout(client);
                if (!result.skipped) {
                  addTiming(stats.timings, "logoutMs", t);
                }
              }
            } catch (err) {
              // ignore
            } finally {
              untrackClient(client);
            }
          }
        }
      } finally {
        node.running = false;
        stats.pendingAfter = node.pending.length;
        stats.finishedAt = new Date().toISOString();
        stats.timings.totalMs = Math.max(0, Date.now() - startedAt);
        if (!node.closeFinalized) {
          emitFlushStats(stats);

          node.status({
            fill: stats.errorCount > 0 ? "red" : "green",
            shape: stats.errorCount > 0 ? "ring" : "dot",
            text: `ACK ok ${stats.okCount}, err ${stats.errorCount}, pending ${node.pending.length}`
          });
        }

        if (node.pending.length > 0 && !node.closed) {
          node.scheduleFlush(1);
        }

        completeCloseIfReady();
      }
    };

    node.on("input", function onInput(msg, send, done) {
      send = send || function fallbackSend(output) { node.send(output); };

      let token;
      try {
        token = extractAckToken(msg);
        validateAckTokenScope(token);
      } catch (err) {
        msg.imapAck = buildImapAckError({
          token,
          plan: node.actionPlan || normalizeAckAction({ action: "delete" }),
          mailbox: token && token.mailbox || "",
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
          ? normalizeAckActionFromMessage(msg)
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
          mailbox: token.mailbox,
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
        mailbox: token.mailbox,
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
      node.closing = true;
      if (node.timer) {
        clearTimeout(node.timer);
        node.timer = null;
      }

      node.closeDone = done;
      scheduleCloseDeadline();

      if (node.pending.length > 0 && !node.running) {
        node.flush().then(() => {
          completeCloseIfReady();
        }).catch((err) => {
          node.warn(`IMAP ACK close flush failed: ${err.message}`);
          completeCloseIfReady();
        });
        return;
      }

      if (!node.running) {
        completeCloseIfReady();
      }
    });
  }

  RED.nodes.registerType("imap-email ack", ImapEmailAckNode);
};
