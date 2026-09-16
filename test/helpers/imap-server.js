"use strict";

// A deliberately small IMAP peer for offline protocol/lifecycle tests. This is
// not a general-purpose mail server. All credentials and messages are synthetic.
const net = require("node:net");
const tls = require("node:tls");
const fs = require("node:fs");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const DEFAULT_SOURCE = Buffer.from([
  "From: Sender <sender@example.test>",
  "To: Receiver <receiver@example.test>",
  "Subject: Synthetic fixture message",
  "Message-ID: <fixture@example.test>",
  "Date: Tue, 15 Sep 2026 10:00:00 +0000",
  "Content-Type: text/plain; charset=utf-8",
  "", "Synthetic body.", ""
].join("\r\n"));

function quoted(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function tokens(value) {
  return [...String(value).matchAll(/"((?:\\.|[^"\\])*)"|([^\s]+)/g)]
    .map((match) => match[1] === undefined ? match[2] : match[1].replace(/\\(.)/g, "$1"));
}

function inRange(value, expression, maximum) {
  return String(expression).split(",").some((part) => {
    const ends = part.split(":").map((entry) => entry === "*" ? maximum : Number(entry));
    return ends.length === 1 ? value === ends[0] : value >= Math.min(...ends) && value <= Math.max(...ends);
  });
}

async function startImapServer(input = {}) {
  const options = Object.assign({
    username: "fixture-user", password: "fixture-password", accessToken: "fixture-token",
    auth: "ok", preauth: false, namespace: true, logout: "ok", greeting: "ok",
    authDelayMs: 0, logoutDelayMs: 0, greetingDelayMs: 0,
    capabilities: ["IMAP4rev1", "AUTH=PLAIN", "AUTH=XOAUTH2", "SASL-IR", "UIDPLUS", "MOVE"],
    messages: [{ uid: 1, source: DEFAULT_SOURCE, flags: [] }], failOperations: {}
  }, input);
  const mailboxes = new Map([["INBOX", options.messages.map((message, index) => ({
    uid: message.uid || index + 1, source: Buffer.from(message.source || DEFAULT_SOURCE),
    flags: new Set(message.flags || [])
  }))]]);
  const state = {
    host: "127.0.0.1", port: null, options, commands: [], connections: 0,
    authAttempts: [], activeSockets: new Set(), mailboxes, timers: new Set(),
    async waitFor(predicate, timeoutMs = 3000) {
      const deadline = Date.now() + timeoutMs;
      while (!predicate(state)) {
        if (Date.now() >= deadline) throw new Error("Timed out waiting for synthetic IMAP fixture");
        await delay(5);
      }
    }
  };
  let stopped = false;
  const later = (ms, callback) => {
    if (!ms) { callback(); return; }
    const timer = setTimeout(() => { state.timers.delete(timer); if (!stopped) callback(); }, ms);
    state.timers.add(timer);
  };
  const capabilities = () => [...options.capabilities, ...(options.namespace ? ["NAMESPACE"] : [])].join(" ");

  const accept = (socket) => {
    const connectionId = ++state.connections;
    state.activeSockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => state.activeSockets.delete(socket));
    let buffered = "";
    let selected = null;
    let pendingAuth = null;
    let authenticated = !!options.preauth;
    const write = (value) => { if (!socket.destroyed && socket.writable) socket.write(value); };
    const finish = (tag, status = "OK", text = "completed") => write(`${tag} ${status} ${text}\r\n`);
    const auth = (tag, mechanism, response) => {
      let username;
      let secret;
      if (mechanism === "LOGIN") [username, secret] = tokens(response);
      else if (mechanism === "PLAIN") [, username, secret] = Buffer.from(response, "base64").toString().split("\0");
      else {
        const data = Buffer.from(response, "base64").toString();
        username = /user=([^\x01]*)/.exec(data)?.[1];
        secret = /auth=Bearer ([^\x01]*)/.exec(data)?.[1];
      }
      const accepted = options.auth === "ok" && username === options.username
        && secret === (mechanism === "XOAUTH2" ? options.accessToken : options.password);
      state.authAttempts.push({ connectionId, username, mechanism, accepted });
      if (options.auth === "hang") return;
      if (options.auth === "close") { socket.destroy(); return; }
      later(options.authDelayMs, () => {
        authenticated = accepted;
        finish(tag, accepted ? "OK" : "NO", accepted ? "authenticated" : "[AUTHENTICATIONFAILED] Synthetic authentication failure");
      });
    };
    const selectedMessages = () => mailboxes.get(selected) || [];
    const matchedMessages = (range, byUid) => {
      const messages = selectedMessages();
      const maximum = byUid ? Math.max(0, ...messages.map((message) => message.uid)) : messages.length;
      return messages.map((message, index) => ({ message, sequence: index + 1 }))
        .filter(({ message, sequence }) => inRange(byUid ? message.uid : sequence, range, maximum));
    };
    const handle = (line) => {
      if (pendingAuth) { const saved = pendingAuth; pendingAuth = null; auth(saved.tag, saved.mechanism, line); return; }
      const match = /^(\S+) (UID )?([A-Za-z]+)(?: (.*))?$/.exec(line);
      if (!match) return;
      const [, tag, uid, verb, rawArgs = ""] = match;
      const operation = `${uid || ""}${verb}`.toUpperCase();
      const args = ["LOGIN", "AUTHENTICATE"].includes(operation) ? "[synthetic credentials redacted]" : rawArgs;
      const command = { connectionId, tag, operation, args };
      state.commands.push(command);
      const configuredFailure = options.failOperations[operation];
      const failure = typeof configuredFailure === "function"
        ? configuredFailure({ command, connectionId, mailbox: selected, messages: selectedMessages(), socket, state })
        : configuredFailure;
      if (failure) {
        finish(tag, typeof failure === "object" ? failure.status : failure === true ? "NO" : failure,
          typeof failure === "object" ? failure.text : "Synthetic operation failure");
        return;
      }
      if (operation === "CAPABILITY") { write(`* CAPABILITY ${capabilities()}\r\n`); finish(tag); return; }
      if (operation === "LOGIN") { auth(tag, "LOGIN", rawArgs); return; }
      if (operation === "AUTHENTICATE") {
        const [mechanism, response] = rawArgs.split(" ");
        if (response) auth(tag, mechanism, response);
        else { pendingAuth = { tag, mechanism }; write("+ \r\n"); }
        return;
      }
      if (operation === "LOGOUT") {
        if (options.logout === "hang") return;
        later(options.logoutDelayMs, () => {
          if (options.logout === "close") { socket.destroy(); return; }
          if (options.logout === "no" || options.logout === "bad") { finish(tag, options.logout.toUpperCase(), "Synthetic logout refusal"); return; }
          write(`* BYE synthetic logout\r\n${tag} OK logout completed\r\n`);
          socket.end();
        });
        return;
      }
      if (!authenticated) { finish(tag, "NO", "Authenticate first"); return; }
      if (operation === "NAMESPACE") { write('* NAMESPACE (("" "/")) NIL NIL\r\n'); finish(tag); return; }
      if (operation === "LIST" || operation === "LSUB") {
        const [, requested = ""] = tokens(rawArgs);
        if (requested === "") write('* LIST (\\Noselect) "/" ""\r\n');
        else if (requested === "*" || requested === "%") {
          for (const mailbox of mailboxes.keys()) write(`* ${operation} () "/" ${quoted(mailbox)}\r\n`);
        } else if (mailboxes.has(requested)) write(`* ${operation} () "/" ${quoted(requested)}\r\n`);
        finish(tag); return;
      }
      if (operation === "CREATE") { const [name] = tokens(rawArgs); if (!mailboxes.has(name)) mailboxes.set(name, []); finish(tag); return; }
      if (operation === "SELECT" || operation === "EXAMINE") {
        const [name] = tokens(rawArgs);
        if (!mailboxes.has(name)) { finish(tag, "NO", "Missing mailbox"); return; }
        selected = name;
        const messages = selectedMessages();
        const next = Math.max(0, ...messages.map((message) => message.uid)) + 1;
        write(`* FLAGS (\\Seen \\Answered \\Flagged \\Deleted)\r\n* ${messages.length} EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY 123] stable\r\n* OK [UIDNEXT ${next}] next\r\n* OK [PERMANENTFLAGS (\\Seen \\Answered \\Flagged \\Deleted \\*)] flags\r\n`);
        finish(tag, "OK", "[READ-WRITE] selected"); return;
      }
      if (operation === "FETCH" || operation === "UID FETCH") {
        const split = rawArgs.indexOf(" ");
        const range = rawArgs.slice(0, split);
        const query = rawArgs.slice(split + 1);
        for (const { message, sequence } of matchedMessages(range, !!uid)) {
          const fields = [`UID ${message.uid}`];
          if (/\bFLAGS\b/.test(query)) fields.push(`FLAGS (${[...message.flags].join(" ")})`);
          if (/RFC822\.SIZE/.test(query)) fields.push(`RFC822.SIZE ${message.source.length}`);
          if (/INTERNALDATE/.test(query)) fields.push('INTERNALDATE "15-Sep-2026 10:00:00 +0000"');
          if (/ENVELOPE/.test(query)) fields.push('ENVELOPE ("Tue, 15 Sep 2026 10:00:00 +0000" "Synthetic fixture message" (("Sender" NIL "sender" "example.test")) NIL NIL (("Receiver" NIL "receiver" "example.test")) NIL NIL NIL "<fixture@example.test>")');
          const body = /BODY(?:\.PEEK)?\[\](?:<(\d+)\.(\d+)>)?/.exec(query);
          if (body) {
            const start = options.ignorePartial ? 0 : Number(body[1]) || 0;
            const chunk = options.ignorePartial ? message.source : message.source.subarray(start, body[2] ? start + Number(body[2]) : undefined);
            write(`* ${sequence} FETCH (${fields.join(" ")} BODY[]${body[1] === undefined || options.ignorePartial ? "" : `<${start}>`} {${chunk.length}}\r\n`);
            write(chunk); write(")\r\n");
          } else write(`* ${sequence} FETCH (${fields.join(" ")})\r\n`);
        }
        finish(tag); return;
      }
      if (operation === "UID SEARCH") {
        // Support only an explicit finite UID criterion. This fixture must not
        // silently accept a regression to SEARCH ALL or a wildcard range.
        const search = /^UID ([1-9]\d*(?::[1-9]\d*)?(?:,[1-9]\d*(?::[1-9]\d*)?)*)$/.exec(rawArgs);
        if (!search) { finish(tag, "BAD", "Only a bounded UID criterion is supported"); return; }
        const uids = matchedMessages(search[1], true).map(({ message }) => message.uid);
        write(`* SEARCH${uids.length ? ` ${uids.join(" ")}` : ""}\r\n`);
        finish(tag); return;
      }
      if (operation === "STORE" || operation === "UID STORE") {
        const store = /^(\S+) ([+-]?FLAGS(?:\.SILENT)?) \(([^)]*)\)/.exec(rawArgs);
        if (!store) { finish(tag, "BAD", "Unsupported store syntax"); return; }
        const [, range, action, value] = store;
        for (const { message } of matchedMessages(range, !!uid)) {
          const flags = value.split(" ").filter(Boolean);
          if (action.startsWith("+")) flags.forEach((flag) => message.flags.add(flag));
          else if (action.startsWith("-")) flags.forEach((flag) => message.flags.delete(flag));
          else message.flags = new Set(flags);
        }
        finish(tag); return;
      }
      if (["COPY", "UID COPY", "MOVE", "UID MOVE"].includes(operation)) {
        const [range, target] = tokens(rawArgs);
        if (!mailboxes.has(target)) { finish(tag, "NO", "[TRYCREATE] Missing target"); return; }
        const matched = matchedMessages(range, !!uid);
        const targetMessages = mailboxes.get(target);
        const sourceUids = [];
        const targetUids = [];
        for (const { message } of matched) {
          const copiedUid = Math.max(0, ...targetMessages.map((entry) => entry.uid)) + 1;
          targetMessages.push({ uid: copiedUid, source: Buffer.from(message.source), flags: new Set(message.flags) });
          sourceUids.push(message.uid); targetUids.push(copiedUid);
        }
        if (operation.endsWith("MOVE")) {
          for (const { message, sequence } of [...matched].reverse()) {
            selectedMessages().splice(selectedMessages().indexOf(message), 1);
            write(`* ${sequence} EXPUNGE\r\n`);
          }
        }
        finish(tag, "OK", sourceUids.length ? `[COPYUID 123 ${sourceUids.join(",")} ${targetUids.join(",")}] completed` : "completed"); return;
      }
      if (operation === "EXPUNGE" || operation === "UID EXPUNGE") {
        const matched = matchedMessages(rawArgs || "1:*", !!uid).filter(({ message }) => message.flags.has("\\Deleted"));
        for (const { message, sequence } of [...matched].reverse()) {
          selectedMessages().splice(selectedMessages().indexOf(message), 1);
          write(`* ${sequence} EXPUNGE\r\n`);
        }
        finish(tag); return;
      }
      if (["NOOP", "CLOSE", "UNSELECT"].includes(operation)) { finish(tag); return; }
      finish(tag, "BAD", `Unsupported synthetic command ${operation}`);
    };
    socket.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      let end;
      while ((end = buffered.indexOf("\r\n")) >= 0) {
        const line = buffered.slice(0, end); buffered = buffered.slice(end + 2); handle(line);
      }
    });
    if (options.greeting === "close") socket.destroy();
    else if (options.greeting !== "hang") later(options.greetingDelayMs, () => write(`* ${options.preauth ? "PREAUTH" : "OK"} [CAPABILITY ${capabilities()}] synthetic IMAP ready\r\n`));
  };

  let server;
  if (options.tls) {
    const tlsOptions = options.tls === true ? {
      key: fs.readFileSync(path.join(__dirname, "localhost-key.pem")),
      cert: fs.readFileSync(path.join(__dirname, "localhost-cert.pem"))
    } : options.tls;
    state.ca = tlsOptions.cert;
    server = tls.createServer(tlsOptions, accept);
    // Track even failed TLS handshakes so close() never leaves a client behind.
    server.on("connection", (socket) => {
      state.activeSockets.add(socket);
      socket.on("error", () => {});
      socket.on("close", () => state.activeSockets.delete(socket));
    });
  } else server = net.createServer(accept);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, state.host, () => { server.removeListener("error", reject); resolve(); });
  });
  state.port = server.address().port;
  state.close = async () => {
    if (stopped) return;
    stopped = true;
    for (const timer of state.timers) clearTimeout(timer);
    state.timers.clear();
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      for (const socket of state.activeSockets) socket.destroy();
    });
    state.activeSockets.clear();
  };
  return state;
}

module.exports = { startImapServer, DEFAULT_SOURCE };
