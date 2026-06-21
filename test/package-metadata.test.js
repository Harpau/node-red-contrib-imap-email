"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const NODE_22_0_0 = [22, 0, 0];

function parseVersionParts(value) {
  const parts = String(value)
    .split(".")
    .map((part) => {
      if (part === "*" || part.toLowerCase() === "x") {
        return 0;
      }
      return Number(part) || 0;
    });

  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) {
      return 1;
    }
    if (left[index] < right[index]) {
      return -1;
    }
  }
  return 0;
}

function comparatorAllowsVersion(operator, candidate, required) {
  const comparison = compareVersions(candidate, parseVersionParts(required));

  if (operator === ">=") {
    return comparison >= 0;
  }
  if (operator === ">") {
    return comparison > 0;
  }
  if (operator === "<") {
    return comparison < 0;
  }
  if (operator === "<=") {
    return comparison <= 0;
  }
  return true;
}

function wildcardAlternativeAllowsVersion(alternative, candidate) {
  const match = String(alternative).match(/^\s*(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?\s*$/i);
  if (!match) {
    return true;
  }

  const major = Number(match[1]);
  const minor = match[2];
  const patch = match[3];

  if (candidate[0] !== major) {
    return false;
  }
  if (minor && minor !== "*" && minor.toLowerCase() !== "x" && candidate[1] !== Number(minor)) {
    return false;
  }
  if (patch && patch !== "*" && patch.toLowerCase() !== "x" && candidate[2] !== Number(patch)) {
    return false;
  }
  return true;
}

function engineAlternativeAllowsVersion(alternative, candidate) {
  const comparatorPattern = /(>=|>|<=|<)\s*(\d+(?:\.(?:\d+|x|\*))?(?:\.(?:\d+|x|\*))?)/gi;
  const comparators = [...String(alternative).matchAll(comparatorPattern)];
  if (comparators.length === 0) {
    return wildcardAlternativeAllowsVersion(alternative, candidate);
  }
  return comparators.every((match) => comparatorAllowsVersion(match[1], candidate, match[2]));
}

function engineRangeAllowsNode22(range) {
  return String(range || "")
    .split("||")
    .some((alternative) => engineAlternativeAllowsVersion(alternative.trim(), NODE_22_0_0));
}

function listFilesRecursive(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

test("stable package metadata is complete", () => {
  const root = path.resolve(__dirname, "..");
  const pkg = require(path.join(root, "package.json"));

  assert.equal(pkg.name, "@compeso/node-red-contrib-imap-email");
  assert.equal(pkg.version, "1.0.0");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.publishConfig && pkg.publishConfig.access, "public");
  assert.equal(pkg.engines && pkg.engines.node, ">=22.0.0");
  assert.equal(pkg["node-red"] && pkg["node-red"].version, ">=4.0.0");
  assert.ok(pkg.keywords.includes("node-red"));
  assert.ok(pkg.keywords.includes("imap-email"));
  assert.equal(pkg.dependencies.imapflow, "1.0.76");
  assert.equal(pkg.dependencies.mailparser, "3.9.10");
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

test("package lock root metadata matches package metadata", () => {
  const root = path.resolve(__dirname, "..");
  const pkg = require(path.join(root, "package.json"));
  const lock = require(path.join(root, "package-lock.json"));
  const rootPackage = lock.packages[""];

  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  assert.equal(rootPackage.name, pkg.name);
  assert.equal(rootPackage.version, pkg.version);
  assert.deepEqual(rootPackage.dependencies, pkg.dependencies);
  assert.deepEqual(rootPackage.engines, pkg.engines);
});

test("locked production dependencies remain compatible with Node 22.0.0", () => {
  const root = path.resolve(__dirname, "..");
  const lock = require(path.join(root, "package-lock.json"));
  const incompatible = [];

  for (const [name, meta] of Object.entries(lock.packages || {})) {
    if (!name || !name.startsWith("node_modules/") || !meta.engines || !meta.engines.node) {
      continue;
    }
    if (!engineRangeAllowsNode22(meta.engines.node)) {
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

test("release documentation describes npm install and current audit command", () => {
  const root = path.resolve(__dirname, "..");
  const docs = {
    "README.md": fs.readFileSync(path.join(root, "README.md"), "utf8"),
    "docs/INSTALL_DE.md": fs.readFileSync(path.join(root, "docs", "INSTALL_DE.md"), "utf8"),
    "docs/RELEASE_DE.md": fs.readFileSync(path.join(root, "docs", "RELEASE_DE.md"), "utf8")
  };

  for (const [file, content] of Object.entries(docs)) {
    assert.match(content, /npm install @compeso\/node-red-contrib-imap-email/, `${file} should document npm registry installation`);
  }

  assert.match(docs["docs/RELEASE_DE.md"], /npm audit --omit=dev/);
  assert.doesNotMatch(docs["docs/RELEASE_DE.md"], /npm audit --audit-level=moderate/);
  assert.match(docs["docs/RELEASE_DE.md"], /Strato und\s+IONOS wurden am 2026-06-17 manuell erfolgreich getestet/);
});

test("palette nodes share the Node-RED network group and IMAP mail color", () => {
  const root = path.resolve(__dirname, "..");
  const paletteNodes = [
    path.join("nodes", "imap-email-in.html"),
    path.join("nodes", "imap-email-ack.html")
  ];

  for (const file of paletteNodes) {
    const html = fs.readFileSync(path.join(root, file), "utf8");

    assert.match(html, /category:\s*['"]network['"]/, `${file} must appear in the Node-RED network palette group`);
    assert.match(html, /color:\s*['"]#c4e3f3['"]/, `${file} must use the IMAP mail palette color`);
  }
});

test("front window documentation describes bounded windows per trigger", () => {
  const root = path.resolve(__dirname, "..");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const help = fs.readFileSync(path.join(root, "nodes", "imap-email-in.html"), "utf8");
  const design = fs.readFileSync(path.join(root, "docs", "design-decisions-imap-email.md"), "utf8");

  assert.match(readme, /Front window\s+maximum messages inspected per bounded window/);
  assert.match(readme, /0 means exactly one cursor window/);
  assert.match(help, /A trigger may read multiple bounded windows/);
  assert.match(design, /pro Trigger koennen mehrere\s+Fenster gelesen werden/);
  assert.match(design, /bounded\/best-effort/);

  assert.doesNotMatch(readme, /Front window\s+maximum messages inspected per trigger from the current cursor/);
  assert.doesNotMatch(help, /filters are applied only inside the bounded cursor window/i);
  assert.doesNotMatch(design, /Es wird nur ein begrenztes Cursor-Fenster gelesen/);
});

test("account defaults and example flow are provider-neutral", () => {
  const root = path.resolve(__dirname, "..");
  const checked = {
    "nodes/imap-email-account.js": fs.readFileSync(path.join(root, "nodes", "imap-email-account.js"), "utf8"),
    "nodes/imap-email-account.html": fs.readFileSync(path.join(root, "nodes", "imap-email-account.html"), "utf8"),
    "examples/basic-at-least-once-flow.json": fs.readFileSync(path.join(root, "examples", "basic-at-least-once-flow.json"), "utf8")
  };

  for (const [file, content] of Object.entries(checked)) {
    assert.doesNotMatch(content, /imap\.strato\.de/i, `${file} must not contain a provider default`);
    assert.doesNotMatch(content, /STRATO/i, `${file} must not contain a provider-specific example name`);
  }

  assert.match(checked["nodes/imap-email-account.html"], /placeholder="imap\.example\.test"/);
  assert.match(checked["examples/basic-at-least-once-flow.json"], /"name": "Example IMAP account"/);
  assert.match(checked["examples/basic-at-least-once-flow.json"], /"host": "imap\.example\.test"/);
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
  assert.match(
    docs["README.md"],
    /copy[\s\S]+copied first[\s\S]+applied only to the source message/i
  );
  assert.match(
    docs["nodes/imap-email-ack.html"],
    /copy[\s\S]+created first[\s\S]+applied only to the source message/i
  );
  assert.match(
    docs["docs/design-decisions-imap-email.md"],
    /messageCopy[\s\S]+Flag-Aenderungen auf der Quellmail in dieser Reihenfolge/
  );

  for (const [file, content] of Object.entries(docs)) {
    assert.doesNotMatch(content, /flags are updated on the\s+source message before it is moved or copied/i, `${file} documents stale copy flag order`);
    assert.doesNotMatch(content, /applies (?:any )?configured flag changes before copying/i, `${file} documents stale copy flag order`);
    assert.doesNotMatch(content, /vor dem Kopieren/i, `${file} documents stale copy flag order`);
    assert.doesNotMatch(content, /Flag-Aenderungen vor dem\s+Kopieren/i, `${file} documents stale copy flag order`);
  }
});

test("github maintainer files describe the current imap email package", () => {
  const root = path.resolve(__dirname, "..");
  const githubDir = path.join(root, ".github");
  const files = listFilesRecursive(githubDir)
    .filter((file) => !file.endsWith(".DS_Store"));
  const stalePatterns = [
    /\bimap queue\b/i,
    /\bimap-queue\b/i,
    /\bimap queue nack\b/i,
    /@compeso\/node-red-contrib-imap-queue/i,
    /compeso-node-red-contrib-imap-queue/i
  ];

  assert.ok(files.length > 0, ".github maintainer files must exist");

  for (const file of files) {
    const relative = path.relative(root, file);
    const content = fs.readFileSync(file, "utf8");

    for (const pattern of stalePatterns) {
      assert.doesNotMatch(content, pattern, `${relative} contains stale imap queue content`);
    }
  }

  const workflow = fs.readFileSync(path.join(githubDir, "workflows", "test.yml"), "utf8");
  assert.match(workflow, /22\.x/, "CI must test the minimum supported Node.js version");
  assert.doesNotMatch(workflow, /18\.x/, "CI must not test unsupported Node.js 18");
  assert.doesNotMatch(workflow, /20\.x/, "CI must not test unsupported Node.js 20");
  assert.match(workflow, /npm ci --no-audit --no-fund/, "CI must install from the lockfile");
  assert.match(workflow, /npm test/, "CI must run the unit tests");
  assert.match(workflow, /npm run pack:check/, "CI must run the package content check");
  assert.doesNotMatch(workflow, /npm publish/, "CI must not publish the package");
});
