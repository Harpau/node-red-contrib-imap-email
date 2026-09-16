# Known issues

This file records known behavior, fixes and the limits of the available evidence.
It is not a release-readiness statement.

## Historical DELETE false success after a rejected Deleted flag

**Status:** fixed at the package level in **version `1.1.0`**. Version `1.0.1`
does not include this fix.
The underlying ImapFlow behavior described below has not been changed upstream
by this package.

### Package protection since 1.1.0

ACK `delete` and input `Expunge window` share the same bounded deletion helper:

1. Require `UIDPLUS`, a usable connection and a selected mailbox with a known
   path and UIDVALIDITY.
2. Explicitly set `\Deleted` for the UID chunk and require a successful result.
   A rejected initial STORE stops before EXPUNGE and is not marked partial.
3. Call `messageDelete()` for that chunk and require a successful result.
4. Search only the UIDs from the same bounded chunk using `UID SEARCH UID <range>`.
   Require a successful search with an empty UID array. A failed search, including
   throttling, must not count as proof of removal. This performs no mailbox-wide
   search or fetch. Check the connection and selected mailbox identity between
   steps and after the confirmation search.

Each step also observes ImapFlow's public `response` event: at least one tagged
OK and no non-OK completion must be observed during that operation. This catches
library exceptions that otherwise turn certain server NO responses into a
successful method result. The temporary listener is removed in all exit paths;
it stores only success/failure flags, without enabling raw logs or keeping
server text, tags or credentials.

Compared with calling `messageDelete()` alone, this adds two commands per chunk:
the checked STORE and the UID-constrained SEARCH, which requests no message content.
Existing `maxUidPerCommand` limits apply, with an additional helper limit of
5000 UIDs. No `ALL`, wildcard or empty search query is permitted. The helper
introduces no production dependency.

A failure after the initial flag update succeeded is partial: flags or deletions
may already have taken effect, and no rollback is attempted. ACK reports failure,
retains the affected inflight entries and stops subsequent chunks in that group.
Input cleanup aborts the current fetch cycle on a partial result or connection
failure; unconfirmed UIDs are not counted as expunged or removed from the registry.
Earlier confirmed chunks remain applied. Cleanup may be attempted again on a
later trigger; neither path offers an atomic, all-or-nothing delete operation.

Retained inflight permits retry but cannot restore a deleted message or make a
remaining `\Deleted` message match a filter that excludes it. Flows must account
for partial side effects and retain their at-least-once duplicate handling.

### Historical trigger and effect

ImapFlow's `messageDelete()` first marks the requested messages `\Deleted`
and then expunges them. Against the local synthetic IMAP server, this sequence
was reproduced with ImapFlow `2.0.5`:

```text
UID STORE 1 +FLAGS (\Deleted) -> NO
UID EXPUNGE 1                -> OK
messageDelete()              -> true
Message UID 1 remains in INBOX.
```

The library does not propagate the failed flag update in this path. Before the
1.1.0 fix, the package's ACK executor accepted the returned `true`;
consequently an ACK could report success and remove its inflight entry even
though the message remained. The retained message could be delivered again.
Server support for `UIDPLUS` prevented a mailbox-wide expunge fallback, but alone
did not prevent this false success.

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

### Direct-library reproduction

Run from a development checkout with installed dependencies. This uses only
the repository's loopback test server and synthetic credentials; no external
mail account is involved. It deliberately calls ImapFlow directly, bypassing the
new package helper, to preserve the original evidence.

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

### Validation limits

The earlier library contract checks covered successful deletion, missing
`UIDPLUS` and an error returned by `UID EXPUNGE`; they did not establish complete
failure propagation for the compound operation. They do not validate the later
package fix.

Regression coverage must check the actual library and local server for
rejected STORE/EXPUNGE, remaining UIDs, connection/mailbox identity changes,
failed or throttled confirmation searches, partial side effects, inflight
retention and stopped subsequent chunks. Both
ACK and input cleanup require coverage. See the [release checklist](RELEASE_DE.md).
Exact tested package states and results are recorded separately in the
repository's `.github/maintainer/` validation records, including the local
candidate checks and the provider acceptance dated 2026-09-16. Those records
identify their own tested tarballs. The startup connection check does not test
DELETE permissions or outcomes.
