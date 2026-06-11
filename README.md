# @compeso/node-red-contrib-imap-email

Development version: `0.1.0`

Node-RED nodes for externally triggered IMAP email processing with bounded front-window fetch and at-least-once ACK deletion.

This package is independent from `@compeso/node-red-contrib-imap-queue`. It uses new Node-RED type names so both packages can be installed side by side without registering the same public node types.

## Nodes

```text
imap email account  shared IMAP account configuration
imap email in       externally triggered bounded front-window fetch
imap email ack      batched acknowledgement and UID delete
```

The previous public node types from the predecessor package are not registered by this package:

```text
imap queue account
imap queue in
imap queue ack
imap queue nack
```

## Installation

From GitHub during development:

```bash
cd ~/.node-red
npm install github:Harpau/node-red-contrib-imap-email
```

From a local checkout:

```bash
cd /path/to/node-red-contrib-imap-email
npm install
npm link

cd ~/.node-red
npm link @compeso/node-red-contrib-imap-email
```

Restart Node-RED after installation.

## Example Flow

Import [examples/basic-at-least-once-flow.json](examples/basic-at-least-once-flow.json) in Node-RED, open the `imap email account` config node, and enter your IMAP username and password.

Minimal flow:

```text
Inject / scheduler / HTTP trigger
  -> imap email in
      -> your successful processing
          -> imap email ack
```

Only wire messages to `imap email ack` after all processing that must succeed has actually succeeded.

`imap email ack` can be configured multiple times in one flow. Typical modes:

```text
delete              delete the mail by UID and complete it
keep/requeue later  keep the mail and retry after the inflight timeout
keep/requeue now    keep the mail and make it immediately eligible again
move to folder      move the mail to a configured IMAP folder
set by msg.<xxx>    read action, target folder and flags from the message
```

The ack node can set or clear `\Seen`, `\Answered` and `\Flagged` for keep and
move actions. Delete is intentionally not combined with flag changes.

## Large Mailboxes

`imap email in` is designed for mailboxes that may contain many messages. It does not run an unbounded mailbox-wide search. Instead, each trigger reads only a bounded front window such as `1:500`, emits at most the configured batch size, and waits for ACK deletion through `imap email ack`.

Important settings:

```text
Batch size       maximum messages emitted per trigger
Front window     maximum number of front messages inspected per trigger
Max inflight     maximum emitted but not-yet-ACKed messages tracked in memory
Retry after ms   time after which an un-ACKed message may be emitted again
UIDs/command     maximum UID count per IMAP command chunk
```

Selection settings:

```text
Deleted   Any | Only with flag | Only without flag
Seen      Any | Only with flag | Only without flag
Answered  Any | Only with flag | Only without flag
Flagged   Any | Only with flag | Only without flag
```

The defaults are `Deleted = Only without flag` and all other flags set to
`Any`. These filters are applied only inside the bounded front window. A
selective filter may emit fewer messages than `Batch size`; it never causes a
full-mailbox scan to fill the batch.

Output messages include the server flags as an array:

```js
msg.imap.flags // for example ["\\Seen", "\\Flagged"]
```

## Delivery Semantics

The package provides at-least-once delivery.

```text
Message still in mailbox = not successfully ACKed
Message deleted          = successfully processed and ACKed
Duplicate delivery       = possible
Exactly once             = not guaranteed
```

The inflight registry is volatile process memory. If Node-RED restarts after a message was emitted but before it was ACKed, the message remains in the mailbox and may be emitted again.

No message is reported as successfully completed if the configured IMAP action
fails. In that case output 2 receives the original message with
`msg.imapAck.ok = false`.

For dynamic decisions, configure `imap email ack` to `set by msg.<xxx>` and set
`msg.imap.ackAction`:

```js
msg.imap.ackAction = {
  disposition: "move",          // keep, delete, move
  targetMailbox: "Archive",
  createTargetMailbox: true,
  requeue: "complete",          // complete, later, now
  flags: {
    seen: "set",                // ignore, set, clear
    answered: "ignore",
    flagged: "clear"
  }
};
```

Successful completions add `msg.imapAck` with fields such as `mode`,
`disposition`, `mailbox`, `targetMailbox`, `uid`, `uidValidity`, `flags`,
`ranges`, `requeue` and `inflightRemoved`.

## Current Limits

- The predecessor's separate NACK node is not registered in this package.
- OAuth2 token acquisition and refresh are not implemented. The account node supports username/password and an optional static access token field.

## Migration Notes

This repository was derived from `@compeso/node-red-contrib-imap-queue`, but it is a new package:

```text
Old npm package:     @compeso/node-red-contrib-imap-queue
New npm package:     @compeso/node-red-contrib-imap-email
Old GitHub repo:     https://github.com/Harpau/node-red-contrib-imap-queue
New GitHub repo:     https://github.com/Harpau/node-red-contrib-imap-email
```

Existing flows from the old package need new node types before they can run with this package:

```text
imap queue account -> imap email account
imap queue in      -> imap email in
imap queue ack     -> imap email ack
```

Flows that use `imap queue nack` need a later migration step once the planned unified `imap email ack` actions are implemented.

## Development Checks

```bash
npm test
npm run pack:check
```

Do not publish this package to npm or flows.nodered.org without explicit human approval.
