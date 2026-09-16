"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { deleteUidRange } = require("../lib/imap-delete");

function harness(behavior = {}) {
  const calls = [];
  function responses(stage) {
    const values = behavior.responses && Object.hasOwn(behavior.responses, stage)
      ? behavior.responses[stage] : [{ response: "OK" }];
    for (const value of values) client.emit("response", value);
  }
  const client = Object.assign(new EventEmitter(), {
    usable: true,
    mailbox: { path: "INBOX", uidValidity: 123n },
    capabilities: new Set(["UIDPLUS"]),
    async messageFlagsAdd(range, flags, options) {
      calls.push({ operation: "store", range, flags, options });
      const result = behavior.store ? await behavior.store(client) : true;
      responses("store");
      return result;
    },
    async messageDelete(range, options) {
      calls.push({ operation: "delete", range, options });
      const result = behavior.remove ? await behavior.remove(client) : true;
      responses("remove");
      return result;
    },
    async search(query, options) {
      calls.push({ operation: "search", query, options });
      const result = behavior.search ? await behavior.search(client) : [];
      responses("search");
      return result;
    }
  });
  return { client, calls };
}

async function failsWithoutPartial(operation) {
  await assert.rejects(operation, (error) => {
    assert.notEqual(error.partial, true);
    return true;
  });
}

async function failsAsPartial(operation) {
  await assert.rejects(operation, (error) => {
    assert.equal(error.partial, true);
    return true;
  });
}

test("safe deletion confirms the flag and deletion before checking exactly the requested UID range", async () => {
  const { client, calls } = harness();
  assert.equal(await deleteUidRange(client, "2,4:6"), true);
  assert.deepEqual(calls, [
    { operation: "store", range: "2,4:6", flags: ["\\Deleted"], options: { uid: true } },
    { operation: "delete", range: "2,4:6", options: { uid: true } },
    { operation: "search", query: { uid: "2,4:6" }, options: { uid: true } }
  ]);
});

test("missing UIDPLUS prevents every mutation and verification command", async () => {
  for (const capabilities of [undefined, new Set(), { has: () => false }]) {
    const { client, calls } = harness();
    client.capabilities = capabilities;
    await failsWithoutPartial(() => deleteUidRange(client, "1"));
    assert.deepEqual(calls, []);
  }
});

test("invalid, wildcard, unsafe or excessive UID sets fail before issuing commands", async () => {
  for (const range of [
    "", "*", "1:*", "0", "1:0", "-1", "1.2", "1,", "1,,2", "1:2:3", "1 2", "1\r\nEXPUNGE",
    "1:5001", "1,3:5002", "4294967296", "9007199254740993", undefined, null, [], { all: true }
  ]) {
    const { client, calls } = harness();
    await failsWithoutPartial(() => deleteUidRange(client, range));
    assert.deepEqual(calls, [], `range ${String(range)}`);
  }
});

test("the maximum chunk and widely separated finite UIDs remain supported without widening", async () => {
  for (const range of ["1:5000", "1,500000000:500000001", "4294967295"]) {
    const { client, calls } = harness();
    assert.equal(await deleteUidRange(client, range), true);
    assert.equal(calls.length, 3);
    assert.ok(calls.every((call) => (call.range || call.query.uid) === range));
  }
});

test("missing selected mailbox, validity or usable connection prevents mutation", async () => {
  for (const change of [
    (client) => { client.usable = false; },
    (client) => { delete client.usable; },
    (client) => { client.isClosed = true; },
    (client) => { client.socket = { destroyed: true }; },
    (client) => { client.mailbox = false; },
    (client) => { client.mailbox = undefined; },
    (client) => { client.mailbox.path = ""; },
    (client) => { delete client.mailbox.uidValidity; }
  ]) {
    const { client, calls } = harness();
    change(client);
    await failsWithoutPartial(() => deleteUidRange(client, "1"));
    assert.deepEqual(calls, []);
  }
});

test("only literal true from the explicit Deleted STORE permits deletion", async () => {
  for (const value of [false, undefined, null, 0, 1, "true", {}]) {
    const { client, calls } = harness({ store: () => value });
    await failsWithoutPartial(() => deleteUidRange(client, "1"));
    assert.deepEqual(calls.map((call) => call.operation), ["store"]);
  }
});

test("a rejected initial STORE preserves the error and does not claim a known partial mutation", async () => {
  const error = Object.assign(new Error("synthetic store failure"), { code: "ECONNRESET" });
  const { client, calls } = harness({ store: () => { throw error; } });
  await assert.rejects(() => deleteUidRange(client, "1"), (caught) => caught === error && caught.partial !== true);
  assert.deepEqual(calls.map((call) => call.operation), ["store"]);
});

test("an initial STORE error already marked partial retains that metadata", async () => {
  const error = Object.assign(new Error("synthetic partial store"), { partial: true });
  const { client } = harness({ store: () => { throw error; } });
  await assert.rejects(() => deleteUidRange(client, "1"), (caught) => caught === error && caught.partial === true);
});

test("only literal true from messageDelete proceeds to verification, with failures marked partial", async () => {
  for (const value of [false, undefined, null, 0, 1, "true", {}]) {
    const { client, calls } = harness({ remove: () => value });
    await failsAsPartial(() => deleteUidRange(client, "1"));
    assert.deepEqual(calls.map((call) => call.operation), ["store", "delete"]);
  }
});

test("delete rejection after a confirmed STORE retains its code and is partial", async () => {
  const error = Object.assign(new Error("synthetic connection loss"), { code: "ECONNRESET" });
  const { client, calls } = harness({ remove: () => { throw error; } });
  await assert.rejects(() => deleteUidRange(client, "1"), (caught) => caught === error && caught.partial === true);
  assert.deepEqual(calls.map((call) => call.operation), ["store", "delete"]);
});

test("non-Error rejections after confirmed STORE become partial errors rather than false success", async () => {
  for (const reason of [null, undefined, false, "synthetic rejection"]) {
    const { client } = harness({ remove: () => { throw reason; } });
    await assert.rejects(() => deleteUidRange(client, "1"), (error) => error instanceof Error && error.partial === true);
  }
});

test("a confirmed bounded UID SEARCH containing any remaining UID fails as partial", async () => {
  const { client, calls } = harness({ search: () => [1, 2] });
  await failsAsPartial(() => deleteUidRange(client, "1:2"));
  assert.deepEqual(calls.map((call) => call.operation), ["store", "delete", "search"]);
});

test("a verification error preserves the cause and partial status", async () => {
  const error = Object.assign(new Error("synthetic search interruption"), { code: "ECONNRESET" });
  const { client } = harness({ search: () => { throw error; } });
  await assert.rejects(() => deleteUidRange(client, "1:2"), (caught) => caught === error && caught.partial === true);
});

test("failed or malformed UID SEARCH results are never treated as proof of absence", async () => {
  for (const result of [false, undefined, null, true, "", {}, { length: 0 }, { all: "" }, new Set()]) {
    const { client } = harness({ search: () => result });
    await failsAsPartial(() => deleteUidRange(client, "1"));
  }
});

test("UIDs already absent from a successfully checked mailbox can complete idempotently", async () => {
  const { client, calls } = harness();
  assert.equal(await deleteUidRange(client, "123,456"), true);
  assert.equal(calls.at(-1).operation, "search");
});

for (const stage of ["store", "remove", "search"]) {
  test(`mailbox or connection changes after ${stage} prevent a false successful deletion`, async () => {
    for (const change of [
      (client) => { client.usable = false; },
      (client) => { client.mailbox = false; },
      (client) => { client.mailbox.path = "Other"; },
      (client) => { client.mailbox.uidValidity = 456n; },
      (client) => { delete client.mailbox.uidValidity; }
    ]) {
      const behavior = stage === "search"
        ? { search: (client) => { change(client); return []; } }
        : { [stage]: (client) => { change(client); return true; } };
      const { client, calls } = harness(behavior);
      await failsAsPartial(() => deleteUidRange(client, "1"));
      assert.equal(calls.length, stage === "store" ? 1 : stage === "remove" ? 2 : 3);
    }
  });
}

test("the guard compares captured metadata values rather than only mailbox object identity", async () => {
  const { client } = harness({ remove: (selected) => { selected.mailbox.uidValidity = 124n; return true; } });
  await failsAsPartial(() => deleteUidRange(client, "1"));
});

test("verification never invokes ambiguous FETCH, rollback or individual retry commands", async () => {
  const { client, calls } = harness({ search: () => [5] });
  for (const method of ["fetch", "fetchAll", "messageFlagsRemove", "exec", "run", "mailboxOpen"]) {
    client[method] = () => assert.fail(`must not call ${method}`);
  }
  await failsAsPartial(() => deleteUidRange(client, "5"));
  assert.deepEqual(calls.map((call) => call.operation), ["store", "delete", "search"]);
});

for (const stage of ["store", "remove", "search"]) {
  test(`the ${stage} stage requires a tagged OK and rejects every non-OK despite a success-shaped result`, async () => {
    for (const events of [
      [], [{ response: "NO" }], [{ response: "BAD" }], [{ response: "BYE" }], [{ response: "PREAUTH" }],
      [{ response: "OK" }, { response: "NO" }], [{ response: "BAD" }, { response: "OK" }],
      [{ response: "synthetic-private-host", code: "synthetic-password" }], [{ code: "synthetic-token" }], [null]
    ]) {
      const { client, calls } = harness({ responses: { [stage]: events } });
      await assert.rejects(() => deleteUidRange(client, "1"), (error) => {
        assert.equal(error.partial === true, stage !== "store");
        assert.doesNotMatch(error.message, /synthetic-/);
        return true;
      });
      assert.equal(calls.length, stage === "store" ? 1 : stage === "remove" ? 2 : 3);
      assert.equal(client.listenerCount("response"), 0);
    }
  });
}

test("response guards preserve pre-existing listeners and remove their own listener on success and rejection", async () => {
  for (const behavior of [{}, { remove: () => { throw new Error("synthetic failure"); } }]) {
    const { client } = harness(behavior);
    const received = [];
    const observer = (event) => received.push(event);
    client.on("response", observer);
    try {
      if (behavior.remove) await failsAsPartial(() => deleteUidRange(client, "1"));
      else assert.equal(await deleteUidRange(client, "1"), true);
      assert.deepEqual(client.listeners("response"), [observer]);
      client.emit("response", { response: "NO" });
      assert.ok(received.length >= 2);
      assert.deepEqual(client.listeners("response"), [observer]);
    } finally { client.removeListener("response", observer); }
  }
});

test("the messageDelete guard accepts multiple successful internal commands without an exact count", async () => {
  const { client } = harness({ responses: { remove: [{ response: "OK" }, { response: "OK" }] } });
  assert.equal(await deleteUidRange(client, "1"), true);
  assert.equal(client.listenerCount("response"), 0);
});

test("tagged OK comparison follows case-insensitive IMAP keyword semantics", async () => {
  const { client } = harness({ responses: {
    store: [{ response: "ok" }], remove: [{ response: "oK" }, { response: "Ok" }], search: [{ response: "ok" }]
  } });
  assert.equal(await deleteUidRange(client, "1"), true);
  assert.equal(client.listenerCount("response"), 0);
});
