"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { parseBoolean } = require("../lib/imap-utils");

test("parseBoolean trims and normalizes string values", () => {
  assert.equal(parseBoolean(" false ", true), false);
  assert.equal(parseBoolean(" OFF ", true), false);
  assert.equal(parseBoolean(" ", true), true);
});

test("parseBoolean keeps existing boolean and known string behavior", () => {
  assert.equal(parseBoolean(true, false), true);
  assert.equal(parseBoolean(false, true), false);
  assert.equal(parseBoolean("false", true), false);
  assert.equal(parseBoolean("0", true), false);
  assert.equal(parseBoolean("no", true), false);
  assert.equal(parseBoolean("nein", true), false);
  assert.equal(parseBoolean("off", true), false);
  assert.equal(parseBoolean("yes", false), true);
  assert.equal(parseBoolean("", true), true);
  assert.equal(parseBoolean(null, true), true);
  assert.equal(parseBoolean(undefined, true), true);
});
