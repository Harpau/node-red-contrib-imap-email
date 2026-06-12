"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const registerAccount = require("../nodes/imap-email-account");

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

  assert.doesNotThrow(() => {
    const err = new Error("read ECONNRESET");
    err.code = "ECONNRESET";
    client.emit("error", err);
  });

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /test client IMAP connection error: read ECONNRESET \(ECONNRESET\)/);
});
