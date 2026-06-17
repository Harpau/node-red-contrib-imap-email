"use strict";

const crypto = require("node:crypto");

const TOKEN_VERSION = 2;
const SIGNATURE_ALGORITHM = "sha256";
const SIGNED_FIELDS = [
  "version",
  "accountId",
  "queueKey",
  "host",
  "port",
  "secure",
  "user",
  "mailbox",
  "uid",
  "uidValidity",
  "issuedAt",
  "nonce"
];

let signingSecret;

function getSigningSecret() {
  if (!signingSecret) {
    signingSecret = crypto.randomBytes(32);
  }
  return signingSecret;
}

function canonicalPayload(token) {
  const payload = {};
  for (const field of SIGNED_FIELDS) {
    payload[field] = token[field];
  }
  return JSON.stringify(payload);
}

function signToken(token) {
  return crypto
    .createHmac(SIGNATURE_ALGORITHM, getSigningSecret())
    .update(canonicalPayload(token))
    .digest("base64url");
}

function timingSafeEqualText(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ""), "utf8");
  const expectedBuffer = Buffer.from(String(expected || ""), "utf8");
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

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
  const token = {
    version: TOKEN_VERSION,
    accountId: accountId || "",
    queueKey: queueKey || "",
    host: host || "",
    port: Number(port) || 993,
    secure: secure !== false,
    user: user || "",
    mailbox: mailbox || "INBOX",
    uid: Number(uid),
    uidValidity: String(uidValidity || ""),
    issuedAt: Date.now(),
    nonce: crypto.randomBytes(16).toString("base64url")
  };
  token.signature = signToken(token);
  return token;
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

  if (typeof source.port !== "number" || !Number.isSafeInteger(source.port) || source.port < 1) {
    throw new Error("msg.imap.ackToken.port ist ungueltig");
  }
  return source.port;
}

function requireSecure(source) {
  if (!Object.prototype.hasOwnProperty.call(source, "secure") || !hasValue(source.secure)) {
    throw new Error("msg.imap.ackToken.secure fehlt");
  }

  if (typeof source.secure !== "boolean") {
    throw new Error("msg.imap.ackToken.secure ist ungueltig");
  }
  return source.secure;
}

function requireUid(source) {
  const uid = Number(source.uid);
  if (!Number.isSafeInteger(uid) || uid < 1) {
    throw new Error("msg.imap.ackToken.uid fehlt/ist ungueltig");
  }
  return uid;
}

function requireVersion(source) {
  if (source.version !== TOKEN_VERSION) {
    throw new Error("msg.imap.ackToken.version fehlt/ist ungueltig");
  }
  return TOKEN_VERSION;
}

function requireIssuedAt(source) {
  if (typeof source.issuedAt !== "number" || !Number.isSafeInteger(source.issuedAt) || source.issuedAt < 1) {
    throw new Error("msg.imap.ackToken.issuedAt fehlt/ist ungueltig");
  }
  return source.issuedAt;
}

function requireNonce(source) {
  const nonce = requireString(source, "nonce");
  if (!/^[a-zA-Z0-9_-]+$/.test(nonce)) {
    throw new Error("msg.imap.ackToken.nonce ist ungueltig");
  }
  return nonce;
}

function requireSignature(source) {
  const signature = requireString(source, "signature");
  if (!/^[a-zA-Z0-9_-]+$/.test(signature)) {
    throw new Error("msg.imap.ackToken.signature ist ungueltig");
  }
  return signature;
}

function verifySignature(token) {
  const expected = signToken(token);
  if (!timingSafeEqualText(token.signature, expected)) {
    throw new Error("msg.imap.ackToken.signature ist ungueltig");
  }
}

function extractAckToken(msg) {
  const source = msg && msg.imap && msg.imap.ackToken;

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("msg.imap.ackToken fehlt");
  }

  const token = {
    version: requireVersion(source),
    accountId: requireString(source, "accountId"),
    queueKey: requireString(source, "queueKey"),
    host: requireString(source, "host"),
    port: requirePort(source),
    secure: requireSecure(source),
    user: requireString(source, "user"),
    mailbox: requireString(source, "mailbox"),
    uid: requireUid(source),
    uidValidity: requireString(source, "uidValidity"),
    issuedAt: requireIssuedAt(source),
    nonce: requireNonce(source),
    signature: requireSignature(source)
  };
  verifySignature(token);

  return token;
}

module.exports = {
  TOKEN_VERSION,
  buildAckToken,
  extractAckToken
};
