"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");

const registerAccount = require("../nodes/imap-email-account");

function createAccount(config = {}, credentials = { username: "fixture-user", password: "fixture-password" }) {
  let Account;
  const warnings = [];
  registerAccount({ nodes: {
    createNode(node) {
      const events = new EventEmitter();
      node.on = events.on.bind(events);
      node.emit = events.emit.bind(events);
      node.warn = (message) => warnings.push(message);
    },
    registerType(type, constructor) { Account = constructor; }
  } });
  const account = new Account({ host: "imap.example.test", secure: true, ...config });
  account.credentials = credentials;
  return { account, warnings };
}

test("verification client uses the same credentials, TLS and stage timeouts as work clients", () => {
  const { account } = createAccount({ port: 1993, tlsRejectUnauthorized: false,
    connectionTimeout: 12000, greetingTimeout: 13000, socketTimeout: 14000 });
  const work = account.createClient();
  const probe = account.createClient({ verifyOnly: true });
  assert.equal(probe.options.verifyOnly, true);
  assert.equal(probe.options.includeMailboxes, false);
  assert.equal(probe.options.logger, false);
  assert.equal(Object.hasOwn(work.options, "verifyOnly"), false);
  assert.equal(Object.hasOwn(work.options, "includeMailboxes"), false);
  const { verifyOnly, includeMailboxes, ...probeOptions } = probe.options;
  assert.deepEqual(probeOptions, work.options);
  assert.equal(probe.options.port, 1993);
  assert.equal(probe.options.tls.rejectUnauthorized, false);
  assert.equal(probe.options.connectionTimeout, 12000);
  assert.equal(probe.options.greetingTimeout, 13000);
  assert.equal(probe.options.socketTimeout, 14000);
  assert.deepEqual(probe.options.auth, { user: "fixture-user", pass: "fixture-password" });
});

test("verification preserves access-token priority over a stored password", () => {
  const { account } = createAccount({}, {
    username: "fixture-user", password: "fixture-password", accessToken: "fixture-token"
  });
  const probe = account.createClient({ verifyOnly: true });
  assert.deepEqual(probe.options.auth, { user: "fixture-user", accessToken: "fixture-token" });
});

for (const [config, credentials, code] of [
  [{ host: " " }, { username: "fixture-user", password: "fixture-password" }, "IMAP_EMAIL_MISSING_HOST"],
  [{}, { password: "fixture-password" }, "IMAP_EMAIL_MISSING_USERNAME"],
  [{}, { username: "fixture-user" }, "IMAP_EMAIL_MISSING_CREDENTIALS"]
]) {
  test(`verification validation has a stable safe code: ${code}`, () => {
    const { account } = createAccount(config, credentials);
    assert.throws(() => account.createClient({ verifyOnly: true }), { code });
  });
}

test("verification error-handler fallback never logs server or callback secrets", () => {
  const { account, warnings } = createAccount();
  const probe = account.createClient({ verifyOnly: true, context: "private-endpoint",
    onError() { throw new Error("callback contains fixture-password and fixture-token"); } });
  const error = Object.assign(new Error("server contains fixture-password"), { code: "fixture-token" });
  assert.doesNotThrow(() => { probe.emit("error", error); probe.emit("error", error); });
  assert.deepEqual(warnings, ["IMAP connection check: error handler failed"]);
});

test("unused and closed account instances never create a verification client", async () => {
  const { account, warnings } = createAccount();
  let clients = 0;
  account.createClient = () => { clients += 1; throw new Error("must not create"); };
  await new Promise(setImmediate);
  assert.equal(clients, 0);
  account.emit("close");
  account.requestConnectionCheck(() => assert.fail("closed account must not publish status"));
  await new Promise(setImmediate);
  assert.equal(clients, 0);
  assert.deepEqual(warnings, []);
});

test("account-created IMAP clients handle asynchronous error events", () => {
  let AccountCtor;
  const warnings = [];

  const RED = {
    nodes: {
      createNode(node) {
        node.id = "account-1";
        node.warn = (message) => warnings.push(message);
        node.error = () => {};
        node.status = () => {};
        node.on = () => {};
      },
      registerType(type, ctor) {
        if (type === "imap-email account") {
          AccountCtor = ctor;
        }
      }
    }
  };

  registerAccount(RED);
  assert.equal(typeof AccountCtor, "function");

  const account = new AccountCtor({
    host: "imap.example.test",
    port: "993",
    secure: true,
    tlsRejectUnauthorized: true,
    connectionTimeout: "30000",
    greetingTimeout: "30000",
    socketTimeout: "300000"
  });
  account.credentials = {
    username: "user@example.test",
    password: "secret"
  };

  const client = account.createClient({ context: "test client" });
  let closeAfterCalls = 0;
  client.closeAfter = () => {
    closeAfterCalls += 1;
  };

  assert.doesNotThrow(() => {
    const err = new Error("read ECONNRESET");
    err.code = "ECONNRESET";
    client.emit("error", err);
  });

  assert.equal(warnings.length, 1);
  assert.equal(closeAfterCalls, 0);
  assert.match(warnings[0], /test client IMAP connection error: read ECONNRESET \(ECONNRESET\)/);
});

test("account createClient fails clearly when host is missing", () => {
  let AccountCtor;

  const RED = {
    nodes: {
      createNode(node) {
        node.id = "account-1";
        node.warn = () => {};
        node.error = () => {};
        node.status = () => {};
        node.on = () => {};
      },
      registerType(type, ctor) {
        if (type === "imap-email account") {
          AccountCtor = ctor;
        }
      }
    }
  };

  registerAccount(RED);
  const account = new AccountCtor({
    host: "",
    port: "993",
    secure: true,
    tlsRejectUnauthorized: true,
    connectionTimeout: "30000",
    greetingTimeout: "30000",
    socketTimeout: "300000"
  });
  account.credentials = {
    username: "user@example.test",
    password: "secret"
  };

  assert.throws(
    () => account.createClient(),
    /IMAP host is missing in imap email account configuration/
  );
});
