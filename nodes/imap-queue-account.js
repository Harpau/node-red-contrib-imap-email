"use strict";

const { ImapFlow } = require("imapflow");
const { parseNumber, parseBoolean } = require("../lib/imap-utils");

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

    return new ImapFlow({
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
  };

  RED.nodes.registerType("imap queue account", ImapQueueAccountNode, {
    credentials: {
      username: { type: "text" },
      password: { type: "password" },
      accessToken: { type: "password" }
    }
  });
};
