"use strict";

const queues = new Map();

function encodePart(value) {
  return Buffer
    .from(JSON.stringify({
      t: typeof value,
      v: value === undefined ? null : String(value)
    }))
    .toString("base64url");
}

function makeQueueKey({ accountId, host, user, mailbox }) {
  return [
    "imap-front-queue",
    encodePart(accountId),
    encodePart(host),
    encodePart(user),
    encodePart(mailbox)
  ].join(":");
}

function makeMessageKey(uidValidity, uid) {
  return `${encodePart(uidValidity)}:${Number(uid)}`;
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
    subject: meta.subject || previous.subject || null,
    ackVersion: token.version,
    ackNonce: token.nonce,
    ackIssuedAt: token.issuedAt,
    ackSignature: token.signature,
    ackClaimed: false,
    ackClaimedAt: null
  };

  map.set(key, entry);
  return entry;
}

function getExistingEntry(queueKey, token) {
  const uid = Number(token && token.uid);
  if (!Number.isSafeInteger(uid) || uid < 1) {
    return null;
  }

  const map = queues.get(queueKey);
  if (!map) {
    return null;
  }

  return map.get(makeMessageKey(token.uidValidity, uid)) || null;
}

function tokenIdentityMatches(entry, token) {
  return !!(entry && token
    && Number(entry.uid) === Number(token.uid)
    && String(entry.uidValidity || "") === String(token.uidValidity || "")
    && entry.ackVersion === token.version
    && entry.ackNonce === token.nonce
    && entry.ackIssuedAt === token.issuedAt
    && entry.ackSignature === token.signature);
}

function matchesAckToken(queueKey, token) {
  return tokenIdentityMatches(getExistingEntry(queueKey, token), token);
}

function claimAckToken(queueKey, token, now = Date.now()) {
  const entry = getExistingEntry(queueKey, token);
  if (!tokenIdentityMatches(entry, token) || entry.ackClaimed) {
    return null;
  }

  entry.ackClaimed = true;
  entry.ackClaimedAt = now;
  return entry;
}

function completeAckToken(queueKey, token) {
  const map = queues.get(queueKey);
  if (!map) {
    return false;
  }

  const entry = getExistingEntry(queueKey, token);
  if (!tokenIdentityMatches(entry, token) || !entry.ackClaimed) {
    return false;
  }

  const removed = map.delete(makeMessageKey(token.uidValidity, token.uid));
  if (map.size === 0) {
    queues.delete(queueKey);
  }
  return removed;
}

function releaseAckToken(queueKey, token) {
  const entry = getExistingEntry(queueKey, token);
  if (!tokenIdentityMatches(entry, token) || !entry.ackClaimed) {
    return false;
  }

  entry.ackClaimed = false;
  entry.ackClaimedAt = null;
  return true;
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

  if (entry.ackClaimed) {
    return true;
  }

  const retry = Math.max(0, Number(retryAfterMs) || 0);
  return now - Number(entry.lastSentAt || 0) < retry;
}

function countActiveInflight(queueKey, retryAfterMs, now = Date.now()) {
  const map = getInflightMap(queueKey);
  let count = 0;

  for (const entry of map.values()) {
    if (entry.ackClaimed) {
      count += 1;
      continue;
    }

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

function pruneExpiredInflight(queueKey, retryAfterMs, now = Date.now()) {
  const map = queues.get(queueKey);
  if (!map) {
    return 0;
  }

  const retry = Math.max(0, Number(retryAfterMs) || 0);
  let pruned = 0;

  for (const [key, entry] of map.entries()) {
    if (entry.ackClaimed) {
      continue;
    }

    if (now - Number(entry.lastSentAt || 0) >= retry) {
      map.delete(key);
      pruned += 1;
    }
  }

  if (map.size === 0) {
    queues.delete(queueKey);
  }

  return pruned;
}

function clearQueue(queueKey) {
  queues.delete(queueKey);
}

function snapshot(queueKey) {
  return Array.from(getInflightMap(queueKey).values());
}

module.exports = {
  encodePart,
  makeQueueKey,
  makeMessageKey,
  getInflightMap,
  markInflight,
  removeInflight,
  matchesAckToken,
  claimAckToken,
  completeAckToken,
  releaseAckToken,
  isActiveInflight,
  countActiveInflight,
  countAllInflight,
  pruneExpiredInflight,
  clearQueue,
  snapshot
};
