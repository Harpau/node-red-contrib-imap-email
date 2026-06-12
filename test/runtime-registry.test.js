"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const registry = require("../lib/runtime-registry");

test("runtime registry marks, counts and removes inflight messages", () => {
  const key = registry.makeQueueKey({ accountId: "a", host: "h", user: "u", mailbox: "INBOX" });
  registry.clearQueue(key);

  const token = { uid: 123, uidValidity: "v1", mailbox: "INBOX" };
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

  registry.markInflight(key, { uid: 1, uidValidity: "v1", mailbox: "Archive" }, { now: 1000 });
  registry.markInflight(key, { uid: 2, uidValidity: "v1", mailbox: "Archive" }, { now: 9000 });

  assert.equal(registry.pruneExpiredInflight(key, 5000, 10000), 1);
  assert.equal(registry.countAllInflight(key), 1);
  assert.equal(registry.isActiveInflight(key, "v1", 2, 5000, 10000), true);

  assert.equal(registry.pruneExpiredInflight(key, 5000, 15000), 1);
  assert.equal(registry.countAllInflight(key), 0);
});
