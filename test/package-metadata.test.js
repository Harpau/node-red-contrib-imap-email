"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("release-candidate package metadata is complete", () => {
  const root = path.resolve(__dirname, "..");
  const pkg = require(path.join(root, "package.json"));

  assert.equal(pkg.name, "@compeso/node-red-contrib-imap-queue");
  assert.equal(pkg.version, "0.9.0");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.publishConfig && pkg.publishConfig.access, "public");
  assert.ok(pkg.keywords.includes("node-red"));
  assert.ok(pkg.dependencies.imapflow);
  assert.ok(pkg.dependencies.mailparser);
  assert.ok(pkg.files.includes("CHANGELOG.md"));
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
