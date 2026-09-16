"use strict";

const { safeClose } = require("./imap-connection");

const CHECK_TIMEOUT_MS = 30000;
const CHECKING = { fill: "yellow", shape: "ring", text: "checking connection" };
const CONNECTED = { fill: "green", shape: "dot", text: "connected" };
const ERROR_TEXT = new Map([
  ["IMAP_EMAIL_MISSING_HOST", "missing host"],
  ["IMAP_EMAIL_MISSING_USERNAME", "missing username"],
  ["IMAP_EMAIL_MISSING_CREDENTIALS", "missing credentials"],
  ["ENOTFOUND", "host not found"],
  ["EAI_AGAIN", "host not found"],
  ["ECONNREFUSED", "connection refused"],
  ...["CONNECT_TIMEOUT", "GREETING_TIMEOUT", "UPGRADE_TIMEOUT", "ETIMEOUT", "ETIMEDOUT", "SocketTimeout", "IMAP_EMAIL_CHECK_TIMEOUT"]
    .map((code) => [code, "connection timeout"]),
  ...["ECONNRESET", "ECONNABORTED", "EPIPE", "NoConnection", "ClosedAfterConnectTLS", "ClosedAfterConnectText", "IMAP_EMAIL_CHECK_CLOSED"]
    .map((code) => [code, "connection lost"]),
  ...["CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "CERT_REVOKED", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "ERR_TLS_CERT_ALTNAME_INVALID"]
    .map((code) => [code, "TLS certificate error"])
]);

// Only fixed, public error categories leave this module. A server error's
// message, response, code or OAuth metadata can contain credentials/endpoints.
function connectionErrorStatus(error) {
  const code = typeof (error && error.code) === "string" ? error.code : "";
  let text = ERROR_TEXT.get(code) || "connection failed";
  if (error && (error.authenticationFailed || code === "AuthenticationFailure")) {
    text = "authentication failed";
  } else if (!ERROR_TEXT.has(code) && (error && error.tlsFailed || /^(ERR_TLS_|ERR_SSL_)/.test(code))) {
    text = "TLS connection error";
  }
  return { fill: "red", shape: "ring", text };
}

function checkError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

// One coordinator per account object, never per host/username or persistent ID.
// The scheduler is injectable for deterministic deadline/cancellation tests.
function createConnectionChecker({ createClient, warn }, scheduler = {}) {
  const schedule = scheduler.setImmediate || setImmediate;
  const unschedule = scheduler.clearImmediate || clearImmediate;
  const startTimer = scheduler.setTimeout || setTimeout;
  const stopTimer = scheduler.clearTimeout || clearTimeout;
  let current = null;
  let closed = false;

  function warnOnce(probe, text) {
    if (probe.warned) return;
    probe.warned = true;
    try { if (warn) warn(`IMAP connection check: ${text}`); } catch (ignored) { /* logging must not throw */ }
  }

  function deliver(probe, status) {
    for (const subscriber of Array.from(probe.subscribers)) {
      if (!probe.subscribers.has(subscriber)) continue;
      try { subscriber({ ...status }); } catch (ignored) { warnOnce(probe, "status callback failed"); }
    }
  }

  function finish(probe, error, cancelled = false) {
    if (probe.settled) return;
    probe.settled = true;
    if (current === probe) current = null;
    if (probe.start !== null) unschedule(probe.start);
    if (probe.closeCheck !== null) unschedule(probe.closeCheck);
    if (probe.timer !== null) stopTimer(probe.timer);
    probe.start = probe.closeCheck = probe.timer = null;
    const client = probe.client;
    probe.client = null;
    if (client && probe.onClose) client.removeListener("close", probe.onClose);
    probe.onClose = null;
    // Mark settled before close(): closing may synchronously emit error/close.
    safeClose(client);
    if (!cancelled) {
      const status = error ? connectionErrorStatus(error) : CONNECTED;
      if (error) warnOnce(probe, status.text);
      deliver(probe, status);
    }
    probe.subscribers.clear();
  }

  function begin(probe) {
    probe.start = null;
    if (probe.settled || closed) return;
    probe.started = true;
    deliver(probe, CHECKING);
    if (probe.settled) return;
    probe.timer = startTimer(() => finish(probe, checkError("IMAP_EMAIL_CHECK_TIMEOUT")), CHECK_TIMEOUT_MS);
    try {
      const client = createClient({
        verifyOnly: true,
        context: "imap email connection check",
        onError: (error) => finish(probe, error || checkError("IMAP_EMAIL_CHECK_FAILED"))
      });
      if (probe.settled) { safeClose(client); return; }
      probe.client = client;
      probe.onClose = () => {
        // verifyOnly normally closes BEFORE connect() resolves. Let its promise
        // settle; only an unauthenticated close is an early transport failure.
        if (probe.settled || probe.closeCheck !== null) return;
        probe.closeCheck = schedule(() => {
          probe.closeCheck = null;
          if (!probe.settled && !client.authenticated) finish(probe, checkError("IMAP_EMAIL_CHECK_CLOSED"));
        });
      };
      client.once("close", probe.onClose);
      Promise.resolve().then(() => {
        if (!probe.settled) return client.connect();
      }).then(() => {
        if (!probe.settled) finish(probe, client.authenticated ? null : checkError("IMAP_EMAIL_CHECK_CLOSED"));
      }, (error) => finish(probe, error || checkError("IMAP_EMAIL_CHECK_FAILED")));
    } catch (error) {
      finish(probe, error || checkError("IMAP_EMAIL_CHECK_FAILED"));
    }
  }

  return {
    subscribe(callback) {
      if (closed) return () => {};
      let probe = current;
      if (!probe) {
        probe = { subscribers: new Set(), client: null, onClose: null, start: null, closeCheck: null, timer: null,
          started: false, settled: false, warned: false };
        current = probe;
        probe.start = schedule(() => begin(probe));
      }
      probe.subscribers.add(callback);
      if (probe.started) {
        try { callback({ ...CHECKING }); } catch (ignored) { warnOnce(probe, "status callback failed"); }
      }
      return () => {
        probe.subscribers.delete(callback);
        if (!probe.settled && probe.subscribers.size === 0) finish(probe, null, true);
      };
    },
    close() {
      closed = true;
      if (current) finish(current, null, true);
    }
  };
}

// Business status is monotonic: once work or validation has set a status, no
// later startup-check result may replace it, even after that work has finished.
function createConnectionStatus(node) {
  let revision = 0;
  let closed = false;
  let pendingStart = null;
  let unsubscribe = null;
  return {
    set(status) {
      revision += 1;
      if (!closed) node.status(status);
    },
    start(account) {
      pendingStart = setImmediate(() => {
        pendingStart = null;
        if (closed) return;
        const leave = account.requestConnectionCheck((status) => {
          if (!closed && revision === 0) node.status(status);
        });
        // Joining an already running check can deliver its status synchronously.
        // A status listener may close this node before subscribe returns.
        if (closed) leave();
        else unsubscribe = leave;
      });
    },
    close() {
      closed = true;
      revision += 1;
      if (pendingStart !== null) clearImmediate(pendingStart);
      pendingStart = null;
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
    }
  };
}

module.exports = { CHECK_TIMEOUT_MS, connectionErrorStatus, createConnectionChecker, createConnectionStatus };
