"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PassThrough, Readable } = require("node:stream");
const test = require("node:test");
const {
  normalizeFlagSelection,
  matchesFlagSelections,
  flagsToState
} = require("../lib/imap-utils");
const registry = require("../lib/runtime-registry");
const registerImapEmailIn = require("../nodes/imap-email-in");

const root = path.resolve(__dirname, "..");

const selectionDefaults = {
  deletedSelection: "exclude",
  seenSelection: "ignore",
  answeredSelection: "ignore",
  flaggedSelection: "ignore"
};

const selectionFields = Object.keys(selectionDefaults);

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readExampleFlow() {
  return JSON.parse(readProjectFile(path.join("examples", "basic-at-least-once-flow.json")));
}

function createInputNode(config = {}, options = {}) {
  let InputCtor;
  const statuses = options.statuses || [];
  const warnings = options.warnings || [];
  const errors = options.errors || [];
  const account = {
    id: "account-1",
    host: "imap.example.test",
    getUsername() {
      return "user@example.test";
    },
    ...options.account
  };
  const RED = {
    nodes: {
      createNode(node) {
        node.id = "node-1";
        node.status = (status) => statuses.push(status);
        node.warn = (message) => warnings.push(message);
        node.error = (err) => errors.push(err);
        node.on = () => {};
      },
      getNode(id) {
        return id === "account-1" ? account : null;
      },
      registerType(type, ctor) {
        if (type === "imap-email in") {
          InputCtor = ctor;
        }
      }
    }
  };

  registerImapEmailIn(RED);
  assert.equal(typeof InputCtor, "function");
  return new InputCtor({ account: "account-1", ...config });
}

function sourceToStream(source) {
  if (source && typeof source.pipe === "function") {
    return source;
  }
  if (Array.isArray(source)) {
    return Readable.from(source);
  }
  return Readable.from([Buffer.isBuffer(source) ? source : Buffer.from(String(source || ""))]);
}

function findMessage(mailbox, uid) {
  const messages = mailbox.messages || mailbox.front || [];
  return messages.find((message) => Number(message.uid) === Number(uid));
}

function createConnectionError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function createCursorTestNode(config = {}, mailboxes = [{ exists: 1200, uidValidity: "uidv-1" }]) {
  const statuses = [];
  const warnings = [];
  const errors = [];
  const fetchCalls = [];
  const fetchOneCalls = [];
  const downloadCalls = [];
  const messageDeleteCalls = [];
  const commandsDuringFetch = [];
  const releasedLocks = [];
  const loggedOutClients = [];
  let mailboxIndex = 0;
  let currentMailbox = mailboxes[0];

  const account = {
    id: "account-1",
    host: "imap.example.test",
    port: 993,
    secure: true,
    getUsername() {
      return "user@example.test";
    },
    createClient() {
      currentMailbox = mailboxes[Math.min(mailboxIndex, mailboxes.length - 1)];
      mailboxIndex += 1;

      return {
        usable: currentMailbox.usable,
        isClosed: currentMailbox.isClosed,
        capabilities: new Set(currentMailbox.capabilities || []),
        mailbox: {
          exists: currentMailbox.exists,
          uidValidity: currentMailbox.uidValidity,
          uidNext: currentMailbox.uidNext
        },
        async connect() {
          if (typeof currentMailbox.connect === "function") {
            return currentMailbox.connect();
          }
        },
        async getMailboxLock(mailbox) {
          if (typeof currentMailbox.getMailboxLock === "function") {
            return currentMailbox.getMailboxLock(mailbox);
          }
          return {
            release() {
              releasedLocks.push(mailbox);
            }
          };
        },
        async *fetch(range, query, options) {
          fetchCalls.push({ range, query, options });
          this.inFetch = true;
          try {
            const front = typeof currentMailbox.fetch === "function"
              ? currentMailbox.fetch(range, query, options)
              : currentMailbox.front || [];
            for await (const item of front) {
              yield item;
            }
          } finally {
            this.inFetch = false;
          }
        },
        async fetchOne(uid, query, options) {
          if (this.inFetch) {
            commandsDuringFetch.push("fetchOne");
          }
          fetchOneCalls.push({ uid, query, options });
          if (typeof currentMailbox.fetchOne === "function") {
            return currentMailbox.fetchOne(uid, query, options);
          }
          return findMessage(currentMailbox, uid) || null;
        },
        async download(uid, part, options) {
          if (this.inFetch) {
            commandsDuringFetch.push("download");
          }
          downloadCalls.push({ uid, part, options });
          if (typeof currentMailbox.download === "function") {
            return currentMailbox.download(uid, part, options);
          }
          const message = findMessage(currentMailbox, uid);
          if (!message || message.source === undefined || message.source === null) {
            return {};
          }
          return {
            meta: { expectedSize: message.size },
            content: sourceToStream(message.source)
          };
        },
        async messageDelete(range, options) {
          if (this.inFetch) {
            commandsDuringFetch.push("messageDelete");
          }
          messageDeleteCalls.push({ range, options });
          if (typeof currentMailbox.messageDelete === "function") {
            return currentMailbox.messageDelete(range, options);
          }
          return true;
        },
        async logout() {
          if (typeof currentMailbox.logout === "function") {
            return currentMailbox.logout();
          }
          loggedOutClients.push(currentMailbox.uidValidity);
        }
      };
    }
  };

  const node = createInputNode({
    diagnostics: "stats",
    includeAttachments: false,
    emitRaw: false,
    ...config
  }, { account, statuses, warnings, errors });
  registry.clearQueue(node.queueKey);

  return {
    node,
    statuses,
    warnings,
    errors,
    fetchCalls,
    fetchOneCalls,
    downloadCalls,
    messageDeleteCalls,
    commandsDuringFetch,
    releasedLocks,
    loggedOutClients
  };
}

function createMailSource(subject = "Hello") {
  return [
    `Subject: ${subject}`,
    "Message-ID: <message-1@example.test>",
    "From: sender@example.test",
    "To: receiver@example.test",
    "",
    "Body"
  ].join("\r\n");
}

function createMailWithAttachment(subject = "Attachment") {
  return [
    `Subject: ${subject}`,
    "Message-ID: <attachment-1@example.test>",
    "From: sender@example.test",
    "To: receiver@example.test",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="test-boundary"',
    "",
    "--test-boundary",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Body",
    "--test-boundary",
    "Content-Type: text/plain; name=\"note.txt\"",
    "Content-Disposition: attachment; filename=\"note.txt\"",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("attachment-body").toString("base64"),
    "--test-boundary--",
    ""
  ].join("\r\n");
}

function createMessage(uid, subject = `Message ${uid}`, flags = []) {
  return {
    uid,
    flags,
    envelope: { subject },
    internalDate: new Date("2026-01-01T00:00:00Z"),
    size: 80,
    source: createMailSource(subject)
  };
}

function rangeBounds(range) {
  const [start, end] = String(range).split(":").map((value) => Number(value));
  return { start, end };
}

function collectStats(outputs) {
  return outputs
    .filter((output) => output && output[2] && output[2].payload)
    .map((output) => output[2].payload);
}

function assertRemovedStatsFieldsAbsent(stats) {
  assert.equal(Object.prototype.hasOwnProperty.call(stats, "scanStrategy"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(stats, "windowPhase"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(stats, "scanCursorHoldReason"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(stats, "newUidCursorReset"), false);
}

function findHtmlDefault(html, field) {
  const pattern = new RegExp(`${field}:\\s*\\{\\s*value:\\s*(?:['"]([^'"]+)['"]|([^,}\\s]+))`);
  const match = html.match(pattern);
  return match && (match[1] || match[2]);
}

function findSelectBlock(html, field) {
  const pattern = new RegExp(`<select\\s+id=["']node-input-${field}["'][^>]*>([\\s\\S]*?)</select>`);
  const match = html.match(pattern);
  return match && match[1];
}

test("imap email in selection defaults match the design decision", () => {
  const html = readProjectFile(path.join("nodes", "imap-email-in.html"));

  for (const [field, expected] of Object.entries(selectionDefaults)) {
    assert.equal(findHtmlDefault(html, field), expected, `${field} must default to ${expected}`);
  }
  assert.equal(findHtmlDefault(html, "scanStrategy"), null);
  assert.equal(findSelectBlock(html, "scanStrategy"), null);
  assert.equal(findHtmlDefault(html, "scanTimeLimitMs"), "10000");
  assert.equal(findHtmlDefault(html, "maxMessageBytes"), "0");
  assert.equal(findHtmlDefault(html, "downloadChunkSize"), "65536");

  const node = createInputNode();
  assert.deepEqual(node.selection, {
    deleted: "exclude",
    seen: "ignore",
    answered: "ignore",
    flagged: "ignore"
  });
  assert.equal(Object.prototype.hasOwnProperty.call(node, "scanStrategy"), false);
  assert.equal(node.scanTimeLimitMs, 10000);
  assert.equal(node.maxMessageBytes, 0);
  assert.equal(node.downloadChunkSize, 65536);
});

test("deprecated scanStrategy config values are ignored", () => {
  assert.equal(Object.prototype.hasOwnProperty.call(createInputNode({ scanStrategy: "cursor-window" }), "scanStrategy"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(createInputNode({ scanStrategy: "new-uid-priority" }), "scanStrategy"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(createInputNode({ scanStrategy: "unexpected" }), "scanStrategy"), false);
});

test("deprecated skipDeleted config does not affect deletedSelection", () => {
  assert.equal(createInputNode({ skipDeleted: true }).deletedSelection, "exclude");
  assert.equal(createInputNode({ skipDeleted: false }).deletedSelection, "exclude");
  assert.equal(createInputNode({ skipDeleted: false, deletedSelection: "unexpected" }).deletedSelection, "exclude");
  assert.equal(
    createInputNode({ skipDeleted: false, deletedSelection: "require" }).deletedSelection,
    "require"
  );
});

test("imap email in normalizes numeric limits to integers", () => {
  const node = createInputNode({
    batchSize: "2.9",
    frontWindowSize: "3.9",
    maxInflight: "4.9",
    scanTimeLimitMs: "7.9",
    maxUidPerCommand: "5.9",
    expungeDeletedFrontLimit: "6.9",
    maxMessageBytes: "123.9",
    downloadChunkSize: "999"
  });

  assert.equal(node.batchSize, 2);
  assert.equal(node.frontWindowSize, 3);
  assert.equal(node.maxInflight, 4);
  assert.equal(node.scanTimeLimitMs, 7);
  assert.equal(node.maxUidPerCommand, 5);
  assert.equal(node.expungeDeletedFrontLimit, 6);
  assert.equal(node.maxMessageBytes, 123);
  assert.equal(node.downloadChunkSize, 1024);
});

test("internal flag selection helpers map UI values to IMAP flags", () => {
  assert.equal(normalizeFlagSelection("ignore"), "ignore");
  assert.equal(normalizeFlagSelection("require"), "require");
  assert.equal(normalizeFlagSelection("exclude"), "exclude");
  assert.equal(normalizeFlagSelection("unexpected", "exclude"), "exclude");

  assert.equal(matchesFlagSelections(["\\Deleted"], {
    deleted: "require",
    seen: "ignore",
    answered: "ignore",
    flagged: "ignore"
  }), true);
  assert.equal(matchesFlagSelections(["\\Seen"], {
    deleted: "exclude",
    seen: "require",
    answered: "ignore",
    flagged: "ignore"
  }), true);
  assert.equal(matchesFlagSelections(["\\Seen"], {
    deleted: "exclude",
    seen: "exclude",
    answered: "ignore",
    flagged: "ignore"
  }), false);

  assert.deepEqual(flagsToState(["\\Seen", "\\Flagged"]), {
    deleted: false,
    seen: true,
    answered: false,
    flagged: true
  });
});

test("example flow serializes imap email in selection fields", () => {
  const flow = readExampleFlow();
  const inputNode = flow.find((node) => node.type === "imap-email in");

  assert.ok(inputNode, "example flow must contain an imap-email in node");

  const exampleSelection = {
    ...selectionDefaults,
    seenSelection: "exclude"
  };

  for (const [field, expected] of Object.entries(exampleSelection)) {
    assert.equal(inputNode[field], expected, `example flow must serialize ${field}`);
  }

  assert.equal(inputNode.maxMessageBytes, "0");
  assert.equal(inputNode.downloadChunkSize, "65536");
  assert.equal(inputNode.scanTimeLimitMs, "10000");

  assert.equal(
    Object.prototype.hasOwnProperty.call(inputNode, "skipDeleted"),
    false,
    "new serialized flows should not rely on the legacy skipDeleted field"
  );
});

test("imap email in UI exposes tri-state flag selection values", () => {
  const html = readProjectFile(path.join("nodes", "imap-email-in.html"));

  for (const field of selectionFields) {
    const block = findSelectBlock(html, field);
    assert.ok(block, `${field} must be rendered as a select control`);
    assert.match(block, /value=["']ignore["'][^>]*>[^<]*Any/i, `${field} must map Any to ignore`);
    assert.match(block, /value=["']require["'][^>]*>[^<]*Only with flag/i, `${field} must map Only with flag to require`);
    assert.match(block, /value=["']exclude["'][^>]*>[^<]*Only without flag/i, `${field} must map Only without flag to exclude`);
  }
});

test("imap email in UI only shows expunge controls when deleted messages are excluded", () => {
  const html = readProjectFile(path.join("nodes", "imap-email-in.html"));

  assert.match(html, /oneditprepare\s*:\s*function/, "editor must define dynamic UI behavior");
  assert.match(html, /node-input-deletedSelection/, "deleted selection must drive the expunge UI");
  assert.match(html, /form-row-expunge-deleted/, "expunge rows must be grouped for toggling");
  assert.match(html, /deletedSelection.*exclude|exclude.*deletedSelection/s, "expunge controls must be tied to exclude mode");
});

test("imap email in outputs both raw flags and flagState", async () => {
  const { node } = createCursorTestNode({ frontWindowSize: 10 }, [
    {
      exists: 1,
      uidValidity: "uidv-1",
      front: [
        {
          uid: 123,
          flags: ["\\Seen", "\\Flagged"],
          size: 100
        }
      ],
      messages: [
        {
          uid: 123,
          flags: ["\\Seen", "\\Flagged"],
          envelope: { subject: "Hello" },
          internalDate: new Date("2026-01-01T00:00:00Z"),
          size: 100,
          source: createMailSource("Hello")
        }
      ]
    }
  ]);

  const outputs = [];
  await node.runFetchCycle({}, (output) => outputs.push(output));

  const mail = outputs.find((output) => output && output[0] && output[0].imap);
  assert.ok(mail, "expected one emitted mail");
  assert.deepEqual(mail[0].imap.flags, ["\\Seen", "\\Flagged"]);
  assert.deepEqual(mail[0].imap.flagState, {
    deleted: false,
    seen: true,
    answered: false,
    flagged: true
  });
});

test("imap email in reads one bounded cursor window per trigger when scanTimeLimitMs is zero", async () => {
  const { node, fetchCalls } = createCursorTestNode({
    frontWindowSize: 500,
    scanTimeLimitMs: 0
  }, [
    { exists: 1200, uidValidity: "uidv-1" },
    { exists: 1200, uidValidity: "uidv-1" },
    { exists: 1200, uidValidity: "uidv-1" }
  ]);
  const outputs = [];
  const send = (output) => outputs.push(output);

  await node.runFetchCycle({}, send);
  await node.runFetchCycle({}, send);
  await node.runFetchCycle({}, send);

  assert.deepEqual(fetchCalls.map((call) => call.range), [
    "1:500",
    "501:1000",
    "1001:1200"
  ]);
  assert.equal(fetchCalls.every((call) => call.options === undefined), true, "cursor windows must use sequence ranges");
  assert.equal(node.scanCursor, 1);

  const stats = collectStats(outputs);
  assert.deepEqual(stats.map((item) => item.scanCursorStart), [1, 501, 1001]);
  assert.deepEqual(stats.map((item) => item.scanCursorEnd), [500, 1000, 1200]);
  assert.deepEqual(stats.map((item) => item.scanCursorNext), [501, 1001, 1]);
  assert.deepEqual(stats.map((item) => item.frontWindowRead), [500, 500, 200]);
  assert.deepEqual(stats.map((item) => item.scanWrapped), [false, false, true]);
  assert.deepEqual(stats.map((item) => item.phase), ["cursor-window", "cursor-window", "cursor-window"]);
  assert.deepEqual(stats.map((item) => item.windowPhasesRead), [["cursor"], ["cursor"], ["cursor"]]);
  stats.forEach(assertRemovedStatsFieldsAbsent);
});

test("imap email in adaptive cursor phase scans to mailbox end and initializes new UID cursor", async () => {
  const { node, fetchCalls } = createCursorTestNode({
    frontWindowSize: 500,
    batchSize: 1
  }, [
    {
      exists: 1200,
      uidNext: 1300,
      uidValidity: "uidv-1",
      fetch() {
        return [];
      }
    }
  ]);
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.deepEqual(fetchCalls.map((call) => call.range), [
    "1:500",
    "501:1000",
    "1001:1200"
  ]);
  assert.equal(node.scanCursor, 1);
  assert.equal(node.newUidCursor, 1300);

  const stats = collectStats(outputs)[0];
  assertRemovedStatsFieldsAbsent(stats);
  assert.equal(stats.phase, "cursor-window");
  assert.deepEqual(stats.windowPhasesRead, ["cursor"]);
  assert.equal(stats.newUidCursorInitialized, true);
  assert.equal(stats.newUidCursor, 1300);
  assert.equal(stats.windowsRead, 3);
  assert.equal(stats.scanWrapped, true);
});

test("imap email in treats an empty mailbox as ready for new UID priority", async () => {
  const { node, fetchCalls } = createCursorTestNode({}, [
    {
      exists: 0,
      uidNext: 42,
      uidValidity: "uidv-empty"
    }
  ]);
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.deepEqual(fetchCalls, []);
  assert.equal(node.scanCursor, 1);
  assert.equal(node.newUidCursor, 42);

  const stats = collectStats(outputs)[0];
  assertRemovedStatsFieldsAbsent(stats);
  assert.equal(stats.phase, "new-uid-priority");
  assert.deepEqual(stats.windowPhasesRead, []);
  assert.equal(stats.scanCursorStart, 1);
  assert.equal(stats.scanCursorEnd, 0);
  assert.equal(stats.newUidCursorInitialized, true);
  assert.equal(stats.newUidCursor, 42);
});

test("imap email in resets the scan cursor on UIDVALIDITY changes", async () => {
  const { node, fetchCalls } = createCursorTestNode({
    frontWindowSize: 500,
    scanTimeLimitMs: 0
  }, [
    { exists: 1200, uidValidity: "uidv-1" },
    { exists: 1200, uidValidity: "uidv-2" }
  ]);
  const outputs = [];
  const send = (output) => outputs.push(output);

  await node.runFetchCycle({}, send);
  assert.equal(node.scanCursor, 501);

  await node.runFetchCycle({}, send);

  assert.deepEqual(fetchCalls.map((call) => call.range), [
    "1:500",
    "1:500"
  ]);
  assert.equal(node.scanCursor, 501);

  const stats = collectStats(outputs);
  assert.equal(stats[1].scanCursorReset, true);
  assert.equal(stats[1].scanCursorStart, 1);
  assert.equal(stats[1].uidValidity, "uidv-2");
});

test("imap email in limits stored candidates after streaming one front window", async () => {
  const front = Array.from({ length: 20 }, (_, index) => ({
    uid: index + 1,
    flags: [],
    size: 80
  }));
  const messages = front.map((item) => ({
    ...item,
    envelope: { subject: `Message ${item.uid}` },
    internalDate: new Date("2026-01-01T00:00:00Z"),
    source: createMailSource(`Message ${item.uid}`)
  }));
  const { node, statuses, fetchCalls, fetchOneCalls, downloadCalls, commandsDuringFetch } = createCursorTestNode({
    frontWindowSize: 20,
    batchSize: 2,
    maxInflight: 2
  }, [
    {
      exists: 20,
      uidValidity: "uidv-1",
      front,
      messages
    }
  ]);
  const outputs = [];
  const mailSendStatusTexts = [];

  await node.runFetchCycle({}, (output) => {
    outputs.push(output);
    if (output && output[0]) {
      const latestStatus = statuses[statuses.length - 1];
      mailSendStatusTexts.push(latestStatus && latestStatus.text);
    }
  });

  assert.deepEqual(commandsDuringFetch, []);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].range, "1:20");
  assert.equal(fetchOneCalls.length, 2);
  assert.equal(downloadCalls.length, 2);
  assert.deepEqual(mailSendStatusTexts, [
    "sent 1, inflight 1/2",
    "sent 2, inflight 2/2"
  ]);

  const stats = collectStats(outputs)[0];
  assert.equal(stats.frontWindowRead, 20);
  assert.equal(stats.candidates, 20);
  assert.equal(stats.emitted, 2);
});

test("imap email in adaptive cursor-window phase reads only one window when scanTimeLimitMs is zero", async () => {
  const { node, fetchCalls } = createCursorTestNode({
    scanTimeLimitMs: 0,
    frontWindowSize: 2,
    batchSize: 2
  }, [
    {
      exists: 5,
      uidNext: 6,
      uidValidity: "uidv-1",
      fetch() {
        return [];
      }
    }
  ]);
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.deepEqual(fetchCalls.map((call) => call.range), ["1:2"]);
  assert.equal(node.scanCursor, 3);
  assert.equal(node.newUidCursor, null);

  const stats = collectStats(outputs)[0];
  assertRemovedStatsFieldsAbsent(stats);
  assert.equal(stats.phase, "cursor-window");
  assert.deepEqual(stats.windowPhasesRead, ["cursor"]);
  assert.equal(stats.windowsRead, 1);
  assert.equal(stats.frontWindowRead, 2);
  assert.equal(stats.scanTimeLimitReached, false);
});

test("imap email in adaptive cursor-window phase holds cursor when a non-final window overflows", async () => {
  const messages = [
    createMessage(1, "Warm one"),
    createMessage(2, "Warm two")
  ];
  const { node, fetchCalls, fetchOneCalls } = createCursorTestNode({
    frontWindowSize: 2,
    batchSize: 1
  }, [
    {
      exists: 5,
      uidNext: 6,
      uidValidity: "uidv-1",
      messages,
      fetch(range) {
        assert.equal(range, "1:2");
        return [
          { uid: 1, flags: [], size: 80 },
          { uid: 2, flags: [], size: 80 }
        ];
      }
    }
  ]);
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.deepEqual(fetchCalls.map((call) => call.range), ["1:2"]);
  assert.deepEqual(fetchOneCalls.map((call) => call.uid), ["1"]);
  assert.equal(node.scanCursor, 1);
  assert.equal(node.newUidCursor, null);

  const stats = collectStats(outputs)[0];
  assertRemovedStatsFieldsAbsent(stats);
  assert.equal(stats.phase, "cursor-window");
  assert.equal(stats.candidateOverflow, true);
  assert.equal(stats.windowUnselectedCandidates, 1);
  assert.equal(stats.scanCursorHeld, true);
  assert.equal(stats.scanCursorNext, 1);
  assert.equal(stats.newUidCursorInitialized, false);
});

test("imap email in adaptive cursor-window phase does not initialize new UID cursor when final window overflows", async () => {
  const messages = [
    createMessage(1, "Final one"),
    createMessage(2, "Final two")
  ];
  const { node, fetchCalls, fetchOneCalls } = createCursorTestNode({
    frontWindowSize: 2,
    batchSize: 1
  }, [
    {
      exists: 2,
      uidNext: 3,
      uidValidity: "uidv-1",
      messages,
      fetch(range) {
        assert.equal(range, "1:2");
        return [
          { uid: 1, flags: [], size: 80 },
          { uid: 2, flags: [], size: 80 }
        ];
      }
    }
  ]);
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.deepEqual(fetchCalls.map((call) => call.range), ["1:2"]);
  assert.deepEqual(fetchOneCalls.map((call) => call.uid), ["1"]);
  assert.equal(node.scanCursor, 1);
  assert.equal(node.newUidCursor, null);

  const stats = collectStats(outputs)[0];
  assertRemovedStatsFieldsAbsent(stats);
  assert.equal(stats.phase, "cursor-window");
  assert.equal(stats.candidateOverflow, true);
  assert.equal(stats.scanCursorHeld, true);
  assert.equal(stats.newUidCursorInitialized, false);
  assert.equal(stats.newUidCursor, null);
});

test("imap email in adaptive cursor-window phase updates status after every window and initializes new UID cursor at mailbox end", async () => {
  const messages = [createMessage(5, "Newest unseen")];
  const { node, statuses, fetchCalls, fetchOneCalls } = createCursorTestNode({
    scanTimeLimitMs: 10000,
    frontWindowSize: 2,
    batchSize: 2,
    seenSelection: "exclude"
  }, [
    {
      exists: 5,
      uidNext: 10,
      uidValidity: "uidv-1",
      messages,
      fetch(range) {
        const { start, end } = rangeBounds(range);
        if (start <= 5 && end >= 5) {
          return [{ uid: 5, flags: [], size: 80 }];
        }
        return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => ({
          uid: start + index,
          flags: ["\\Seen"],
          size: 80
        }));
      }
    }
  ]);
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.deepEqual(fetchCalls.map((call) => call.range), ["1:2", "3:4", "5:5"]);
  assert.deepEqual(fetchOneCalls.map((call) => call.uid), ["5"]);
  assert.equal(node.scanCursor, 1);
  assert.equal(node.newUidCursor, 10);
  assert.equal(statuses.filter((status) => /^cursor-window /.test(status.text || "")).length, 3);

  const stats = collectStats(outputs)[0];
  assertRemovedStatsFieldsAbsent(stats);
  assert.equal(stats.phase, "cursor-window");
  assert.deepEqual(stats.windowPhasesRead, ["cursor"]);
  assert.equal(stats.newUidCursorInitialized, true);
  assert.equal(stats.newUidCursor, 10);
  assert.equal(stats.windowsRead, 3);
  assert.equal(stats.emitted, 1);
});

test("imap email in new UID priority emits new UIDs before backlog and splits window size", async () => {
  const messages = [
    createMessage(1, "Backlog one"),
    createMessage(101, "New one"),
    createMessage(102, "New two")
  ];
  const { node, fetchCalls, fetchOneCalls } = createCursorTestNode({
    frontWindowSize: 5,
    batchSize: 3
  }, [
    {
      exists: 6,
      uidNext: 104,
      uidValidity: "uidv-1",
      messages,
      fetch(range, query, options) {
        if (options && options.uid) {
          assert.equal(range, "101:103");
          return [
            { uid: 101, flags: [], size: 80 },
            { uid: 102, flags: [], size: 80 }
          ];
        }

        assert.equal(range, "1:2");
        return [{ uid: 1, flags: [], size: 80 }];
      }
    }
  ]);
  const outputs = [];
  node.scanUidValidity = "uidv-1";
  node.newUidCursor = 101;

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.deepEqual(fetchCalls.map((call) => call.range), ["101:103", "1:2"]);
  assert.deepEqual(fetchCalls.map((call) => call.options), [{ uid: true }, undefined]);
  assert.deepEqual(fetchOneCalls.map((call) => call.uid), ["101", "102", "1"]);
  assert.equal(node.newUidCursor, 104);
  assert.equal(node.scanCursor, 3);

  const stats = collectStats(outputs)[0];
  assertRemovedStatsFieldsAbsent(stats);
  assert.equal(stats.phase, "new-uid-priority");
  assert.deepEqual(stats.windowPhasesRead, ["new-uid", "backlog"]);
  assert.equal(stats.uidWindowStart, 101);
  assert.equal(stats.uidWindowEnd, 103);
  assert.equal(stats.scanCursorStart, 1);
  assert.equal(stats.scanCursorEnd, 2);
  assert.equal(stats.emitted, 3);
});

test("imap email in new UID priority chunks UID fetches by maxUidPerCommand", async () => {
  const messages = Array.from({ length: 6 }, (_, index) => createMessage(101 + index, `New ${index + 1}`));
  const { node, fetchCalls, fetchOneCalls } = createCursorTestNode({
    frontWindowSize: 12,
    maxUidPerCommand: 3,
    batchSize: 10
  }, [
    {
      exists: 6,
      uidNext: 107,
      uidValidity: "uidv-1",
      messages,
      fetch(range, query, options) {
        assert.deepEqual(options, { uid: true });
        const { start, end } = rangeBounds(range);
        return messages
          .filter((message) => message.uid >= start && message.uid <= end)
          .map((message) => ({ uid: message.uid, flags: [], size: message.size }));
      }
    }
  ]);
  const outputs = [];
  node.scanUidValidity = "uidv-1";
  node.newUidCursor = 101;

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.deepEqual(fetchCalls.map((call) => call.range), ["101:103", "104:106"]);
  assert.deepEqual(fetchCalls.map((call) => call.options), [{ uid: true }, { uid: true }]);
  assert.deepEqual(fetchOneCalls.map((call) => call.uid), ["101", "102", "103", "104", "105", "106"]);
  assert.equal(node.newUidCursor, 107);
  assert.equal(node.scanCursor, 1);

  const stats = collectStats(outputs)[0];
  assertRemovedStatsFieldsAbsent(stats);
  assert.equal(stats.phase, "new-uid-priority");
  assert.deepEqual(stats.windowPhasesRead, ["new-uid"]);
  assert.equal(stats.windowsRead, 2);
  assert.equal(stats.frontWindowRead, 6);
  assert.equal(stats.uidWindowStart, 101);
  assert.equal(stats.uidWindowEnd, 106);
  assert.equal(stats.uidWindowNext, 107);
  assert.equal(stats.emitted, 6);
});

test("imap email in new UID priority stops chunking at a full batch boundary without skipping UIDs", async () => {
  const messages = Array.from({ length: 6 }, (_, index) => createMessage(101 + index, `New ${index + 1}`));
  const { node, fetchCalls, fetchOneCalls } = createCursorTestNode({
    frontWindowSize: 12,
    maxUidPerCommand: 2,
    batchSize: 2
  }, [
    {
      exists: 6,
      uidNext: 107,
      uidValidity: "uidv-1",
      messages,
      fetch(range, query, options) {
        assert.deepEqual(options, { uid: true });
        const { start, end } = rangeBounds(range);
        return messages
          .filter((message) => message.uid >= start && message.uid <= end)
          .map((message) => ({ uid: message.uid, flags: [], size: message.size }));
      }
    }
  ]);
  const outputs = [];
  node.scanUidValidity = "uidv-1";
  node.newUidCursor = 101;

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.deepEqual(fetchCalls.map((call) => call.range), ["101:102"]);
  assert.deepEqual(fetchOneCalls.map((call) => call.uid), ["101", "102"]);
  assert.equal(node.newUidCursor, 103);
  assert.equal(node.scanCursor, 1);

  const stats = collectStats(outputs)[0];
  assertRemovedStatsFieldsAbsent(stats);
  assert.equal(stats.candidateOverflow, false);
  assert.equal(stats.windowsRead, 1);
  assert.equal(stats.frontWindowRead, 2);
  assert.equal(stats.uidWindowStart, 101);
  assert.equal(stats.uidWindowEnd, 102);
  assert.equal(stats.uidWindowNext, 103);
  assert.equal(stats.emitted, 2);
});

test("imap email in new UID priority keeps cursor at first unselected UID inside a chunk overflow", async () => {
  const messages = Array.from({ length: 6 }, (_, index) => createMessage(101 + index, `New ${index + 1}`));
  const { node, fetchCalls, fetchOneCalls } = createCursorTestNode({
    frontWindowSize: 12,
    maxUidPerCommand: 3,
    batchSize: 2
  }, [
    {
      exists: 6,
      uidNext: 107,
      uidValidity: "uidv-1",
      messages,
      fetch(range, query, options) {
        assert.deepEqual(options, { uid: true });
        assert.equal(range, "101:103");
        return [
          { uid: 101, flags: [], size: 80 },
          { uid: 102, flags: [], size: 80 },
          { uid: 103, flags: [], size: 80 }
        ];
      }
    }
  ]);
  const outputs = [];
  node.scanUidValidity = "uidv-1";
  node.newUidCursor = 101;

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.deepEqual(fetchCalls.map((call) => call.range), ["101:103"]);
  assert.deepEqual(fetchOneCalls.map((call) => call.uid), ["101", "102"]);
  assert.equal(node.newUidCursor, 103);
  assert.equal(node.scanCursor, 1);

  const stats = collectStats(outputs)[0];
  assertRemovedStatsFieldsAbsent(stats);
  assert.equal(stats.candidateOverflow, true);
  assert.equal(stats.windowUnselectedCandidates, 1);
  assert.equal(stats.uidWindowStart, 101);
  assert.equal(stats.uidWindowEnd, 103);
  assert.equal(stats.uidWindowNext, 104);
  assert.equal(stats.emitted, 2);
});

test("imap email in new UID priority reads backlog after chunked new UID windows when capacity remains", async () => {
  const messages = [
    createMessage(1, "Backlog one"),
    createMessage(101, "New one"),
    createMessage(102, "New two"),
    createMessage(103, "New three"),
    createMessage(104, "New four")
  ];
  const { node, fetchCalls, fetchOneCalls } = createCursorTestNode({
    frontWindowSize: 10,
    maxUidPerCommand: 2,
    batchSize: 5
  }, [
    {
      exists: 5,
      uidNext: 105,
      uidValidity: "uidv-1",
      messages,
      fetch(range, query, options) {
        if (options && options.uid) {
          const { start, end } = rangeBounds(range);
          return messages
            .filter((message) => message.uid >= start && message.uid <= end)
            .map((message) => ({ uid: message.uid, flags: [], size: message.size }));
        }

        assert.equal(options, undefined);
        assert.equal(range, "1:5");
        return [{ uid: 1, flags: [], size: 80 }];
      }
    }
  ]);
  const outputs = [];
  node.scanUidValidity = "uidv-1";
  node.newUidCursor = 101;

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.deepEqual(fetchCalls.map((call) => call.range), ["101:102", "103:104", "1:5"]);
  assert.deepEqual(fetchCalls.map((call) => call.options), [{ uid: true }, { uid: true }, undefined]);
  assert.deepEqual(fetchOneCalls.map((call) => call.uid), ["101", "102", "103", "104", "1"]);
  assert.equal(node.newUidCursor, 105);
  assert.equal(node.scanCursor, 1);

  const stats = collectStats(outputs)[0];
  assertRemovedStatsFieldsAbsent(stats);
  assert.deepEqual(stats.windowPhasesRead, ["new-uid", "backlog"]);
  assert.equal(stats.windowsRead, 3);
  assert.equal(stats.frontWindowRead, 9);
  assert.equal(stats.uidWindowStart, 101);
  assert.equal(stats.uidWindowEnd, 104);
  assert.equal(stats.uidWindowNext, 105);
  assert.equal(stats.scanCursorStart, 1);
  assert.equal(stats.scanCursorEnd, 5);
  assert.equal(stats.scanCursorNext, 1);
  assert.equal(stats.emitted, 5);
});

test("imap email in new UID priority skips backlog when new UIDs fill capacity", async () => {
  const messages = [
    createMessage(101, "New one"),
    createMessage(102, "New two")
  ];
  const { node, fetchCalls, fetchOneCalls } = createCursorTestNode({
    frontWindowSize: 5,
    batchSize: 2
  }, [
    {
      exists: 6,
      uidNext: 104,
      uidValidity: "uidv-1",
      messages,
      fetch(range, query, options) {
        assert.deepEqual(options, { uid: true });
        assert.equal(range, "101:103");
        return [
          { uid: 101, flags: [], size: 80 },
          { uid: 102, flags: [], size: 80 }
        ];
      }
    }
  ]);
  node.scanUidValidity = "uidv-1";
  node.newUidCursor = 101;
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.deepEqual(fetchCalls.map((call) => call.range), ["101:103"]);
  assert.deepEqual(fetchOneCalls.map((call) => call.uid), ["101", "102"]);
  assert.equal(node.newUidCursor, 104);
  assert.equal(node.scanCursor, 1);

  const stats = collectStats(outputs)[0];
  assertRemovedStatsFieldsAbsent(stats);
  assert.equal(stats.phase, "new-uid-priority");
  assert.deepEqual(stats.windowPhasesRead, ["new-uid"]);
  assert.equal(stats.windowsRead, 1);
  assert.equal(stats.emitted, 2);
  assert.equal(stats.candidateOverflow, false);
});

test("imap email in new UID priority skips redundant backlog when new UID window covers mailbox", async () => {
  const messages = [
    createMessage(101, "New one"),
    createMessage(102, "New two"),
    createMessage(103, "New three")
  ];
  const { node, fetchCalls, fetchOneCalls } = createCursorTestNode({
    frontWindowSize: 5,
    batchSize: 5
  }, [
    {
      exists: 3,
      uidNext: 104,
      uidValidity: "uidv-1",
      messages,
      fetch(range, query, options) {
        assert.deepEqual(options, { uid: true });
        assert.equal(range, "101:103");
        return [
          { uid: 101, flags: [], size: 80 },
          { uid: 102, flags: [], size: 80 },
          { uid: 103, flags: [], size: 80 }
        ];
      }
    }
  ]);
  node.scanUidValidity = "uidv-1";
  node.newUidCursor = 101;
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.deepEqual(fetchCalls.map((call) => call.range), ["101:103"]);
  assert.deepEqual(fetchCalls.map((call) => call.options), [{ uid: true }]);
  assert.deepEqual(fetchOneCalls.map((call) => call.uid), ["101", "102", "103"]);
  assert.equal(node.newUidCursor, 104);
  assert.equal(node.scanCursor, 1);

  const stats = collectStats(outputs)[0];
  assertRemovedStatsFieldsAbsent(stats);
  assert.equal(stats.phase, "new-uid-priority");
  assert.deepEqual(stats.windowPhasesRead, ["new-uid"]);
  assert.equal(stats.windowsRead, 1);
  assert.equal(stats.frontWindowRead, 3);
  assert.equal(stats.scanCursorStart, 1);
  assert.equal(stats.scanCursorEnd, 0);
  assert.equal(stats.scanCursorNext, 1);
  assert.equal(stats.emitted, 3);
});

test("imap email in new UID priority keeps backlog when new UID window does not cover mailbox", async () => {
  const messages = [
    createMessage(1, "Backlog one"),
    createMessage(101, "New one"),
    createMessage(102, "New two"),
    createMessage(103, "New three")
  ];
  const { node, fetchCalls, fetchOneCalls } = createCursorTestNode({
    frontWindowSize: 5,
    batchSize: 5
  }, [
    {
      exists: 4,
      uidNext: 104,
      uidValidity: "uidv-1",
      messages,
      fetch(range, query, options) {
        if (options && options.uid) {
          assert.equal(range, "101:103");
          return [
            { uid: 101, flags: [], size: 80 },
            { uid: 102, flags: [], size: 80 },
            { uid: 103, flags: [], size: 80 }
          ];
        }

        assert.equal(options, undefined);
        assert.equal(range, "1:2");
        return [{ uid: 1, flags: [], size: 80 }];
      }
    }
  ]);
  node.scanUidValidity = "uidv-1";
  node.newUidCursor = 101;
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.deepEqual(fetchCalls.map((call) => call.range), ["101:103", "1:2"]);
  assert.deepEqual(fetchCalls.map((call) => call.options), [{ uid: true }, undefined]);
  assert.deepEqual(fetchOneCalls.map((call) => call.uid), ["101", "102", "103", "1"]);

  const stats = collectStats(outputs)[0];
  assertRemovedStatsFieldsAbsent(stats);
  assert.equal(stats.phase, "new-uid-priority");
  assert.deepEqual(stats.windowPhasesRead, ["new-uid", "backlog"]);
  assert.equal(stats.windowsRead, 2);
  assert.equal(stats.frontWindowRead, 5);
  assert.equal(stats.emitted, 4);
});

test("imap email in new UID priority skips redundant backlog after flag filtering", async () => {
  const messages = [
    createMessage(101, "Seen one", ["\\Seen"]),
    createMessage(102, "Seen two", ["\\Seen"]),
    createMessage(103, "Unseen three")
  ];
  const { node, fetchCalls, fetchOneCalls } = createCursorTestNode({
    frontWindowSize: 5,
    batchSize: 5,
    seenSelection: "exclude"
  }, [
    {
      exists: 3,
      uidNext: 104,
      uidValidity: "uidv-1",
      messages,
      fetch(range, query, options) {
        assert.deepEqual(options, { uid: true });
        assert.equal(range, "101:103");
        return [
          { uid: 101, flags: ["\\Seen"], size: 80 },
          { uid: 102, flags: ["\\Seen"], size: 80 },
          { uid: 103, flags: [], size: 80 }
        ];
      }
    }
  ]);
  node.scanUidValidity = "uidv-1";
  node.newUidCursor = 101;
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.deepEqual(fetchCalls.map((call) => call.range), ["101:103"]);
  assert.deepEqual(fetchOneCalls.map((call) => call.uid), ["103"]);

  const stats = collectStats(outputs)[0];
  assertRemovedStatsFieldsAbsent(stats);
  assert.equal(stats.phase, "new-uid-priority");
  assert.deepEqual(stats.windowPhasesRead, ["new-uid"]);
  assert.equal(stats.windowsRead, 1);
  assert.equal(stats.filteredByFlags, 2);
  assert.equal(stats.emitted, 1);
});

test("imap email in new UID priority counts only unique valid UIDs for mailbox coverage", async () => {
  const messages = [
    createMessage(1, "Backlog one"),
    createMessage(101, "New one"),
    createMessage(102, "New two")
  ];
  const { node, fetchCalls, fetchOneCalls } = createCursorTestNode({
    frontWindowSize: 5,
    batchSize: 5
  }, [
    {
      exists: 3,
      uidNext: 104,
      uidValidity: "uidv-1",
      messages,
      fetch(range, query, options) {
        if (options && options.uid) {
          assert.equal(range, "101:103");
          return [
            { uid: 101, flags: [], size: 80 },
            { uid: 101, flags: [], size: 80 },
            { uid: "not-a-uid", flags: [], size: 80 },
            { uid: 102, flags: [], size: 80 }
          ];
        }

        assert.equal(options, undefined);
        assert.equal(range, "1:2");
        return [{ uid: 1, flags: [], size: 80 }];
      }
    }
  ]);
  node.scanUidValidity = "uidv-1";
  node.newUidCursor = 101;
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.deepEqual(fetchCalls.map((call) => call.range), ["101:103", "1:2"]);
  assert.deepEqual(fetchCalls.map((call) => call.options), [{ uid: true }, undefined]);
  assert.deepEqual(fetchOneCalls.map((call) => call.uid), ["101", "102", "1"]);

  const stats = collectStats(outputs)[0];
  assertRemovedStatsFieldsAbsent(stats);
  assert.equal(stats.phase, "new-uid-priority");
  assert.deepEqual(stats.windowPhasesRead, ["new-uid", "backlog"]);
  assert.equal(stats.windowsRead, 2);
  assert.equal(stats.emitted, 3);
});

test("imap email in new UID priority normalizes stale scan cursor when covered new UID window skips backlog", async () => {
  const messages = [
    createMessage(101, "New one"),
    createMessage(102, "New two"),
    createMessage(103, "New three")
  ];
  const { node, fetchCalls } = createCursorTestNode({
    frontWindowSize: 5,
    batchSize: 5
  }, [
    {
      exists: 3,
      uidNext: 104,
      uidValidity: "uidv-1",
      messages,
      fetch(range, query, options) {
        assert.deepEqual(options, { uid: true });
        assert.equal(range, "101:103");
        return [
          { uid: 101, flags: [], size: 80 },
          { uid: 102, flags: [], size: 80 },
          { uid: 103, flags: [], size: 80 }
        ];
      }
    }
  ]);
  node.scanUidValidity = "uidv-1";
  node.newUidCursor = 101;
  node.scanCursor = 99;
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.deepEqual(fetchCalls.map((call) => call.range), ["101:103"]);
  assert.equal(node.scanCursor, 1);

  const stats = collectStats(outputs)[0];
  assertRemovedStatsFieldsAbsent(stats);
  assert.equal(stats.phase, "new-uid-priority");
  assert.deepEqual(stats.windowPhasesRead, ["new-uid"]);
  assert.equal(stats.scanCursorReset, true);
  assert.equal(stats.scanCursorStart, 1);
  assert.equal(stats.scanCursorEnd, 0);
  assert.equal(stats.scanCursorNext, 1);
});

test("imap email in new UID priority leaves new UID cursor on first unselected UID when new window overflows", async () => {
  const messages = [
    createMessage(101, "New one"),
    createMessage(102, "New two"),
    createMessage(103, "New three")
  ];
  const { node, fetchCalls, fetchOneCalls } = createCursorTestNode({
    frontWindowSize: 6,
    batchSize: 2
  }, [
    {
      exists: 6,
      uidNext: 105,
      uidValidity: "uidv-1",
      messages,
      fetch(range, query, options) {
        assert.deepEqual(options, { uid: true });
        assert.equal(range, "101:103");
        return [
          { uid: 101, flags: [], size: 80 },
          { uid: 102, flags: [], size: 80 },
          { uid: 103, flags: [], size: 80 }
        ];
      }
    }
  ]);
  node.scanUidValidity = "uidv-1";
  node.newUidCursor = 101;
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.deepEqual(fetchCalls.map((call) => call.range), ["101:103"]);
  assert.deepEqual(fetchOneCalls.map((call) => call.uid), ["101", "102"]);
  assert.equal(node.newUidCursor, 103);
  assert.equal(node.scanCursor, 1);

  const stats = collectStats(outputs)[0];
  assertRemovedStatsFieldsAbsent(stats);
  assert.equal(stats.phase, "new-uid-priority");
  assert.deepEqual(stats.windowPhasesRead, ["new-uid"]);
  assert.equal(stats.candidateOverflow, true);
  assert.equal(stats.windowUnselectedCandidates, 1);
  assert.equal(stats.uidWindowStart, 101);
  assert.equal(stats.uidWindowEnd, 103);
});

test("imap email in new UID priority holds backlog cursor when backlog window overflows", async () => {
  const messages = [
    createMessage(1, "Backlog one"),
    createMessage(2, "Backlog two")
  ];
  const { node, fetchCalls, fetchOneCalls } = createCursorTestNode({
    frontWindowSize: 4,
    batchSize: 1
  }, [
    {
      exists: 6,
      uidNext: 101,
      uidValidity: "uidv-1",
      messages,
      fetch(range, query, options) {
        assert.equal(options, undefined);
        assert.equal(range, "1:2");
        return [
          { uid: 1, flags: [], size: 80 },
          { uid: 2, flags: [], size: 80 }
        ];
      }
    }
  ]);
  node.scanUidValidity = "uidv-1";
  node.newUidCursor = 101;
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.deepEqual(fetchCalls.map((call) => call.range), ["1:2"]);
  assert.deepEqual(fetchOneCalls.map((call) => call.uid), ["1"]);
  assert.equal(node.scanCursor, 1);
  assert.equal(node.newUidCursor, 101);

  const stats = collectStats(outputs)[0];
  assertRemovedStatsFieldsAbsent(stats);
  assert.equal(stats.phase, "new-uid-priority");
  assert.deepEqual(stats.windowPhasesRead, ["backlog"]);
  assert.equal(stats.candidateOverflow, true);
  assert.equal(stats.scanCursorHeld, true);
  assert.equal(stats.scanCursorNext, 1);
});

test("imap email in default cursor window holds cursor when candidate list fills", async () => {
  const messages = [
    createMessage(1, "Default one"),
    createMessage(2, "Default two")
  ];
  const { node, fetchCalls, fetchOneCalls } = createCursorTestNode({
    frontWindowSize: 2,
    batchSize: 1
  }, [
    {
      exists: 5,
      uidValidity: "uidv-1",
      messages,
      fetch(range) {
        assert.equal(range, "1:2");
        return [
          { uid: 1, flags: [], size: 80 },
          { uid: 2, flags: [], size: 80 }
        ];
      }
    }
  ]);
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.deepEqual(fetchCalls.map((call) => call.range), ["1:2"]);
  assert.deepEqual(fetchOneCalls.map((call) => call.uid), ["1"]);
  assert.equal(node.scanCursor, 1);

  const stats = collectStats(outputs)[0];
  assertRemovedStatsFieldsAbsent(stats);
  assert.equal(stats.phase, "cursor-window");
  assert.deepEqual(stats.windowPhasesRead, ["cursor"]);
  assert.equal(stats.candidateOverflow, true);
  assert.equal(stats.scanCursorHeld, true);
  assert.equal(stats.scanCursorNext, 1);
  assert.equal(stats.scanWrapped, false);
});

test("imap email in default cursor window advances when candidate list fits", async () => {
  const messages = [
    createMessage(1, "Default one"),
    createMessage(2, "Default two")
  ];
  const { node, fetchCalls, fetchOneCalls } = createCursorTestNode({
    frontWindowSize: 2,
    batchSize: 2
  }, [
    {
      exists: 5,
      uidValidity: "uidv-1",
      messages,
      fetch(range) {
        assert.equal(range, "1:2");
        return [
          { uid: 1, flags: [], size: 80 },
          { uid: 2, flags: [], size: 80 }
        ];
      }
    }
  ]);
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.deepEqual(fetchCalls.map((call) => call.range), ["1:2"]);
  assert.deepEqual(fetchOneCalls.map((call) => call.uid), ["1", "2"]);
  assert.equal(node.scanCursor, 3);

  const stats = collectStats(outputs)[0];
  assertRemovedStatsFieldsAbsent(stats);
  assert.equal(stats.phase, "cursor-window");
  assert.deepEqual(stats.windowPhasesRead, ["cursor"]);
  assert.equal(stats.candidateOverflow, false);
  assert.equal(stats.scanCursorHeld, false);
  assert.equal(stats.scanCursorNext, 3);
  assert.equal(stats.scanWrapped, false);
});

test("imap email in default cursor window holds overflowing final window without reporting wrap", async () => {
  const messages = [
    createMessage(4, "Tail one"),
    createMessage(5, "Tail two")
  ];
  const { node, fetchCalls, fetchOneCalls } = createCursorTestNode({
    frontWindowSize: 2,
    batchSize: 1
  }, [
    {
      exists: 5,
      uidValidity: "uidv-1",
      messages,
      fetch(range) {
        assert.equal(range, "4:5");
        return [
          { uid: 4, flags: [], size: 80 },
          { uid: 5, flags: [], size: 80 }
        ];
      }
    }
  ]);
  node.scanCursor = 4;
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.deepEqual(fetchCalls.map((call) => call.range), ["4:5"]);
  assert.deepEqual(fetchOneCalls.map((call) => call.uid), ["4"]);
  assert.equal(node.scanCursor, 4);

  const stats = collectStats(outputs)[0];
  assertRemovedStatsFieldsAbsent(stats);
  assert.equal(stats.phase, "cursor-window");
  assert.deepEqual(stats.windowPhasesRead, ["cursor"]);
  assert.equal(stats.candidateOverflow, true);
  assert.equal(stats.scanCursorStart, 4);
  assert.equal(stats.scanCursorEnd, 5);
  assert.equal(stats.scanCursorNext, 4);
  assert.equal(stats.scanCursorHeld, true);
  assert.equal(stats.scanWrapped, false);
});

test("imap email in default cursor window drains held window after emitted mail is removed", async () => {
  const { node, fetchCalls, fetchOneCalls } = createCursorTestNode({
    frontWindowSize: 2,
    batchSize: 1
  }, [
    {
      exists: 2,
      uidValidity: "uidv-1",
      messages: [
        createMessage(1, "Removed first"),
        createMessage(2, "Remaining second")
      ],
      fetch(range) {
        assert.equal(range, "1:2");
        return [
          { uid: 1, flags: [], size: 80 },
          { uid: 2, flags: [], size: 80 }
        ];
      }
    },
    {
      exists: 1,
      uidValidity: "uidv-1",
      messages: [
        createMessage(2, "Remaining second")
      ],
      fetch(range) {
        assert.equal(range, "1:1");
        return [
          { uid: 2, flags: [], size: 80 }
        ];
      }
    }
  ]);
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));
  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.deepEqual(fetchCalls.map((call) => call.range), ["1:2", "1:1"]);
  assert.deepEqual(fetchOneCalls.map((call) => call.uid), ["1", "2"]);
  assert.equal(node.scanCursor, 1);

  const stats = collectStats(outputs);
  assert.equal(stats[0].candidateOverflow, true);
  assert.equal(stats[0].scanCursorHeld, true);
  assert.equal(stats[0].phase, "cursor-window");
  assert.deepEqual(stats[0].windowPhasesRead, ["cursor"]);
  assert.equal(stats[1].candidateOverflow, false);
  assert.equal(stats[1].scanCursorHeld, false);
  assert.equal(stats[1].phase, "cursor-window");
  assert.deepEqual(stats[1].windowPhasesRead, ["cursor"]);
  assert.equal(stats[1].scanWrapped, true);
});

test("imap email in default cursor window keeps held cursor while inflight mail is skipped", async () => {
  const messages = [
    createMessage(1, "Inflight first"),
    createMessage(2, "Next second"),
    createMessage(3, "Overflow third")
  ];
  const { node, fetchCalls, fetchOneCalls } = createCursorTestNode({
    frontWindowSize: 3,
    batchSize: 1
  }, [
    {
      exists: 3,
      uidValidity: "uidv-1",
      messages,
      fetch(range) {
        assert.equal(range, "1:3");
        return [
          { uid: 1, flags: [], size: 80 },
          { uid: 2, flags: [], size: 80 },
          { uid: 3, flags: [], size: 80 }
        ];
      }
    },
    {
      exists: 3,
      uidValidity: "uidv-1",
      messages,
      fetch(range) {
        assert.equal(range, "1:3");
        return [
          { uid: 1, flags: [], size: 80 },
          { uid: 2, flags: [], size: 80 },
          { uid: 3, flags: [], size: 80 }
        ];
      }
    }
  ]);
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));
  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.deepEqual(fetchCalls.map((call) => call.range), ["1:3", "1:3"]);
  assert.deepEqual(fetchOneCalls.map((call) => call.uid), ["1", "2"]);
  assert.equal(node.scanCursor, 1);

  const stats = collectStats(outputs);
  assert.equal(stats[0].candidateOverflow, true);
  assert.equal(stats[0].scanCursorHeld, true);
  assert.equal(stats[0].phase, "cursor-window");
  assert.deepEqual(stats[0].windowPhasesRead, ["cursor"]);
  assert.equal(stats[1].filteredByInflight, 1);
  assert.equal(stats[1].candidateOverflow, true);
  assert.equal(stats[1].scanCursorHeld, true);
  assert.equal(stats[1].phase, "cursor-window");
  assert.deepEqual(stats[1].windowPhasesRead, ["cursor"]);
  assert.equal(stats[1].scanCursorNext, 1);
});

test("imap email in new UID priority resets new UID cursor on UIDVALIDITY changes", async () => {
  const { node, fetchCalls } = createCursorTestNode({
    scanTimeLimitMs: 0,
    frontWindowSize: 2,
    batchSize: 1
  }, [
    {
      exists: 5,
      uidNext: 6,
      uidValidity: "uidv-new",
      fetch() {
        return [];
      }
    }
  ]);
  node.scanUidValidity = "uidv-old";
  node.newUidCursor = 99;
  node.scanCursor = 4;
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.deepEqual(fetchCalls.map((call) => call.range), ["1:2"]);
  assert.equal(node.newUidCursor, null);
  assert.equal(node.scanCursor, 3);

  const stats = collectStats(outputs)[0];
  assertRemovedStatsFieldsAbsent(stats);
  assert.equal(stats.phase, "cursor-window");
  assert.equal(stats.scanCursorReset, true);
});

test("imap email in handles transient connect, lock and fetch errors without node.error", async () => {
  const cases = [
    {
      name: "connect",
      code: "ENOTFOUND",
      message: "getaddrinfo ENOTFOUND imap.strato.de",
      apply(mailbox, err) {
        mailbox.connect = () => {
          throw err;
        };
      },
      expectReleasedLock: false
    },
    {
      name: "lock",
      code: "NoConnection",
      message: "Connection not available",
      apply(mailbox, err) {
        mailbox.getMailboxLock = () => {
          throw err;
        };
      },
      expectReleasedLock: false
    },
    {
      name: "fetchOne",
      code: "EADDRNOTAVAIL",
      message: "read EADDRNOTAVAIL",
      apply(mailbox, err) {
        mailbox.fetchOne = () => {
          throw err;
        };
      },
      expectReleasedLock: true
    }
  ];

  for (const item of cases) {
    const err = createConnectionError(item.message, item.code);
    const mailbox = {
      usable: false,
      exists: 1,
      uidValidity: `uidv-${item.name}`,
      front: [{ uid: 11, flags: [], size: 100 }],
      messages: [{
        uid: 11,
        flags: [],
        envelope: { subject: "Transient" },
        internalDate: new Date("2026-01-01T00:00:00Z"),
        size: 100,
        source: createMailSource("Transient")
      }]
    };
    item.apply(mailbox, err);

    const { node, statuses, warnings, errors, releasedLocks, loggedOutClients } = createCursorTestNode({
      frontWindowSize: 1,
      batchSize: 1
    }, [mailbox]);
    const outputs = [];

    await node.runFetchCycle({}, (output) => outputs.push(output));

    assert.equal(node.running, false, `${item.name} must reset running state`);
    assert.equal(errors.length, 0, `${item.name} must not call node.error`);
    assert.equal(warnings.length, 1, `${item.name} must warn once`);
    assert.match(String(warnings[0]), new RegExp(item.code), `${item.name} warning must include the connection code`);
    assert.equal(loggedOutClients.length, 0, `${item.name} must not logout a closed client`);
    assert.deepEqual(releasedLocks, item.expectReleasedLock ? ["INBOX"] : []);
    assert.equal(statuses[statuses.length - 1].fill, "red");

    const errorOutput = outputs.find((output) => output && output[1]);
    assert.equal(errorOutput[1].error.code, item.code);
    if (item.name === "fetchOne") {
      assert.equal(errorOutput[1].imap.uid, 11);
      assert.equal(errorOutput[1].imap.ackToken, undefined);
      assert.equal(node.scanCursor, 1);
      assert.equal(node.newUidCursor, null);
      assert.equal(registry.countAllInflight(node.queueKey), 0);
    }

    const stats = collectStats(outputs)[0];
    assert.equal(stats.ok, false);
    assert.equal(stats.connectionErrors, 1);
    assert.match(stats.error, new RegExp(item.message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    if (item.name === "fetchOne") {
      assert.equal(stats.scanCursorAdjusted, true);
      assert.equal(stats.scanCursorNext, 1);
      assert.equal(stats.newUidCursorInitialized, false);
      assert.equal(stats.newUidCursor, null);
    }
  }
});

test("imap email in rolls back new UID cursor on transient fetchOne errors", async () => {
  const err = createConnectionError("Connection not available", "NoConnection");
  const { node, statuses, warnings, errors, releasedLocks, loggedOutClients, fetchOneCalls } = createCursorTestNode({
    frontWindowSize: 4,
    batchSize: 1
  }, [
    {
      usable: false,
      exists: 1,
      uidValidity: "uidv-fetchone-newuid",
      uidNext: 103,
      front: [{ uid: 101, flags: [], size: 100 }],
      fetchOne() {
        throw err;
      }
    }
  ]);
  node.newUidCursor = 101;
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.equal(node.running, false);
  assert.equal(errors.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0]), /NoConnection/);
  assert.deepEqual(releasedLocks, ["INBOX"]);
  assert.equal(loggedOutClients.length, 0);
  assert.deepEqual(fetchOneCalls.map((call) => call.uid), ["101"]);
  assert.equal(node.newUidCursor, 101);
  assert.equal(registry.countAllInflight(node.queueKey), 0);
  assert.equal(statuses[statuses.length - 1].fill, "red");

  const errorOutput = outputs.find((output) => output && output[1]);
  assert.equal(errorOutput[1].error.code, "NoConnection");
  assert.equal(errorOutput[1].imap.uid, 101);
  assert.equal(errorOutput[1].imap.ackToken, undefined);

  const stats = collectStats(outputs)[0];
  assert.equal(stats.ok, false);
  assert.equal(stats.connectionErrors, 1);
  assert.equal(stats.newUidCursor, 101);
  assert.equal(stats.scanCursorAdjusted, false);
});

test("imap email in rolls back chunked new UID cursor on transient fetchOne errors", async () => {
  const err = createConnectionError("Connection not available", "NoConnection");
  const messages = [
    createMessage(101, "New one"),
    createMessage(102, "New two"),
    createMessage(103, "New three"),
    createMessage(104, "New four")
  ];
  const { node, warnings, errors, fetchCalls, fetchOneCalls } = createCursorTestNode({
    frontWindowSize: 12,
    maxUidPerCommand: 2,
    batchSize: 4
  }, [
    {
      usable: false,
      exists: 4,
      uidValidity: "uidv-fetchone-chunked-newuid",
      uidNext: 105,
      messages,
      fetch(range, query, options) {
        assert.deepEqual(options, { uid: true });
        const { start, end } = rangeBounds(range);
        return messages
          .filter((message) => message.uid >= start && message.uid <= end)
          .map((message) => ({ uid: message.uid, flags: [], size: message.size }));
      },
      fetchOne(uid) {
        if (Number(uid) === 103) {
          throw err;
        }
        return messages.find((message) => Number(message.uid) === Number(uid)) || null;
      }
    }
  ]);
  node.newUidCursor = 101;
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.equal(errors.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0]), /NoConnection/);
  assert.deepEqual(fetchCalls.map((call) => call.range), ["101:102", "103:104"]);
  assert.deepEqual(fetchOneCalls.map((call) => call.uid), ["101", "102", "103"]);
  assert.equal(node.newUidCursor, 103);
  assert.equal(registry.countAllInflight(node.queueKey), 2);

  const successOutputs = outputs.filter((output) => output && output[0]);
  assert.deepEqual(successOutputs.map((output) => output[0].imap.uid), [101, 102]);

  const errorOutput = outputs.find((output) => output && output[1]);
  assert.equal(errorOutput[1].error.code, "NoConnection");
  assert.equal(errorOutput[1].imap.uid, 103);
  assert.equal(errorOutput[1].imap.ackToken, undefined);

  const stats = collectStats(outputs)[0];
  assert.equal(stats.ok, false);
  assert.equal(stats.connectionErrors, 1);
  assert.equal(stats.newUidCursor, 103);
  assert.equal(stats.uidWindowStart, 101);
  assert.equal(stats.uidWindowEnd, 104);
  assert.equal(stats.uidWindowNext, 105);
});

test("imap email in clears newly initialized new UID cursor after transient fetchOne sequence retry", async () => {
  const err = createConnectionError("read EADDRNOTAVAIL", "EADDRNOTAVAIL");
  const { node, warnings, errors, releasedLocks, loggedOutClients, fetchOneCalls } = createCursorTestNode({
    frontWindowSize: 2,
    batchSize: 1
  }, [
    {
      usable: false,
      exists: 2,
      uidValidity: "uidv-fetchone-init-newuid",
      uidNext: 50,
      front: [{ uid: 11, flags: [], size: 100 }],
      fetchOne() {
        throw err;
      }
    }
  ]);
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.equal(errors.length, 0);
  assert.equal(warnings.length, 1);
  assert.deepEqual(releasedLocks, ["INBOX"]);
  assert.equal(loggedOutClients.length, 0);
  assert.deepEqual(fetchOneCalls.map((call) => call.uid), ["11"]);
  assert.equal(node.scanCursor, 1);
  assert.equal(node.newUidCursor, null);
  assert.equal(registry.countAllInflight(node.queueKey), 0);

  const stats = collectStats(outputs)[0];
  assert.equal(stats.ok, false);
  assert.equal(stats.connectionErrors, 1);
  assert.equal(stats.scanCursorAdjusted, true);
  assert.equal(stats.scanCursorNext, 1);
  assert.equal(stats.newUidCursorInitialized, false);
  assert.equal(stats.newUidCursor, null);
});

test("imap email in keeps non-transient fetchOne errors on the existing error path", async () => {
  const err = new Error("invalid fetch query");
  const { node, statuses, warnings, errors, releasedLocks, loggedOutClients, fetchOneCalls } = createCursorTestNode({
    frontWindowSize: 1,
    batchSize: 1
  }, [
    {
      exists: 1,
      uidValidity: "uidv-fetchone-permanent",
      front: [{ uid: 44, flags: [], size: 100 }],
      fetchOne() {
        throw err;
      }
    }
  ]);
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.equal(node.running, false);
  assert.equal(warnings.length, 0);
  assert.equal(errors.length, 1);
  assert.equal(errors[0], err);
  assert.deepEqual(releasedLocks, ["INBOX"]);
  assert.deepEqual(loggedOutClients, ["uidv-fetchone-permanent"]);
  assert.deepEqual(fetchOneCalls.map((call) => call.uid), ["44"]);
  assert.equal(registry.countAllInflight(node.queueKey), 0);
  assert.equal(statuses[statuses.length - 1].fill, "red");

  const errorOutput = outputs.find((output) => output && output[1]);
  assert.equal(errorOutput[1].error.message, "invalid fetch query");
  assert.equal(errorOutput[1].imap.uid, undefined);

  const stats = collectStats(outputs)[0];
  assert.equal(stats.ok, false);
  assert.equal(stats.connectionErrors, 0);
  assert.equal(stats.error, "invalid fetch query");
});

test("imap email in handles transient download errors without node.error", async () => {
  const err = createConnectionError("Connection not available", "NoConnection");
  const { node, statuses, warnings, errors, releasedLocks, loggedOutClients, downloadCalls } = createCursorTestNode({
    frontWindowSize: 1,
    batchSize: 1
  }, [
    {
      usable: false,
      exists: 1,
      uidValidity: "uidv-download-connection",
      front: [{ uid: 22, flags: [], size: 100 }],
      messages: [{
        uid: 22,
        flags: [],
        envelope: { subject: "Download lost" },
        internalDate: new Date("2026-01-01T00:00:00Z"),
        size: 100,
        source: createMailSource("Download lost")
      }],
      download() {
        throw err;
      }
    }
  ]);
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.equal(node.running, false);
  assert.equal(errors.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0]), /NoConnection/);
  assert.deepEqual(releasedLocks, ["INBOX"]);
  assert.equal(loggedOutClients.length, 0);
  assert.equal(downloadCalls.length, 1);
  assert.equal(node.scanCursor, 1);
  assert.equal(statuses[statuses.length - 1].fill, "red");

  const errorOutput = outputs.find((output) => output && output[1]);
  assert.equal(errorOutput[1].error.code, "NoConnection");
  assert.equal(errorOutput[1].imap.uid, 22);

  const stats = collectStats(outputs)[0];
  assert.equal(stats.ok, false);
  assert.equal(stats.connectionErrors, 1);
  assert.equal(stats.scanCursorAdjusted, true);
});

test("imap email in swallows late download stream errors after parse failure", async () => {
  const firstErr = createConnectionError("Connection not available", "NoConnection");
  const lateErr = createConnectionError("Connection not available", "NoConnection");
  const unexpectedProcessErrors = [];
  const recordUnexpected = (err) => unexpectedProcessErrors.push(err);
  const source = new PassThrough();
  const { node, warnings, errors, loggedOutClients } = createCursorTestNode({
    frontWindowSize: 1,
    batchSize: 1
  }, [
    {
      usable: false,
      exists: 1,
      uidValidity: "uidv-late-stream-error",
      front: [{ uid: 33, flags: [], size: 100 }],
      messages: [{
        uid: 33,
        flags: [],
        envelope: { subject: "Late stream error" },
        internalDate: new Date("2026-01-01T00:00:00Z"),
        size: 100,
        source: createMailSource("Late stream error")
      }],
      download() {
        setImmediate(() => {
          source.emit("error", firstErr);
          setImmediate(() => {
            source.emit("error", lateErr);
          });
        });
        return {
          meta: { expectedSize: 100 },
          content: source
        };
      }
    }
  ]);
  const outputs = [];

  process.prependListener("uncaughtException", recordUnexpected);
  process.prependListener("unhandledRejection", recordUnexpected);

  try {
    await node.runFetchCycle({}, (output) => outputs.push(output));
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.removeListener("uncaughtException", recordUnexpected);
    process.removeListener("unhandledRejection", recordUnexpected);
  }

  assert.equal(node.running, false);
  assert.equal(errors.length, 0);
  assert.deepEqual(unexpectedProcessErrors, []);
  assert.equal(warnings.length, 1);
  assert.equal(loggedOutClients.length, 0);

  const errorOutput = outputs.find((output) => output && output[1]);
  assert.equal(errorOutput[1].error.code, "NoConnection");

  const stats = collectStats(outputs)[0];
  assert.equal(stats.ok, false);
  assert.equal(stats.connectionErrors, 1);
});

test("imap email in rejects known oversized messages without downloading them", async () => {
  const { node, downloadCalls } = createCursorTestNode({
    frontWindowSize: 1,
    batchSize: 1,
    maxMessageBytes: 10
  }, [
    {
      exists: 1,
      uidValidity: "uidv-oversize",
      front: [{ uid: 77, flags: [], size: 100 }],
      messages: [{
        uid: 77,
        flags: [],
        envelope: { subject: "Too big" },
        internalDate: new Date("2026-01-01T00:00:00Z"),
        size: 100,
        source: createMailSource("Too big")
      }]
    }
  ]);
  registry.clearQueue(node.queueKey);
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.equal(downloadCalls.length, 0);
  assert.equal(registry.countAllInflight(node.queueKey), 1);

  const errorOutput = outputs.find((output) => output && output[1]);
  assert.equal(errorOutput[1].error.code, "IMAP_EMAIL_MESSAGE_TOO_LARGE");
  assert.equal(errorOutput[1].imap.uid, 77);

  const stats = collectStats(outputs)[0];
  assert.equal(stats.tooLarge, 1);
  assert.equal(stats.emitted, 0);
});

test("imap email in aborts unknown-size streams that exceed maxMessageBytes", async () => {
  const { node, downloadCalls } = createCursorTestNode({
    frontWindowSize: 1,
    batchSize: 1,
    maxMessageBytes: 20
  }, [
    {
      exists: 1,
      uidValidity: "uidv-stream-oversize",
      front: [{ uid: 88, flags: [] }],
      messages: [{
        uid: 88,
        flags: [],
        envelope: { subject: "Unknown big" },
        internalDate: new Date("2026-01-01T00:00:00Z"),
        source: createMailSource("Unknown big").repeat(10)
      }]
    }
  ]);
  registry.clearQueue(node.queueKey);
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.equal(downloadCalls.length, 1);
  assert.equal(registry.countAllInflight(node.queueKey), 1);

  const errorOutput = outputs.find((output) => output && output[1]);
  assert.equal(errorOutput[1].error.code, "IMAP_EMAIL_MESSAGE_TOO_LARGE");

  const stats = collectStats(outputs)[0];
  assert.equal(stats.tooLarge, 1);
});

test("imap email in drains attachments unless attachment output is enabled", async () => {
  const source = createMailWithAttachment("With attachment");
  const mailbox = {
    exists: 1,
    uidValidity: "uidv-attachment",
    front: [{ uid: 99, flags: [], size: Buffer.byteLength(source) }],
    messages: [{
      uid: 99,
      flags: [],
      envelope: { subject: "With attachment" },
      internalDate: new Date("2026-01-01T00:00:00Z"),
      size: Buffer.byteLength(source),
      source
    }]
  };

  const noAttachments = createCursorTestNode({ frontWindowSize: 1, batchSize: 1 }, [mailbox]);
  const noAttachmentOutputs = [];
  await noAttachments.node.runFetchCycle({}, (output) => noAttachmentOutputs.push(output));
  const noAttachmentMail = noAttachmentOutputs.find((output) => output && output[0]);
  assert.equal(Object.prototype.hasOwnProperty.call(noAttachmentMail[0].email, "attachments"), false);

  const withAttachments = createCursorTestNode({
    frontWindowSize: 1,
    batchSize: 1,
    includeAttachments: true
  }, [mailbox]);
  const attachmentOutputs = [];
  await withAttachments.node.runFetchCycle({}, (output) => attachmentOutputs.push(output));
  const attachmentMail = attachmentOutputs.find((output) => output && output[0]);
  assert.equal(attachmentMail[0].email.attachments.length, 1);
  assert.equal(attachmentMail[0].email.attachments[0].filename, "note.txt");
  assert.equal(attachmentMail[0].email.attachments[0].content.toString(), "attachment-body");
});

test("imap email in keeps raw output only when raw source is enabled", async () => {
  const source = createMailSource("Raw");
  const { node } = createCursorTestNode({
    frontWindowSize: 1,
    batchSize: 1,
    emitRaw: true
  }, [
    {
      exists: 1,
      uidValidity: "uidv-raw",
      front: [{ uid: 55, flags: [], size: Buffer.byteLength(source) }],
      messages: [{
        uid: 55,
        flags: [],
        envelope: { subject: "Raw" },
        internalDate: new Date("2026-01-01T00:00:00Z"),
        size: Buffer.byteLength(source),
        source
      }]
    }
  ]);
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  const mail = outputs.find((output) => output && output[0]);
  assert.ok(Buffer.isBuffer(mail[0].raw));
  assert.equal(mail[0].raw.toString(), source);
});

test("imap email in only expunges deleted front-window UIDs with UIDPLUS", async () => {
  const skipped = createCursorTestNode({
    frontWindowSize: 5,
    batchSize: 1,
    expungeDeletedFront: true,
    expungeDeletedFrontLimit: 1
  }, [
    {
      exists: 5,
      uidValidity: "uidv-no-uidplus",
      front: [{ uid: 10, flags: ["\\Deleted"], size: 10 }]
    }
  ]);
  const skippedOutputs = [];
  await skipped.node.runFetchCycle({}, (output) => skippedOutputs.push(output));

  assert.equal(skipped.messageDeleteCalls.length, 0);
  assert.equal(skipped.node.scanCursor, 1);
  assert.equal(collectStats(skippedOutputs)[0].deletedExpungeSkipped, 1);

  const expunged = createCursorTestNode({
    frontWindowSize: 5,
    batchSize: 1,
    expungeDeletedFront: true,
    expungeDeletedFrontLimit: 1
  }, [
    {
      exists: 10,
      uidValidity: "uidv-uidplus",
      capabilities: ["UIDPLUS"],
      front: [{ uid: 10, flags: ["\\Deleted"], size: 10 }]
    }
  ]);
  expunged.node.scanCursor = 6;
  const expungedOutputs = [];
  await expunged.node.runFetchCycle({}, (output) => expungedOutputs.push(output));

  assert.equal(expunged.messageDeleteCalls.length, 1);
  assert.equal(expunged.messageDeleteCalls[0].range, "10");
  assert.deepEqual(expunged.messageDeleteCalls[0].options, { uid: true });
  assert.equal(expunged.node.scanCursor, 6);

  const stats = collectStats(expungedOutputs)[0];
  assert.equal(stats.deletedExpunged, 1);
  assert.equal(stats.scanCursorAdjusted, true);
  assert.equal(stats.scanCursorNext, 6);
});

test("imap email in does not enter new UID priority when cursor-window expunge adjusts the cursor", async () => {
  const { node, messageDeleteCalls } = createCursorTestNode({
    frontWindowSize: 1,
    batchSize: 1,
    expungeDeletedFront: true,
    expungeDeletedFrontLimit: 1
  }, [
    {
      exists: 1,
      uidNext: 2,
      uidValidity: "uidv-cursor-expunge",
      capabilities: ["UIDPLUS"],
      front: [{ uid: 1, flags: ["\\Deleted"], size: 10 }]
    }
  ]);
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.equal(messageDeleteCalls.length, 1);
  assert.equal(node.scanCursor, 1);
  assert.equal(node.newUidCursor, null);

  const stats = collectStats(outputs)[0];
  assertRemovedStatsFieldsAbsent(stats);
  assert.equal(stats.phase, "cursor-window");
  assert.equal(stats.deletedExpunged, 1);
  assert.equal(stats.scanCursorAdjusted, true);
  assert.equal(stats.newUidCursorInitialized, false);
  assert.equal(stats.newUidCursor, null);
});

test("imap email in does not adjust cursor when expunge returns false", async () => {
  const { node, messageDeleteCalls } = createCursorTestNode({
    frontWindowSize: 5,
    batchSize: 1,
    expungeDeletedFront: true,
    expungeDeletedFrontLimit: 1
  }, [
    {
      exists: 10,
      uidValidity: "uidv-expunge-false",
      capabilities: ["UIDPLUS"],
      front: [{ uid: 10, flags: ["\\Deleted"], size: 10 }],
      messageDelete() {
        return false;
      }
    }
  ]);
  node.scanCursor = 6;
  const outputs = [];

  await node.runFetchCycle({}, (output) => outputs.push(output));

  assert.equal(messageDeleteCalls.length, 1);
  assert.equal(node.scanCursor, 1);

  const stats = collectStats(outputs)[0];
  assert.equal(stats.deletedExpungeErrors, 1);
  assert.equal(stats.scanCursorAdjusted, false);
  assert.equal(stats.scanCursorNext, 1);
});

test("imap email in runtime contract uses explicit selection fields", () => {
  const source = readProjectFile(path.join("nodes", "imap-email-in.js"));
  const html = readProjectFile(path.join("nodes", "imap-email-in.html"));
  const flow = readProjectFile(path.join("examples", "basic-at-least-once-flow.json"));

  for (const field of selectionFields) {
    assert.match(source, new RegExp(`\\b${field}\\b`), `${field} must be read by the runtime`);
    assert.match(html, new RegExp(`\\b${field}\\b`), `${field} must be configured by the editor UI`);
  }

  assert.equal(html.includes("skipDeleted"), false, "editor UI should use the new selection fields");
  assert.equal(flow.includes("skipDeleted"), false, "example flow should use the new selection fields");
});

test("imap email package registers only imap-email flow types", () => {
  const pkg = require(path.join(root, "package.json"));
  const nodeTypes = Object.keys(pkg["node-red"].nodes);
  const nodeSources = fs
    .readdirSync(path.join(root, "nodes"))
    .filter((file) => file.endsWith(".js") || file.endsWith(".html"))
    .map((file) => readProjectFile(path.join("nodes", file)))
    .join("\n");

  assert.deepEqual(nodeTypes, [
    "imap-email account",
    "imap-email in",
    "imap-email ack"
  ]);
  assert.equal(nodeTypes.some((type) => type.startsWith("imap queue")), false);
  assert.equal(nodeTypes.some((type) => type.startsWith("imap email")), false);

  for (const type of nodeTypes) {
    const escaped = type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      nodeSources,
      new RegExp(`RED\\.nodes\\.registerType\\(['"]${escaped}['"]`),
      `${type} must be registered in JS/HTML`
    );
    assert.match(
      nodeSources,
      new RegExp(`data-template-name=["']${escaped}["']`),
      `${type} must have a matching data-template-name`
    );
    assert.match(
      nodeSources,
      new RegExp(`data-help-name=["']${escaped}["']`),
      `${type} must have a matching data-help-name`
    );
  }

  assert.equal(/RED\.nodes\.registerType\(['"]imap queue/.test(nodeSources), false);
  assert.equal(/data-template-name=["']imap queue/.test(nodeSources), false);
  assert.equal(/data-help-name=["']imap queue/.test(nodeSources), false);
  assert.equal(/RED\.nodes\.registerType\(['"]imap email/.test(nodeSources), false);
  assert.equal(/data-template-name=["']imap email/.test(nodeSources), false);
  assert.equal(/data-help-name=["']imap email/.test(nodeSources), false);
});

test("imap email in flag filters must not require unbounded mailbox scans", () => {
  const source = readProjectFile(path.join("nodes", "imap-email-in.js"));

  assert.match(
    source,
    /\bnode\.scanCursor\b/,
    "runtime must keep an internal bounded scan cursor"
  );
  assert.match(
    source,
    /client\.fetch\(`\$\{window\.windowStart\}:\$\{window\.windowEnd\}`/,
    "front fetch must stream bounded cursor windows"
  );
  assert.equal(source.includes("fetchAll"), false, "input node must not collect IMAP fetch results with fetchAll");
  assert.equal(/\bsearch\s*\(/i.test(source), false, "flag filtering must not introduce IMAP SEARCH");
  assert.equal(source.includes("1:*"), false, "flag filtering must not fetch the whole mailbox");
  assert.equal(source.includes("maxWindowsPerCycle"), false, "cursor scan must not add a second scan limit");
});
