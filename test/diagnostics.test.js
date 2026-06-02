"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const diagnostics = require("../lib/diagnostics");

test("diagnostics levels normalize to supported values", () => {
  assert.equal(diagnostics.normalizeDiagnostics("off"), "off");
  assert.equal(diagnostics.normalizeDiagnostics("stats"), "stats");
  assert.equal(diagnostics.normalizeDiagnostics("debug"), "debug");
  assert.equal(diagnostics.normalizeDiagnostics("unknown", "off"), "off");
});

test("diagnostics redacts credentials and bulky message content", () => {
  const result = diagnostics.redact({
    password: "secret",
    accessToken: "token",
    raw: Buffer.from("hello"),
    attachments: [{ content: "large" }],
    nested: { value: "ok" }
  });

  assert.equal(result.password, "[redacted]");
  assert.equal(result.accessToken, "[redacted]");
  assert.equal(result.raw, "[redacted]");
  assert.equal(result.attachments, "[redacted]");
  assert.deepEqual(result.nested, { value: "ok" });
});
