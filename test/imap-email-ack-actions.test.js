"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { extractAckToken } = require("../lib/ack-token");

function loadAckActions() {
  return require("../lib/imap-ack-actions");
}

function sampleToken() {
  return {
    accountId: "account-1",
    queueKey: "queue-1",
    host: "imap.example.test",
    port: 993,
    secure: true,
    user: "user@example.test",
    mailbox: "INBOX",
    uid: 123,
    uidValidity: "uidv-1"
  };
}

test("imap email ack action helper module exposes the planned API", () => {
  const actions = loadAckActions();

  assert.equal(typeof actions.normalizeAckAction, "function");
  assert.equal(typeof actions.validateAckActionPlan, "function");
  assert.equal(typeof actions.buildImapAckResult, "function");
  assert.equal(typeof actions.buildImapAckError, "function");
  assert.equal(typeof actions.executeAckActionBatch, "function");
});

test("normalizes primary ack actions keep, delete and move", () => {
  const { normalizeAckAction } = loadAckActions();

  assert.deepEqual(normalizeAckAction({ mode: "delete" }), {
    mode: "delete",
    disposition: "delete",
    targetMailbox: "",
    createTargetMailbox: false,
    requeue: "complete",
    flags: { add: [], remove: [] }
  });

  assert.deepEqual(normalizeAckAction({ mode: "keep-requeue-later" }), {
    mode: "keep-requeue-later",
    disposition: "keep",
    targetMailbox: "",
    createTargetMailbox: false,
    requeue: "later",
    flags: { add: [], remove: [] }
  });

  assert.deepEqual(normalizeAckAction({ mode: "keep-requeue-now" }), {
    mode: "keep-requeue-now",
    disposition: "keep",
    targetMailbox: "",
    createTargetMailbox: false,
    requeue: "now",
    flags: { add: [], remove: [] }
  });

  assert.deepEqual(normalizeAckAction({
    mode: "move",
    targetMailbox: "Archive/Processed",
    createTargetMailbox: true
  }), {
    mode: "move",
    disposition: "move",
    targetMailbox: "Archive/Processed",
    createTargetMailbox: true,
    requeue: "complete",
    flags: { add: [], remove: [] }
  });
});

test("normalizes seen, answered and flagged actions to IMAP flag changes", () => {
  const { normalizeAckAction } = loadAckActions();

  assert.deepEqual(normalizeAckAction({
    mode: "keep-requeue-now",
    seenAction: "ignore",
    answeredAction: "ignore",
    flaggedAction: "ignore"
  }).flags, {
    add: [],
    remove: []
  });

  assert.deepEqual(normalizeAckAction({
    mode: "move",
    targetMailbox: "Archive",
    seenAction: "set",
    answeredAction: "set",
    flaggedAction: "set"
  }).flags, {
    add: ["\\Seen", "\\Answered", "\\Flagged"],
    remove: []
  });

  assert.deepEqual(normalizeAckAction({
    mode: "move",
    targetMailbox: "Archive",
    seenAction: "clear",
    answeredAction: "clear",
    flaggedAction: "clear"
  }).flags, {
    add: [],
    remove: ["\\Seen", "\\Answered", "\\Flagged"]
  });
});

test("rejects invalid ack action combinations", () => {
  const { normalizeAckAction, validateAckActionPlan } = loadAckActions();

  assert.throws(() => validateAckActionPlan({
    mode: "custom",
    disposition: "delete",
    targetMailbox: "Archive",
    requeue: "complete",
    flags: { add: [], remove: [] }
  }), /delete.*move|move.*delete|target/i);

  assert.throws(() => normalizeAckAction({ mode: "move" }), /target.*mailbox/i);

  assert.throws(() => validateAckActionPlan({
    mode: "custom",
    disposition: "keep",
    targetMailbox: "",
    requeue: "complete",
    flags: { add: ["\\Seen"], remove: ["\\Seen"] }
  }), /conflict|contradict|seen/i);
});

test("continues to use msg.imap.ackToken as the delivery contract", () => {
  const token = sampleToken();
  const extracted = extractAckToken({ imap: { ackToken: token } });

  assert.deepEqual(extracted, token);
});

test("builds the planned msg.imapAck success structure", () => {
  const { buildImapAckResult, normalizeAckAction } = loadAckActions();
  const token = sampleToken();
  const plan = normalizeAckAction({
    mode: "move",
    targetMailbox: "Archive",
    seenAction: "set",
    flaggedAction: "clear"
  });

  assert.deepEqual(buildImapAckResult({
    token,
    plan,
    mailbox: "INBOX",
    ranges: ["123"],
    batchSize: 1,
    inflightRemoved: true
  }), {
    ok: true,
    mode: "move",
    disposition: "move",
    mailbox: "INBOX",
    targetMailbox: "Archive",
    uid: 123,
    uidValidity: "uidv-1",
    flags: {
      add: ["\\Seen"],
      remove: ["\\Flagged"]
    },
    ranges: ["123"],
    batchSize: 1,
    requeue: "complete",
    completed: true,
    inflightRemoved: true
  });
});

test("builds the planned msg.imapAck error structure for missing tokens", () => {
  const { buildImapAckError, normalizeAckAction } = loadAckActions();
  const plan = normalizeAckAction({ mode: "delete" });

  assert.throws(() => extractAckToken({}), /ackToken|uid/i);
  assert.deepEqual(buildImapAckError({
    plan,
    mailbox: "INBOX",
    error: new Error("msg.imap.ackToken.uid fehlt")
  }), {
    ok: false,
    mode: "delete",
    disposition: "delete",
    mailbox: "INBOX",
    targetMailbox: "",
    uid: undefined,
    uidValidity: undefined,
    error: "msg.imap.ackToken.uid fehlt",
    completed: false,
    inflightRemoved: false
  });
});

test("does not report success when an IMAP action fails", async () => {
  const { executeAckActionBatch, normalizeAckAction } = loadAckActions();
  const plan = normalizeAckAction({ mode: "delete" });
  const client = {
    async messageDelete() {
      throw new Error("delete failed");
    }
  };

  await assert.rejects(
    () => executeAckActionBatch({ client, plan, uidRanges: ["123"], mailbox: "INBOX" }),
    /delete failed/
  );
});

test("reports chunk-level failures without marking the full batch successful", async () => {
  const { executeAckActionBatch, normalizeAckAction } = loadAckActions();
  const plan = normalizeAckAction({ mode: "delete" });
  const calls = [];
  const client = {
    async messageDelete(range) {
      calls.push(range);
      if (range === "4:6") {
        throw new Error("chunk failed");
      }
    }
  };

  await assert.rejects(
    () => executeAckActionBatch({ client, plan, uidRanges: ["1:3", "4:6"], mailbox: "INBOX" }),
    /chunk failed/
  );
  assert.deepEqual(calls, ["1:3", "4:6"]);
});
