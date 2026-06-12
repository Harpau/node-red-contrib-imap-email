"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { extractAckToken } = require("../lib/ack-token");
const registry = require("../lib/runtime-registry");
const registerImapEmailAck = require("../nodes/imap-email-ack");

function loadAckActions() {
  return require("../lib/imap-ack-actions");
}

function sampleToken(uid = 123) {
  return {
    accountId: "account-1",
    queueKey: "queue-1",
    host: "imap.example.test",
    port: 993,
    secure: true,
    user: "user@example.test",
    mailbox: "INBOX",
    uid,
    uidValidity: "uidv-1"
  };
}

function createConnectionError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function createAckNode(config = {}, clientFactory) {
  let AckCtor;
  const statuses = [];
  const warnings = [];
  const errors = [];
  const sends = [];
  const account = {
    id: "account-1",
    host: "imap.example.test",
    port: 993,
    secure: true,
    getUsername() {
      return "user@example.test";
    },
    createClient: clientFactory
  };
  const RED = {
    nodes: {
      createNode(node) {
        node.id = "ack-node-1";
        node.status = (status) => statuses.push(status);
        node.warn = (message) => warnings.push(message);
        node.error = (err) => errors.push(err);
        node.send = (output) => sends.push(output);
        node.on = () => {};
      },
      getNode(id) {
        return id === "account-1" ? account : null;
      },
      registerType(type, ctor) {
        if (type === "imap-email ack") {
          AckCtor = ctor;
        }
      }
    }
  };

  registerImapEmailAck(RED);
  assert.equal(typeof AckCtor, "function");

  return {
    node: new AckCtor({
      account: "account-1",
      diagnostics: "stats",
      ...config
    }),
    statuses,
    warnings,
    errors,
    sends
  };
}

function sendWithCapture(itemOutputs) {
  return (output) => itemOutputs.push(output);
}

test("imap email ack action helper module exposes the simplified API", () => {
  const actions = loadAckActions();

  assert.equal(typeof actions.normalizeAckAction, "function");
  assert.equal(typeof actions.normalizeAckActionFromMessage, "function");
  assert.equal(typeof actions.validateAckActionPlan, "function");
  assert.equal(typeof actions.buildImapAckResult, "function");
  assert.equal(typeof actions.buildImapAckError, "function");
  assert.equal(typeof actions.executeAckActionRange, "function");
});

test("normalizes delete, move and flag ack actions", () => {
  const { normalizeAckAction } = loadAckActions();

  assert.deepEqual(normalizeAckAction({ action: "delete" }), {
    action: "delete",
    disposition: "delete",
    targetMailbox: "",
    flags: { add: [], remove: [] }
  });

  assert.deepEqual(normalizeAckAction({
    action: "move",
    targetMailbox: "Archive/Processed"
  }), {
    action: "move",
    disposition: "move",
    targetMailbox: "Archive/Processed",
    flags: { add: [], remove: [] }
  });

  assert.deepEqual(normalizeAckAction({
    action: "flag",
    seenAction: "set",
    answeredAction: "ignore",
    flaggedAction: "clear"
  }), {
    action: "flag",
    disposition: "keep",
    targetMailbox: "",
    flags: {
      add: ["\\Seen"],
      remove: ["\\Flagged"]
    }
  });
});

test("normalizes set by msg. action objects", () => {
  const { normalizeAckActionFromMessage } = loadAckActions();
  const msg = {
    imap: {
      ackAction: {
        action: "flag",
        flags: {
          seen: "set",
          answered: "clear",
          flagged: "ignore"
        }
      }
    }
  };

  assert.deepEqual(normalizeAckActionFromMessage(msg, "imap.ackAction"), {
    action: "flag",
    disposition: "keep",
    targetMailbox: "",
    flags: {
      add: ["\\Seen"],
      remove: ["\\Answered"]
    }
  });
});

test("set by msg. uses the fixed msg.imap.ackAction path", () => {
  const { normalizeAckActionFromMessage } = loadAckActions();
  const { node } = createAckNode({
    actionMode: "message",
    actionProperty: "custom.path"
  }, () => ({
    mailbox: { uidValidity: "uidv-1" },
    async connect() {},
    async getMailboxLock() {
      return { release() {} };
    },
    async logout() {}
  }));

  assert.equal(node.actionProperty, "imap.ackAction");
  assert.deepEqual(normalizeAckActionFromMessage({
    imap: {
      ackAction: { action: "delete" }
    }
  }), {
    action: "delete",
    disposition: "delete",
    targetMailbox: "",
    flags: { add: [], remove: [] }
  });
});

test("rejects invalid simplified ack action combinations", () => {
  const { normalizeAckAction, validateAckActionPlan } = loadAckActions();

  assert.throws(() => normalizeAckAction({ action: "move" }), /target.*mailbox/i);
  assert.throws(() => normalizeAckAction({ action: "unknown" }), /unknown.*action/i);
  assert.throws(() => normalizeAckAction({
    action: "delete",
    seenAction: "set"
  }), /delete.*flag/i);
  assert.throws(() => normalizeAckAction({
    action: "move",
    targetMailbox: "Archive",
    seenAction: "set"
  }), /move.*flag/i);
  assert.throws(() => validateAckActionPlan({
    action: "flag",
    disposition: "keep",
    targetMailbox: "",
    flags: { add: ["\\Seen"], remove: ["\\Seen"] }
  }), /conflict|contradict|seen/i);
});

test("continues to use msg.imap.ackToken as the delivery contract", () => {
  const token = sampleToken();
  const extracted = extractAckToken({ imap: { ackToken: token } });

  assert.deepEqual(extracted, token);
});

test("builds simplified msg.imapAck success and error structures", () => {
  const { buildImapAckResult, buildImapAckError, normalizeAckAction } = loadAckActions();
  const token = sampleToken();
  const plan = normalizeAckAction({
    action: "flag",
    seenAction: "set",
    flaggedAction: "clear"
  });

  assert.deepEqual(buildImapAckResult({
    token,
    plan,
    mailbox: "INBOX",
    range: "123"
  }), {
    ok: true,
    action: "flag",
    disposition: "keep",
    mailbox: "INBOX",
    targetMailbox: "",
    uid: 123,
    uidValidity: "uidv-1",
    flags: {
      add: ["\\Seen"],
      remove: ["\\Flagged"]
    },
    range: "123",
    completed: true
  });

  assert.deepEqual(buildImapAckError({
    token,
    plan,
    mailbox: "INBOX",
    range: "123",
    error: new Error("flag failed")
  }), {
    ok: false,
    action: "flag",
    disposition: "keep",
    mailbox: "INBOX",
    targetMailbox: "",
    uid: 123,
    uidValidity: "uidv-1",
    flags: {
      add: ["\\Seen"],
      remove: ["\\Flagged"]
    },
    range: "123",
    completed: false,
    error: "flag failed"
  });
});

test("executes move with automatic target mailbox creation", async () => {
  const { executeAckActionRange, normalizeAckAction } = loadAckActions();
  const calls = [];
  const plan = normalizeAckAction({
    action: "move",
    targetMailbox: "Archive/Processed"
  });
  const client = {
    async mailboxCreate(path) {
      calls.push(["mailboxCreate", path]);
    },
    async messageMove(range, target, options) {
      calls.push(["messageMove", range, target, options]);
    }
  };

  await executeAckActionRange({ client, plan, range: "123", mailbox: "INBOX" });

  assert.deepEqual(calls, [
    ["mailboxCreate", "Archive/Processed"],
    ["messageMove", "123", "Archive/Processed", { uid: true }]
  ]);
});

test("does not report success when an IMAP action fails", async () => {
  const { executeAckActionRange, normalizeAckAction } = loadAckActions();
  const plan = normalizeAckAction({ action: "delete" });
  const client = {
    async messageDelete() {
      throw new Error("delete failed");
    }
  };

  await assert.rejects(
    () => executeAckActionRange({ client, plan, range: "123", mailbox: "INBOX" }),
    /delete failed/
  );
});

test("ack runtime handles chunk failures at chunk granularity", async () => {
  const key = "queue-1";
  registry.clearQueue(key);
  for (const uid of [1, 2, 3, 4]) {
    registry.markInflight(key, sampleToken(uid), { now: 1000 });
  }

  const clientCalls = [];
  const { node } = createAckNode({
    actionMode: "delete",
    batchSize: 4,
    maxUidPerCommand: 2,
    flushMs: 60000,
    diagnostics: "off"
  }, () => ({
    mailbox: { uidValidity: "uidv-1" },
    async connect() {},
    async getMailboxLock() {
      return { release() {} };
    },
    async messageDelete(range, options) {
      clientCalls.push(["messageDelete", range, options]);
      if (range === "3:4") {
        throw new Error("chunk failed");
      }
    },
    async logout() {}
  }));

  const itemOutputs = [];
  for (const uid of [1, 2, 3, 4]) {
    node.pending.push({
      msg: { payload: uid, imap: { ackToken: sampleToken(uid) } },
      send: sendWithCapture(itemOutputs),
      done: () => {},
      token: sampleToken(uid),
      plan: node.actionPlan,
      enqueuedAt: Date.now()
    });
  }

  await node.flush();

  assert.deepEqual(clientCalls, [
    ["messageDelete", "1:2", { uid: true }],
    ["messageDelete", "3:4", { uid: true }]
  ]);

  const ok = itemOutputs.filter((output) => output[0]).map((output) => output[0].imapAck);
  const failed = itemOutputs.filter((output) => output[1]).map((output) => output[1].imapAck);

  assert.deepEqual(ok.map((ack) => ack.uid), [1, 2]);
  assert.deepEqual(failed.map((ack) => ack.uid), [3, 4]);
  assert.equal(ok.every((ack) => ack.ok && ack.completed), true);
  assert.equal(failed.every((ack) => !ack.ok && !ack.completed), true);
  assert.equal(registry.countAllInflight(key), 2);
  assert.equal(registry.isActiveInflight(key, "uidv-1", 1, 10000, 2000), false);
  assert.equal(registry.isActiveInflight(key, "uidv-1", 2, 10000, 2000), false);
  assert.equal(registry.isActiveInflight(key, "uidv-1", 3, 10000, 2000), true);
  assert.equal(registry.isActiveInflight(key, "uidv-1", 4, 10000, 2000), true);
});

test("ack runtime handles transient connect failures without node.error", async () => {
  const err = createConnectionError("getaddrinfo ENOTFOUND imap.strato.de", "ENOTFOUND");
  const { node, warnings, errors } = createAckNode({
    actionMode: "delete",
    batchSize: 1,
    flushMs: 60000,
    diagnostics: "off"
  }, () => ({
    usable: false,
    mailbox: { uidValidity: "uidv-1" },
    async connect() {
      throw err;
    },
    async logout() {
      throw new Error("logout should be skipped for closed clients");
    }
  }));

  const itemOutputs = [];
  let doneCount = 0;
  node.pending.push({
    msg: { payload: 1, imap: { ackToken: sampleToken(1) } },
    send: sendWithCapture(itemOutputs),
    done: () => {
      doneCount += 1;
    },
    token: sampleToken(1),
    plan: node.actionPlan,
    enqueuedAt: Date.now()
  });

  await node.flush();

  assert.equal(node.running, false);
  assert.equal(errors.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0]), /ENOTFOUND/);
  assert.equal(doneCount, 1);
  assert.equal(itemOutputs.length, 1);
  assert.equal(itemOutputs[0][1].imapAck.ok, false);
  assert.equal(itemOutputs[0][1].imapAck.error, "getaddrinfo ENOTFOUND imap.strato.de");
});

test("ack runtime fails remaining chunks after a transient action connection loss", async () => {
  const err = createConnectionError("read ECONNRESET", "ECONNRESET");
  const clientCalls = [];
  const { node, warnings, errors } = createAckNode({
    actionMode: "delete",
    batchSize: 4,
    maxUidPerCommand: 2,
    flushMs: 60000,
    diagnostics: "off"
  }, () => ({
    usable: true,
    mailbox: { uidValidity: "uidv-1" },
    async connect() {},
    async getMailboxLock() {
      return { release() {} };
    },
    async messageDelete(range) {
      clientCalls.push(range);
      throw err;
    },
    async logout() {}
  }));

  const itemOutputs = [];
  let doneCount = 0;
  for (const uid of [1, 2, 3, 4]) {
    node.pending.push({
      msg: { payload: uid, imap: { ackToken: sampleToken(uid) } },
      send: sendWithCapture(itemOutputs),
      done: () => {
        doneCount += 1;
      },
      token: sampleToken(uid),
      plan: node.actionPlan,
      enqueuedAt: Date.now()
    });
  }

  await node.flush();

  assert.equal(node.running, false);
  assert.equal(errors.length, 0);
  assert.deepEqual(clientCalls, ["1:2"]);
  assert.equal(warnings.length, 2);
  assert.equal(doneCount, 4);
  assert.equal(itemOutputs.filter((output) => output[1]).length, 4);
  assert.deepEqual(
    itemOutputs.filter((output) => output[1]).map((output) => output[1].imapAck.uid),
    [1, 2, 3, 4]
  );
});

test("ack runtime ignores transient logout failures after successful actions", async () => {
  const err = createConnectionError("Connection not available", "NoConnection");
  const clientCalls = [];
  const { node, warnings, errors } = createAckNode({
    actionMode: "delete",
    batchSize: 1,
    flushMs: 60000,
    diagnostics: "off"
  }, () => ({
    usable: true,
    mailbox: { uidValidity: "uidv-1" },
    async connect() {},
    async getMailboxLock() {
      return { release() {} };
    },
    async messageDelete(range) {
      clientCalls.push(range);
    },
    async logout() {
      throw err;
    }
  }));

  const itemOutputs = [];
  let doneCount = 0;
  node.pending.push({
    msg: { payload: 1, imap: { ackToken: sampleToken(1) } },
    send: sendWithCapture(itemOutputs),
    done: () => {
      doneCount += 1;
    },
    token: sampleToken(1),
    plan: node.actionPlan,
    enqueuedAt: Date.now()
  });

  await node.flush();

  assert.equal(node.running, false);
  assert.equal(errors.length, 0);
  assert.equal(warnings.length, 0);
  assert.deepEqual(clientCalls, ["1"]);
  assert.equal(doneCount, 1);
  assert.equal(itemOutputs.length, 1);
  assert.equal(itemOutputs[0][0].imapAck.ok, true);
});
