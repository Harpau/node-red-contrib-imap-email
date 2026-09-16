# Known issues

This file records unresolved behavior and the limits of the available evidence.
It is not a release-readiness statement.

## DELETE may report success after the server rejects the Deleted flag

**Status:** open; observed during development of the unreleased startup check.
The startup-check change does not modify the existing ACK action executor.

### Trigger and effect

ImapFlow's `messageDelete()` first marks the requested messages `\Deleted`
and then expunges them. Against the local synthetic IMAP server, this sequence
was reproduced with ImapFlow `2.0.5`:

```text
UID STORE 1 +FLAGS (\Deleted) -> NO
UID EXPUNGE 1                -> OK
messageDelete()              -> true
Message UID 1 remains in INBOX.
```

The library does not propagate the failed flag update in this path. The package's
ACK executor accepts the returned `true`; consequently an ACK can report success
and remove its inflight entry even though the message remains. The retained
message can be delivered again. Server support for `UIDPLUS` prevents a
mailbox-wide expunge fallback, but does not prevent this false success.

The defect is also present in the exact pre-change baseline, ImapFlow `1.4.2`,
by source inspection of its [published npm archive](https://registry.npmjs.org/imapflow/-/imapflow-1.4.2.tgz).
The archive's SHA-512 integrity matches the `1.4.2` entry in the repository's
pre-change lockfile. The call chain in that archive is:

- `lib/imap-flow.js`, lines 2701-2707: `messageDelete()` returns the EXPUNGE result.
- `lib/commands/expunge.js`, line 24: the flag update is awaited without checking
  its return value; lines 36-51 return `true` after successful EXPUNGE.
- `lib/commands/store.js`, lines 93-99: a rejected STORE returns `false`.

The same unchecked result was also found in ImapFlow `1.7.8` source. Thus the
source-level defect predates the update from `1.4.2` to `2.0.5`; this is not a
new 2.x regression. The wire-level reproduction above was run with `2.0.5`,
not repeated with `1.4.2` or `1.7.8`. No claim is made about every older version
or every real provider.

### Local reproduction

Run from a development checkout with installed dependencies. This uses only
the repository's loopback test server and synthetic credentials; no external
mail account is involved.

```js
const { ImapFlow } = require("imapflow");
const { startImapServer } = require("./test/helpers/imap-server");

async function reproduce() {
  const server = await startImapServer({
    failOperations: { "UID STORE": "NO" }
  });
  const client = new ImapFlow({
    host: server.host,
    port: server.port,
    secure: false,
    doSTARTTLS: false,
    logger: false,
    auth: { user: "fixture-user", pass: "fixture-password" }
  });
  client.on("error", () => {});
  let lock;
  try {
    await client.connect();
    lock = await client.getMailboxLock("INBOX");
    const result = await client.messageDelete("1", { uid: true });
    console.log({ result, remaining: server.mailboxes.get("INBOX").length });
    // Observed: { result: true, remaining: 1 }
  } finally {
    if (lock) lock.release();
    client.close();
    await server.close();
  }
}

reproduce().catch((error) => { console.error(error); process.exitCode = 1; });
```

### Scope of current checks and follow-up

The library contract tests cover successful deletion, rejection of missing
`UIDPLUS`, and an error returned by `UID EXPUNGE`. They do not establish that
every failure in the compound DELETE operation is propagated correctly.

A separate fix must ensure a rejected `UID STORE` cannot become a successful
ACK, with a regression test that checks both the result and the remaining
server-side message. Until then, flows must retain their normal at-least-once
duplicate handling. The unresolved issue must be considered explicitly during
release review; the startup connection check cannot detect or repair it.
