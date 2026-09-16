"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const {
  CHECK_TIMEOUT_MS, connectionErrorStatus, createConnectionChecker, createConnectionStatus
} = require("../lib/imap-connection-check");

const CHECKING = { fill: "yellow", shape: "ring", text: "checking connection" };
const CONNECTED = { fill: "green", shape: "dot", text: "connected" };
const failure = (text) => ({ fill: "red", shape: "ring", text });

function fakeScheduler() {
  let now = 0;
  let next = 0;
  const immediates = new Map();
  const timers = new Map();
  return {
    setImmediate(callback) { const id = ++next; immediates.set(id, callback); return id; },
    clearImmediate(id) { immediates.delete(id); },
    setTimeout(callback, ms) { const id = ++next; timers.set(id, { callback, time: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    tick() {
      for (const [id, callback] of [...immediates]) {
        if (immediates.delete(id)) callback();
      }
    },
    advance(ms) {
      const until = now + ms;
      while (true) {
        const due = [...timers].filter(([, value]) => value.time <= until).sort((a, b) => a[1].time - b[1].time)[0];
        if (!due) break;
        const [id, value] = due;
        now = value.time;
        timers.delete(id);
        value.callback();
      }
      now = until;
    },
    get pending() { return immediates.size + timers.size; },
    get pendingTimers() { return timers.size; }
  };
}

async function flushPromises() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(config = {}) {
  const scheduler = config.scheduler || fakeScheduler();
  const clients = [];
  const warnings = [];
  const checker = createConnectionChecker({
    createClient(options) {
      if (Object.hasOwn(config, "factoryError")) throw config.factoryError;
      const connection = deferred();
      const client = Object.assign(new EventEmitter(), {
        authenticated: false, isClosed: false, closeCalls: 0, connectCalls: 0,
        options, connection,
        connect() {
          this.connectCalls += 1;
          if (Object.hasOwn(config, "connectError")) throw config.connectError;
          return connection.promise;
        },
        close() {
          this.closeCalls += 1;
          this.isClosed = true;
          this.emit("close");
          if (config.errorDuringClose) this.emit("error", config.errorDuringClose);
          if (config.closeThrows) throw new Error("synthetic secret in close error");
        }
      });
      client.on("error", options.onError);
      clients.push(client);
      if (Object.hasOwn(config, "factoryCallbackError")) options.onError(config.factoryCallbackError);
      return client;
    },
    warn(message) {
      warnings.push(message);
      if (config.warnThrows) throw new Error("synthetic secret in logger");
    }
  }, scheduler);
  return { checker, scheduler, clients, warnings };
}

async function start(h) {
  h.scheduler.tick();
  await flushPromises();
}

async function succeed(h, client = h.clients.at(-1)) {
  client.authenticated = true;
  client.close();
  client.connection.resolve();
  await flushPromises();
  h.scheduler.tick();
}

function assertClean(h, client = h.clients.at(-1)) {
  assert.equal(h.scheduler.pending, 0, "no delayed starts, close checks or deadlines remain");
  if (client) assert.equal(client.listenerCount("close"), 0, "probe close listener is detached");
}

test("connection errors become fixed safe statuses across all supported categories", () => {
  const groups = {
    "missing host": ["IMAP_EMAIL_MISSING_HOST"],
    "missing username": ["IMAP_EMAIL_MISSING_USERNAME"],
    "missing credentials": ["IMAP_EMAIL_MISSING_CREDENTIALS"],
    "host not found": ["ENOTFOUND", "EAI_AGAIN"],
    "connection refused": ["ECONNREFUSED"],
    "connection timeout": ["CONNECT_TIMEOUT", "GREETING_TIMEOUT", "UPGRADE_TIMEOUT", "ETIMEOUT", "ETIMEDOUT", "SocketTimeout", "IMAP_EMAIL_CHECK_TIMEOUT"],
    "connection lost": ["ECONNRESET", "ECONNABORTED", "EPIPE", "NoConnection", "ClosedAfterConnectTLS", "ClosedAfterConnectText", "IMAP_EMAIL_CHECK_CLOSED"],
    "TLS certificate error": ["CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "CERT_REVOKED", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "ERR_TLS_CERT_ALTNAME_INVALID"],
    "TLS connection error": ["ERR_TLS_HANDSHAKE_TIMEOUT", "ERR_SSL_WRONG_VERSION_NUMBER", "ERR_TLS_synthetic-private-endpoint"],
    "authentication failed": ["AuthenticationFailure"],
    "connection failed": ["UNKNOWN_synthetic-secret", "__proto__", "constructor"]
  };
  for (const [text, codes] of Object.entries(groups)) {
    for (const code of codes) {
      const error = { code, message: "synthetic password fixture-secret", response: "private.fixture.invalid" };
      assert.deepEqual(connectionErrorStatus(error), failure(text), code);
    }
  }
  assert.deepEqual(connectionErrorStatus({ authenticationFailed: true, code: "ECONNRESET" }), failure("authentication failed"));
  assert.deepEqual(connectionErrorStatus({ tlsFailed: true, code: "UNKNOWN_fixture-secret" }), failure("TLS connection error"));
  assert.deepEqual(connectionErrorStatus({ tlsFailed: true, code: "CERT_HAS_EXPIRED" }), failure("TLS certificate error"));
  assert.deepEqual(connectionErrorStatus({ tlsFailed: true, code: "UPGRADE_TIMEOUT" }), failure("connection timeout"));
  for (const error of [null, undefined, "fixture-secret", {}, { code: { toString() { throw new Error("must not stringify"); } } }]) {
    assert.deepEqual(connectionErrorStatus(error), failure("connection failed"));
  }
});

test("one account shares its running probe, includes late subscribers and starts fresh after completion", async () => {
  const h = harness();
  const first = [];
  const second = [];
  const late = [];
  h.checker.subscribe((status) => first.push(status));
  h.checker.subscribe((status) => second.push(status));
  assert.equal(h.clients.length, 0, "construction is deferred past subscription");
  await start(h);
  h.checker.subscribe((status) => late.push(status));
  assert.equal(h.clients.length, 1);
  assert.equal(h.clients[0].connectCalls, 1);
  assert.equal(h.clients[0].options.verifyOnly, true);
  assert.equal(h.scheduler.pendingTimers, 1);
  assert.deepEqual(late, [CHECKING]);
  await succeed(h);
  for (const statuses of [first, second, late]) assert.deepEqual(statuses, [CHECKING, CONNECTED]);
  assert.deepEqual(h.warnings, []);
  assertClean(h);
  const fresh = [];
  h.checker.subscribe((status) => fresh.push(status));
  await start(h);
  assert.equal(h.clients.length, 2);
  assert.deepEqual(fresh, [CHECKING]);
  await succeed(h);
  assert.deepEqual(fresh, [CHECKING, CONNECTED]);
  assertClean(h);
});

test("separate account coordinators never share a probe or its outcome", async () => {
  const scheduler = fakeScheduler();
  const a = harness({ scheduler });
  const b = harness({ scheduler });
  const aStatuses = [];
  const bStatuses = [];
  a.checker.subscribe((status) => aStatuses.push(status));
  b.checker.subscribe((status) => bStatuses.push(status));
  await start(a);
  assert.equal(a.clients.length, 1);
  assert.equal(b.clients.length, 1);
  a.clients[0].connection.reject({ authenticationFailed: true });
  await flushPromises();
  assert.deepEqual(aStatuses, [CHECKING, failure("authentication failed")]);
  assert.deepEqual(bStatuses, [CHECKING]);
  await succeed(b);
  assert.deepEqual(bStatuses, [CHECKING, CONNECTED]);
  assertClean(a);
  assertClean(b);
});

test("a normal authenticated close before connect resolves is successful", async () => {
  const h = harness();
  const statuses = [];
  h.checker.subscribe((status) => statuses.push(status));
  await start(h);
  const client = h.clients[0];
  client.authenticated = true;
  client.close();
  h.scheduler.tick();
  assert.deepEqual(statuses, [CHECKING], "a normal close alone neither fails nor claims success");
  client.connection.resolve();
  await flushPromises();
  assert.deepEqual(statuses, [CHECKING, CONNECTED]);
  assert.equal(client.closeCalls, 1);
  assertClean(h);
});

test("an unauthenticated early close produces one connection-lost result", async () => {
  const h = harness();
  const statuses = [];
  h.checker.subscribe((status) => statuses.push(status));
  await start(h);
  const client = h.clients[0];
  client.close();
  h.scheduler.tick();
  client.connection.reject(new Error("private server content"));
  await flushPromises();
  assert.deepEqual(statuses, [CHECKING, failure("connection lost")]);
  assert.equal(h.warnings.length, 1);
  assertClean(h);
});

test("connect resolving without authenticated state cannot report connected", async () => {
  const h = harness();
  const statuses = [];
  h.checker.subscribe((status) => statuses.push(status));
  await start(h);
  h.clients[0].connection.resolve();
  await flushPromises();
  assert.deepEqual(statuses, [CHECKING, failure("connection lost")]);
  assert.equal(h.clients[0].closeCalls, 1);
  assertClean(h);
});

for (const authenticated of [false, true]) {
  test(`the fixed total deadline closes an authenticated=${authenticated} stalled session once`, async () => {
    const hostile = { code: "fixture-secret", message: "fixture-private-endpoint" };
    const h = harness({ errorDuringClose: hostile });
    const a = [];
    const b = [];
    h.checker.subscribe((status) => a.push(status));
    h.checker.subscribe((status) => b.push(status));
    await start(h);
    const client = h.clients[0];
    client.authenticated = authenticated;
    assert.equal(CHECK_TIMEOUT_MS, 30000);
    h.scheduler.advance(29999);
    client.emit("data", "synthetic keepalive");
    assert.deepEqual(a, [CHECKING]);
    h.scheduler.advance(1);
    assert.equal(client.closeCalls, 1);
    assert.equal(client.isClosed, true);
    for (const statuses of [a, b]) assert.deepEqual(statuses, [CHECKING, failure("connection timeout")]);
    assert.deepEqual(h.warnings, ["IMAP connection check: connection timeout"]);
    client.emit("error", hostile);
    client.emit("close");
    client.connection.reject(hostile);
    await flushPromises();
    h.scheduler.advance(60000);
    assert.equal(a.length, 2);
    assert.equal(h.warnings.length, 1);
    assertClean(h);
  });
}

test("an earlier configured client timeout beats the total deadline", async () => {
  const h = harness();
  const statuses = [];
  h.checker.subscribe((status) => statuses.push(status));
  await start(h);
  h.scheduler.advance(1000);
  h.clients[0].emit("error", { code: "GREETING_TIMEOUT", message: "fixture-secret" });
  h.clients[0].connection.reject({ code: "GREETING_TIMEOUT" });
  await flushPromises();
  h.scheduler.advance(CHECK_TIMEOUT_MS);
  assert.deepEqual(statuses, [CHECKING, failure("connection timeout")]);
  assert.equal(h.warnings.length, 1);
  assert.equal(h.clients[0].closeCalls, 1);
  assertClean(h);
});

for (const [code, expected] of [
  ["IMAP_EMAIL_MISSING_HOST", "missing host"],
  ["IMAP_EMAIL_MISSING_USERNAME", "missing username"],
  ["IMAP_EMAIL_MISSING_CREDENTIALS", "missing credentials"],
  ["UNKNOWN_fixture-secret", "connection failed"]
]) {
  test(`a synchronous client factory error gives ${expected} and clears its deadline`, async () => {
    const h = harness({ factoryError: { code, message: "private fixture password" } });
    const statuses = [];
    h.checker.subscribe((status) => statuses.push(status));
    await start(h);
    assert.deepEqual(statuses, [CHECKING, failure(expected)]);
    assert.equal(h.clients.length, 0);
    assert.deepEqual(h.warnings, [`IMAP connection check: ${expected}`]);
    assertClean(h);
  });
}

test("a synchronous connect throw is handled without an unhandled rejection", async () => {
  const h = harness({ connectError: { code: "ECONNREFUSED", message: "fixture-secret" } });
  const statuses = [];
  h.checker.subscribe((status) => statuses.push(status));
  await start(h);
  assert.deepEqual(statuses, [CHECKING, failure("connection refused")]);
  assert.equal(h.clients[0].closeCalls, 1);
  assertClean(h);
});

test("a synchronous factory error callback closes the subsequently returned client", async () => {
  const h = harness({ factoryCallbackError: { code: "ECONNRESET" } });
  const statuses = [];
  h.checker.subscribe((status) => statuses.push(status));
  await start(h);
  assert.deepEqual(statuses, [CHECKING, failure("connection lost")]);
  assert.equal(h.clients[0].connectCalls, 0);
  assert.equal(h.clients[0].closeCalls, 1);
  assertClean(h);
});

test("falsy rejection, throw and event reasons always fail instead of reporting connected", async () => {
  for (const reason of [undefined, null, false, 0, ""]) {
    for (const source of ["factory", "factoryCallback", "connectThrow", "rejection", "event"]) {
      const config = source === "factory" ? { factoryError: reason }
        : source === "factoryCallback" ? { factoryCallbackError: reason }
          : source === "connectThrow" ? { connectError: reason } : {};
      const h = harness(config);
      const statuses = [];
      h.checker.subscribe((status) => statuses.push(status));
      await start(h);
      if (source === "rejection" || source === "event") {
        const client = h.clients[0];
        client.authenticated = true;
        if (source === "event") client.emit("error", reason);
        client.connection.reject(reason);
        await flushPromises();
      }
      assert.deepEqual(statuses, [CHECKING, failure("connection failed")], `${source} with ${String(reason)}`);
      assert.deepEqual(h.warnings, ["IMAP connection check: connection failed"]);
      assertClean(h);
    }
  }
});

test("unsubscribing before the deferred start creates no client or status", async () => {
  const h = harness();
  const statuses = [];
  const unsubscribe = h.checker.subscribe((status) => statuses.push(status));
  unsubscribe();
  unsubscribe();
  await start(h);
  assert.deepEqual(statuses, []);
  assert.deepEqual(h.clients, []);
  assert.deepEqual(h.warnings, []);
  assertClean(h);
});

test("one closing subscriber preserves a shared probe, but the final subscriber cancels it", async () => {
  const h = harness();
  const first = [];
  const second = [];
  const leaveFirst = h.checker.subscribe((status) => first.push(status));
  const leaveSecond = h.checker.subscribe((status) => second.push(status));
  await start(h);
  leaveFirst();
  assert.equal(h.clients[0].closeCalls, 0);
  assert.equal(h.scheduler.pendingTimers, 1);
  leaveSecond();
  assert.equal(h.clients[0].closeCalls, 1);
  h.clients[0].emit("error", { code: "ECONNRESET", message: "fixture-secret" });
  h.clients[0].connection.reject(new Error("fixture-private-endpoint"));
  await flushPromises();
  assert.deepEqual(first, [CHECKING]);
  assert.deepEqual(second, [CHECKING]);
  assert.deepEqual(h.warnings, []);
  assertClean(h);
});

test("a remaining subscriber receives success after another subscriber leaves", async () => {
  const h = harness();
  const first = [];
  const second = [];
  const leave = h.checker.subscribe((status) => first.push(status));
  h.checker.subscribe((status) => second.push(status));
  await start(h);
  leave();
  await succeed(h);
  assert.deepEqual(first, [CHECKING]);
  assert.deepEqual(second, [CHECKING, CONNECTED]);
  assertClean(h);
});

for (const started of [false, true]) {
  test(`account close with started=${started} silently aborts and prevents future subscriptions`, async () => {
    const h = harness();
    const statuses = [];
    h.checker.subscribe((status) => statuses.push(status));
    if (started) await start(h);
    h.checker.close();
    h.checker.close();
    h.checker.subscribe(() => assert.fail("closed account cannot deliver"))();
    await start(h);
    assert.deepEqual(statuses, started ? [CHECKING] : []);
    assert.equal(h.clients.length, started ? 1 : 0);
    if (started) {
      assert.equal(h.clients[0].closeCalls, 1);
      h.clients[0].emit("error", new Error("fixture-secret"));
      h.clients[0].connection.reject(new Error("late fixture-secret"));
      await flushPromises();
    }
    assert.deepEqual(h.warnings, []);
    assertClean(h);
  });
}

test("cancel between client creation and the connect microtask prevents a late connection", async () => {
  const h = harness();
  const leave = h.checker.subscribe(() => {});
  h.scheduler.tick();
  assert.equal(h.clients.length, 1);
  assert.equal(h.clients[0].connectCalls, 0);
  leave();
  await flushPromises();
  assert.equal(h.clients[0].connectCalls, 0);
  assert.equal(h.clients[0].closeCalls, 1);
  assertClean(h);
});

test("an old cancelled generation cannot affect a new probe or remove its shared slot", async () => {
  const h = harness();
  const oldStatuses = [];
  const newStatuses = [];
  const joinedStatuses = [];
  const leave = h.checker.subscribe((status) => oldStatuses.push(status));
  await start(h);
  const old = h.clients[0];
  leave();
  h.checker.subscribe((status) => newStatuses.push(status));
  await start(h);
  old.emit("error", { authenticationFailed: true, message: "fixture-secret" });
  old.emit("close");
  old.connection.reject(new Error("late rejection fixture-secret"));
  await flushPromises();
  h.checker.subscribe((status) => joinedStatuses.push(status));
  assert.equal(h.clients.length, 2, "late settlement must not remove the new shared slot");
  await succeed(h);
  assert.deepEqual(oldStatuses, [CHECKING]);
  assert.deepEqual(newStatuses, [CHECKING, CONNECTED]);
  assert.deepEqual(joinedStatuses, [CHECKING, CONNECTED]);
  assert.deepEqual(h.warnings, []);
  assertClean(h);
});

test("late errors after success cannot add warnings or change the completed result", async () => {
  const h = harness();
  const statuses = [];
  h.checker.subscribe((status) => statuses.push(status));
  await start(h);
  await succeed(h);
  h.clients[0].emit("error", { code: "ECONNRESET" });
  h.clients[0].emit("close");
  h.scheduler.advance(60000);
  assert.deepEqual(statuses, [CHECKING, CONNECTED]);
  assert.deepEqual(h.warnings, []);
  assertClean(h);
});

test("throwing subscribers are isolated and their error content never reaches warning text", async () => {
  const h = harness({ warnThrows: true });
  const statuses = [];
  h.checker.subscribe(() => { throw new Error("fixture-secret@private-endpoint"); });
  h.checker.subscribe((status) => statuses.push(status));
  await start(h);
  h.checker.subscribe(() => { throw new Error("late subscriber fixture-secret"); });
  h.clients[0].connection.reject({ code: "UNKNOWN_fixture-secret", message: "private endpoint" });
  await flushPromises();
  assert.deepEqual(statuses, [CHECKING, failure("connection failed")]);
  assert.deepEqual(h.warnings, ["IMAP connection check: status callback failed"]);
  assertClean(h);
});

test("a callback may cancel during checking without creating a client", async () => {
  const h = harness();
  let leave;
  leave = h.checker.subscribe(() => leave());
  await start(h);
  assert.deepEqual(h.clients, []);
  assert.deepEqual(h.warnings, []);
  assertClean(h);
});

test("delivery copies statuses so a subscriber cannot corrupt another subscriber", async () => {
  const h = harness();
  const statuses = [];
  h.checker.subscribe((status) => { status.text = "mutated"; });
  h.checker.subscribe((status) => statuses.push(status));
  await start(h);
  await succeed(h);
  assert.deepEqual(statuses, [CHECKING, CONNECTED]);
  assertClean(h);
});

test("reentrant new subscriptions during completion receive a fresh probe", async () => {
  const h = harness();
  const fresh = [];
  h.checker.subscribe((status) => {
    if (status.text === "connected") h.checker.subscribe((next) => fresh.push(next));
  });
  await start(h);
  await succeed(h);
  await flushPromises();
  assert.equal(h.clients.length, 2);
  await succeed(h);
  assert.deepEqual(fresh, [CHECKING, CONNECTED]);
  assertClean(h);
});

test("a throwing close implementation does not prevent settled status or timer cleanup", async () => {
  const h = harness({ closeThrows: true });
  const statuses = [];
  h.checker.subscribe((status) => statuses.push(status));
  await start(h);
  h.clients[0].connection.reject({ code: "ECONNREFUSED" });
  await flushPromises();
  assert.deepEqual(statuses, [CHECKING, failure("connection refused")]);
  assert.deepEqual(h.warnings, ["IMAP connection check: connection refused"]);
  assertClean(h);
});

test("repeated success and cancellation cycles leave no accumulated scheduler handles or listeners", async () => {
  const h = harness();
  for (let index = 0; index < 40; index += 1) {
    const leave = h.checker.subscribe(() => {});
    await start(h);
    if (index % 2) {
      leave();
      h.clients.at(-1).connection.reject(new Error("late synthetic cancellation"));
      await flushPromises();
    } else await succeed(h);
    assertClean(h);
  }
  assert.equal(h.clients.length, 40);
  assert.ok(h.clients.every((client) => client.isClosed && client.closeCalls === 1));
  assert.deepEqual(h.warnings, []);
});

function statusHarness(t) {
  const scheduler = fakeScheduler();
  t.mock.method(global, "setImmediate", scheduler.setImmediate);
  t.mock.method(global, "clearImmediate", scheduler.clearImmediate);
  const statuses = [];
  const callbacks = [];
  let leaves = 0;
  const account = {
    requestConnectionCheck(callback) {
      callbacks.push(callback);
      return () => { leaves += 1; };
    }
  };
  const status = createConnectionStatus({ status: (value) => statuses.push(value) });
  return { scheduler, statuses, callbacks, account, status, get leaves() { return leaves; } };
}

test("node connection status subscribes after initialization and displays the complete check sequence", (t) => {
  const h = statusHarness(t);
  h.status.start(h.account);
  assert.equal(h.callbacks.length, 0);
  assert.deepEqual(h.statuses, []);
  h.scheduler.tick();
  h.callbacks[0](CHECKING);
  h.callbacks[0](CONNECTED);
  assert.deepEqual(h.statuses, [CHECKING, CONNECTED]);
  h.status.close();
  assert.equal(h.leaves, 1);
  assert.equal(h.scheduler.pending, 0);
});

test("finished business work retains priority over late check success and failure", (t) => {
  const h = statusHarness(t);
  h.status.start(h.account);
  h.scheduler.tick();
  h.callbacks[0](CHECKING);
  const running = { fill: "blue", shape: "dot", text: "ACK batch 1" };
  const finished = { fill: "green", shape: "dot", text: "ACK completed" };
  h.status.set(running);
  h.status.set(finished);
  h.callbacks[0](CONNECTED);
  h.callbacks[0](failure("connection timeout"));
  assert.deepEqual(h.statuses, [CHECKING, running, finished]);
  h.status.close();
  assert.equal(h.scheduler.pending, 0);
});

test("an initial configuration error takes priority over all connection-check statuses", (t) => {
  const h = statusHarness(t);
  const invalid = failure("Invalid ACK configuration");
  h.status.set(invalid);
  h.status.start(h.account);
  h.scheduler.tick();
  h.callbacks[0](CHECKING);
  h.callbacks[0](CONNECTED);
  h.callbacks[0](failure("authentication failed"));
  assert.deepEqual(h.statuses, [invalid]);
  h.status.close();
  assert.equal(h.leaves, 1);
  assert.equal(h.scheduler.pending, 0);
});

test("node status close before start cancels the scheduled subscription", (t) => {
  const h = statusHarness(t);
  h.status.start(h.account);
  h.status.close();
  h.status.close();
  h.scheduler.tick();
  h.status.set(CONNECTED);
  assert.equal(h.callbacks.length, 0);
  assert.equal(h.leaves, 0);
  assert.deepEqual(h.statuses, []);
  assert.equal(h.scheduler.pending, 0);
});

test("node status close after start unsubscribes once and suppresses all stale status sources", (t) => {
  const h = statusHarness(t);
  h.status.start(h.account);
  h.scheduler.tick();
  h.callbacks[0](CHECKING);
  h.status.close();
  h.status.close();
  h.callbacks[0](CONNECTED);
  h.status.set(failure("late business error"));
  assert.equal(h.leaves, 1);
  assert.deepEqual(h.statuses, [CHECKING]);
  assert.equal(h.scheduler.pending, 0);
});

test("closing during the synchronous status of a joined check releases its subscription", (t) => {
  const h = statusHarness(t);
  h.account.requestConnectionCheck = (callback) => {
    callback(CHECKING);
    h.status.close();
    return () => { h.callbacks.push("left"); };
  };
  h.status.start(h.account);
  h.scheduler.tick();
  h.status.close();
  assert.deepEqual(h.statuses, [CHECKING]);
  assert.deepEqual(h.callbacks, ["left"]);
  assert.equal(h.scheduler.pending, 0);
});

test("business work can recover after a failed deploy check without another subscription", (t) => {
  const h = statusHarness(t);
  h.status.start(h.account);
  h.scheduler.tick();
  h.callbacks[0](CHECKING);
  h.callbacks[0](failure("authentication failed"));
  const active = { fill: "blue", shape: "dot", text: "triggered" };
  const done = { fill: "green", shape: "ring", text: "empty" };
  h.status.set(active);
  h.status.set(done);
  assert.deepEqual(h.statuses, [CHECKING, failure("authentication failed"), active, done]);
  assert.equal(h.callbacks.length, 1);
  h.status.close();
});
