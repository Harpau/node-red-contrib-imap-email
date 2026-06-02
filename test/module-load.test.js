"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("package node-red mappings point to loadable node modules", () => {
  const root = path.resolve(__dirname, "..");
  const pkg = require(path.join(root, "package.json"));
  const mappings = pkg["node-red"] && pkg["node-red"].nodes;

  assert.ok(mappings, "package.json must contain node-red.nodes mappings");

  for (const [type, relativeFile] of Object.entries(mappings)) {
    const fullPath = path.join(root, relativeFile);
    assert.equal(fs.existsSync(fullPath), true, `${type} mapped file must exist`);
    assert.equal(typeof require(fullPath), "function", `${type} module must export a registration function`);
  }
});

test("all lib modules are loadable", () => {
  const libDir = path.resolve(__dirname, "..", "lib");
  const files = fs.readdirSync(libDir).filter((name) => name.endsWith(".js"));

  assert.ok(files.length > 0, "expected lib modules");

  for (const file of files) {
    const loaded = require(path.join(libDir, file));
    assert.ok(loaded !== undefined, `${file} should load`);
  }
});
