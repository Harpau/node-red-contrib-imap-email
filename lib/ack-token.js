"use strict";

function buildAckToken({
  accountId,
  queueKey,
  host,
  port,
  secure,
  user,
  mailbox,
  uid,
  uidValidity
}) {
  return {
    accountId: accountId || "",
    queueKey: queueKey || "",
    host: host || "",
    port: Number(port) || 993,
    secure: secure !== false,
    user: user || "",
    mailbox: mailbox || "INBOX",
    uid: Number(uid),
    uidValidity: String(uidValidity || "")
  };
}

function extractAckToken(msg, defaults = {}) {
  const source = msg && msg.imap && msg.imap.ackToken
    ? msg.imap.ackToken
    : (msg && msg.imap ? msg.imap : {});

  const token = buildAckToken({
    accountId: source.accountId || defaults.accountId,
    queueKey: source.queueKey || source.inflightKey || defaults.queueKey,
    host: source.host || defaults.host,
    port: source.port || defaults.port,
    secure: source.secure !== undefined ? source.secure : defaults.secure,
    user: source.user || defaults.user,
    mailbox: source.mailbox || defaults.mailbox,
    uid: source.uid,
    uidValidity: source.uidValidity
  });

  if (!Number.isSafeInteger(token.uid) || token.uid < 1) {
    throw new Error("msg.imap.ackToken.uid oder msg.imap.uid fehlt/ist ungueltig");
  }

  if (!token.uidValidity) {
    throw new Error("msg.imap.ackToken.uidValidity oder msg.imap.uidValidity fehlt");
  }

  if (!token.mailbox) {
    token.mailbox = defaults.mailbox || "INBOX";
  }

  return token;
}

module.exports = {
  buildAckToken,
  extractAckToken
};
