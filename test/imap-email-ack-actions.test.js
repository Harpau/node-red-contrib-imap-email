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

function expectedQueueKey(mailbox = "INBOX") {
  return registry.makeQueueKey({
    accountId: "account-1",
    host: "imap.example.test",
    user: "user@example.test",
    mailbox
  });
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
  const handlers = {};
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
        node.on = (event, handler) => {
          handlers[event] = handler;
        };
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
    sends,
    handlers
  };
}

function sendWithCapture(itemOutputs) {
  return (output) => itemOutputs.push(output);
}

function invokeInput(handlers, msg) {
  const outputs = [];
  let doneCount = 0;
  handlers.input(msg, (output) => outputs.push(output), () => {
    doneCount += 1;
  });
  return { outputs, doneCount };
}

function pushPendingAckItems(node, uids, itemOutputs, onDone) {
  for (const uid of uids) {
    node.pending.push({
      msg: { payload: uid, imap: { ackToken: sampleToken(uid) } },
      send: sendWithCapture(itemOutputs),
      done: () => {
        if (onDone) {
          onDone(uid);
        }
      },
      token: sampleToken(uid),
      plan: node.actionPlan,
      enqueuedAt: Date.now()
    });
  }
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

test("rejects invalid named flag actions instead of silently ignoring them", () => {
  const { normalizeAckAction, normalizeAckActionFromMessage } = loadAckActions();

  assert.throws(() => normalizeAckAction({
    action: "flag",
    seenAction: "typo"
  }), /invalid.*flag.*action/i);

  assert.throws(() => normalizeAckActionFromMessage({
    imap: {
      ackAction: {
        action: "flag",
        flags: {
          seen: "typo"
        }
      }
    }
  }), /invalid.*flag.*action/i);
});

test("normalizes and validates raw add/remove flag arrays", () => {
  const { normalizeAckAction } = loadAckActions();

  assert.deepEqual(normalizeAckAction({
    action: "flag",
    flags: {
      add: ["Seen"],
      remove: ["\\Flagged"]
    }
  }), {
    action: "flag",
    disposition: "keep",
    targetMailbox: "",
    flags: {
      add: ["\\Seen"],
      remove: ["\\Flagged"]
    }
  });

  assert.throws(() => normalizeAckAction({
    action: "flag",
    flags: {
      add: ["\\Deleted"]
    }
  }), /unsupported.*flag/i);

  assert.throws(() => normalizeAckAction({
    action: "flag",
    flags: {
      add: [" Seen "],
      remove: ["\\Seen"]
    }
  }), /conflict|contradict|seen/i);

  assert.throws(() => normalizeAckAction({
    action: "flag",
    flags: {
      add: ["\\Seen"],
      seen: "typo"
    }
  }), /cannot be combined/i);
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

test("ack runtime normalizes numeric limits to integers", () => {
  const { node } = createAckNode({
    batchSize: "2.9",
    flushMs: "10.8",
    maxUidPerCommand: "5.9",
    maxBatchesPerFlush: "3.9",
    closeTimeoutMs: "7.9"
  }, () => ({
    mailbox: { uidValidity: "uidv-1" },
    async connect() {},
    async getMailboxLock() {
      return { release() {} };
    },
    async logout() {}
  }));

  assert.equal(node.batchSize, 2);
  assert.equal(node.flushMs, 10);
  assert.equal(node.maxUidPerCommand, 5);
  assert.equal(node.maxBatchesPerFlush, 3);
  assert.equal(node.closeTimeoutMs, 7);
});

test("continues to use msg.imap.ackToken as the delivery contract", () => {
  const token = sampleToken();
  const extracted = extractAckToken({ imap: { ackToken: token } });

  assert.deepEqual(extracted, token);
});

test("ack runtime accepts legacy tokens with missing or blank scope fields", () => {
  const { node, handlers } = createAckNode({
    actionMode: "delete",
    batchSize: 100,
    flushMs: 60000
  }, () => {
    throw new Error("client should not be created before a pending flush");
  });

  const { outputs, doneCount } = invokeInput(handlers, {
    payload: "legacy",
    imap: {
      ackToken: {
        accountId: "",
        host: "",
        port: "",
        secure: "",
        user: "",
        queueKey: "",
        uid: 1,
        uidValidity: "uidv-1",
        mailbox: "Archive"
      }
    }
  });

  if (node.timer) {
    clearTimeout(node.timer);
    node.timer = null;
  }

  assert.equal(outputs.length, 0);
  assert.equal(doneCount, 0);
  assert.equal(node.pending.length, 1);
  assert.equal(node.pending[0].token.accountId, "account-1");
  assert.equal(node.pending[0].token.host, "imap.example.test");
  assert.equal(node.pending[0].token.user, "user@example.test");
  assert.equal(node.pending[0].token.mailbox, "Archive");
});

test("ack runtime validates explicit token account scope before queueing", () => {
  const cases = [
    ["accountId", "account-2", /accountId/i],
    ["host", "imap.other.test", /host/i],
    ["host", "IMAP.EXAMPLE.TEST", null],
    ["port", "994", /port/i],
    ["port", "993.9", /port.*invalid/i],
    ["secure", "false", /secure/i],
    ["secure", "typo", /secure.*invalid/i],
    ["user", "User@example.test", /user/i],
    ["queueKey", "other-queue", /queueKey/i],
    ["inflightKey", "other-queue", /queueKey/i]
  ];

  for (const [field, value, expectedError] of cases) {
    let clientCalls = 0;
    const { node, handlers } = createAckNode({
      actionMode: "delete",
      batchSize: 100,
      flushMs: 60000
    }, () => {
      clientCalls += 1;
      throw new Error("client should not be created");
    });
    const token = {
      uid: 1,
      uidValidity: "uidv-1",
      mailbox: "INBOX"
    };
    token[field] = value;

    const { outputs, doneCount } = invokeInput(handlers, {
      payload: field,
      imap: { ackToken: token }
    });

    if (node.timer) {
      clearTimeout(node.timer);
      node.timer = null;
    }

    if (expectedError) {
      assert.equal(node.pending.length, 0, `${field} mismatch must not be queued`);
      assert.equal(doneCount, 1, `${field} mismatch must call done`);
      assert.equal(clientCalls, 0, `${field} mismatch must not create a client`);
      assert.equal(outputs.length, 1, `${field} mismatch must emit one error`);
      assert.equal(outputs[0][0], null);
      assert.equal(outputs[0][1].imapAck.ok, false);
      assert.match(outputs[0][1].imapAck.error, expectedError);
    } else {
      assert.equal(outputs.length, 0, `${field} match should be accepted`);
      assert.equal(doneCount, 0, `${field} match should wait for flush`);
      assert.equal(clientCalls, 0, `${field} match should not flush yet`);
      assert.equal(node.pending.length, 1, `${field} match should be queued`);
    }
  }
});

test("ack runtime validates queue keys against the token mailbox", () => {
  const { node: okNode, handlers: okHandlers } = createAckNode({
    actionMode: "delete",
    mailbox: "INBOX",
    batchSize: 100,
    flushMs: 60000
  }, () => {
    throw new Error("client should not be created before flush");
  });
  const accepted = invokeInput(okHandlers, {
    imap: {
      ackToken: {
        uid: 1,
        uidValidity: "uidv-1",
        mailbox: "Archive",
        queueKey: expectedQueueKey("Archive")
      }
    }
  });
  if (okNode.timer) {
    clearTimeout(okNode.timer);
    okNode.timer = null;
  }

  assert.equal(accepted.outputs.length, 0);
  assert.equal(okNode.pending.length, 1);
  assert.equal(okNode.pending[0].token.mailbox, "Archive");

  let clientCalls = 0;
  const { node: badNode, handlers: badHandlers } = createAckNode({
    actionMode: "delete",
    mailbox: "INBOX",
    batchSize: 100,
    flushMs: 60000
  }, () => {
    clientCalls += 1;
    throw new Error("client should not be created");
  });
  const rejected = invokeInput(badHandlers, {
    imap: {
      ackToken: {
        uid: 2,
        uidValidity: "uidv-1",
        mailbox: "Archive",
        queueKey: expectedQueueKey("INBOX")
      }
    }
  });
  if (badNode.timer) {
    clearTimeout(badNode.timer);
    badNode.timer = null;
  }

  assert.equal(badNode.pending.length, 0);
  assert.equal(clientCalls, 0);
  assert.equal(rejected.doneCount, 1);
  assert.equal(rejected.outputs.length, 1);
  assert.equal(rejected.outputs[0][1].imapAck.ok, false);
  assert.match(rejected.outputs[0][1].imapAck.error, /queueKey/i);
});

test("ack runtime sends invalid message actions to output 2 without queueing", () => {
  let clientCalls = 0;
  const { node, handlers } = createAckNode({
    actionMode: "message",
    batchSize: 100,
    flushMs: 60000
  }, () => {
    clientCalls += 1;
    throw new Error("client should not be created");
  });

  const result = invokeInput(handlers, {
    imap: {
      uid: 1,
      uidValidity: "uidv-1",
      mailbox: "INBOX",
      ackAction: {
        action: "flag",
        flags: {
          seen: "typo"
        }
      }
    }
  });
  if (node.timer) {
    clearTimeout(node.timer);
    node.timer = null;
  }

  assert.equal(node.pending.length, 0);
  assert.equal(clientCalls, 0);
  assert.equal(result.doneCount, 1);
  assert.equal(result.outputs.length, 1);
  assert.equal(result.outputs[0][1].imapAck.ok, false);
  assert.match(result.outputs[0][1].imapAck.error, /invalid.*flag.*action/i);
});

test("ack runtime sends invalid static action config to output 2 without queueing", () => {
  let clientCalls = 0;
  const { node, handlers, errors } = createAckNode({
    actionMode: "flag",
    seenAction: "typo",
    batchSize: 100,
    flushMs: 60000
  }, () => {
    clientCalls += 1;
    throw new Error("client should not be created");
  });

  const result = invokeInput(handlers, {
    imap: {
      uid: 1,
      uidValidity: "uidv-1",
      mailbox: "INBOX"
    }
  });
  if (node.timer) {
    clearTimeout(node.timer);
    node.timer = null;
  }

  assert.equal(errors.length, 1);
  assert.equal(node.pending.length, 0);
  assert.equal(clientCalls, 0);
  assert.equal(result.doneCount, 1);
  assert.equal(result.outputs.length, 1);
  assert.equal(result.outputs[0][1].imapAck.ok, false);
  assert.match(result.outputs[0][1].imapAck.error, /invalid.*flag.*action/i);
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

test("ack close fails remaining pending items after a running bounded flush", async () => {
  const key = "queue-1";
  registry.clearQueue(key);
  for (const uid of [1, 2]) {
    registry.markInflight(key, sampleToken(uid), { now: 1000 });
  }

  let resolveAction;
  let actionStarted;
  const actionStartedPromise = new Promise((resolve) => {
    actionStarted = resolve;
  });
  const { node, handlers, errors } = createAckNode({
    actionMode: "delete",
    batchSize: 1,
    maxBatchesPerFlush: 1,
    flushMs: 60000,
    diagnostics: "off"
  }, () => ({
    usable: true,
    mailbox: { uidValidity: "uidv-1" },
    async connect() {},
    async getMailboxLock() {
      return { release() {} };
    },
    messageDelete(range) {
      actionStarted(range);
      return new Promise((resolve) => {
        resolveAction = resolve;
      });
    },
    async logout() {}
  }));

  const itemOutputs = [];
  const doneUids = [];
  pushPendingAckItems(node, [1, 2], itemOutputs, (uid) => doneUids.push(uid));

  const flushPromise = node.flush();
  assert.equal(await actionStartedPromise, "1");

  let closeDoneCount = 0;
  handlers.close(false, () => {
    closeDoneCount += 1;
  });

  resolveAction();
  await flushPromise;

  assert.equal(closeDoneCount, 1);
  assert.equal(errors.length, 0);
  assert.deepEqual(doneUids.sort((a, b) => a - b), [1, 2]);
  assert.deepEqual(itemOutputs.filter((output) => output[0]).map((output) => output[0].imapAck.uid), [1]);
  assert.deepEqual(itemOutputs.filter((output) => output[1]).map((output) => output[1].imapAck.uid), [2]);
  assert.match(itemOutputs.find((output) => output[1])[1].imapAck.error, /node close/);
  assert.equal(registry.isActiveInflight(key, "uidv-1", 1, 10000, 2000), false);
  assert.equal(registry.isActiveInflight(key, "uidv-1", 2, 10000, 2000), true);
});

test("ack close drains one bounded flush and fails excess pending without removing inflight", async () => {
  const key = "queue-1";
  registry.clearQueue(key);
  for (const uid of [1, 2, 3]) {
    registry.markInflight(key, sampleToken(uid), { now: 1000 });
  }

  const clientCalls = [];
  const { node, handlers, errors } = createAckNode({
    actionMode: "delete",
    batchSize: 1,
    maxBatchesPerFlush: 1,
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
    async logout() {}
  }));

  const itemOutputs = [];
  let doneCount = 0;
  pushPendingAckItems(node, [1, 2, 3], itemOutputs, () => {
    doneCount += 1;
  });

  let closeDoneCount = 0;
  await new Promise((resolve) => {
    handlers.close(false, () => {
      closeDoneCount += 1;
      resolve();
    });
  });

  assert.equal(closeDoneCount, 1);
  assert.equal(doneCount, 3);
  assert.equal(errors.length, 0);
  assert.deepEqual(clientCalls, ["1"]);
  assert.deepEqual(itemOutputs.filter((output) => output[0]).map((output) => output[0].imapAck.uid), [1]);
  assert.deepEqual(itemOutputs.filter((output) => output[1]).map((output) => output[1].imapAck.uid), [2, 3]);
  assert.equal(registry.isActiveInflight(key, "uidv-1", 1, 10000, 2000), false);
  assert.equal(registry.isActiveInflight(key, "uidv-1", 2, 10000, 2000), true);
  assert.equal(registry.isActiveInflight(key, "uidv-1", 3, 10000, 2000), true);
});

test("ack close deadline aborts active clients and does not escalate transient aborts", async () => {
  const key = "queue-1";
  registry.clearQueue(key);
  registry.markInflight(key, sampleToken(1), { now: 1000 });

  let rejectAction;
  let actionStarted;
  const actionStartedPromise = new Promise((resolve) => {
    actionStarted = resolve;
  });
  let closeCalls = 0;
  const client = {
    usable: true,
    mailbox: { uidValidity: "uidv-1" },
    async connect() {},
    async getMailboxLock() {
      return { release() {} };
    },
    messageDelete(range) {
      actionStarted(range);
      return new Promise((resolve, reject) => {
        rejectAction = reject;
      });
    },
    close() {
      closeCalls += 1;
      client.usable = false;
      if (rejectAction) {
        rejectAction(createConnectionError("Connection not available", "NoConnection"));
      }
    },
    async logout() {
      throw new Error("logout should be skipped after close");
    }
  };

  const { node, handlers, warnings, errors } = createAckNode({
    actionMode: "delete",
    batchSize: 1,
    maxBatchesPerFlush: 1,
    flushMs: 60000,
    closeTimeoutMs: 5,
    diagnostics: "off"
  }, () => client);

  const itemOutputs = [];
  let doneCount = 0;
  pushPendingAckItems(node, [1], itemOutputs, () => {
    doneCount += 1;
  });

  const flushPromise = node.flush();
  assert.equal(await actionStartedPromise, "1");

  let closeDoneCount = 0;
  await new Promise((resolve) => {
    handlers.close(false, () => {
      closeDoneCount += 1;
      resolve();
    });
  });
  await flushPromise;

  assert.equal(closeDoneCount, 1);
  assert.equal(closeCalls, 1);
  assert.equal(doneCount, 1);
  assert.equal(errors.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0]), /Connection not available|node close/);
  assert.equal(itemOutputs.length, 1);
  assert.equal(itemOutputs[0][1].imapAck.ok, false);
  assert.match(itemOutputs[0][1].imapAck.error, /node close/);
  assert.equal(registry.isActiveInflight(key, "uidv-1", 1, 10000, 2000), true);
});
