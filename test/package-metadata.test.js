"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function comparatorAllowsNode18(operator, major) {
  if (operator === ">=") {
    return major <= 18;
  }
  if (operator === ">") {
    return major < 18;
  }
  if (operator === "<") {
    return major > 18;
  }
  if (operator === "<=") {
    return major >= 18;
  }
  return true;
}

function engineAlternativeAllowsNode18(alternative) {
  const comparators = [...String(alternative).matchAll(/(>=|>|<=|<)\s*(\d+)/g)];
  if (comparators.length === 0) {
    return true;
  }
  return comparators.every((match) => comparatorAllowsNode18(match[1], Number(match[2])));
}

function engineRangeAllowsNode18(range) {
  return String(range || "")
    .split("||")
    .some((alternative) => engineAlternativeAllowsNode18(alternative.trim()));
}

test("stable package metadata is complete", () => {
  const root = path.resolve(__dirname, "..");
  const pkg = require(path.join(root, "package.json"));

  assert.equal(pkg.name, "@compeso/node-red-contrib-imap-email");
  assert.equal(pkg.version, "0.1.0");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.publishConfig && pkg.publishConfig.access, "public");
  assert.ok(pkg.keywords.includes("node-red"));
  assert.ok(pkg.keywords.includes("imap-email"));
  assert.equal(pkg.dependencies.imapflow, "1.0.76");
  assert.equal(pkg.dependencies.mailparser, "3.9.8");
  assert.equal(Object.prototype.hasOwnProperty.call(pkg, "overrides"), false);
  assert.ok(pkg.files.includes("CHANGELOG.md"));
  assert.equal(pkg.homepage, "https://github.com/Harpau/node-red-contrib-imap-email#readme");
  assert.equal(pkg.repository.url, "git+https://github.com/Harpau/node-red-contrib-imap-email.git");
  assert.equal(pkg.bugs.url, "https://github.com/Harpau/node-red-contrib-imap-email/issues");

  assert.deepEqual(Object.keys(pkg["node-red"].nodes), [
    "imap-email account",
    "imap-email in",
    "imap-email ack"
  ]);
});

test("locked production dependencies remain compatible with Node 18", () => {
  const root = path.resolve(__dirname, "..");
  const lock = require(path.join(root, "package-lock.json"));
  const incompatible = [];

  for (const [name, meta] of Object.entries(lock.packages || {})) {
    if (!name || !name.startsWith("node_modules/") || !meta.engines || !meta.engines.node) {
      continue;
    }
    if (!engineRangeAllowsNode18(meta.engines.node)) {
      incompatible.push(`${name}: ${meta.engines.node}`);
    }
  }

  assert.deepEqual(incompatible, []);
});

test("installed imapflow exposes the IMAP methods used by the nodes", () => {
  const { ImapFlow } = require("imapflow");
  const requiredMethods = [
    "connect",
    "getMailboxLock",
    "mailboxCreate",
    "messageDelete",
    "messageMove",
    "messageCopy",
    "messageFlagsAdd",
    "messageFlagsRemove",
    "fetchOne",
    "fetch"
  ];

  for (const method of requiredMethods) {
    assert.equal(typeof ImapFlow.prototype[method], "function", `ImapFlow must expose ${method}`);
  }
});

test("project documentation does not contain stale GitHub repository URLs for this package", () => {
  const root = path.resolve(__dirname, "..");
  const checkedFiles = [
    "README.md",
    "CHANGELOG.md",
    path.join("docs", "INSTALL_DE.md"),
    path.join("docs", "RELEASE_DE.md"),
    "package.json"
  ];

  for (const file of checkedFiles) {
    const content = fs.readFileSync(path.join(root, file), "utf8");
    assert.equal(content.includes("github.com/compeso/node-red-contrib-imap-email"), false, `${file} contains stale GitHub HTTPS URL`);
    assert.equal(content.includes("github:compeso/node-red-contrib-imap-email"), false, `${file} contains stale GitHub shorthand URL`);
  }
});

test("release documentation exists", () => {
  const root = path.resolve(__dirname, "..");
  const required = [
    "README.md",
    "CHANGELOG.md",
    path.join("docs", "INSTALL_DE.md"),
    path.join("docs", "RELEASE_DE.md")
  ];

  for (const file of required) {
    const fullPath = path.join(root, file);
    assert.equal(fs.existsSync(fullPath), true, `${file} must exist`);
    assert.ok(fs.readFileSync(fullPath, "utf8").length > 100, `${file} should not be empty`);
  }
});

test("ack documentation describes copy and fail-closed capability rules", () => {
  const root = path.resolve(__dirname, "..");
  const docs = {
    "README.md": fs.readFileSync(path.join(root, "README.md"), "utf8"),
    "nodes/imap-email-ack.html": fs.readFileSync(path.join(root, "nodes", "imap-email-ack.html"), "utf8"),
    "docs/design-decisions-imap-email.md": fs.readFileSync(path.join(root, "docs", "design-decisions-imap-email.md"), "utf8")
  };

  for (const [file, content] of Object.entries(docs)) {
    assert.match(content, /\bcopy\b/, `${file} should document the copy ACK action`);
    assert.match(content, /UIDPLUS/, `${file} should document the delete UIDPLUS requirement`);
    assert.match(content, /\bMOVE\b/, `${file} should document the native MOVE requirement`);
  }

  assert.match(docs["nodes/imap-email-ack.html"], /<option value="copy">copy<\/option>/);
  assert.match(docs["README.md"], /action fails closed on output 2/);
  assert.match(docs["docs/design-decisions-imap-email.md"], /messageCopy/);
});
