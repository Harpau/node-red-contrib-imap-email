"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAckToken } = require("../lib/ack-token");
const registry = require("../lib/runtime-registry");

function tokenFor(queueKey, uid = 123, overrides = {}) {
  return buildAckToken({
    accountId: "a",
    queueKey,
    host: "h",
    port: 993,
    secure: true,
    user: "u",
    mailbox: "INBOX",
    uid,
    uidValidity: "v1",
    ...overrides
  });
}

function identityToken(queueKey, uid = 123, issuedAt = 1000, overrides = {}) {
  return {
    version: 2,
    accountId: "a",
    queueKey,
    host: "h",
    port: 993,
    secure: true,
    user: "u",
    mailbox: "INBOX",
    uid,
    uidValidity: "v1",
    issuedAt,
    nonce: `nonce-${uid}-${issuedAt}`,
    signature: `sig-${uid}-${issuedAt}`,
    ...overrides
  };
}

test("runtime registry marks, counts and removes inflight messages", () => {
  const key = registry.makeQueueKey({ accountId: "a", host: "h", user: "u", mailbox: "INBOX" });
  registry.clearQueue(key);

  const token = tokenFor(key);
  registry.markInflight(key, token, { now: 1000 });

  assert.equal(registry.countAllInflight(key), 1);
  assert.equal(registry.isActiveInflight(key, "v1", 123, 10000, 2000), true);
  assert.equal(registry.isActiveInflight(key, "v1", 123, 500, 2000), false);

  assert.equal(registry.removeInflight(key, "v1", 123), true);
  assert.equal(registry.countAllInflight(key), 0);
});

test("runtime registry prunes expired inflight messages", () => {
  const key = registry.makeQueueKey({ accountId: "a", host: "h", user: "u", mailbox: "Archive" });
  registry.clearQueue(key);

  registry.markInflight(key, tokenFor(key, 1, { mailbox: "Archive" }), { now: 1000 });
  registry.markInflight(key, tokenFor(key, 2, { mailbox: "Archive" }), { now: 9000 });

  assert.equal(registry.pruneExpiredInflight(key, 5000, 10000), 1);
  assert.equal(registry.countAllInflight(key), 1);
  assert.equal(registry.isActiveInflight(key, "v1", 2, 5000, 10000), true);

  assert.equal(registry.pruneExpiredInflight(key, 5000, 15000), 1);
  assert.equal(registry.countAllInflight(key), 0);
});

test("runtime registry queue and message keys are collision-resistant", () => {
  const slashMailbox = registry.makeQueueKey({ accountId: "a", host: "h", user: "u", mailbox: "Archive/Processed" });
  const underscoreMailbox = registry.makeQueueKey({ accountId: "a", host: "h", user: "u", mailbox: "Archive_Processed" });
  assert.notEqual(slashMailbox, underscoreMailbox);

  const values = [undefined, "", "default", "0", 0, "%", ":", "Fach/Über"];
  const keys = values.map((mailbox) => registry.makeQueueKey({ accountId: "a", host: "h", user: "u", mailbox }));
  assert.equal(new Set(keys).size, values.length);

  assert.notEqual(registry.makeMessageKey("v/1", 1), registry.makeMessageKey("v_1", 1));
  assert.notEqual(registry.makeMessageKey(undefined, 1), registry.makeMessageKey("default", 1));
});

test("runtime registry claims, completes and releases exact ACK token generations", () => {
  const key = registry.makeQueueKey({ accountId: "a", host: "h", user: "u", mailbox: "INBOX" });
  registry.clearQueue(key);
  const token = tokenFor(key, 1);
  const staleToken = tokenFor(key, 1);

  registry.markInflight(key, token, { now: 1000 });

  assert.equal(registry.matchesAckToken(key, token), true);
  assert.equal(registry.matchesAckToken(key, staleToken), false);
  assert.equal(!!registry.claimAckToken(key, token, 2000), true);
  assert.equal(registry.claimAckToken(key, token, 2001), null);
  assert.equal(registry.completeAckToken(key, staleToken), false);
  assert.equal(registry.isActiveInflight(key, "v1", 1, 1, 100000), true);
  assert.equal(registry.pruneExpiredInflight(key, 1, 100000), 0);
  assert.equal(registry.releaseAckToken(key, token), true);
  assert.equal(!!registry.claimAckToken(key, token, 3000), true);
  assert.equal(registry.completeAckToken(key, token), true);
  assert.equal(registry.countAllInflight(key), 0);
});

test("runtime registry does not overwrite or remove claimed inflight messages", () => {
  const key = registry.makeQueueKey({ accountId: "a", host: "h", user: "u", mailbox: "INBOX" });
  registry.clearQueue(key);
  const token = tokenFor(key, 1);
  const replacement = tokenFor(key, 1);

  registry.markInflight(key, token, { now: 1000 });
  assert.equal(!!registry.claimAckToken(key, token, 2000), true);

  assert.equal(registry.markInflight(key, replacement, { now: 3000 }), null);
  assert.equal(registry.removeInflight(key, "v1", 1), false);
  assert.equal(registry.matchesAckToken(key, token), true);
  assert.equal(registry.matchesAckToken(key, replacement), false);
  assert.equal(registry.completeAckToken(key, token, 4000), true);
  assert.equal(registry.countAllInflight(key), 0);
});

test("runtime registry protects active unclaimed entries only with retry context", () => {
  const key = registry.makeQueueKey({ accountId: "a", host: "h", user: "u", mailbox: "INBOX" });
  registry.clearQueue(key);
  const token = identityToken(key, 1, 1000);
  const replacement = identityToken(key, 1, 2000);

  assert.notEqual(registry.markInflight(key, token, { now: 1000 }), null);
  assert.equal(registry.markInflight(key, replacement, { now: 2000, retryAfterMs: 5000 }), null);
  assert.equal(registry.matchesAckToken(key, token), true);
  assert.equal(registry.matchesAckToken(key, replacement), false);

  assert.notEqual(registry.markInflight(key, replacement, { now: 7000, retryAfterMs: 5000 }), null);
  assert.equal(registry.matchesAckToken(key, replacement), true);

  const legacyReplacement = identityToken(key, 1, 8000);
  assert.notEqual(registry.markInflight(key, legacyReplacement, { now: 8000 }), null);
  assert.equal(registry.matchesAckToken(key, legacyReplacement), true);
});

test("runtime registry removeInflight preserves active and claimed entries", () => {
  const key = registry.makeQueueKey({ accountId: "a", host: "h", user: "u", mailbox: "INBOX" });
  registry.clearQueue(key);
  const active = identityToken(key, 1, 1000);
  const claimed = identityToken(key, 2, 1000);

  registry.markInflight(key, active, { now: 1000 });
  assert.equal(registry.removeInflight(key, "v1", 1, { now: 2000, retryAfterMs: 5000 }), false);
  assert.equal(registry.matchesAckToken(key, active), true);
  assert.equal(registry.removeInflight(key, "v1", 1, { now: 2000, retryAfterMs: 5000, force: true }), true);

  registry.markInflight(key, active, { now: 1000 });
  assert.equal(registry.removeInflight(key, "v1", 1, { now: 7000, retryAfterMs: 5000 }), true);

  registry.markInflight(key, claimed, { now: 1000 });
  assert.notEqual(registry.claimAckToken(key, claimed, 1500), null);
  assert.equal(registry.removeInflight(key, "v1", 2, { now: 7000, retryAfterMs: 5000, force: true }), false);
  assert.equal(registry.matchesAckToken(key, claimed), true);
  assert.equal(registry.completeAckToken(key, claimed, 8000), true);
});

test("runtime registry completion guards reject old token generations", () => {
  const key = registry.makeQueueKey({ accountId: "a", host: "h", user: "u", mailbox: "INBOX" });
  registry.clearQueue(key);
  const token = tokenFor(key, 1);
  token.issuedAt = 1000;
  token.signature = "issued-1000";

  registry.markInflight(key, token, { now: 1000 });
  assert.equal(!!registry.claimAckToken(key, token, 1500), true);
  assert.equal(registry.completeAckToken(key, token, 2000), true);

  const staleToken = tokenFor(key, 1);
  staleToken.issuedAt = 2000;
  staleToken.signature = "issued-2000";
  assert.equal(registry.markInflight(key, staleToken, { now: 2500 }), null);

  const freshToken = tokenFor(key, 1);
  freshToken.issuedAt = 2001;
  freshToken.signature = "issued-2001";
  assert.notEqual(registry.markInflight(key, freshToken, { now: 3000 }), null);
  assert.equal(registry.matchesAckToken(key, freshToken), true);
  assert.equal(registry.removeInflight(key, "v1", 1), true);
});

test("runtime registry completion guards expire and are pruned without inflight entries", () => {
  const key = registry.makeQueueKey({ accountId: "a", host: "h", user: "u", mailbox: "INBOX" });
  registry.clearQueue(key);
  const completedAt = 10000;
  const token = identityToken(key, 1, completedAt - 1000);

  registry.markInflight(key, token, { now: completedAt - 1000 });
  assert.notEqual(registry.claimAckToken(key, token, completedAt - 500), null);
  assert.equal(registry.completeAckToken(key, token, completedAt), true);
  assert.equal(registry.countAllInflight(key), 0);

  const stale = identityToken(key, 1, completedAt);
  assert.equal(registry.markInflight(key, stale, { now: completedAt + 1 }), null);

  assert.equal(registry.pruneExpiredInflight(key, 5000, completedAt + registry.COMPLETION_GUARD_TTL_MS), 0);
  assert.notEqual(registry.markInflight(key, stale, {
    now: completedAt + registry.COMPLETION_GUARD_TTL_MS + 1
  }), null);
  assert.equal(registry.matchesAckToken(key, stale), true);
});

test("runtime registry completion guards are capped per queue", () => {
  const key = registry.makeQueueKey({ accountId: "a", host: "h", user: "u", mailbox: "INBOX" });
  registry.clearQueue(key);
  const max = registry.MAX_COMPLETION_GUARDS_PER_QUEUE;
  const base = 10000;

  for (let uid = 1; uid <= max + 1; uid += 1) {
    const completedAt = base + uid;
    const token = identityToken(key, uid, completedAt - 1);
    registry.markInflight(key, token, { now: completedAt - 1 });
    registry.claimAckToken(key, token, completedAt);
    assert.equal(registry.completeAckToken(key, token, completedAt), true);
  }

  const trimmed = identityToken(key, 1, base + 1);
  assert.notEqual(registry.markInflight(key, trimmed, { now: base + max + 2 }), null);
  assert.equal(registry.matchesAckToken(key, trimmed), true);
  assert.equal(registry.removeInflight(key, "v1", 1), true);

  const newestCompletedAt = base + max + 1;
  const stillGuarded = identityToken(key, max + 1, newestCompletedAt);
  assert.equal(registry.markInflight(key, stillGuarded, { now: newestCompletedAt + 1 }), null);
});

test("runtime registry clearQueue removes completion guards", () => {
  const key = registry.makeQueueKey({ accountId: "a", host: "h", user: "u", mailbox: "INBOX" });
  registry.clearQueue(key);
  const token = tokenFor(key, 1);
  token.issuedAt = 1000;
  token.signature = "issued-1000";

  registry.markInflight(key, token, { now: 1000 });
  assert.equal(!!registry.claimAckToken(key, token, 1500), true);
  assert.equal(registry.completeAckToken(key, token, 2000), true);
  registry.clearQueue(key);

  const oldToken = tokenFor(key, 1);
  oldToken.issuedAt = 1500;
  oldToken.signature = "issued-1500";
  assert.notEqual(registry.markInflight(key, oldToken, { now: 3000 }), null);
  assert.equal(registry.matchesAckToken(key, oldToken), true);
});
