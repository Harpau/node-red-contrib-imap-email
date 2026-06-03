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
  assert.equal(flow.some((node) => node.type === "imap queue account"), true);
  assert.equal(flow.some((node) => node.type === "imap queue in"), true);
  assert.equal(flow.some((node) => node.type === "imap queue ack"), true);
  assert.equal(flow.some((node) => node.type === "imap queue nack"), true);
  assert.equal(flow.some((node) => node.type === "imap-queue-in"), false);
  assert.equal(flow.some((node) => Object.prototype.hasOwnProperty.call(node, "credentials")), false);
});

test("nack default failed mailbox does not start with a dot", () => {
  const root = path.resolve(__dirname, "..");
  const files = [
    path.join(root, "nodes", "imap-queue-nack.js"),
    path.join(root, "nodes", "imap-queue-nack.html"),
    path.join(root, "examples", "basic-at-least-once-flow.json")
  ];

  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    assert.equal(text.includes(".NodeRED.failed"), false, `${path.basename(file)} must not use dot-prefixed failed mailbox`);
  }
});
