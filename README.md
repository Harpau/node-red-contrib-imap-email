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

## Delivery Semantics

The package provides at-least-once delivery.

```text
Message still in mailbox = not successfully ACKed
Message deleted          = successfully processed and ACKed
Duplicate delivery       = possible
Exactly once             = not guaranteed
```

The inflight registry is volatile process memory. If Node-RED restarts after a message was emitted but before it was ACKed, the message remains in the mailbox and may be emitted again.

## Current Limits

- `imap email ack` currently performs the existing positive ACK behavior: batched UID deletion.
- The predecessor's separate NACK node is not registered in this package.
- Unified ACK/NACK actions and additional flag-selection controls are planned follow-up work, not part of this safe rename.
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
