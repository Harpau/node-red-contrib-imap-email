"use strict";

const TRANSIENT_CONNECTION_CODES = new Set([
  "ClosedAfterConnectTLS",
  "ClosedAfterConnectText",
  "EADDRNOTAVAIL",
  "EAI_AGAIN",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTDOWN",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "NoConnection",
  "SocketTimeout"
]);

function formatImapError(err) {
  if (!err) {
    return "Unknown IMAP client error";
  }

  const message = err.message || String(err);
  return err.code ? `${message} (${err.code})` : message;
}

function isTransientImapConnectionError(err) {
  if (!err) {
    return false;
  }

  if (err.code && TRANSIENT_CONNECTION_CODES.has(String(err.code))) {
    return true;
  }

  const message = String(err.message || err);
  return /connection not available|unexpected close|socket timeout|read eaddrnotavail|read econnreset|getaddrinfo enotfound/i.test(message);
}

function isClientClosed(client) {
  return !!(client && (
    client.isClosed ||
    client.usable === false ||
    client.state === "logout" ||
    client.state === "LOGOUT" ||
    client.socket && client.socket.destroyed ||
    client.writeSocket && client.writeSocket.destroyed
  ));
}

function safeClose(client) {
  if (!client || typeof client.close !== "function") {
    return { ok: true, skipped: true };
  }

  if (client.isClosed) {
    return { ok: true, skipped: true };
  }

  try {
    client.close();
    return { ok: true, skipped: false };
  } catch (err) {
    return { ok: false, skipped: false, error: err };
  }
}

async function safeLogout(client) {
  if (!client || typeof client.logout !== "function") {
    return { ok: true, skipped: true };
  }

  if (isClientClosed(client)) {
    return { ok: true, skipped: true };
  }

  try {
    await client.logout();
    return { ok: true, skipped: false };
  } catch (err) {
    if (isTransientImapConnectionError(err)) {
      safeClose(client);
    }
    return { ok: false, skipped: false, error: err };
  }
}

module.exports = {
  formatImapError,
  isTransientImapConnectionError,
  safeClose,
  safeLogout
};
