"use strict";

// This harness uses the real runtime and the separately installed npm tarball.
// It does not register substitute node types or load source-tree runtime files.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");
const { setTimeout: delay } = require("node:timers/promises");

async function waitFor(predicate, description, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail(`Timed out waiting for ${description}`);
}

async function startNodeRed(options = {}) {
  const installDir = path.resolve(process.env.NODE_RED_TEST_DIR || "/private/tmp/imap-email-integration-env");
  const installedRequire = createRequire(path.join(installDir, "package.json"));
  let RED;
  let packagePath;
  try {
    RED = installedRequire("node-red");
    packagePath = path.dirname(installedRequire.resolve("@compeso/node-red-contrib-imap-email/package.json"));
  } catch (error) {
    throw new Error("Install Node-RED and the freshly packed package into NODE_RED_TEST_DIR before running integration tests", { cause: error });
  }
  assert.notEqual(await fs.realpath(packagePath), await fs.realpath(path.resolve(__dirname, "../..")),
    "Integration must load an installed tarball, not an npm link to the source tree");

  const userDir = await fs.mkdtemp(path.join(os.tmpdir(), "imap-email-node-red-"));
  if (options.persistedDir) {
    for (const file of ["flows.json", "flows_cred.json"]) {
      await fs.copyFile(path.join(options.persistedDir, file), path.join(userDir, file));
    }
  }
  const logs = [];
  const statuses = [];
  const messages = [];
  const deployments = [];
  let runtimeStarted = false;
  const server = http.createServer();
  const onStatus = event => statuses.push({ ...event, at: Date.now() });
  const onRuntime = event => {
    if (event.id === "runtime-deploy") deployments.push(event.payload.revision);
    if (event.id === "runtime-state" && event.payload && event.payload.state === "start") runtimeStarted = true;
  };
  RED.events.on("node-status", onStatus);
  RED.events.on("runtime-event", onRuntime);
  RED.init(server, {
    userDir,
    nodesDir: [packagePath],
    flowFile: "flows.json",
    credentialSecret: "synthetic-integration-secret",
    httpAdminRoot: false,
    httpNodeRoot: false,
    editorTheme: { projects: { enabled: false } },
    functionGlobalContext: {
      captureImapIntegration: (kind, msg) => messages.push({ kind, msg, at: Date.now() })
    },
    logging: {
      console: { level: "off" },
      integration: {
        level: "trace", metrics: false, audit: false,
        handler: () => entry => logs.push(entry)
      }
    }
  });
  try {
    await RED.start();
    // RED.start() can resolve before loading the initial credential store/flows.
    // Deploying sooner races that load and silently loses synthetic credentials.
    await waitFor(() => runtimeStarted, "initial runtime flow/credential loading");
  } catch (error) {
    await RED.stop();
    RED.events.removeListener("node-status", onStatus);
    RED.events.removeListener("runtime-event", onRuntime);
    await fs.rm(userDir, { recursive: true, force: true });
    throw error;
  }

  async function deploy(flows, deploymentType = "full") {
    const previousDeploys = deployments.length;
    const result = await RED.runtime.flows.setFlows({
      flows: { flows: structuredClone(flows) }, deploymentType
    });
    await waitFor(() => deployments.slice(previousDeploys).includes(result.rev), "actual runtime deploy completion");
    return result;
  }

  return {
    RED, installDir, packagePath, userDir, logs, statuses, messages,
    deploy,
    node(id) { return RED.nodes.getNode(id); },
    mark() { return { statuses: statuses.length, messages: messages.length, logs: logs.length }; },
    statusesSince(mark, id) {
      return statuses.slice(mark.statuses).filter(event => !id || event.id === id).map(event => event.status || {});
    },
    collectedSince(mark, kind) {
      return messages.slice(mark.messages).filter(event => !kind || event.kind === kind).map(event => event.msg);
    },
    warningsSince(mark) {
      return logs.slice(mark.logs).filter(entry => entry.type && /^imap-email /.test(entry.type) && entry.level <= RED.log.WARN);
    },
    async waitStatus(mark, id, text) {
      await waitFor(() => statuses.slice(mark.statuses).some(event => event.id === id && event.status && event.status.text === text), `${id}: ${text}`);
    },
    async close() {
      try {
        await RED.stop();
      } finally {
        RED.events.removeListener("node-status", onStatus);
        RED.events.removeListener("runtime-event", onRuntime);
        server.close();
        await fs.rm(userDir, { recursive: true, force: true });
      }
    }
  };
}

function collector(id, z, kind) {
  return {
    id, z, type: "function", name: `capture ${kind}`, x: 500, y: 100,
    func: `global.get("captureImapIntegration")(${JSON.stringify(kind)}, msg); return null;`,
    outputs: 1, noerr: 0, initialize: "", finalize: "", libs: [], wires: [[]]
  };
}

function statusCollector(z = "flow-main", suffix = "") {
  const collectorId = `capture-status${suffix}`;
  return [
    { id: `status${suffix}`, z, type: "status", scope: null, x: 300, y: 100, wires: [[collectorId]] },
    collector(collectorId, z, "status")
  ];
}

function account(server, overrides = {}) {
  return {
    id: "account-main", type: "imap-email account", name: "synthetic fixture",
    host: server.host, port: server.port, secure: false, tlsRejectUnauthorized: true,
    connectionTimeout: 2000, greetingTimeout: 2000, socketTimeout: 2000,
    credentials: { username: "fixture-user", password: "fixture-password" },
    ...overrides
  };
}

function input(overrides = {}) {
  return {
    id: "input-main", z: "flow-main", type: "imap-email in", name: "fixture input",
    account: "account-main", mailbox: "INBOX", batchSize: 1, frontWindowSize: 5,
    maxInflight: 5, maxUidPerCommand: 5, expungeDeletedFront: false, diagnostics: "stats",
    x: 160, y: 200, wires: [["capture-output"], ["capture-error"], ["capture-stats"]],
    ...overrides
  };
}

function ack(overrides = {}) {
  return {
    id: "ack-main", z: "flow-main", type: "imap-email ack", name: "fixture ack",
    account: "account-main", actionMode: "flag", seenAction: "set", batchSize: 1, flushMs: 1,
    diagnostics: "stats", x: 160, y: 300,
    wires: [["capture-ack"], ["capture-error"], ["capture-ack-stats"]],
    ...overrides
  };
}

function baseFlow(server, options = {}) {
  return [
    { id: "flow-main", type: "tab", label: "Integration", disabled: false },
    account(server), input(),
    ...(options.ack ? [ack()] : []),
    ...statusCollector(),
    collector("capture-output", "flow-main", "output"),
    collector("capture-stats", "flow-main", "stats"),
    collector("capture-ack", "flow-main", "ack"),
    collector("capture-error", "flow-main", "error"),
    collector("capture-ack-stats", "flow-main", "ack-stats")
  ];
}

function withoutCredentials(flows) {
  return structuredClone(flows).map(node => {
    delete node.credentials;
    return node;
  });
}

module.exports = { startNodeRed, waitFor, delay, collector, statusCollector, account, input, ack, baseFlow, withoutCredentials };
