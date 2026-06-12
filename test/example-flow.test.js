"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("example flow is importable and contains no credentials", () => {
  const root = path.resolve(__dirname, "..");
  const flowPath = path.join(root, "examples", "basic-at-least-once-flow.json");
  const flow = JSON.parse(fs.readFileSync(flowPath, "utf8"));

  assert.equal(Array.isArray(flow), true);
  assert.equal(flow.some((node) => node.type === "imap email account"), true);
  assert.equal(flow.some((node) => node.type === "imap email in"), true);
  assert.equal(flow.some((node) => node.type === "imap email ack"), true);
  assert.equal(flow.some((node) => node.type === "imap queue account"), false);
  assert.equal(flow.some((node) => node.type === "imap queue in"), false);
  assert.equal(flow.some((node) => node.type === "imap queue ack"), false);
  assert.equal(flow.some((node) => node.type === "imap queue nack"), false);
  assert.equal(flow.some((node) => node.type === "imap-queue-in"), false);
  assert.equal(flow.some((node) => Object.prototype.hasOwnProperty.call(node, "credentials")), false);
  assert.equal(flow.some((node) => Object.prototype.hasOwnProperty.call(node, "actionProperty")), false);
});

test("example flow uses only public imap email nodes", () => {
  const root = path.resolve(__dirname, "..");
  const flowPath = path.join(root, "examples", "basic-at-least-once-flow.json");
  const text = fs.readFileSync(flowPath, "utf8");

  assert.equal(text.includes("imap queue"), false);
  assert.equal(text.includes("imap-queue"), false);
});
