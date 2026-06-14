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

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function requireString(source, field) {
  if (!hasValue(source[field])) {
    throw new Error(`msg.imap.ackToken.${field} fehlt`);
  }
  return String(source[field]);
}

function requirePort(source) {
  if (!hasValue(source.port)) {
    throw new Error("msg.imap.ackToken.port fehlt");
  }

  if (typeof source.port === "number") {
    if (Number.isSafeInteger(source.port) && source.port > 0) {
      return source.port;
    }
    throw new Error("msg.imap.ackToken.port ist ungueltig");
  }

  const text = String(source.port).trim();
  if (!/^[0-9]+$/.test(text)) {
    throw new Error("msg.imap.ackToken.port ist ungueltig");
  }

  const port = Number(text);
  if (!Number.isSafeInteger(port) || port < 1) {
    throw new Error("msg.imap.ackToken.port ist ungueltig");
  }
  return port;
}

function requireSecure(source) {
  if (!Object.prototype.hasOwnProperty.call(source, "secure") || !hasValue(source.secure)) {
    throw new Error("msg.imap.ackToken.secure fehlt");
  }

  if (typeof source.secure === "boolean") {
    return source.secure;
  }

  const text = String(source.secure).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(text)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(text)) {
    return false;
  }
  throw new Error("msg.imap.ackToken.secure ist ungueltig");
}

function requireUid(source) {
  const uid = Number(source.uid);
  if (!Number.isSafeInteger(uid) || uid < 1) {
    throw new Error("msg.imap.ackToken.uid fehlt/ist ungueltig");
  }
  return uid;
}

function extractAckToken(msg) {
  const source = msg && msg.imap && msg.imap.ackToken;

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("msg.imap.ackToken fehlt");
  }

  const token = {
    accountId: requireString(source, "accountId"),
    queueKey: requireString(source, "queueKey"),
    host: requireString(source, "host"),
    port: requirePort(source),
    secure: requireSecure(source),
    user: requireString(source, "user"),
    mailbox: requireString(source, "mailbox"),
    uid: requireUid(source),
    uidValidity: requireString(source, "uidValidity")
  };

  return token;
}

module.exports = {
  buildAckToken,
  extractAckToken
};
