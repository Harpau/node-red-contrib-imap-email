"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const { executeAckActionRange } = require("../lib/imap-ack-actions");
const { deleteUidRange } = require("../lib/imap-delete");
const { startImapServer, DEFAULT_SOURCE } = require("./helpers/imap-server");

async function fixture(t, serverOptions = {}, clientOptions = {}) {
  const server = await startImapServer(serverOptions);
  t.after(() => server.close());
  const client = new ImapFlow(Object.assign({
    host: server.host, port: server.port, secure: !!serverOptions.tls,
    doSTARTTLS: false, logger: false, disableAutoIdle: true,
    connectionTimeout: 1500, greetingTimeout: 1500, socketTimeout: 1500,
    auth: { user: "fixture-user", pass: "fixture-password" }
  }, clientOptions));
  const errors = [];
  client.on("error", (error) => errors.push(error));
  t.after(() => client.close());
  return { server, client, errors };
}

function assertProbeCommands(server) {
  const allowed = new Set(["CAPABILITY", "AUTHENTICATE", "LOGIN", "NAMESPACE", "LOGOUT", "LIST"]);
  for (const command of server.commands) {
    assert.ok(allowed.has(command.operation), `Probe must not send ${command.operation}`);
    if (command.operation === "LIST") assert.equal(command.args, '"" ""');
  }
}

test("real ImapFlow verifyOnly authenticates and closes before connect resolves", { timeout: 5000 }, async (t) => {
  const { server, client, errors } = await fixture(t, {}, { verifyOnly: true, includeMailboxes: false });
  const events = [];
  client.on("close", () => events.push("close"));
  await client.connect();
  events.push("resolved");
  assert.deepEqual(events, ["close", "resolved"]);
  assert.equal(server.authAttempts.length, 1);
  assert.equal(server.authAttempts[0].accepted, true);
  assert.ok(server.commands.some((command) => command.operation === "LOGOUT"));
  assertProbeCommands(server);
  assert.deepEqual(errors, []);
  await server.waitFor(() => server.activeSockets.size === 0);
});

test("real ImapFlow verifyOnly uses static OAuth token authentication", { timeout: 5000 }, async (t) => {
  const { server, client } = await fixture(t, {}, {
    verifyOnly: true, auth: { user: "fixture-user", accessToken: "fixture-token" }
  });
  await client.connect();
  assert.deepEqual(server.authAttempts.map(({ mechanism, accepted }) => ({ mechanism, accepted })), [{ mechanism: "XOAUTH2", accepted: true }]);
  assertProbeCommands(server);
});

test("real ImapFlow exposes authenticationFailed on rejected credentials", { timeout: 5000 }, async (t) => {
  const { server, client } = await fixture(t, { auth: "fail" }, { verifyOnly: true });
  await assert.rejects(client.connect(), (error) => error.authenticationFailed === true);
  assert.equal(server.authAttempts.length, 1);
  assert.equal(server.authAttempts[0].accepted, false);
  assertProbeCommands(server);
});

test("real ImapFlow accepts PREAUTH without challenging configured credentials", { timeout: 5000 }, async (t) => {
  const { server, client } = await fixture(t, { preauth: true }, {
    verifyOnly: true, auth: { user: "unused-synthetic", pass: "unused-synthetic" }
  });
  await client.connect();
  assert.equal(server.authAttempts.length, 0);
  assertProbeCommands(server);
});

test("real ImapFlow namespace fallback only requests the empty root listing", { timeout: 5000 }, async (t) => {
  const { server, client } = await fixture(t, { namespace: false }, { verifyOnly: true });
  await client.connect();
  assert.deepEqual(server.commands.filter((command) => command.operation === "LIST").map((command) => command.args), ['"" ""']);
  assertProbeCommands(server);
});

for (const logout of ["no", "bad", "close"]) {
  test(`real ImapFlow public verify contract resolves after logout ${logout}`, { timeout: 5000 }, async (t) => {
    const { server, client } = await fixture(t, { logout }, { verifyOnly: true });
    await client.connect();
    assert.equal(server.authAttempts[0].accepted, true);
    await server.waitFor(() => server.activeSockets.size === 0);
    assertProbeCommands(server);
  });
}

for (const step of ["auth", "logout"]) {
  test(`real ImapFlow hanging ${step} fails at socket timeout and closes`, { timeout: 5000 }, async (t) => {
    const { server, client } = await fixture(t, { [step]: "hang" }, { verifyOnly: true, socketTimeout: 80 });
    await assert.rejects(client.connect(), (error) => error.code === "ETIMEOUT");
    await server.waitFor(() => server.activeSockets.size === 0);
    assertProbeCommands(server);
  });
}

test("real ImapFlow caller close aborts a verify session without late reconnection", { timeout: 5000 }, async (t) => {
  const { server, client } = await fixture(t, { auth: "hang" }, { verifyOnly: true });
  const connection = client.connect();
  // Attach a rejection handler before closing to avoid a timing-dependent
  // unhandled rejection in the test itself.
  const rejected = assert.rejects(connection);
  await server.waitFor(() => server.authAttempts.length === 1);
  client.close();
  await rejected;
  await server.waitFor(() => server.activeSockets.size === 0);
  assert.equal(server.connections, 1);
});

test("real ImapFlow TLS succeeds with a trusted synthetic CA", { timeout: 5000 }, async (t) => {
  const server = await startImapServer({ tls: true });
  t.after(() => server.close());
  const client = new ImapFlow({
    host: server.host, port: server.port, secure: true, logger: false, verifyOnly: true,
    tls: { ca: server.ca, rejectUnauthorized: true },
    auth: { user: "fixture-user", pass: "fixture-password" }
  });
  client.on("error", () => {});
  t.after(() => client.close());
  await client.connect();
  assert.equal(server.authAttempts[0].accepted, true);
});

test("real ImapFlow rejects an untrusted synthetic TLS certificate", { timeout: 5000 }, async (t) => {
  const { server, client } = await fixture(t, { tls: true }, { verifyOnly: true });
  await assert.rejects(client.connect(), (error) => ["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN"].includes(error.code));
  assert.equal(server.authAttempts.length, 0);
});

for (const ignorePartial of [false, true]) {
  test(`real ImapFlow download is complete and bounded when ignorePartial=${ignorePartial}`, { timeout: 5000 }, async (t) => {
    const source = Buffer.concat([DEFAULT_SOURCE, Buffer.from("synthetic continuation\r\n".repeat(80))]);
    const { server, client } = await fixture(t, { ignorePartial, messages: [{ uid: 7, source }] });
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const header = await client.fetchOne("7", { uid: true, flags: true, size: true, envelope: true }, { uid: true });
      assert.equal(header.uid, 7);
      assert.equal(header.size, source.length);
      assert.equal(header.envelope.subject, "Synthetic fixture message");
      const download = await client.download("7", false, { uid: true, chunkSize: 128 });
      assert.equal(download.meta.expectedSize, source.length);
      assert.equal(download.meta.contentType, "message/rfc822");
      const chunks = [];
      for await (const chunk of download.content) chunks.push(chunk);
      assert.deepEqual(Buffer.concat(chunks), source);
      const downloads = server.commands.filter((command) => command.operation === "UID FETCH" && command.args.includes("BODY.PEEK[]"));
      assert.ok(downloads.length <= (ignorePartial ? 2 : Math.ceil(source.length / 128) + 1), "download must stop within the reported message size");
    } finally { lock.release(); }
    await client.logout();
  });
}

test("real ImapFlow ACK APIs return success values and perform UID operations", { timeout: 5000 }, async (t) => {
  const { server, client } = await fixture(t);
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    assert.ok(client.capabilities.has("UIDPLUS"));
    assert.ok(client.capabilities.has("MOVE"));
    assert.equal(await client.messageFlagsAdd("1", ["\\Seen"], { uid: true }), true);
    assert.equal(await client.messageFlagsRemove("1", ["\\Seen"], { uid: true }), true);
    await client.mailboxCreate("Copied");
    const copied = await client.messageCopy("1", "Copied", { uid: true });
    assert.equal(copied.path, "INBOX");
    assert.equal(copied.destination, "Copied");
    assert.equal(copied.uidValidity, 123n);
    assert.equal(copied.uidMap.get(1), 1);
    await client.mailboxCreate("Moved");
    const moved = await client.messageMove("1", "Moved", { uid: true });
    assert.equal(moved.destination, "Moved");
    assert.equal(moved.uidMap.get(1), 1);
    assert.equal(server.mailboxes.get("INBOX").length, 0);
  } finally { lock.release(); }
  const copiedLock = await client.getMailboxLock("Copied");
  try {
    assert.equal(await client.messageDelete("1", { uid: true }), true);
    assert.equal(server.mailboxes.get("Copied").length, 0);
    assert.ok(server.commands.some((command) => command.operation === "UID EXPUNGE"));
    assert.equal(server.commands.some((command) => command.operation === "EXPUNGE"), false);
  } finally { copiedLock.release(); }
  await client.logout();
});

test("real ImapFlow ACK failure values are rejected by the package action executor", { timeout: 5000 }, async (t) => {
  const { server, client } = await fixture(t);
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    for (const [action, operation, flags] of [
      ["flag", "UID STORE", { add: ["\\Seen"], remove: [] }],
      ["copy", "UID COPY", { add: [], remove: [] }],
      ["move", "UID MOVE", { add: [], remove: [] }],
      ["delete", "UID EXPUNGE", { add: [], remove: [] }]
    ]) {
      server.options.failOperations = { [operation]: "NO" };
      await assert.rejects(executeAckActionRange({
        client, plan: { action, targetMailbox: ["copy", "move"].includes(action) ? "SyntheticTarget" : "", disposition: action === "flag" ? "keep" : action, flags },
        range: "1", mailbox: "INBOX", ensureTargetMailbox: false
      }), /(?:ACK|IMAP) .*(?:failed|not confirmed)/);
    }
    assert.equal(server.mailboxes.get("INBOX").length, 1);
  } finally { lock.release(); }
  await client.logout();
});

test("real advertised capabilities prevent unsafe MOVE and delete fallbacks", { timeout: 5000 }, async (t) => {
  const { server, client } = await fixture(t, { capabilities: ["IMAP4rev1", "AUTH=PLAIN", "SASL-IR"] });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    const before = server.commands.length;
    for (const action of ["move", "delete"]) {
      await assert.rejects(executeAckActionRange({
        client, plan: { action, targetMailbox: action === "move" ? "SyntheticTarget" : "", disposition: action, flags: { add: [], remove: [] } },
        range: "1", mailbox: "INBOX", ensureTargetMailbox: false
      }), /requires (?:IMAP )?(?:MOVE|UIDPLUS)/);
    }
    assert.deepEqual(server.commands.slice(before), []);
  } finally { lock.release(); }
  await client.logout();
});

test("real Mailparser preserves decoded headers, alternative bodies and binary attachments", async () => {
  const source = [
    "From: Sender <sender@example.test>", "To: Receiver <receiver@example.test>",
    "Subject: =?UTF-8?Q?Gr=C3=BC=C3=9Fe?=", "Message-ID: <mime-fixture@example.test>",
    "X-Synthetic: first", "X-Synthetic: second", "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="outer"', "", "--outer",
    'Content-Type: multipart/alternative; boundary="inner"', "", "--inner",
    "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: quoted-printable", "", "Gr=C3=BC=C3=9Fe plain", "--inner",
    "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: quoted-printable", "", "<p>Gr=C3=BC=C3=9Fe html</p>", "--inner--", "--outer",
    "Content-Type: application/octet-stream", 'Content-Disposition: attachment; filename="synthetic.bin"',
    "Content-Transfer-Encoding: base64", "", "AAEC//4=", "--outer--", ""
  ].join("\r\n");
  const parsed = await simpleParser(Buffer.from(source), { skipHtmlToText: true, skipTextToHtml: true });
  assert.equal(parsed.subject, "Grüße");
  assert.equal(parsed.from.value[0].address, "sender@example.test");
  assert.deepEqual(parsed.headers.get("x-synthetic"), ["first", "second"]);
  assert.match(parsed.text, /Grüße plain/);
  assert.match(parsed.html, /<p>Grüße html<\/p>/);
  assert.equal(parsed.attachments.length, 1);
  assert.equal(parsed.attachments[0].filename, "synthetic.bin");
  assert.deepEqual(parsed.attachments[0].content, Buffer.from([0, 1, 2, 255, 254]));
});

test("safe DELETE rejects the original STORE-NO bug before EXPUNGE with real ImapFlow", { timeout: 5000 }, async (t) => {
  const { server, client } = await fixture(t, { failOperations: { "UID STORE": "NO" } });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    await assert.rejects(() => deleteUidRange(client, "1"), (error) => /IMAP delete/.test(error.message) && error.partial !== true);
    assert.equal(server.mailboxes.get("INBOX").length, 1);
    assert.equal(server.commands.filter((command) => command.operation === "UID STORE").length, 1);
    assert.equal(server.commands.some((command) => command.operation.includes("EXPUNGE")), false);
    assert.equal(server.commands.some((command) => /FETCH|SEARCH/.test(command.operation)), false);
  } finally { lock.release(); }
  await client.logout();
});

test("safe DELETE detects a removed flag and failed second STORE despite upstream success", { timeout: 5000 }, async (t) => {
  let storeCount = 0;
  const { server, client } = await fixture(t, {
    failOperations: {
      "UID STORE": ({ messages }) => {
        storeCount += 1;
        if (storeCount === 2) {
          messages[0].flags.delete("\\Deleted");
          return "NO";
        }
      }
    }
  });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    await assert.rejects(() => deleteUidRange(client, "1"), (error) => error.partial === true);
    assert.equal(storeCount, 2);
    assert.equal(server.mailboxes.get("INBOX").length, 1);
    assert.ok(server.commands.some((command) => command.operation === "UID EXPUNGE"));
    assert.equal(server.commands.some((command) => command.operation === "UID SEARCH"), false);
    assert.equal(server.commands.some((command) => command.operation === "UID STORE" && command.args.includes("-FLAGS")), false);
  } finally { lock.release(); }
  await client.logout();
});

test("safe DELETE reports a partial chunk, supports retry with missing UIDs and preserves an outside sentinel", { timeout: 5000 }, async (t) => {
  const { server, client } = await fixture(t, {
    messages: [{ uid: 1 }, { uid: 2 }, { uid: 99, flags: ["\\Deleted"] }],
    failOperations: {
      "UID EXPUNGE": ({ messages }) => { messages.find((message) => message.uid === 2).flags.delete("\\Deleted"); }
    }
  });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    await assert.rejects(() => deleteUidRange(client, "1:2"), (error) => error.partial === true);
    assert.deepEqual(server.mailboxes.get("INBOX").map((message) => message.uid), [2, 99]);
    server.options.failOperations = {};
    assert.equal(await deleteUidRange(client, "1:2"), true);
    assert.deepEqual(server.mailboxes.get("INBOX").map((message) => message.uid), [99]);
    assert.equal(server.mailboxes.get("INBOX")[0].flags.has("\\Deleted"), true);
    for (const command of server.commands.filter((entry) => /^(?:UID )?(?:STORE|EXPUNGE|FETCH|SEARCH)$/.test(entry.operation))) {
      assert.ok(["UID STORE", "UID EXPUNGE", "UID SEARCH"].includes(command.operation));
      assert.match(command.args, command.operation === "UID SEARCH" ? /^UID 1:2$/ : /^1:2(?: |$)/);
    }
  } finally { lock.release(); }
  await client.logout();
});

test("safe DELETE confirms already absent UIDs without touching unrelated messages", { timeout: 5000 }, async (t) => {
  const { server, client } = await fixture(t, { messages: [{ uid: 99, flags: ["\\Deleted"] }] });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    assert.equal(await deleteUidRange(client, "1:2"), true);
    assert.deepEqual(server.mailboxes.get("INBOX").map((message) => message.uid), [99]);
    assert.ok(server.commands.some((command) => command.operation === "UID SEARCH"));
  } finally { lock.release(); }
  await client.logout();
});

test("safe DELETE distinguishes failed verification from confirmed absence after real deletion", { timeout: 5000 }, async (t) => {
  const { server, client } = await fixture(t, { failOperations: { "UID SEARCH": "NO" } });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    await assert.rejects(() => deleteUidRange(client, "1"), (error) => error.partial === true);
    assert.equal(server.mailboxes.get("INBOX").length, 0, "the IMAP mutation may already have completed");
  } finally { lock.release(); }
  await client.logout();
});

test("safe DELETE reports EXPUNGE refusal as partial after a confirmed flag mutation", { timeout: 5000 }, async (t) => {
  const { server, client } = await fixture(t, { failOperations: { "UID EXPUNGE": "NO" } });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    await assert.rejects(() => deleteUidRange(client, "1"), (error) => error.partial === true);
    assert.equal(server.mailboxes.get("INBOX")[0].flags.has("\\Deleted"), true);
    assert.equal(server.commands.some((command) => command.operation === "UID SEARCH"), false);
  } finally { lock.release(); }
  await client.logout();
});

test("safe DELETE requires a real selected mailbox even though public fetch silently returns no rows", { timeout: 5000 }, async (t) => {
  const { server, client } = await fixture(t);
  await client.connect();
  assert.deepEqual(await client.fetchAll("1", { uid: true }, { uid: true }), []);
  const before = server.commands.length;
  await assert.rejects(() => deleteUidRange(client, "1"), /selected mailbox/);
  assert.deepEqual(server.commands.slice(before), []);
  assert.equal(server.mailboxes.get("INBOX").length, 1);
  await client.logout();
});

test("upstream exhausted FETCH throttling looks empty while the requested UID still exists", { timeout: 25000 }, async (t) => {
  const { server, client } = await fixture(t, {
    failOperations: {
      "UID FETCH": { status: "BAD", text: "Request is throttled. Suggested Backoff Time: 1 milliseconds" }
    }
  }, { socketTimeout: 20000 });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    // Keep this actual wire-level regression evidence: ImapFlow 2.0.5 retries
    // four times, then resolves its public iterator as empty instead of failing.
    // It is therefore not a safe proof that deletion completed.
    assert.deepEqual(await client.fetchAll("1", { uid: true }, { uid: true }), []);
    assert.equal(server.commands.filter((command) => command.operation === "UID FETCH").length, 4);
    assert.equal(server.mailboxes.get("INBOX")[0].uid, 1);
    assert.equal(client.usable, true);
    assert.deepEqual(await client.search({ uid: "1" }, { uid: true }), [1]);
  } finally { lock.release(); }
  await client.logout();
});

test("safe DELETE treats throttled bounded UID SEARCH as an unconfirmed partial result", { timeout: 5000 }, async (t) => {
  const { server, client } = await fixture(t, {
    failOperations: {
      "UID SEARCH": { status: "BAD", text: "Request is throttled. Suggested Backoff Time: 1 milliseconds" }
    }
  });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    await assert.rejects(() => deleteUidRange(client, "1"), (error) => error.partial === true);
    assert.deepEqual(server.commands.filter((command) => command.operation === "UID SEARCH").map((command) => command.args), ["UID 1"]);
    assert.equal(server.mailboxes.get("INBOX").length, 0);
  } finally { lock.release(); }
  await client.logout();
});

test("upstream special missing-message NO may look like an empty UID SEARCH", { timeout: 5000 }, async (t) => {
  const { server, client } = await fixture(t, {
    failOperations: {
      "UID SEARCH": { status: "NO", text: "Some of the requested messages no longer exist" }
    }
  });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    const result = await client.search({ uid: "1" }, { uid: true });
    assert.deepEqual(result, []);
    assert.equal(server.mailboxes.get("INBOX")[0].uid, 1);
  } finally { lock.release(); }
  await client.logout();
});

for (const operation of ["UID STORE", "UID EXPUNGE", "UID SEARCH"]) {
  test(`safe DELETE rejects the SDK's special missing-message NO during ${operation}`, { timeout: 5000 }, async (t) => {
    const { server, client } = await fixture(t, {
      failOperations: { [operation]: { status: "NO", text: "Some of the requested messages no longer exist" } }
    });
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      await assert.rejects(() => deleteUidRange(client, "1"), (error) => {
        assert.equal(error.partial === true, operation !== "UID STORE");
        assert.doesNotMatch(error.message, /Some of the requested/);
        return true;
      });
      assert.equal(client.listenerCount("response"), 0);
      if (operation === "UID STORE") assert.equal(server.commands.some((command) => command.operation === "UID EXPUNGE"), false);
      if (operation === "UID EXPUNGE") assert.equal(server.mailboxes.get("INBOX").length, 1);
      assert.equal(server.commands.some((command) => command.operation === "UID STORE" && command.args.includes("-FLAGS")), false);
    } finally { lock.release(); }
    await client.logout();
  });
}

for (const rejectedSearch of [false, true]) {
  test(`safe DELETE observes replies before an existing throwing listener, rejectedSearch=${rejectedSearch}`, { timeout: 5000 }, async (t) => {
    const { client } = await fixture(t, rejectedSearch ? {
      failOperations: { "UID SEARCH": { status: "NO", text: "Some of the requested messages no longer exist" } }
    } : {});
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    const observer = () => { throw new Error("synthetic observer error"); };
    client.on("response", observer);
    try {
      if (rejectedSearch) await assert.rejects(() => deleteUidRange(client, "1"), (error) => error.partial === true);
      else assert.equal(await deleteUidRange(client, "1"), true);
      assert.deepEqual(client.listeners("response"), [observer]);
    } finally {
      client.removeListener("response", observer);
      lock.release();
    }
    await client.logout();
  });
}
