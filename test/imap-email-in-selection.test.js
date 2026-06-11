"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  normalizeFlagSelection,
  matchesFlagSelections
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

function createInputNode(config = {}) {
  let InputCtor;
  const account = {
    id: "account-1",
    host: "imap.example.test",
    getUsername() {
      return "user@example.test";
    }
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
    /Math\.min\(exists,\s*node\.frontWindowSize\)/,
    "front window must remain bounded by frontWindowSize"
  );
  assert.match(
    source,
    /fetchAll\(`1:\$\{frontEnd\}`/,
    "front fetch must read only the bounded 1:frontEnd range"
  );
  assert.equal(/\bsearch\s*\(/i.test(source), false, "flag filtering must not introduce IMAP SEARCH");
  assert.equal(source.includes("1:*"), false, "flag filtering must not fetch the whole mailbox");
  assert.equal(source.includes("maxWindowsPerCycle"), false, "v0.1 must not scan multiple windows per cycle");
});
