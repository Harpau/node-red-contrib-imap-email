"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const test = require("node:test");
const { startImapServer } = require("../helpers/imap-server");
const {
  startNodeRed, waitFor, delay, account, input, ack, baseFlow,
  statusCollector, withoutCredentials
} = require("./node-red-harness");

function change(flows, id, values) {
  return flows.map(node => node.id === id ? { ...node, ...values } : node);
}

function assertStatusSequence(harness, mark, id, finalText, finalFill = "green") {
  const statuses = harness.statusesSince(mark, id);
  assert.deepEqual(statuses, [
    { fill: "yellow", shape: "ring", text: "checking connection" },
    { fill: finalFill, shape: finalFill === "green" ? "dot" : "ring", text: finalText }
  ]);
}

async function settled(server) {
  await server.waitFor(() => server.activeSockets.size === 0);
  // Allow the corresponding Node-RED status message to reach its Function node.
  await delay(25);
}

function assertProbeWarningsSanitized(harness, mark, server) {
  const forbidden = new Set([
    server.host, server.options.username, server.options.password, server.options.accessToken,
    "fixture-user", "fixture-password", "fixture-token", "invalid-synthetic-password", "alternate-synthetic-password"
  ].filter(Boolean));
  for (const entry of harness.warningsSince(mark)) {
    // Include metadata and complete message/stack payloads, not just status text
    // or a shortened prefix. All fixture values are synthetic.
    const text = JSON.stringify(entry);
    for (const value of forbidden) {
      assert.equal(text.includes(value), false, "complete IMAP warning must omit synthetic secrets, username and endpoint");
    }
  }
}

test("installed package in actual Node-RED: deploy, credentials and lifecycle", { timeout: 120000 }, async t => {
  const harness = await startNodeRed();
  t.after(() => harness.close());

  async function scenario(name, options, run) {
    await t.test(name, { timeout: 12000 }, async st => {
      const server = await startImapServer(options);
      const scenarioMark = harness.mark();
      st.after(async () => {
        try { await harness.deploy([]); } finally { await server.close(); }
      });
      await run(server);
      assertProbeWarningsSanitized(harness, scenarioMark, server);
    });
  }

  await scenario("the packaged disabled example imports without an IMAP connection", {}, async server => {
    const example = JSON.parse(await fs.readFile(path.join(harness.packagePath, "examples/basic-at-least-once-flow.json"), "utf8"));
    assert.ok(example.filter(node => node.type === "tab").every(node => node.disabled));
    // Loopback replaces even the inactive placeholder endpoint: a regression can
    // never turn this example-import test into an external network attempt.
    for (const node of example.filter(node => node.type === "imap-email account")) {
      Object.assign(node, { host: server.host, port: server.port, secure: false,
        credentials: { username: "fixture-user", password: "fixture-password" } });
    }
    const mark = harness.mark();
    await harness.deploy(example);
    await delay(40);
    assert.equal(server.connections, 0);
    assert.equal(harness.statusesSince(mark).some(status => status.text === "checking connection"), false);
  });

  await scenario("full deploy shares one authenticated probe, delivers initial status and no output", {}, async server => {
    const mark = harness.mark();
    await harness.deploy(baseFlow(server, { ack: true }));
    await Promise.all([
      harness.waitStatus(mark, "input-main", "connected"),
      harness.waitStatus(mark, "ack-main", "connected")
    ]);
    await settled(server);
    assert.equal(server.connections, 1);
    assert.equal(server.authAttempts.length, 1);
    assert.equal(server.authAttempts[0].accepted, true);
    assertStatusSequence(harness, mark, "input-main", "connected");
    assertStatusSequence(harness, mark, "ack-main", "connected");
    for (const id of ["input-main", "ack-main"]) {
      assert.deepEqual(harness.collectedSince(mark, "status")
        .filter(msg => msg.status.source.id === id).map(msg => msg.status.text),
      ["checking connection", "connected"]);
    }
    assert.equal(harness.collectedSince(mark).filter(msg => !msg.status).length, 0);
    assert.equal(harness.warningsSince(mark).length, 0);
    assert.equal(server.commands.some(command => /SELECT|FETCH|SEARCH|STORE|COPY|MOVE|EXPUNGE/.test(command.operation)), false);

    const secondMark = harness.mark();
    await harness.deploy(withoutCredentials(baseFlow(server, { ack: true })), "full");
    await harness.waitStatus(secondMark, "input-main", "connected");
    await settled(server);
    assert.equal(server.connections, 2, "another full deploy starts a fresh probe");
  });

  for (const mode of ["nodes", "flows"]) {
    await scenario(`${mode} deploy updates stored credentials, including deletion and unchanged password`, {}, async server => {
      let flows = baseFlow(server, { ack: true });
      let mark = harness.mark();
      await harness.deploy(flows);
      await harness.waitStatus(mark, "input-main", "connected");
      await settled(server);
      flows = withoutCredentials(flows);

      const updateCredentials = async (credentials, expectedText, expectedConnections) => {
        mark = harness.mark();
        await harness.deploy(change(flows, "account-main", { credentials }), mode);
        await Promise.all([
          harness.waitStatus(mark, "input-main", expectedText),
          harness.waitStatus(mark, "ack-main", expectedText)
        ]);
        await settled(server);
        assert.equal(server.connections, expectedConnections);
        assertStatusSequence(harness, mark, "input-main", expectedText, expectedText === "connected" ? "green" : "red");
        const failure = expectedText !== "connected";
        assert.ok(harness.warningsSince(mark).length <= (failure ? 1 : 0), "a shared probe emits at most one warning");
        return mark;
      };

      await updateCredentials({ username: "fixture-user", password: "invalid-synthetic-password" }, "authentication failed", 2);
      assert.equal(server.authAttempts.at(-1).accepted, false);
      await updateCredentials({ password: "fixture-password" }, "connected", 3);
      assert.equal(server.authAttempts.at(-1).accepted, true);
      const missingMark = await updateCredentials({ password: "" }, "missing credentials", 3);
      assert.ok(harness.collectedSince(missingMark, "status").some(msg => msg.status.text === "missing credentials"));
      await updateCredentials({ password: "fixture-password" }, "connected", 4);
      await updateCredentials({ username: "fixture-user", password: "__PWRD__" }, "connected", 5);

      mark = harness.mark();
      flows = change(flows, "input-main", { batchSize: 2 });
      const previousAccount = harness.node("account-main");
      await harness.deploy(flows, mode);
      await harness.waitStatus(mark, "input-main", "connected");
      await settled(server);
      assert.equal(server.connections, 6);
      assert.equal(harness.node("account-main"), previousAccount, "unchanged global account remains the same instance");
      assert.equal(server.authAttempts.at(-1).accepted, true, "password persisted in actual credential store");
    });
  }

  await scenario("node versus flow deploy restarts only the appropriate consumers", {}, async server => {
    let flows = baseFlow(server, { ack: true });
    flows.push({ id: "flow-other", type: "tab", label: "Unrelated" });
    flows.push({ id: "unrelated", type: "comment", z: "flow-other", name: "initial", x: 100, y: 100, wires: [] });
    let mark = harness.mark();
    await harness.deploy(flows);
    await harness.waitStatus(mark, "input-main", "connected");
    await settled(server);
    flows = withoutCredentials(flows);
    for (const mode of ["nodes", "flows"]) {
      const instance = harness.node("input-main");
      mark = harness.mark();
      flows = change(flows, "unrelated", { name: mode });
      await harness.deploy(flows, mode);
      await delay(40);
      assert.equal(harness.node("input-main"), instance);
      assert.equal(server.connections, 1);
      assert.equal(harness.statusesSince(mark, "input-main").length, 0);
    }
    const ackBeforeNodes = harness.node("ack-main");
    mark = harness.mark();
    flows = change(flows, "input-main", { name: "changed node" });
    await harness.deploy(flows, "nodes");
    await harness.waitStatus(mark, "input-main", "connected");
    await settled(server);
    assert.equal(harness.node("ack-main"), ackBeforeNodes);
    assert.equal(harness.statusesSince(mark, "ack-main").length, 0);
    assert.equal(server.connections, 2);

    mark = harness.mark();
    flows = change(flows, "input-main", { name: "changed flow" });
    await harness.deploy(flows, "flows");
    await harness.waitStatus(mark, "ack-main", "connected");
    await settled(server);
    assert.notEqual(harness.node("ack-main"), ackBeforeNodes);
    assertStatusSequence(harness, mark, "ack-main", "connected");
    assert.equal(server.connections, 3);
  });

  await scenario("changing account reference uses the new server and leaves unused accounts idle", {}, async server => {
    const second = await startImapServer({ password: "alternate-synthetic-password" });
    try {
      let flows = baseFlow(server);
      flows.push(account(second, { id: "account-second", credentials: { username: "fixture-user", password: "alternate-synthetic-password" } }));
      let mark = harness.mark();
      await harness.deploy(flows);
      await harness.waitStatus(mark, "input-main", "connected");
      await settled(server);
      assert.equal(second.connections, 0);
      flows = change(withoutCredentials(flows), "input-main", { account: "account-second" });
      mark = harness.mark();
      await harness.deploy(flows, "nodes");
      await harness.waitStatus(mark, "input-main", "connected");
      await settled(second);
      assert.equal(server.connections, 1);
      assert.equal(second.connections, 1);
      assert.equal(second.authAttempts[0].accepted, true);
    } finally { await second.close(); }
  });

  await scenario("TLS certificate verification follows the deployed account setting", { tls: true }, async server => {
    let flows = change(baseFlow(server), "account-main", { secure: true, tlsRejectUnauthorized: false });
    let mark = harness.mark();
    await harness.deploy(flows);
    await harness.waitStatus(mark, "input-main", "connected");
    await settled(server);
    mark = harness.mark();
    flows = change(withoutCredentials(flows), "account-main", { tlsRejectUnauthorized: true });
    await harness.deploy(flows, "nodes");
    await harness.waitStatus(mark, "input-main", "TLS certificate error");
    assertStatusSequence(harness, mark, "input-main", "TLS certificate error", "red");
  });

  await scenario("disabled nodes, disabled flows and unused accounts open zero connections", {}, async server => {
    for (const variant of ["node", "flow", "unused"]) {
      let flows = baseFlow(server);
      if (variant === "node") flows = change(flows, "input-main", { d: true });
      if (variant === "flow") flows = change(flows, "flow-main", { disabled: true });
      if (variant === "unused") flows = flows.filter(node => node.id !== "input-main");
      const mark = harness.mark();
      await harness.deploy(flows);
      await delay(40);
      assert.equal(server.connections, 0, variant);
      assert.equal(harness.statusesSince(mark).some(status => status.text === "checking connection"), false);
    }
  });

  for (const scope of ["global", "local"]) {
    await scenario(`two subflows with ${scope} account scope share only identical runtime account instances`, { authDelayMs: 100 }, async server => {
      const template = "subflow-fixture";
      const flows = [
        { id: "flow-main", type: "tab", label: "Subflow integration" },
        { id: template, type: "subflow", name: "IMAP synthetic", in: [], out: [], env: [], meta: {}, color: "#DDAA99" },
        account(server, scope === "local" ? { z: template } : {}),
        input({ id: "subflow-input", z: template, wires: [[], [], []] }),
        ...statusCollector(template, "-subflow"),
        { id: "subflow-one", type: `subflow:${template}`, z: "flow-main", x: 100, y: 100, wires: [] },
        { id: "subflow-two", type: `subflow:${template}`, z: "flow-main", x: 100, y: 200, wires: [] }
      ];
      const mark = harness.mark();
      await harness.deploy(flows);
      await waitFor(() => new Set(harness.collectedSince(mark, "status")
        .filter(msg => msg.status.text === "connected" && msg.status.source.type === "imap-email in")
        .map(msg => msg.status.source.id)).size === 2, "both actual subflow instances connected");
      await settled(server);
      assert.equal(server.connections, scope === "global" ? 1 : 2);
      assert.ok(server.authAttempts.every(attempt => attempt.accepted));
    });
  }

  await scenario("redeploy aborts a slow probe promptly without late status or warning", { authDelayMs: 400 }, async server => {
    let flows = baseFlow(server, { ack: true });
    let mark = harness.mark();
    await harness.deploy(flows);
    await server.waitFor(() => server.authAttempts.length === 1);
    server.options.authDelayMs = 0;
    const oldNode = harness.node("input-main");
    mark = harness.mark();
    const started = Date.now();
    await harness.deploy(withoutCredentials(flows), "full");
    await harness.waitStatus(mark, "input-main", "connected");
    assert.ok(Date.now() - started < 1500, "redeploy does not await a stuck connect promise");
    assert.notEqual(harness.node("input-main"), oldNode);
    await delay(500);
    await settled(server);
    assert.equal(server.connections, 2);
    assertStatusSequence(harness, mark, "input-main", "connected");
    assert.equal(harness.warningsSince(mark).length, 0);
  });

  await scenario("removing one consumer preserves the probe for another; removing the last aborts it", { authDelayMs: 300 }, async server => {
    let flows = baseFlow(server, { ack: true });
    const mark = harness.mark();
    await harness.deploy(flows);
    await server.waitFor(() => server.authAttempts.length === 1);
    flows = withoutCredentials(flows).filter(node => node.id !== "input-main");
    await harness.deploy(flows, "nodes");
    await harness.waitStatus(mark, "ack-main", "connected");
    await settled(server);
    assert.equal(server.connections, 1);
    assert.equal(harness.statusesSince(mark, "input-main").some(status => status.text === "connected"), false);

    const lastMark = harness.mark();
    await harness.deploy(change(flows, "ack-main", { name: "restart last consumer" }), "nodes");
    await server.waitFor(() => server.authAttempts.length === 2);
    await harness.deploy(flows.filter(node => node.id !== "ack-main"), "nodes");
    await server.waitFor(() => server.activeSockets.size === 0);
    await delay(350);
    assert.equal(harness.statusesSince(lastMark, "ack-main").some(status => status.text === "connected"), false);
    assert.equal(harness.warningsSince(lastMark).length, 0);
  });

  await scenario("real download and immediate ACK retain both business statuses when the slower probe completes", { authDelayMs: 600 }, async server => {
    const mark = harness.mark();
    await harness.deploy(baseFlow(server, { ack: true }));
    await server.waitFor(() => server.authAttempts.length === 1);
    server.options.authDelayMs = 0;
    harness.node("input-main").receive({ payload: "synthetic trigger" });
    await waitFor(() => harness.collectedSince(mark, "output").length === 1, "real downloaded email before initial probe completes");
    const message = harness.collectedSince(mark, "output")[0];
    assert.ok(message.imap.ackToken.signature);
    harness.node("ack-main").receive(message);
    await harness.waitStatus(mark, "ack-main", "ACK ok 1, err 0, pending 0");
    const inputStatusBefore = harness.statusesSince(mark, "input-main").at(-1);
    const ackStatusBefore = harness.statusesSince(mark, "ack-main").at(-1);
    assert.ok(inputStatusBefore.text.startsWith("sent 1"));
    assert.equal(server.commands.some(command => command.connectionId === 1 && command.operation === "LOGOUT"), false,
      "both business operations must finish before the delayed startup probe");
    await server.waitFor(() => server.commands.some(command => command.connectionId === 1 && command.operation === "LOGOUT"));
    await settled(server);
    assert.deepEqual(harness.statusesSince(mark, "input-main").at(-1), inputStatusBefore);
    assert.deepEqual(harness.statusesSince(mark, "ack-main").at(-1), ackStatusBefore);
    for (const id of ["input-main", "ack-main"]) {
      assert.equal(harness.statusesSince(mark, id).some(status => status.text === "connected"), false);
    }
    assert.equal(server.connections, 3, "one shared probe, one input connection and one ACK connection");
    assert.equal(harness.collectedSince(mark, "stats").length, 1);
    assert.equal(harness.collectedSince(mark, "output").length, 1);
    assert.equal(harness.collectedSince(mark, "ack").length, 1);
    assert.equal(harness.collectedSince(mark, "error").length, 0);
    assert.ok(server.mailboxes.get("INBOX")[0].flags.has("\\Seen"));
    assert.equal(harness.warningsSince(mark).length, 0);
  });

  await scenario("a shorter socket timeout ends hanging authentication once for all consumers", { auth: "hang" }, async server => {
    const flows = change(baseFlow(server, { ack: true }), "account-main", { socketTimeout: 1000 });
    const mark = harness.mark();
    const started = Date.now();
    await harness.deploy(flows);
    await Promise.all([
      harness.waitStatus(mark, "input-main", "connection timeout"),
      harness.waitStatus(mark, "ack-main", "connection timeout")
    ]);
    await settled(server);
    assert.ok(Date.now() - started < 5000, "the configured inactivity timeout fires before the 30-second overall deadline");
    assert.equal(server.connections, 1);
    assert.equal(server.authAttempts.length, 1);
    assert.equal(server.activeSockets.size, 0);
    for (const id of ["input-main", "ack-main"]) {
      assertStatusSequence(harness, mark, id, "connection timeout", "red");
    }
    assert.equal(harness.warningsSince(mark).length, 1, "one warning per shared failed probe");
    assert.equal(harness.collectedSince(mark).filter(msg => !msg.status).length, 0);
    assert.equal(server.commands.some(command => /SELECT|FETCH|SEARCH|STORE|COPY|MOVE|EXPUNGE/.test(command.operation)), false);
  });

  await scenario("a failed initial probe does not block later real input and ACK processing", { auth: "fail" }, async server => {
    const flows = baseFlow(server, { ack: true });
    const mark = harness.mark();
    await harness.deploy(flows);
    await harness.waitStatus(mark, "input-main", "authentication failed");
    await settled(server);
    server.options.auth = "ok";
    const workMark = harness.mark();
    harness.node("input-main").receive({ payload: "synthetic retry" });
    await waitFor(() => harness.collectedSince(workMark, "output").length === 1, "real downloaded email");
    const message = harness.collectedSince(workMark, "output")[0];
    assert.ok(message.imap.ackToken.signature);
    assert.match(message.payload, /Synthetic body/);
    harness.node("ack-main").receive(message);
    await waitFor(() => harness.collectedSince(workMark, "ack").length === 1, "real ACK completion");
    await settled(server);
    assert.equal(harness.collectedSince(workMark, "error").length, 0);
    assert.ok(harness.statusesSince(workMark, "input-main").at(-1).text.startsWith("sent 1"));
    assert.equal(harness.statusesSince(workMark, "ack-main").at(-1).text, "ACK ok 1, err 0, pending 0");
    assert.ok(server.mailboxes.get("INBOX")[0].flags.has("\\Seen"), "ACK changed the real synthetic server flag");
  });

  await scenario("an existing invalid ACK action remains visible throughout deployment", {}, async server => {
    let flows = baseFlow(server, { ack: true });
    flows = change(flows, "ack-main", { actionMode: "move", targetMailbox: "" });
    const mark = harness.mark();
    await harness.deploy(flows);
    await harness.waitStatus(mark, "input-main", "connected");
    await settled(server);
    const statuses = harness.statusesSince(mark, "ack-main");
    assert.ok(statuses.length > 0);
    assert.ok(statuses.every(status => status.fill === "red" && !["connected", "checking connection"].includes(status.text)));
  });

  await scenario("a fresh Node-RED process loads persisted flows and credentials and probes without deploy or trigger", {}, async server => {
    const mark = harness.mark();
    await harness.deploy(baseFlow(server, { ack: true }));
    await harness.waitStatus(mark, "input-main", "connected");
    await settled(server);
    const result = await promisify(execFile)(process.execPath,
      [path.join(__dirname, "node-red-startup-worker.js"), harness.userDir],
      { timeout: 10000, env: process.env });
    const restarted = JSON.parse(result.stdout);
    assert.deepEqual(restarted.input.map(status => status.text), ["checking connection", "connected"]);
    assert.deepEqual(restarted.ack.map(status => status.text), ["checking connection", "connected"]);
    assert.equal(restarted.warnings, 0);
    assert.equal(restarted.outputMessages, 0);
    assert.equal(restarted.statusMessages.length, 4);
    assert.equal(server.connections, 2, "startup adds one fresh shared probe");
    assert.equal(server.authAttempts.length, 2);
    assert.ok(server.authAttempts.every(attempt => attempt.accepted));
  });
});
