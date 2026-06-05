"use strict";

const { ImapFlow } = require("imapflow");
const { parseNumber, parseBoolean } = require("../lib/imap-utils");

function errorMessage(err) {
  if (!err) {
    return "Unknown IMAP client error";
  }

  const message = err.message || String(err);
  return err.code ? `${message} (${err.code})` : message;
}

module.exports = function registerImapQueueAccount(RED) {
  function ImapQueueAccountNode(config) {
    RED.nodes.createNode(this, config);

    this.name = config.name || "";
    this.host = config.host || "imap.strato.de";
    this.port = parseNumber(config.port, 993, 1, 65535);
    this.secure = parseBoolean(config.secure, true);
    this.tlsRejectUnauthorized = parseBoolean(config.tlsRejectUnauthorized, true);
    this.connectionTimeout = parseNumber(config.connectionTimeout, 30000, 1000, 300000);
    this.greetingTimeout = parseNumber(config.greetingTimeout, 30000, 1000, 300000);
    this.socketTimeout = parseNumber(config.socketTimeout, 300000, 1000, 3600000);
  }

  ImapQueueAccountNode.prototype.getUsername = function getUsername() {
    return this.credentials && this.credentials.username || "";
  };

  ImapQueueAccountNode.prototype.createClient = function createClient(options = {}) {
    const user = options.user || this.getUsername();
    const accessToken = options.accessToken || this.credentials && this.credentials.accessToken;
    const password = options.password || this.credentials && this.credentials.password;

    if (!user) {
      throw new Error("IMAP username is missing in imap queue account credentials");
    }

    const auth = accessToken
      ? { user, accessToken }
      : { user, pass: password || "" };

    if (!accessToken && !auth.pass) {
      throw new Error("IMAP password/access token is missing in imap queue account credentials");
    }

    const client = new ImapFlow({
      host: options.host || this.host,
      port: options.port || this.port,
      secure: options.secure !== undefined ? options.secure : this.secure,
      auth,
      logger: false,
      connectionTimeout: this.connectionTimeout,
      greetingTimeout: this.greetingTimeout,
      socketTimeout: this.socketTimeout,
      tls: {
        rejectUnauthorized: this.tlsRejectUnauthorized
      }
    });

    const ownerNode = options.node || this;
    const context = options.context || "imap queue client";

    // ImapFlow is an EventEmitter and may emit an asynchronous 'error' event
    // after the awaited API call has already returned or while another promise is
    // pending. Without an 'error' listener Node.js treats this as an uncaught
    // exception and the Node-RED runtime can exit. Keep this handler deliberately
    // small and non-throwing.
    client.on("error", (err) => {
      const message = `${context} IMAP connection error: ${errorMessage(err)}`;

      try {
        if (typeof options.onError === "function") {
          options.onError(err);
        } else if (ownerNode && typeof ownerNode.warn === "function") {
          ownerNode.warn(message);
        }
      } catch (handlerErr) {
        // Never throw from an EventEmitter error handler.
        try {
          if (ownerNode && typeof ownerNode.warn === "function") {
            ownerNode.warn(`${context} IMAP error handler failed: ${errorMessage(handlerErr)}`);
          }
        } catch (ignored) {
          // ignore
        }
      }

      // A reset IMAP/TLS connection is no longer useful for the current command.
      // closeAfter() is designed for use from error handlers and lets the current
      // tick finish before the socket is torn down.
      try {
        if (typeof client.closeAfter === "function") {
          client.closeAfter();
        }
      } catch (ignored) {
        // ignore
      }
    });

    return client;
  };

  RED.nodes.registerType("imap queue account", ImapQueueAccountNode, {
    credentials: {
      username: { type: "text" },
      password: { type: "password" },
      accessToken: { type: "password" }
    }
  });
};
