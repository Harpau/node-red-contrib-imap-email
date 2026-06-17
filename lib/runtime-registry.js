"use strict";

const queues = new Map();
const completionGuards = new Map();
const COMPLETION_GUARD_TTL_MS = 30 * 60 * 1000;
const MAX_COMPLETION_GUARDS_PER_QUEUE = 120000;

function normalizeNow(now) {
  const value = Number(now);
  return Number.isFinite(value) && value > 0 ? value : Date.now();
}

function normalizeRetryAfter(retryAfterMs) {
  const value = Number(retryAfterMs);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

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

function getCompletionGuardMap(queueKey) {
  if (!completionGuards.has(queueKey)) {
    completionGuards.set(queueKey, new Map());
  }
  return completionGuards.get(queueKey);
}

function cleanupCompletionGuardMap(queueKey, map) {
  if (map && map.size === 0) {
    completionGuards.delete(queueKey);
  }
}

function pruneCompletionGuards(queueKey, now = Date.now()) {
  const map = completionGuards.get(queueKey);
  if (!map) {
    return 0;
  }

  const cutoff = normalizeNow(now) - COMPLETION_GUARD_TTL_MS;
  let pruned = 0;

  for (const [key, guard] of map.entries()) {
    const insertedAt = Number(guard && guard.insertedAt);
    if (Number.isFinite(insertedAt) && insertedAt > cutoff) {
      break;
    }
    map.delete(key);
    pruned += 1;
  }

  while (map.size > MAX_COMPLETION_GUARDS_PER_QUEUE) {
    const oldest = map.keys().next();
    if (oldest.done) {
      break;
    }
    map.delete(oldest.value);
    pruned += 1;
  }

  cleanupCompletionGuardMap(queueKey, map);
  return pruned;
}

function isEntryActive(entry, retryAfterMs, now = Date.now()) {
  if (!entry) {
    return false;
  }

  if (entry.ackClaimed) {
    return true;
  }

  const retry = normalizeRetryAfter(retryAfterMs);
  if (retry === 0) {
    return false;
  }

  return normalizeNow(now) - Number(entry.lastSentAt || 0) < retry;
}

function markInflight(queueKey, token, meta = {}) {
  const uid = Number(token.uid);
  if (!Number.isSafeInteger(uid) || uid < 1) {
    return null;
  }

  const now = normalizeNow(meta.now);
  const key = makeMessageKey(token.uidValidity, uid);
  pruneCompletionGuards(queueKey, now);
  const existingMap = queues.get(queueKey);
  const previous = existingMap && existingMap.get(key) || {};
  if (isEntryActive(previous, meta.retryAfterMs, now)) {
    return null;
  }

  const guardMap = completionGuards.get(queueKey);
  const guard = guardMap && guardMap.get(key);
  if (guard !== undefined) {
    const issuedAt = Number(token.issuedAt);
    const completedAt = Number(guard && guard.completedAt);
    if (!Number.isFinite(issuedAt) || !Number.isFinite(completedAt) || issuedAt <= completedAt) {
      return null;
    }
    guardMap.delete(key);
    cleanupCompletionGuardMap(queueKey, guardMap);
  }

  const map = existingMap || getInflightMap(queueKey);

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

function completeAckToken(queueKey, token, now = Date.now()) {
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
  if (removed) {
    const completedAt = normalizeNow(now);
    const messageKey = makeMessageKey(token.uidValidity, token.uid);
    pruneCompletionGuards(queueKey, completedAt);
    const guardMap = getCompletionGuardMap(queueKey);
    guardMap.delete(messageKey);
    guardMap.set(messageKey, {
      completedAt,
      insertedAt: completedAt
    });
    pruneCompletionGuards(queueKey, completedAt);
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

function removeInflight(queueKey, uidValidity, uid, options = {}) {
  const map = queues.get(queueKey);
  if (!map) {
    return false;
  }

  const key = makeMessageKey(uidValidity, uid);
  const entry = map.get(key);
  if (!entry || entry.ackClaimed) {
    return false;
  }

  if (!options.force && isEntryActive(entry, options.retryAfterMs, options.now)) {
    return false;
  }

  const removed = map.delete(key);
  if (map.size === 0) {
    queues.delete(queueKey);
  }
  return removed;
}

function isActiveInflight(queueKey, uidValidity, uid, retryAfterMs, now = Date.now()) {
  const map = queues.get(queueKey);
  if (!map) {
    return false;
  }
  const entry = map.get(makeMessageKey(uidValidity, uid));
  return isEntryActive(entry, retryAfterMs, now);
}

function countActiveInflight(queueKey, retryAfterMs, now = Date.now()) {
  const map = queues.get(queueKey);
  if (!map) {
    return 0;
  }
  let count = 0;

  for (const entry of map.values()) {
    if (isEntryActive(entry, retryAfterMs, now)) {
      count += 1;
    }
  }

  return count;
}

function countAllInflight(queueKey) {
  const map = queues.get(queueKey);
  return map ? map.size : 0;
}

function pruneExpiredInflight(queueKey, retryAfterMs, now = Date.now()) {
  const timestamp = normalizeNow(now);
  pruneCompletionGuards(queueKey, timestamp);
  const map = queues.get(queueKey);
  if (!map) {
    return 0;
  }

  const retry = normalizeRetryAfter(retryAfterMs);
  let pruned = 0;

  for (const [key, entry] of map.entries()) {
    if (entry.ackClaimed) {
      continue;
    }

    if (timestamp - Number(entry.lastSentAt || 0) >= retry) {
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
  completionGuards.delete(queueKey);
}

function snapshot(queueKey) {
  const map = queues.get(queueKey);
  return map ? Array.from(map.values()) : [];
}

module.exports = {
  COMPLETION_GUARD_TTL_MS,
  MAX_COMPLETION_GUARDS_PER_QUEUE,
  encodePart,
  makeQueueKey,
  makeMessageKey,
  getInflightMap,
  pruneCompletionGuards,
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
