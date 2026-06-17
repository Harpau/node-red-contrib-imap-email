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
