"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { parseBoolean, headersToObject } = require("../lib/imap-utils");

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

test("headersToObject returns a null-prototype object with normal headers", () => {
  const headers = headersToObject(new Map([
    ["subject", "Hello"],
    ["message-id", "<message-1@example.test>"]
  ]));

  assert.equal(Object.getPrototypeOf(headers), null);
  assert.equal(headers.subject, "Hello");
  assert.equal(headers["message-id"], "<message-1@example.test>");
  assert.deepEqual(Object.keys(headers), ["subject", "message-id"]);
});

test("headersToObject neutralizes prototype pollution header names", () => {
  const headers = headersToObject([
    ["__proto__", { polluted: true }],
    ["constructor", "evil-constructor"],
    ["Prototype", "evil-prototype"],
    ["x-imap-email-header-__proto__", "existing"]
  ]);

  assert.equal(Object.getPrototypeOf(headers), null);
  assert.equal(headers.__proto__, undefined);
  assert.equal(headers.constructor, undefined);
  assert.equal(headers.prototype, undefined);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(headers["x-imap-email-header-__proto__"], { polluted: true });
  assert.equal(headers["x-imap-email-header-constructor"], "evil-constructor");
  assert.equal(headers["x-imap-email-header-Prototype"], "evil-prototype");
  assert.equal(headers["x-imap-email-header-__proto__-2"], "existing");
});
