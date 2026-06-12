"use strict";

const { ImapFlow } = require("imapflow");
const { parseNumber, parseBoolean } = require("../lib/imap-utils");
const { formatImapError } = require("../lib/imap-connection");

module.exports = function registerImapEmailAccount(RED) {
  function ImapEmailAccountNode(config) {
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

  ImapEmailAccountNode.prototype.getUsername = function getUsername() {
    return this.credentials && this.credentials.username || "";
  };

  ImapEmailAccountNode.prototype.createClient = function createClient(options = {}) {
    const user = options.user || this.getUsername();
    const accessToken = options.accessToken || this.credentials && this.credentials.accessToken;
    const password = options.password || this.credentials && this.credentials.password;

    if (!user) {
      throw new Error("IMAP username is missing in imap email account credentials");
    }

    const auth = accessToken
      ? { user, accessToken }
      : { user, pass: password || "" };

    if (!accessToken && !auth.pass) {
      throw new Error("IMAP password/access token is missing in imap email account credentials");
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
    const context = options.context || "imap email client";

    // ImapFlow is an EventEmitter and may emit an asynchronous 'error' event
    // after the awaited API call has already returned or while another promise is
    // pending. Without an 'error' listener Node.js treats this as an uncaught
    // exception and the Node-RED runtime can exit. Keep this handler deliberately
    // small and non-throwing.
    client.on("error", (err) => {
      const message = `${context} IMAP connection error: ${formatImapError(err)}`;

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
            ownerNode.warn(`${context} IMAP error handler failed: ${formatImapError(handlerErr)}`);
          }
        } catch (ignored) {
          // ignore
        }
      }
    });

    return client;
  };

  RED.nodes.registerType("imap-email account", ImapEmailAccountNode, {
    credentials: {
      username: { type: "text" },
      password: { type: "password" },
      accessToken: { type: "password" }
    }
  });
};
