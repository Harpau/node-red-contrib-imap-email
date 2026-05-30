"use strict";

const { extractAckToken } = require("../lib/ack-token");
const registry = require("../lib/runtime-registry");
const { ensureMailbox } = require("../lib/imap-utils");

module.exports = function registerImapQueueNack(RED) {
  function ImapQueueNackNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    node.account = RED.nodes.getNode(config.account);
    node.name = config.name || "";
    node.mailbox = config.mailbox || "INBOX";
    node.action = config.action || "retry";
    node.failedMailbox = config.failedMailbox || ".NodeRED.failed";

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

    node.on("input", async function onInput(msg, send, done) {
      send = send || function fallbackSend(output) { node.send(output); };
      let token;

      try {
        token = extractAckToken(msg, defaultTokenValues());
      } catch (err) {
        msg.imapNack = {
          ok: false,
          error: err.message
        };
        send([null, msg]);
        if (done) {
          done();
        }
        return;
      }

      const mailbox = token.mailbox || node.mailbox || "INBOX";

      try {
        if (node.action === "retry") {
          msg.imapNack = {
            ok: true,
            action: "retry",
            note: "Message left in mailbox and inflight entry kept until retry timeout",
            uid: token.uid,
            mailbox
          };
          send([msg, null]);
          if (done) {
            done();
          }
          return;
        }

        if (node.action === "retry-now") {
          if (token.queueKey) {
            registry.removeInflight(token.queueKey, token.uidValidity, token.uid);
          }
          msg.imapNack = {
            ok: true,
            action: "retry-now",
            uid: token.uid,
            mailbox
          };
          send([msg, null]);
          if (done) {
            done();
          }
          return;
        }

        let client;
        let lock;

        try {
          client = node.account.createClient();
          await client.connect();
          lock = await client.getMailboxLock(mailbox);

          const currentUidValidity = String(client.mailbox && client.mailbox.uidValidity || "");
          if (token.uidValidity && currentUidValidity !== String(token.uidValidity)) {
            throw new Error(`UIDVALIDITY mismatch for ${mailbox}: token=${token.uidValidity}, current=${currentUidValidity}`);
          }

          if (node.action === "move") {
            await ensureMailbox(client, node.failedMailbox);
            await client.messageMove(String(token.uid), node.failedMailbox, { uid: true });
          } else if (node.action === "delete") {
            await client.messageDelete(String(token.uid), { uid: true });
          } else {
            throw new Error(`Unknown NACK action: ${node.action}`);
          }

          if (token.queueKey) {
            registry.removeInflight(token.queueKey, token.uidValidity, token.uid);
          }

          msg.imapNack = {
            ok: true,
            action: node.action,
            uid: token.uid,
            mailbox,
            failedMailbox: node.action === "move" ? node.failedMailbox : undefined
          };

          node.status({ fill: "green", shape: "dot", text: `${node.action} UID ${token.uid}` });
          send([msg, null]);
          if (done) {
            done();
          }
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
      } catch (err) {
        msg.imapNack = {
          ok: false,
          action: node.action,
          uid: token.uid,
          mailbox,
          error: err.message
        };
        node.status({ fill: "red", shape: "ring", text: err.message });
        node.error(err, msg);
        send([null, msg]);
        if (done) {
          done();
        }
      }
    });
  }

  RED.nodes.registerType("imap-queue-nack", ImapQueueNackNode);
};
