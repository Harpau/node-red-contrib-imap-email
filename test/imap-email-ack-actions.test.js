"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { buildAckToken, extractAckToken } = require("../lib/ack-token");
const registry = require("../lib/runtime-registry");
const registerImapEmailAck = require("../nodes/imap-email-ack");

function loadAckActions() {
  return require("../lib/imap-ack-actions");
}

const sampleTokenCache = new Map();

function buildSampleToken(uid = 123, overrides = {}) {
  return buildAckToken({
    accountId: "account-1",
    queueKey: "queue-1",
    host: "imap.example.test",
    port: 993,
    secure: true,
    user: "user@example.test",
    mailbox: "INBOX",
    uid,
    uidValidity: "uidv-1",
    ...overrides
  });
}

function sampleToken(uid = 123, overrides = {}) {
  const key = JSON.stringify({ uid, overrides });
  if (!sampleTokenCache.has(key)) {
    sampleTokenCache.set(key, buildSampleToken(uid, overrides));
  }
  return { ...sampleTokenCache.get(key) };
}

function expectedQueueKey(mailbox = "INBOX") {
  return registry.makeQueueKey({
    accountId: "account-1",
    host: "imap.example.test",
    user: "user@example.test",
    mailbox
  });
}

function inputToken(uid = 123, overrides = {}) {
  const tokenConfig = {
    accountId: "account-1",
    host: "imap.example.test",
    port: 993,
    secure: true,
    user: "user@example.test",
    mailbox: "INBOX",
    uid,
    uidValidity: "uidv-1",
    ...overrides
  };
  if (!Object.prototype.hasOwnProperty.call(overrides, "queueKey")) {
    tokenConfig.queueKey = expectedQueueKey(tokenConfig.mailbox);
  }
  return buildAckToken(tokenConfig);
}

function createConnectionError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function imapCaps(...names) {
  return new Set(names);
}

// Runtime tests below supply only the operation relevant to their scenario.
// Give DELETE doubles a selected usable mailbox and explicit STORE/SEARCH phases;
// successful stubbed deletes remove the addressed range from the virtual peer.
function completeDeleteClient(client) {
  if (!client || typeof client.messageDelete !== "function") return client;
  client = Object.assign(new EventEmitter(), client);
  if (!Object.hasOwn(client, "usable")) client.usable = true;
  client.mailbox = { path: "INBOX", uidValidity: "uidv-1", ...client.mailbox };
  const completedRanges = new Set();
  const originalDelete = client.messageDelete;
  client.messageDelete = async function(range, options) {
    const result = await originalDelete.call(this, range, options);
    if (result === true) completedRanges.add(range);
    return result;
  };
  if (!client.messageFlagsAdd) {
    client.messageFlagsAdd = async (range, flags, options) => {
      assert.deepEqual(flags, ["\\Deleted"]);
      assert.deepEqual(options, { uid: true });
      completedRanges.delete(range);
      return true;
    };
  }
  if (!client.search) {
    client.search = async function(query, options) {
      assert.deepEqual(Object.keys(query), ["uid"]);
      assert.deepEqual(options, { uid: true });
      assert.equal(completedRanges.has(query.uid), true, "verify only a completed DELETE range");
      return [];
    };
  }
  for (const operation of ["messageFlagsAdd", "messageDelete", "search"]) {
    const command = client[operation];
    client[operation] = async function(...args) {
      const result = await command.apply(this, args);
      this.emit("response", { response: result === true || Array.isArray(result) ? "OK" : "NO" });
      return result;
    };
  }
  if (client.getMailboxLock) {
    const originalLock = client.getMailboxLock;
    client.getMailboxLock = async function(mailbox) {
      const lock = await originalLock.call(this, mailbox);
      this.mailbox.path = mailbox;
      return lock;
    };
  }
  return client;
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
    requestConnectionCheck() { return () => {}; },
    host: "imap.example.test",
    port: 993,
    secure: true,
    getUsername() {
      return "user@example.test";
    },
    createClient: (...args) => completeDeleteClient(clientFactory(...args))
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

function enqueueInput(handlers, msg) {
  const outputs = [];
  let doneCount = 0;
  handlers.input(msg, (output) => outputs.push(output), () => {
    doneCount += 1;
  });
  return {
    outputs,
    get doneCount() {
      return doneCount;
    }
  };
}

function makePendingAckItem(node, uid, itemOutputs, onDone) {
  const token = sampleToken(uid);
  token.issuedAt = Date.now() + 1000;
  token.signature = `${token.signature}-${token.issuedAt}`;
  registry.markInflight(token.queueKey, token, { now: 1000 });
  return {
    msg: { payload: uid, imap: { ackToken: token } },
    send: sendWithCapture(itemOutputs),
    done: () => {
      if (onDone) {
        onDone(uid);
      }
    },
    token,
    plan: node.actionPlan,
    enqueuedAt: Date.now()
  };
}

function pushPendingAckItems(node, uids, itemOutputs, onDone) {
  for (const uid of uids) {
    node.pending.push(makePendingAckItem(node, uid, itemOutputs, onDone));
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

test("normalizes delete, move, copy and flag ack actions", () => {
  const { normalizeAckAction } = loadAckActions();

  assert.deepEqual(normalizeAckAction({ action: "delete" }), {
    action: "delete",
    disposition: "delete",
    targetMailbox: "",
    flags: { add: [], remove: [] }
  });

  assert.deepEqual(normalizeAckAction({
    action: "move",
    targetMailbox: "Archive/Processed",
    seenAction: "set",
    flagAdd: "$Processed",
    flagRemove: "\\Draft"
  }), {
    action: "move",
    disposition: "move",
    targetMailbox: "Archive/Processed",
    flags: { add: ["\\Seen", "$Processed"], remove: ["\\Draft"] }
  });

  assert.deepEqual(normalizeAckAction({
    action: "copy",
    targetMailbox: "Archive/Copied",
    flaggedAction: "set",
    flagRemove: "$Todo"
  }), {
    action: "copy",
    disposition: "copy",
    targetMailbox: "Archive/Copied",
    flags: { add: ["\\Flagged"], remove: ["$Todo"] }
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
          flagged: "ignore",
          add: "$Processed",
          remove: ["\\Draft"]
        }
      }
    }
  };

  assert.deepEqual(normalizeAckActionFromMessage(msg, "imap.ackAction"), {
    action: "flag",
    disposition: "keep",
    targetMailbox: "",
    flags: {
      add: ["\\Seen", "$Processed"],
      remove: ["\\Answered", "\\Draft"]
    }
  });

  assert.deepEqual(normalizeAckActionFromMessage({
    imap: {
      ackAction: {
        action: "copy",
        targetMailbox: "Archive/Copied",
        flags: {
          seen: "set"
        }
      }
    }
  }), {
    action: "copy",
    disposition: "copy",
    targetMailbox: "Archive/Copied",
    flags: {
      add: ["\\Seen"],
      remove: []
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
      add: ["Seen", "\\Deleted", "$Processed", "custom-keyword"],
      remove: ["\\Flagged", "\\Draft"]
    }
  }), {
    action: "flag",
    disposition: "keep",
    targetMailbox: "",
    flags: {
      add: ["\\Seen", "\\Deleted", "$Processed", "custom-keyword"],
      remove: ["\\Flagged", "\\Draft"]
    }
  });

  assert.throws(() => normalizeAckAction({
    action: "flag",
    flags: {
      add: ["\\Recent"]
    }
  }), /unsupported.*flag/i);

  assert.throws(() => normalizeAckAction({
    action: "flag",
    flags: {
      add: ["\\*"]
    }
  }), /unsupported.*flag/i);

  assert.throws(() => normalizeAckAction({
    action: "flag",
    flags: {
      add: ["bad flag"]
    }
  }), /invalid.*flag/i);

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
  }), /invalid.*flag.*action/i);
});

test("set by msg. uses the fixed msg.imap.ackAction path", () => {
  const { normalizeAckActionFromMessage } = loadAckActions();
  const { node } = createAckNode({
    actionMode: "message",
    actionProperty: "custom.path"
  }, () => ({
    capabilities: imapCaps("UIDPLUS"),
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
  assert.throws(() => normalizeAckAction({ action: "copy" }), /target.*mailbox/i);
  assert.throws(() => normalizeAckAction({ action: "unknown" }), /unknown.*action/i);
  assert.throws(() => normalizeAckAction({
    action: "delete",
    seenAction: "set"
  }), /delete.*flag/i);

  assert.deepEqual(normalizeAckAction({
    action: "move",
    targetMailbox: "Archive",
    seenAction: "set"
  }), {
    action: "move",
    disposition: "move",
    targetMailbox: "Archive",
    flags: { add: ["\\Seen"], remove: [] }
  });

  assert.deepEqual(normalizeAckAction({
    action: "copy",
    targetMailbox: "Copied",
    flaggedAction: "clear"
  }), {
    action: "copy",
    disposition: "copy",
    targetMailbox: "Copied",
    flags: { add: [], remove: ["\\Flagged"] }
  });

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
    capabilities: imapCaps("UIDPLUS"),
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

test("ack runtime no longer falls back to legacy config.action", () => {
  const { node } = createAckNode({
    action: "move",
    targetMailbox: "Archive/Legacy"
  }, () => {
    throw new Error("client should not be created");
  });

  assert.equal(node.actionMode, "delete");
  assert.deepEqual(node.actionPlan, {
    action: "delete",
    disposition: "delete",
    targetMailbox: "",
    flags: { add: [], remove: [] }
  });
});

test("continues to use msg.imap.ackToken as the delivery contract", () => {
  const token = sampleToken();
  const extracted = extractAckToken({ imap: { ackToken: token } });

  assert.deepEqual(extracted, token);
});

test("ack runtime rejects legacy or incomplete ACK tokens before queueing", () => {
  const cases = [
    ["missing token", { imap: { uid: 1, uidValidity: "uidv-1", mailbox: "INBOX" } }, /ackToken.*fehlt/i],
    ["blank scope", {
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
    }, /ackToken\.version.*ungueltig/i],
    ["inflightKey alias", {
      imap: {
        ackToken: {
          ...inputToken(1),
          queueKey: undefined,
          inflightKey: expectedQueueKey("INBOX")
        }
      }
    }, /ackToken\.queueKey.*fehlt/i]
  ];

  for (const [label, msg, expectedError] of cases) {
    const { node, handlers } = createAckNode({
      actionMode: "delete",
      batchSize: 100,
      flushMs: 60000
    }, () => {
      throw new Error("client should not be created before a pending flush");
    });

    const { outputs, doneCount } = invokeInput(handlers, {
      payload: label,
      ...msg
    });

    if (node.timer) {
      clearTimeout(node.timer);
      node.timer = null;
    }

    assert.equal(outputs.length, 1, label);
    assert.equal(outputs[0][0], null, label);
    assert.equal(outputs[0][1].imapAck.ok, false, label);
    assert.match(outputs[0][1].imapAck.error, expectedError, label);
    assert.equal(doneCount, 1, label);
    assert.equal(node.pending.length, 0, label);
  }
});

test("ack runtime accepts complete scoped ACK tokens", () => {
  const { node, handlers } = createAckNode({
    actionMode: "delete",
    batchSize: 100,
    flushMs: 60000
  }, () => {
    throw new Error("client should not be created before a pending flush");
  });

  const { outputs, doneCount } = invokeInput(handlers, {
    payload: "scoped",
    imap: {
      ackToken: inputToken(1, { mailbox: "Archive" })
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
    ["accountId", () => inputToken(1, { accountId: "account-2" }), /accountId/i],
    ["host", () => inputToken(1, { host: "imap.other.test" }), /host/i],
    ["host", () => inputToken(1, { host: "IMAP.EXAMPLE.TEST" }), null],
    ["port", () => inputToken(1, { port: 994 }), /port/i],
    ["port", () => ({ ...inputToken(1), port: "993.9" }), /port.*(invalid|ungueltig)/i],
    ["secure", () => inputToken(1, { secure: false }), /secure/i],
    ["secure", () => ({ ...inputToken(1), secure: "typo" }), /secure.*(invalid|ungueltig)/i],
    ["user", () => inputToken(1, { user: "User@example.test" }), /user/i],
    ["queueKey", () => inputToken(1, { queueKey: "other-queue" }), /queueKey/i]
  ];

  for (const [field, createToken, expectedError] of cases) {
    let clientCalls = 0;
    const { node, handlers } = createAckNode({
      actionMode: "delete",
      batchSize: 100,
      flushMs: 60000
    }, () => {
      clientCalls += 1;
      throw new Error("client should not be created");
    });
    const token = createToken();

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
    batchSize: 100,
    flushMs: 60000
  }, () => {
    throw new Error("client should not be created before flush");
  });
  const accepted = invokeInput(okHandlers, {
    imap: {
      ackToken: inputToken(1, { mailbox: "Archive" })
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
    batchSize: 100,
    flushMs: 60000
  }, () => {
    clientCalls += 1;
    throw new Error("client should not be created");
  });
  const rejected = invokeInput(badHandlers, {
    imap: {
      ackToken: inputToken(2, {
        mailbox: "Archive",
        queueKey: expectedQueueKey("INBOX")
      })
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

test("ack runtime rejects tampered signed ACK tokens before queueing", () => {
  const token = inputToken(1);
  token.uid = 2;
  let clientCalls = 0;
  const { node, handlers } = createAckNode({
    actionMode: "delete",
    batchSize: 100,
    flushMs: 60000
  }, () => {
    clientCalls += 1;
    throw new Error("client should not be created");
  });

  const result = invokeInput(handlers, {
    imap: { ackToken: token }
  });
  if (node.timer) {
    clearTimeout(node.timer);
    node.timer = null;
  }

  assert.equal(node.pending.length, 0);
  assert.equal(clientCalls, 0);
  assert.equal(result.outputs.length, 1);
  assert.equal(result.outputs[0][1].imapAck.ok, false);
  assert.match(result.outputs[0][1].imapAck.error, /signature/i);
});

test("ack runtime rejects ACK tokens without current inflight before creating a client", async () => {
  const token = inputToken(1);
  registry.clearQueue(token.queueKey);
  let clientCalls = 0;
  const { node, handlers } = createAckNode({
    actionMode: "delete",
    batchSize: 100,
    flushMs: 60000,
    diagnostics: "off"
  }, () => {
    clientCalls += 1;
    throw new Error("client should not be created");
  });

  const result = enqueueInput(handlers, {
    imap: { ackToken: token }
  });
  if (node.timer) {
    clearTimeout(node.timer);
    node.timer = null;
  }

  assert.equal(node.pending.length, 1);
  await node.flush();

  assert.equal(clientCalls, 0);
  assert.equal(result.doneCount, 1);
  assert.equal(result.outputs.length, 1);
  assert.equal(result.outputs[0][1].imapAck.ok, false);
  assert.match(result.outputs[0][1].imapAck.error, /not current|claimed/i);
});

test("ack runtime claims duplicate ACK tokens so only one reaches IMAP", async () => {
  const token = inputToken(1);
  registry.clearQueue(token.queueKey);
  registry.markInflight(token.queueKey, token, { now: 1000 });
  const clientCalls = [];
  const { node, handlers } = createAckNode({
    actionMode: "delete",
    batchSize: 100,
    flushMs: 60000,
    diagnostics: "off"
  }, () => ({
    capabilities: imapCaps("UIDPLUS"),
    mailbox: { uidValidity: "uidv-1" },
    async connect() {},
    async getMailboxLock() {
      return { release() {} };
    },
    async messageDelete(range) {
      clientCalls.push(range);
      return true;
    },
    async logout() {}
  }));

  const first = enqueueInput(handlers, { imap: { ackToken: token } });
  const second = enqueueInput(handlers, { imap: { ackToken: token } });
  if (node.timer) {
    clearTimeout(node.timer);
    node.timer = null;
  }

  await node.flush();

  const outputs = [...first.outputs, ...second.outputs];
  assert.deepEqual(clientCalls, ["1"]);
  assert.equal(first.doneCount + second.doneCount, 2);
  assert.equal(outputs.filter((output) => output[0]).length, 1);
  assert.equal(outputs.filter((output) => output[1]).length, 1);
  assert.match(outputs.find((output) => output[1])[1].imapAck.error, /not current|claimed/i);
});

test("ack runtime rejects replay after a successful ACK", async () => {
  const token = inputToken(1);
  registry.clearQueue(token.queueKey);
  registry.markInflight(token.queueKey, token, { now: 1000 });
  const clientCalls = [];
  const { node, handlers } = createAckNode({
    actionMode: "delete",
    batchSize: 100,
    flushMs: 60000,
    diagnostics: "off"
  }, () => ({
    capabilities: imapCaps("UIDPLUS"),
    mailbox: { uidValidity: "uidv-1" },
    async connect() {},
    async getMailboxLock() {
      return { release() {} };
    },
    async messageDelete(range) {
      clientCalls.push(range);
      return true;
    },
    async logout() {}
  }));

  const first = enqueueInput(handlers, { imap: { ackToken: token } });
  if (node.timer) {
    clearTimeout(node.timer);
    node.timer = null;
  }
  await node.flush();

  const replay = enqueueInput(handlers, { imap: { ackToken: token } });
  if (node.timer) {
    clearTimeout(node.timer);
    node.timer = null;
  }
  await node.flush();

  assert.deepEqual(clientCalls, ["1"]);
  assert.equal(first.outputs[0][0].imapAck.ok, true);
  assert.equal(replay.doneCount, 1);
  assert.equal(replay.outputs.length, 1);
  assert.equal(replay.outputs[0][1].imapAck.ok, false);
  assert.match(replay.outputs[0][1].imapAck.error, /not current|claimed/i);
});

test("ack runtime rejects stale token generations without removing the current inflight", async () => {
  const oldToken = inputToken(1);
  const newToken = inputToken(1);
  registry.clearQueue(oldToken.queueKey);
  registry.markInflight(oldToken.queueKey, oldToken, { now: 1000 });
  registry.markInflight(newToken.queueKey, newToken, { now: 2000 });
  let clientCalls = 0;
  const { node, handlers } = createAckNode({
    actionMode: "delete",
    batchSize: 100,
    flushMs: 60000,
    diagnostics: "off"
  }, () => {
    clientCalls += 1;
    throw new Error("client should not be created");
  });

  const result = enqueueInput(handlers, {
    imap: { ackToken: oldToken }
  });
  if (node.timer) {
    clearTimeout(node.timer);
    node.timer = null;
  }
  await node.flush();

  assert.equal(clientCalls, 0);
  assert.equal(result.outputs.length, 1);
  assert.equal(result.outputs[0][1].imapAck.ok, false);
  assert.equal(registry.matchesAckToken(newToken.queueKey, newToken), true);
  assert.equal(registry.isActiveInflight(newToken.queueKey, "uidv-1", 1, 10000, 3000), true);
});

test("parallel ack nodes cannot execute the same ACK token twice", async () => {
  const token = inputToken(1);
  registry.clearQueue(token.queueKey);
  registry.markInflight(token.queueKey, token, { now: 1000 });
  const clientCalls = [];
  function clientFactory() {
    return {
      capabilities: imapCaps("UIDPLUS"),
      mailbox: { uidValidity: "uidv-1" },
      async connect() {},
      async getMailboxLock() {
        return { release() {} };
      },
      async messageDelete(range) {
        clientCalls.push(range);
        return true;
      },
      async logout() {}
    };
  }
  const firstNode = createAckNode({
    actionMode: "delete",
    batchSize: 100,
    flushMs: 60000,
    diagnostics: "off"
  }, clientFactory);
  const secondNode = createAckNode({
    actionMode: "delete",
    batchSize: 100,
    flushMs: 60000,
    diagnostics: "off"
  }, clientFactory);

  const first = enqueueInput(firstNode.handlers, { imap: { ackToken: token } });
  const second = enqueueInput(secondNode.handlers, { imap: { ackToken: token } });
  for (const node of [firstNode.node, secondNode.node]) {
    if (node.timer) {
      clearTimeout(node.timer);
      node.timer = null;
    }
  }

  await Promise.all([firstNode.node.flush(), secondNode.node.flush()]);
  const outputs = [...first.outputs, ...second.outputs];

  assert.deepEqual(clientCalls, ["1"]);
  assert.equal(first.doneCount + second.doneCount, 2);
  assert.equal(outputs.filter((output) => output[0]).length, 1);
  assert.equal(outputs.filter((output) => output[1]).length, 1);
});

test("ack runtime separates scopes that would collide with delimiter grouping", async () => {
  const firstToken = inputToken(1, {
    mailbox: "A|B",
    uidValidity: "C"
  });
  const secondToken = inputToken(2, {
    mailbox: "A",
    uidValidity: "B|C"
  });
  registry.clearQueue(firstToken.queueKey);
  registry.clearQueue(secondToken.queueKey);
  registry.markInflight(firstToken.queueKey, firstToken, { now: 1000 });
  registry.markInflight(secondToken.queueKey, secondToken, { now: 1000 });
  const locks = [];
  const deletes = [];
  const { node, handlers } = createAckNode({
    actionMode: "delete",
    batchSize: 100,
    flushMs: 60000,
    diagnostics: "off"
  }, () => ({
    capabilities: imapCaps("UIDPLUS"),
    mailbox: { uidValidity: "" },
    async connect() {},
    async getMailboxLock(mailbox) {
      locks.push(mailbox);
      this.mailbox.uidValidity = mailbox === "A|B" ? "C" : "B|C";
      return { release() {} };
    },
    async messageDelete(range) {
      deletes.push([this.mailbox.uidValidity, range]);
      return true;
    },
    async logout() {}
  }));

  const first = enqueueInput(handlers, { imap: { ackToken: firstToken } });
  const second = enqueueInput(handlers, { imap: { ackToken: secondToken } });
  if (node.timer) {
    clearTimeout(node.timer);
    node.timer = null;
  }
  await node.flush();

  assert.deepEqual(locks, ["A|B", "A"]);
  assert.deepEqual(deletes, [["C", "1"], ["B|C", "2"]]);
  const outputs = [...first.outputs, ...second.outputs];
  assert.equal(outputs.filter((output) => output[0]).length, 2);
  assert.equal(outputs.filter((output) => output[1]).length, 0);
});

test("ack runtime releases token claims after IMAP failures", async () => {
  const token = inputToken(1);
  registry.clearQueue(token.queueKey);
  registry.markInflight(token.queueKey, token, { now: 1000 });
  const { node, handlers } = createAckNode({
    actionMode: "delete",
    batchSize: 100,
    flushMs: 60000,
    diagnostics: "off"
  }, () => ({
    capabilities: imapCaps("UIDPLUS"),
    mailbox: { uidValidity: "uidv-1" },
    async connect() {},
    async getMailboxLock() {
      return { release() {} };
    },
    async messageDelete() {
      throw new Error("delete failed");
    },
    async logout() {}
  }));

  const result = enqueueInput(handlers, {
    imap: { ackToken: token }
  });
  if (node.timer) {
    clearTimeout(node.timer);
    node.timer = null;
  }
  await node.flush();

  assert.equal(result.outputs.length, 1);
  assert.equal(result.outputs[0][1].imapAck.ok, false);
  assert.equal(registry.matchesAckToken(token.queueKey, token), true);
  assert.equal(!!registry.claimAckToken(token.queueKey, token), true);
  assert.equal(registry.releaseAckToken(token.queueKey, token), true);
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
      ackToken: inputToken(1),
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
      ackToken: inputToken(1)
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

  const partialError = new Error("move failed");
  partialError.partial = true;
  assert.equal(buildImapAckError({
    token,
    plan,
    mailbox: "INBOX",
    range: "123",
    error: partialError
  }).partial, true);
});

test("executes move with automatic target mailbox creation", async () => {
  const { executeAckActionRange, normalizeAckAction } = loadAckActions();
  const calls = [];
  const plan = normalizeAckAction({
    action: "move",
    targetMailbox: "Archive/Processed",
    seenAction: "set",
    flagRemove: "$Todo"
  });
  const client = {
    capabilities: imapCaps("MOVE"),
    async mailboxCreate(path) {
      calls.push(["mailboxCreate", path]);
    },
    async messageFlagsAdd(range, flags, options) {
      calls.push(["messageFlagsAdd", range, flags, options]);
      return true;
    },
    async messageFlagsRemove(range, flags, options) {
      calls.push(["messageFlagsRemove", range, flags, options]);
      return true;
    },
    async messageMove(range, target, options) {
      calls.push(["messageMove", range, target, options]);
      return { destination: target };
    }
  };

  await executeAckActionRange({ client, plan, range: "123", mailbox: "INBOX" });

  assert.deepEqual(calls, [
    ["mailboxCreate", "Archive/Processed"],
    ["messageFlagsAdd", "123", ["\\Seen"], { uid: true }],
    ["messageFlagsRemove", "123", ["$Todo"], { uid: true }],
    ["messageMove", "123", "Archive/Processed", { uid: true }]
  ]);
});

test("does not apply move flags when target mailbox creation fails", async () => {
  const { executeAckActionRange, normalizeAckAction } = loadAckActions();
  const calls = [];
  const plan = normalizeAckAction({
    action: "move",
    targetMailbox: "Archive/Processed",
    seenAction: "set"
  });
  const client = {
    capabilities: imapCaps("MOVE"),
    async mailboxCreate(path) {
      calls.push(["mailboxCreate", path]);
      throw new Error("create failed");
    },
    async messageFlagsAdd() {
      calls.push(["messageFlagsAdd"]);
    },
    async messageMove() {
      calls.push(["messageMove"]);
    }
  };

  await assert.rejects(
    () => executeAckActionRange({ client, plan, range: "123", mailbox: "INBOX" }),
    /create failed/
  );
  assert.deepEqual(calls, [["mailboxCreate", "Archive/Processed"]]);
});

test("does not move when move flag updates fail before any side effect", async () => {
  const { executeAckActionRange, normalizeAckAction } = loadAckActions();
  const calls = [];
  const plan = normalizeAckAction({
    action: "move",
    targetMailbox: "Archive/Processed",
    seenAction: "set"
  });
  const client = {
    capabilities: imapCaps("MOVE"),
    async mailboxCreate(path) {
      calls.push(["mailboxCreate", path]);
    },
    async messageFlagsAdd(range, flags, options) {
      calls.push(["messageFlagsAdd", range, flags, options]);
      throw new Error("flag add failed");
    },
    async messageMove() {
      calls.push(["messageMove"]);
    }
  };

  await assert.rejects(
    () => executeAckActionRange({ client, plan, range: "123", mailbox: "INBOX" }),
    (err) => {
      assert.equal(err.message, "flag add failed");
      assert.equal(err.partial, undefined);
      return true;
    }
  );
  assert.deepEqual(calls, [
    ["mailboxCreate", "Archive/Processed"],
    ["messageFlagsAdd", "123", ["\\Seen"], { uid: true }]
  ]);
});

test("marks move failures after flag changes as partial", async () => {
  const { executeAckActionRange, normalizeAckAction } = loadAckActions();
  const calls = [];
  const plan = normalizeAckAction({
    action: "move",
    targetMailbox: "Archive/Processed",
    seenAction: "set"
  });
  const client = {
    capabilities: imapCaps("MOVE"),
    async mailboxCreate(path) {
      calls.push(["mailboxCreate", path]);
    },
    async messageFlagsAdd(range, flags, options) {
      calls.push(["messageFlagsAdd", range, flags, options]);
      return true;
    },
    async messageMove(range, target, options) {
      calls.push(["messageMove", range, target, options]);
      throw new Error("move failed");
    }
  };

  await assert.rejects(
    () => executeAckActionRange({ client, plan, range: "123", mailbox: "INBOX" }),
    (err) => {
      assert.equal(err.message, "move failed");
      assert.equal(err.partial, true);
      return true;
    }
  );
  assert.deepEqual(calls, [
    ["mailboxCreate", "Archive/Processed"],
    ["messageFlagsAdd", "123", ["\\Seen"], { uid: true }],
    ["messageMove", "123", "Archive/Processed", { uid: true }]
  ]);
});

test("does not report success when an IMAP action fails", async () => {
  const { executeAckActionRange, normalizeAckAction } = loadAckActions();
  const plan = normalizeAckAction({ action: "delete" });
  const client = completeDeleteClient({
    capabilities: imapCaps("UIDPLUS"),
    async messageDelete() {
      throw new Error("delete failed");
    }
  });

  await assert.rejects(
    () => executeAckActionRange({ client, plan, range: "123", mailbox: "INBOX" }),
    /delete failed/
  );
});

test("executes delete with UIDPLUS, confirmed flagging and exact UID SEARCH absence verification", async () => {
  const { executeAckActionRange, normalizeAckAction } = loadAckActions();
  const calls = [];
  const result = await executeAckActionRange({
    client: completeDeleteClient({
      capabilities: imapCaps("UIDPLUS"),
      async messageFlagsAdd(range, flags, options) {
        calls.push(["messageFlagsAdd", range, flags, options]);
        return true;
      },
      async messageDelete(range, options) {
        calls.push(["messageDelete", range, options]);
        return true;
      },
      async search(query, options) {
        calls.push(["search", query, options]);
        return [];
      }
    }),
    plan: normalizeAckAction({ action: "delete" }),
    range: "123",
    mailbox: "INBOX"
  });

  assert.deepEqual(calls, [
    ["messageFlagsAdd", "123", ["\\Deleted"], { uid: true }],
    ["messageDelete", "123", { uid: true }],
    ["search", { uid: "123" }, { uid: true }]
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.action, "delete");
  assert.equal(result.disposition, "delete");
});

test("rejects unsafe delete and move capability fallbacks before acting", async () => {
  const { executeAckActionRange, normalizeAckAction } = loadAckActions();
  const calls = [];

  await assert.rejects(
    () => executeAckActionRange({
      client: {
        capabilities: imapCaps(),
        async messageDelete() {
          calls.push("messageDelete");
          return true;
        }
      },
      plan: normalizeAckAction({ action: "delete" }),
      range: "123",
      mailbox: "INBOX"
    }),
    /UIDPLUS/
  );

  await assert.rejects(
    () => executeAckActionRange({
      client: {
        capabilities: imapCaps(),
        async mailboxCreate() {
          calls.push("mailboxCreate");
        },
        async messageMove() {
          calls.push("messageMove");
          return { destination: "Archive" };
        }
      },
      plan: normalizeAckAction({ action: "move", targetMailbox: "Archive" }),
      range: "123",
      mailbox: "INBOX"
    }),
    /MOVE/
  );

  assert.deepEqual(calls, []);
});

test("executes copy with automatic target mailbox creation before source flag updates", async () => {
  const { executeAckActionRange, normalizeAckAction } = loadAckActions();
  const calls = [];
  const plan = normalizeAckAction({
    action: "copy",
    targetMailbox: "Archive/Copied",
    seenAction: "set",
    flagRemove: "$Todo"
  });
  const client = {
    async mailboxCreate(path) {
      calls.push(["mailboxCreate", path]);
    },
    async messageFlagsAdd(range, flags, options) {
      calls.push(["messageFlagsAdd", range, flags, options]);
      return true;
    },
    async messageFlagsRemove(range, flags, options) {
      calls.push(["messageFlagsRemove", range, flags, options]);
      return true;
    },
    async messageCopy(range, target, options) {
      calls.push(["messageCopy", range, target, options]);
      return { destination: target };
    }
  };

  await executeAckActionRange({ client, plan, range: "123", mailbox: "INBOX" });

  assert.deepEqual(calls, [
    ["mailboxCreate", "Archive/Copied"],
    ["messageCopy", "123", "Archive/Copied", { uid: true }],
    ["messageFlagsAdd", "123", ["\\Seen"], { uid: true }],
    ["messageFlagsRemove", "123", ["$Todo"], { uid: true }]
  ]);
});

test("does not apply copy source flags when copy fails first", async () => {
  const { executeAckActionRange, normalizeAckAction } = loadAckActions();
  const cases = [
    ["throws", /copy failed/, async () => { throw new Error("copy failed"); }],
    ["false", /ACK copy failed/, async () => false],
    ["undefined", /ACK copy failed/, async () => undefined]
  ];

  for (const [label, expectedError, messageCopy] of cases) {
    const calls = [];
    const plan = normalizeAckAction({
      action: "copy",
      targetMailbox: "Archive/Copied",
      seenAction: "set",
      flagRemove: "$Todo"
    });
    const client = {
      async mailboxCreate(path) {
        calls.push(["mailboxCreate", path]);
      },
      async messageCopy(range, target, options) {
        calls.push(["messageCopy", range, target, options]);
        return messageCopy();
      },
      async messageFlagsAdd(range, flags, options) {
        calls.push(["messageFlagsAdd", range, flags, options]);
        return true;
      },
      async messageFlagsRemove(range, flags, options) {
        calls.push(["messageFlagsRemove", range, flags, options]);
        return true;
      }
    };

    await assert.rejects(
      () => executeAckActionRange({ client, plan, range: "123", mailbox: "INBOX" }),
      (err) => {
        assert.match(err.message, expectedError, label);
        assert.equal(err.partial, undefined, label);
        return true;
      }
    );
    assert.deepEqual(calls, [
      ["mailboxCreate", "Archive/Copied"],
      ["messageCopy", "123", "Archive/Copied", { uid: true }]
    ], label);
  }
});

test("marks copy source flag failures after successful copy as partial", async () => {
  const { executeAckActionRange, normalizeAckAction } = loadAckActions();
  const cases = [
    ["flag add", {
      flags: { seenAction: "set" },
      expectedError: "flag add failed",
      async messageFlagsAdd() {
        throw new Error("flag add failed");
      }
    }],
    ["flag remove", {
      flags: { seenAction: "set", flaggedAction: "clear" },
      expectedError: "flag remove failed",
      async messageFlagsAdd() {
        return true;
      },
      async messageFlagsRemove() {
        throw new Error("flag remove failed");
      }
    }]
  ];

  for (const [label, testCase] of cases) {
    const plan = normalizeAckAction({
      action: "copy",
      targetMailbox: "Archive/Copied",
      ...testCase.flags
    });
    const client = {
      async mailboxCreate() {},
      async messageCopy() {
        return { destination: "Archive/Copied" };
      },
      async messageFlagsAdd(range, flags, options) {
        if (testCase.messageFlagsAdd) {
          return testCase.messageFlagsAdd(range, flags, options);
        }
        return true;
      },
      async messageFlagsRemove(range, flags, options) {
        if (testCase.messageFlagsRemove) {
          return testCase.messageFlagsRemove(range, flags, options);
        }
        return true;
      }
    };

    await assert.rejects(
      () => executeAckActionRange({ client, plan, range: "123", mailbox: "INBOX" }),
      (err) => {
        assert.equal(err.message, testCase.expectedError, label);
        assert.equal(err.partial, true, label);
        return true;
      }
    );
  }
});

test("rejects false and undefined IMAP action results", async () => {
  const { executeAckActionRange, normalizeAckAction } = loadAckActions();
  const cases = [
    ["delete false", normalizeAckAction({ action: "delete" }), {
      capabilities: imapCaps("UIDPLUS"),
      async messageDelete() { return false; }
    }],
    ["delete undefined", normalizeAckAction({ action: "delete" }), {
      capabilities: imapCaps("UIDPLUS"),
      async messageDelete() {}
    }],
    ["move false", normalizeAckAction({ action: "move", targetMailbox: "Archive" }), {
      capabilities: imapCaps("MOVE"),
      async mailboxCreate() {},
      async messageMove() { return false; }
    }],
    ["move undefined", normalizeAckAction({ action: "move", targetMailbox: "Archive" }), {
      capabilities: imapCaps("MOVE"),
      async mailboxCreate() {},
      async messageMove() {}
    }],
    ["copy false", normalizeAckAction({ action: "copy", targetMailbox: "Archive" }), {
      async mailboxCreate() {},
      async messageCopy() { return false; }
    }],
    ["copy undefined", normalizeAckAction({ action: "copy", targetMailbox: "Archive" }), {
      async mailboxCreate() {},
      async messageCopy() {}
    }],
    ["flag add false", normalizeAckAction({ action: "flag", seenAction: "set" }), {
      async messageFlagsAdd() { return false; }
    }],
    ["flag add undefined", normalizeAckAction({ action: "flag", seenAction: "set" }), {
      async messageFlagsAdd() {}
    }],
    ["flag remove false", normalizeAckAction({ action: "flag", seenAction: "clear" }), {
      async messageFlagsRemove() { return false; }
    }],
    ["flag remove undefined", normalizeAckAction({ action: "flag", seenAction: "clear" }), {
      async messageFlagsRemove() {}
    }]
  ];

  for (const [label, plan, client] of cases) {
    await assert.rejects(
      () => executeAckActionRange({ client: completeDeleteClient(client), plan, range: "123", mailbox: "INBOX" }),
      label.startsWith("delete") ? /IMAP delete command was not confirmed/ : /failed/,
      label
    );
  }
});

test("marks false and undefined results after flag changes as partial", async () => {
  const { executeAckActionRange, normalizeAckAction } = loadAckActions();
  const cases = [
    ["flag remove false", normalizeAckAction({ action: "flag", seenAction: "set", flaggedAction: "clear" }), {
      async messageFlagsAdd() { return true; },
      async messageFlagsRemove() { return false; }
    }],
    ["flag remove undefined", normalizeAckAction({ action: "flag", seenAction: "set", flaggedAction: "clear" }), {
      async messageFlagsAdd() { return true; },
      async messageFlagsRemove() {}
    }],
    ["move false", normalizeAckAction({ action: "move", targetMailbox: "Archive", seenAction: "set" }), {
      capabilities: imapCaps("MOVE"),
      async mailboxCreate() {},
      async messageFlagsAdd() { return true; },
      async messageMove() { return false; }
    }],
    ["move undefined", normalizeAckAction({ action: "move", targetMailbox: "Archive", seenAction: "set" }), {
      capabilities: imapCaps("MOVE"),
      async mailboxCreate() {},
      async messageFlagsAdd() { return true; },
      async messageMove() {}
    }],
    ["copy flag add false after copy", normalizeAckAction({ action: "copy", targetMailbox: "Archive", seenAction: "set" }), {
      async mailboxCreate() {},
      async messageCopy() { return true; },
      async messageFlagsAdd() { return false; }
    }],
    ["copy flag add undefined after copy", normalizeAckAction({ action: "copy", targetMailbox: "Archive", seenAction: "set" }), {
      async mailboxCreate() {},
      async messageCopy() { return true; },
      async messageFlagsAdd() {}
    }],
    ["copy flag remove false after copy", normalizeAckAction({ action: "copy", targetMailbox: "Archive", seenAction: "set", flaggedAction: "clear" }), {
      async mailboxCreate() {},
      async messageCopy() { return true; },
      async messageFlagsAdd() { return true; },
      async messageFlagsRemove() { return false; }
    }],
    ["copy flag remove undefined after copy", normalizeAckAction({ action: "copy", targetMailbox: "Archive", seenAction: "set", flaggedAction: "clear" }), {
      async mailboxCreate() {},
      async messageCopy() { return true; },
      async messageFlagsAdd() { return true; },
      async messageFlagsRemove() {}
    }]
  ];

  for (const [label, plan, client] of cases) {
    await assert.rejects(
      () => executeAckActionRange({ client, plan, range: "123", mailbox: "INBOX" }),
      (err) => {
        assert.equal(err.partial, true, label);
        return /failed/.test(err.message);
      }
    );
  }
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
    capabilities: imapCaps("UIDPLUS"),
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
      return true;
    },
    async logout() {}
  }));

    const itemOutputs = [];
    for (const uid of [1, 2, 3, 4]) {
      node.pending.push(makePendingAckItem(node, uid, itemOutputs, () => {}));
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

function deleteProtocolClient(calls, overrides = {}) {
  return {
    usable: true,
    capabilities: imapCaps("UIDPLUS"),
    mailbox: { path: "INBOX", uidValidity: "uidv-1" },
    async connect() {},
    async getMailboxLock() { return { release() {} }; },
    async messageFlagsAdd(range, flags, options) {
      calls.push(["STORE", range]);
      assert.deepEqual(flags, ["\\Deleted"]);
      assert.deepEqual(options, { uid: true });
      return true;
    },
    async messageDelete(range, options) {
      calls.push(["DELETE", range]);
      assert.deepEqual(options, { uid: true });
      return true;
    },
    async search(query, options) {
      calls.push(["VERIFY", query.uid]);
      assert.deepEqual(query, { uid: query.uid });
      assert.deepEqual(options, { uid: true });
      assert.match(query.uid, /^[1-9]\d*(?::[1-9]\d*)?(?:,[1-9]\d*(?::[1-9]\d*)?)*$/);
      return [];
    },
    async logout() {},
    ...overrides
  };
}

test("DELETE STORE failures never complete ACK and release claims while preserving inflight", async () => {
  for (const failure of [false, undefined, null, new Error("synthetic STORE refusal")]) {
    const token = inputToken(1);
    registry.clearQueue(token.queueKey);
    registry.markInflight(token.queueKey, token);
    const calls = [];
    const { node, handlers, sends } = createAckNode({ batchSize: 100, flushMs: 60000 }, () =>
      deleteProtocolClient(calls, {
        async messageFlagsAdd(range) {
          calls.push(["STORE", range]);
          if (failure instanceof Error) throw failure;
          return failure;
        }
      }));
    const result = enqueueInput(handlers, { imap: { ackToken: token } });
    clearTimeout(node.timer);
    node.timer = null;
    await node.flush();
    assert.deepEqual(calls, [["STORE", "1"]]);
    assert.equal(result.doneCount, 1);
    assert.equal(result.outputs.length, 1);
    assert.equal(result.outputs[0][0], null);
    assert.equal(result.outputs[0][1].imapAck.ok, false);
    assert.equal(result.outputs[0][1].imapAck.completed, false);
    assert.equal(result.outputs[0][1].imapAck.partial, undefined);
    assert.equal(registry.matchesAckToken(token.queueKey, token), true);
    assert.ok(registry.claimAckToken(token.queueKey, token), "failed action releases the claim");
    registry.releaseAckToken(token.queueKey, token);
    const stats = sends.find(output => output[2])[2].payload;
    assert.equal(stats.okCount, 0);
    assert.equal(stats.errorCount, 1);
  }
});

test("DELETE retries the same token successfully after a STORE refusal", async () => {
  const token = inputToken(1);
  registry.clearQueue(token.queueKey);
  registry.markInflight(token.queueKey, token);
  let acceptStore = false;
  const calls = [];
  const { node, handlers } = createAckNode({ batchSize: 100, flushMs: 60000 }, () =>
    deleteProtocolClient(calls, {
      async messageFlagsAdd(range) { calls.push(["STORE", range]); return acceptStore; }
    }));
  const attempt = async msg => {
    const result = enqueueInput(handlers, msg);
    clearTimeout(node.timer);
    node.timer = null;
    await node.flush();
    return result;
  };
  const first = await attempt({ imap: { ackToken: token } });
  assert.equal(first.outputs[0][1].imapAck.ok, false);
  assert.equal(registry.matchesAckToken(token.queueKey, token), true);
  acceptStore = true;
  const retried = await attempt(structuredClone(first.outputs[0][1]));
  assert.equal(retried.doneCount, 1);
  assert.equal(retried.outputs.length, 1);
  assert.equal(retried.outputs[0][0].imapAck.ok, true);
  assert.equal(retried.outputs[0][0].imapAck.completed, true);
  assert.equal(registry.matchesAckToken(token.queueKey, token), false);
  assert.deepEqual(calls, [["STORE", "1"], ["STORE", "1"], ["DELETE", "1"], ["VERIFY", "1"]]);
});

test("DELETE STORE failure remains chunk-local with no hidden per-UID fallback", async () => {
  const calls = [];
  const { node, sends } = createAckNode({ batchSize: 4, maxUidPerCommand: 2, flushMs: 60000 }, () =>
    deleteProtocolClient(calls, {
      async messageFlagsAdd(range) { calls.push(["STORE", range]); return range !== "1:2"; }
    }));
  const outputs = [];
  let done = 0;
  pushPendingAckItems(node, [1, 2, 3, 4], outputs, () => { done += 1; });
  const tokens = node.pending.map(item => item.token);
  await node.flush();
  assert.deepEqual(calls, [["STORE", "1:2"], ["STORE", "3:4"], ["DELETE", "3:4"], ["VERIFY", "3:4"]]);
  assert.equal(done, 4);
  assert.deepEqual(outputs.filter(output => output[1]).map(output => output[1].imapAck.uid), [1, 2]);
  assert.deepEqual(outputs.filter(output => output[0]).map(output => output[0].imapAck.uid), [3, 4]);
  for (const token of tokens) {
    assert.equal(registry.matchesAckToken(token.queueKey, token), token.uid <= 2);
    if (token.uid <= 2) {
      assert.ok(registry.claimAckToken(token.queueKey, token));
      registry.releaseAckToken(token.queueKey, token);
    }
  }
  const stats = sends.find(output => output[2])[2].payload;
  assert.equal(stats.okCount, 2);
  assert.equal(stats.errorCount, 2);
});

test("DELETE failures after confirmed STORE stop all subsequent chunks and preserve their inflight", async () => {
  for (const failure of ["delete false", "delete throws", "UID remains", "verification throws", "search false", "search undefined", "search NO swallowed", "mailbox lost"]) {
    const calls = [];
    let verificationCalled = false;
    const { node, sends } = createAckNode({ batchSize: 4, maxUidPerCommand: 2, flushMs: 60000 }, () =>
      deleteProtocolClient(calls, {
        async messageDelete(range) {
          calls.push(["DELETE", range]);
          if (failure === "delete false") return false;
          if (failure === "delete throws") throw new Error("synthetic DELETE refusal");
          if (failure === "mailbox lost") this.mailbox = false;
          return true;
        },
        async search(query, options) {
          calls.push(["VERIFY", query.uid]);
          assert.deepEqual(query, { uid: "1:2" });
          assert.deepEqual(options, { uid: true });
          verificationCalled = true;
          if (failure === "UID remains") return [1, 2];
          if (failure === "verification throws") throw new Error("synthetic verification failure");
          if (failure === "search false") return false;
          if (failure === "search undefined") return undefined;
          if (failure === "search NO swallowed") this.emit("response", { response: "NO" });
          return [];
        }
      }));
    const outputs = [];
    let done = 0;
    pushPendingAckItems(node, [1, 2, 3, 4], outputs, () => { done += 1; });
    const tokens = node.pending.map(item => item.token);
    await node.flush();
    assert.ok(calls.every(call => call[1] === "1:2"), failure);
    assert.equal(done, 4, failure);
    assert.equal(outputs.length, 4, failure);
    assert.equal(outputs.every(output => output[1] && output[1].imapAck.ok === false
      && output[1].imapAck.completed === false && output[1].imapAck.partial === true), true, failure);
    for (const token of tokens) {
      assert.equal(registry.matchesAckToken(token.queueKey, token), true, failure);
      assert.ok(registry.claimAckToken(token.queueKey, token), failure);
      registry.releaseAckToken(token.queueKey, token);
    }
    if (["UID remains", "verification throws", "search false", "search undefined", "search NO swallowed"].includes(failure)) {
      assert.equal(verificationCalled, true, failure);
    }
    const stats = sends.find(output => output[2])[2].payload;
    assert.equal(stats.okCount, 0, failure);
    assert.equal(stats.errorCount, 4, failure);
  }
});

test("ack runtime rejects unsafe delete without UIDPLUS and keeps inflight", async () => {
  const key = "queue-1";
  registry.clearQueue(key);
  registry.markInflight(key, sampleToken(1), { now: 1000 });
  const clientCalls = [];

  const { node } = createAckNode({
    actionMode: "delete",
    batchSize: 1,
    flushMs: 60000,
    diagnostics: "off"
  }, () => ({
    capabilities: imapCaps(),
    mailbox: { uidValidity: "uidv-1" },
    async connect() {},
    async getMailboxLock() {
      return { release() {} };
    },
    async messageDelete() {
      clientCalls.push("messageDelete");
      return true;
    },
    async logout() {}
  }));

    const itemOutputs = [];
    node.pending.push(makePendingAckItem(node, 1, itemOutputs, () => {}));

  await node.flush();

  assert.deepEqual(clientCalls, []);
  assert.equal(itemOutputs.length, 1);
  assert.equal(itemOutputs[0][1].imapAck.ok, false);
  assert.match(itemOutputs[0][1].imapAck.error, /UIDPLUS/);
  assert.equal(registry.isActiveInflight(key, "uidv-1", 1, 10000, 2000), true);
});

test("ack runtime completes copy actions and removes inflight", async () => {
  const key = "queue-1";
  registry.clearQueue(key);
  registry.markInflight(key, sampleToken(1), { now: 1000 });
  const clientCalls = [];

  const { node } = createAckNode({
    actionMode: "copy",
    targetMailbox: "Archive/Copied",
    seenAction: "set",
    batchSize: 1,
    flushMs: 60000,
    diagnostics: "off"
  }, () => ({
    mailbox: { uidValidity: "uidv-1" },
    async connect() {},
    async getMailboxLock() {
      return { release() {} };
    },
    async mailboxCreate(path) {
      clientCalls.push(["mailboxCreate", path]);
    },
    async messageFlagsAdd(range, flags, options) {
      clientCalls.push(["messageFlagsAdd", range, flags, options]);
      return true;
    },
    async messageCopy(range, target, options) {
      clientCalls.push(["messageCopy", range, target, options]);
      return { destination: target };
    },
    async logout() {}
  }));

    const itemOutputs = [];
    node.pending.push(makePendingAckItem(node, 1, itemOutputs, () => {}));

  await node.flush();

  assert.deepEqual(clientCalls, [
    ["mailboxCreate", "Archive/Copied"],
    ["messageCopy", "1", "Archive/Copied", { uid: true }],
    ["messageFlagsAdd", "1", ["\\Seen"], { uid: true }]
  ]);
  assert.equal(itemOutputs.length, 1);
  assert.equal(itemOutputs[0][0].imapAck.ok, true);
  assert.equal(itemOutputs[0][0].imapAck.action, "copy");
  assert.equal(registry.isActiveInflight(key, "uidv-1", 1, 10000, 2000), false);
});

test("ack runtime completes message-driven copy actions and removes inflight", async () => {
  const token = inputToken(1);
  registry.clearQueue(token.queueKey);
  registry.markInflight(token.queueKey, token, { now: 1000 });
  const clientCalls = [];

  const { node, handlers } = createAckNode({
    actionMode: "message",
    batchSize: 100,
    flushMs: 60000,
    diagnostics: "off"
  }, () => ({
    mailbox: { uidValidity: "uidv-1" },
    async connect() {},
    async getMailboxLock() {
      return { release() {} };
    },
    async mailboxCreate(path) {
      clientCalls.push(["mailboxCreate", path]);
    },
    async messageFlagsAdd(range, flags, options) {
      clientCalls.push(["messageFlagsAdd", range, flags, options]);
      return true;
    },
    async messageCopy(range, target, options) {
      clientCalls.push(["messageCopy", range, target, options]);
      return { destination: target };
    },
    async logout() {}
  }));

  const outputs = [];
  let doneCount = 0;
  handlers.input({
    payload: 1,
    imap: {
      ackToken: token,
      ackAction: {
        action: "copy",
        targetMailbox: "Archive/Copied",
        flags: { seen: "set" }
      }
    }
  }, (output) => outputs.push(output), () => {
    doneCount += 1;
  });

  if (node.timer) {
    clearTimeout(node.timer);
    node.timer = null;
  }

  assert.equal(node.pending.length, 1);
  assert.equal(node.pending[0].plan.action, "copy");

  await node.flush();

  assert.deepEqual(clientCalls, [
    ["mailboxCreate", "Archive/Copied"],
    ["messageCopy", "1", "Archive/Copied", { uid: true }],
    ["messageFlagsAdd", "1", ["\\Seen"], { uid: true }]
  ]);
  assert.equal(doneCount, 1);
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0][0].imapAck.ok, true);
  assert.equal(outputs[0][0].imapAck.action, "copy");
  assert.equal(registry.isActiveInflight(token.queueKey, "uidv-1", 1, 10000, 2000), false);
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
    node.pending.push(makePendingAckItem(node, 1, itemOutputs, () => {
      doneCount += 1;
    }));

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
    capabilities: imapCaps("UIDPLUS"),
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
      node.pending.push(makePendingAckItem(node, uid, itemOutputs, () => {
        doneCount += 1;
      }));
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

test("ack runtime stops remaining chunks after a partial move side effect", async () => {
  const clientCalls = [];
  const { node, warnings, errors } = createAckNode({
    actionMode: "move",
    targetMailbox: "Archive/Processed",
    seenAction: "set",
    batchSize: 4,
    maxUidPerCommand: 2,
    flushMs: 60000,
    diagnostics: "off"
  }, () => ({
    capabilities: imapCaps("MOVE"),
    usable: true,
    mailbox: { uidValidity: "uidv-1" },
    async connect() {},
    async getMailboxLock() {
      return { release() {} };
    },
    async mailboxCreate(path) {
      clientCalls.push(["mailboxCreate", path]);
    },
    async messageFlagsAdd(range, flags, options) {
      clientCalls.push(["messageFlagsAdd", range, flags, options]);
      return true;
    },
    async messageMove(range, target, options) {
      clientCalls.push(["messageMove", range, target, options]);
      throw new Error("move failed after flags");
    },
    async logout() {}
  }));

    const itemOutputs = [];
    let doneCount = 0;
    for (const uid of [1, 2, 3, 4]) {
      node.pending.push(makePendingAckItem(node, uid, itemOutputs, () => {
        doneCount += 1;
      }));
    }

  await node.flush();

  assert.equal(node.running, false);
  assert.equal(errors.length, 0);
  assert.deepEqual(clientCalls, [
    ["mailboxCreate", "Archive/Processed"],
    ["messageFlagsAdd", "1:2", ["\\Seen"], { uid: true }],
    ["messageMove", "1:2", "Archive/Processed", { uid: true }]
  ]);
  assert.equal(warnings.length, 2);
  assert.equal(doneCount, 4);
  assert.equal(itemOutputs.filter((output) => output[1]).length, 4);
  assert.equal(itemOutputs.every((output) => output[1].imapAck.partial === true), true);
});

test("ack runtime stops remaining chunks after a partial copy source flag side effect", async () => {
  const key = "queue-1";
  registry.clearQueue(key);
  for (const uid of [1, 2, 3, 4]) {
    registry.markInflight(key, sampleToken(uid), { now: 1000 });
  }

  const clientCalls = [];
  const { node, warnings, errors } = createAckNode({
    actionMode: "copy",
    targetMailbox: "Archive/Copied",
    seenAction: "set",
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
    async mailboxCreate(path) {
      clientCalls.push(["mailboxCreate", path]);
    },
    async messageCopy(range, target, options) {
      clientCalls.push(["messageCopy", range, target, options]);
      return { destination: target };
    },
    async messageFlagsAdd(range, flags, options) {
      clientCalls.push(["messageFlagsAdd", range, flags, options]);
      throw new Error("flag failed after copy");
    },
    async logout() {}
  }));

    const itemOutputs = [];
    let doneCount = 0;
    for (const uid of [1, 2, 3, 4]) {
      node.pending.push(makePendingAckItem(node, uid, itemOutputs, () => {
        doneCount += 1;
      }));
    }

  await node.flush();

  assert.equal(node.running, false);
  assert.equal(errors.length, 0);
  assert.deepEqual(clientCalls, [
    ["mailboxCreate", "Archive/Copied"],
    ["messageCopy", "1:2", "Archive/Copied", { uid: true }],
    ["messageFlagsAdd", "1:2", ["\\Seen"], { uid: true }]
  ]);
  assert.equal(warnings.length, 2);
  assert.equal(doneCount, 4);
  assert.equal(itemOutputs.filter((output) => output[1]).length, 4);
  assert.equal(itemOutputs.every((output) => output[1].imapAck.partial === true), true);
  for (const uid of [1, 2, 3, 4]) {
    assert.equal(registry.isActiveInflight(key, "uidv-1", uid, 10000, 2000), true);
  }
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
    capabilities: imapCaps("UIDPLUS"),
    usable: true,
    mailbox: { uidValidity: "uidv-1" },
    async connect() {},
    async getMailboxLock() {
      return { release() {} };
    },
    async messageDelete(range) {
      clientCalls.push(range);
      return true;
    },
    async logout() {
      throw err;
    }
  }));

    const itemOutputs = [];
    let doneCount = 0;
    node.pending.push(makePendingAckItem(node, 1, itemOutputs, () => {
      doneCount += 1;
    }));

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
    capabilities: imapCaps("UIDPLUS"),
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

  resolveAction(true);
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
    capabilities: imapCaps("UIDPLUS"),
    usable: true,
    mailbox: { uidValidity: "uidv-1" },
    async connect() {},
    async getMailboxLock() {
      return { release() {} };
    },
    async messageDelete(range) {
      clientCalls.push(range);
      return true;
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
    capabilities: imapCaps("UIDPLUS"),
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
