"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  normalizeFlagSelection,
  matchesFlagSelections,
  flagsToState
} = require("../lib/imap-utils");
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
        node.status = () => {};
        node.error = () => {};
        node.on = () => {};
      },
      getNode(id) {
        return id === "account-1" ? account : null;
      },
      registerType(type, ctor) {
        if (type === "imap email in") {
          InputCtor = ctor;
        }
      }
    }
  };

  registerImapEmailIn(RED);
  assert.equal(typeof InputCtor, "function");
  return new InputCtor({ account: "account-1", ...config });
}

function createCursorTestNode(config = {}, mailboxes = [{ exists: 1200, uidValidity: "uidv-1" }]) {
  const fetchCalls = [];
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
        mailbox: {
          exists: currentMailbox.exists,
          uidValidity: currentMailbox.uidValidity
        },
        async connect() {},
        async getMailboxLock(mailbox) {
          return {
            release() {
              releasedLocks.push(mailbox);
            }
          };
        },
        async fetchAll(range, query, options) {
          fetchCalls.push({ range, query, options });
          return currentMailbox.front || [];
        },
        async logout() {
          loggedOutClients.push(currentMailbox.uidValidity);
        }
      };
    }
  };

  return {
    node: createInputNode({
      diagnostics: "stats",
      includeAttachments: false,
      emitRaw: false,
      ...config
    }, { account }),
    fetchCalls,
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

function collectStats(outputs) {
  return outputs
    .filter((output) => output && output[2] && output[2].payload)
    .map((output) => output[2].payload);
}

function findHtmlDefault(html, field) {
  const pattern = new RegExp(`${field}:\\s*\\{\\s*value:\\s*['"]([^'"]+)['"]`);
  const match = html.match(pattern);
  return match && match[1];
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

  const node = createInputNode();
  assert.deepEqual(node.selection, {
    deleted: "exclude",
    seen: "ignore",
    answered: "ignore",
    flagged: "ignore"
  });
});

test("legacy skipDeleted maps to deletedSelection only when selection is absent", () => {
  assert.equal(createInputNode({ skipDeleted: true }).deletedSelection, "exclude");
  assert.equal(createInputNode({ skipDeleted: false }).deletedSelection, "ignore");
  assert.equal(
    createInputNode({ skipDeleted: false, deletedSelection: "require" }).deletedSelection,
    "require"
  );
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
  const inputNode = flow.find((node) => node.type === "imap email in");

  assert.ok(inputNode, "example flow must contain an imap email in node");

  for (const [field, expected] of Object.entries(selectionDefaults)) {
    assert.equal(inputNode[field], expected, `example flow must serialize ${field}`);
  }

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
          envelope: { subject: "Hello" },
          internalDate: new Date("2026-01-01T00:00:00Z"),
          size: 100
        }
      ]
    }
  ]);
  node.account.createClient = () => ({
    mailbox: { exists: 1, uidValidity: "uidv-1" },
    async connect() {},
    async getMailboxLock() {
      return { release() {} };
    },
    async fetchAll(range, query, options) {
      if (options && options.uid) {
        return [
          {
            uid: 123,
            flags: ["\\Seen", "\\Flagged"],
            envelope: { subject: "Hello" },
            internalDate: new Date("2026-01-01T00:00:00Z"),
            size: 100,
            source: createMailSource("Hello")
          }
        ];
      }
      return [
        {
          uid: 123,
          flags: ["\\Seen", "\\Flagged"],
          envelope: { subject: "Hello" },
          internalDate: new Date("2026-01-01T00:00:00Z"),
          size: 100
        }
      ];
    },
    async logout() {}
  });

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

test("imap email in advances one bounded cursor window per trigger", async () => {
  const { node, fetchCalls } = createCursorTestNode({ frontWindowSize: 500 }, [
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
});

test("imap email in resets the scan cursor on UIDVALIDITY changes", async () => {
  const { node, fetchCalls } = createCursorTestNode({ frontWindowSize: 500 }, [
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

test("imap email in runtime contract is not limited to legacy skipDeleted", () => {
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

test("imap email package does not register old imap queue node types", () => {
  const pkg = require(path.join(root, "package.json"));
  const nodeTypes = Object.keys(pkg["node-red"].nodes);
  const nodeSources = fs
    .readdirSync(path.join(root, "nodes"))
    .filter((file) => file.endsWith(".js") || file.endsWith(".html"))
    .map((file) => readProjectFile(path.join("nodes", file)))
    .join("\n");

  assert.deepEqual(nodeTypes, [
    "imap email account",
    "imap email in",
    "imap email ack"
  ]);
  assert.equal(nodeTypes.some((type) => type.startsWith("imap queue")), false);
  assert.equal(/RED\.nodes\.registerType\(['"]imap queue/.test(nodeSources), false);
  assert.equal(/data-template-name=["']imap queue/.test(nodeSources), false);
  assert.equal(/data-help-name=["']imap queue/.test(nodeSources), false);
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
    /fetchAll\(`\$\{windowStart\}:\$\{windowEnd\}`/,
    "front fetch must read one bounded cursor window"
  );
  assert.equal(/\bsearch\s*\(/i.test(source), false, "flag filtering must not introduce IMAP SEARCH");
  assert.equal(source.includes("1:*"), false, "flag filtering must not fetch the whole mailbox");
  assert.equal(source.includes("maxWindowsPerCycle"), false, "cursor scan must not add a second scan limit");
});
