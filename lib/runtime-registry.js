"use strict";

const queues = new Map();

function safePart(value) {
  return String(value || "default").replace(/[^a-zA-Z0-9_.@:-]/g, "_");
}

function makeQueueKey({ accountId, host, user, mailbox }) {
  return [
    "imap-front-queue",
    safePart(accountId),
    safePart(host),
    safePart(user),
    safePart(mailbox || "INBOX")
  ].join(":");
}

function makeMessageKey(uidValidity, uid) {
  return `${safePart(uidValidity)}:${Number(uid)}`;
}

function getInflightMap(queueKey) {
  if (!queues.has(queueKey)) {
    queues.set(queueKey, new Map());
  }
  return queues.get(queueKey);
}

function markInflight(queueKey, token, meta = {}) {
  const uid = Number(token.uid);
  if (!Number.isSafeInteger(uid) || uid < 1) {
    return null;
  }

  const now = Number(meta.now) || Date.now();
  const key = makeMessageKey(token.uidValidity, uid);
  const map = getInflightMap(queueKey);
  const previous = map.get(key) || {};

  const entry = {
    uid,
    uidValidity: String(token.uidValidity || ""),
    mailbox: token.mailbox,
    firstSentAt: previous.firstSentAt || now,
    lastSentAt: now,
    attempts: Number(previous.attempts || 0) + 1,
    messageId: meta.messageId || previous.messageId || null,
    subject: meta.subject || previous.subject || null
  };

  map.set(key, entry);
  return entry;
}

function removeInflight(queueKey, uidValidity, uid) {
  const map = getInflightMap(queueKey);
  return map.delete(makeMessageKey(uidValidity, uid));
}

function isActiveInflight(queueKey, uidValidity, uid, retryAfterMs, now = Date.now()) {
  const map = getInflightMap(queueKey);
  const entry = map.get(makeMessageKey(uidValidity, uid));
  if (!entry) {
    return false;
  }

  const retry = Math.max(0, Number(retryAfterMs) || 0);
  return now - Number(entry.lastSentAt || 0) < retry;
}

function countActiveInflight(queueKey, retryAfterMs, now = Date.now()) {
  const map = getInflightMap(queueKey);
  let count = 0;

  for (const entry of map.values()) {
    const retry = Math.max(0, Number(retryAfterMs) || 0);
    if (now - Number(entry.lastSentAt || 0) < retry) {
      count += 1;
    }
  }

  return count;
}

function countAllInflight(queueKey) {
  return getInflightMap(queueKey).size;
}

function clearQueue(queueKey) {
  queues.delete(queueKey);
}

function snapshot(queueKey) {
  return Array.from(getInflightMap(queueKey).values());
}

module.exports = {
  makeQueueKey,
  makeMessageKey,
  getInflightMap,
  markInflight,
  removeInflight,
  isActiveInflight,
  countActiveInflight,
  countAllInflight,
  clearQueue,
  snapshot
};
