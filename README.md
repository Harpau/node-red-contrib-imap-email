# @compeso/node-red-contrib-imap-queue

Node-RED nodes for using an IMAP mailbox as an **at-least-once queue**.

The package is designed for mailboxes that can temporarily contain many messages. It does not run an unbounded `SEARCH UNDELETED` over the whole mailbox. Instead, the input node reads a bounded front window such as `1:500`, emits only a limited batch, and waits for an ACK node to delete messages after successful processing.

Since version `0.2.0`, `imap-queue-in` is **externally triggered only**. It does not poll by itself. Wire an Inject node, scheduler, HTTP endpoint, or any other trigger to its input. Every incoming trigger starts exactly one bounded fetch cycle.

## Nodes

### `imap-queue-account`

Configuration node with IMAP host, port, TLS settings and credentials.

### `imap-queue-in`

Input node with one input and three outputs. It performs one bounded fetch cycle whenever it receives a message.

It does **not** start by itself and does **not** run an internal polling or drain timer. If a trigger arrives while a fetch cycle is already running, it skips that trigger and emits a stats message on output 3 with `payload.skipped = true` and `payload.reason = "already running"`.

Outputs:

1. Parsed mail message
2. Error / parse error message
3. Stats message, when Diagnostics is set to `stats` or `debug`

Important fields on output 1:

```js
msg.topic             // mail subject, for Node-RED compatibility
msg.payload           // text body
msg.email             // parsed metadata
msg.email.topic       // mail subject inside the email object
msg.email.text        // text body
msg.email.html        // html body if available
msg.email.header      // parsed headers object
msg.email.attachments // parsed attachments, only when enabled
msg.imap.ackToken     // required for imap-queue-ack
```

The node intentionally does not emit `msg.html` or `msg.attachments`. HTML and attachments are nested below `msg.email`.

### `imap-queue-ack`

Input node. Wire this node only after successful processing. It batches ACKs internally and deletes messages by UID from the queue mailbox. No additional ACK flush Inject node is required.

Outputs:

1. ACK success message
2. ACK error message
3. Batch stats message, when Diagnostics is set to `stats` or `debug`

### `imap-queue-nack`

Optional input node for explicit negative acknowledgement. It can keep the message for retry, clear the in-memory inflight entry, move the message to a failed mailbox, or delete it.

## Delivery guarantee

The mailbox itself is the durable queue:

```text
message still in mailbox = not successfully ACKed
message deleted          = successfully processed and ACKed
```

The input node keeps only a volatile in-memory inflight cache to avoid emitting the same message repeatedly while it is being processed. If Node-RED restarts, the cache is lost. That can cause duplicate delivery, but messages are not silently lost because they remain in the mailbox until the ACK node deletes them.

This means:

```text
At least once: yes
Exactly once: no
Duplicates: possible and expected after errors/restarts
Persistent local state: not required
```

## Suggested settings for a queue mailbox

Use an external trigger interval that matches your desired throughput, for example an Inject node every 1 second or a scheduler that triggers more often while backlog exists.

```text
External trigger:         e.g. Inject every 1 second
Mailbox:                  INBOX
Batch size:               50
Front window size:        500
Max inflight:             500
Retry after:              1800000 ms
ACK batch size:           100
ACK flush:                500 ms
UIDs per command:         500
Skip deleted:             true
Expunge deleted front:    true
Expunge deleted limit:    200
Diagnostics:              stats
```

If the external trigger fires faster than one fetch cycle can finish, the node does not start a second parallel IMAP fetch. It emits a skipped stats message instead.


## Diagnostics and timings

Version `0.4.0` adds a Diagnostics option to the runtime nodes.

```text
off
  Keep only node status and normal error/success outputs.

stats
  Emit structured statistics on the stats output. This is the recommended default while tuning.

debug
  Emit stats and write redacted debug summaries to the Node-RED runtime log. Passwords, tokens, raw message source and attachments are redacted.
```

`imap-queue-in` stats include counters and timings such as:

```js
msg.payload.exists
msg.payload.frontWindowRead
msg.payload.candidates
msg.payload.fetched
msg.payload.emitted
msg.payload.deletedFlagged
msg.payload.deletedExpunged
msg.payload.missingSource
msg.payload.timings.connectMs
msg.payload.timings.lockMs
msg.payload.timings.frontFetchMs
msg.payload.timings.fullFetchMs
msg.payload.timings.parseMs
msg.payload.timings.expungeMs
msg.payload.timings.totalMs
```

`imap-queue-ack` stats include one message per flush with values such as:

```js
msg.payload.requested
msg.payload.groups
msg.payload.okCount
msg.payload.errorCount
msg.payload.pendingAfter
msg.payload.ranges
msg.payload.timings.connectMs
msg.payload.timings.deleteMs
msg.payload.timings.totalMs
```

Operationally expected ACK/NACK errors are emitted on the nodes' error outputs and logged as warnings rather than flooding the runtime with hard errors. Unexpected node failures still use `node.error`.

## Minimal flow

```text
Inject / scheduler / HTTP trigger
  -> imap queue in
      -> your successful processing path
          -> imap queue ack
```

Only the successful processing path may lead to `imap-queue-ack`. If processing fails, do not ACK. The message stays in the mailbox and will be delivered again after the retry timeout or after a restart.

## Installation from GitHub

From the Node-RED user directory, usually `~/.node-red`:

```bash
npm install github:compeso/node-red-contrib-imap-queue
```

Then restart Node-RED.

## Local development installation

From this package directory:

```bash
npm install
npm test
npm link
```

From your Node-RED user directory:

```bash
cd ~/.node-red
npm link @compeso/node-red-contrib-imap-queue
```

Then restart Node-RED.

On Windows, the user directory is commonly:

```powershell
cd $env:USERPROFILE\.node-red
npm link @compeso/node-red-contrib-imap-queue
```

## Example flow

Import:

```text
examples/basic-at-least-once-flow.json
```

After import, open the `imap-queue-account` config node and enter username and password.

## Safety notes

- `imap-queue-ack` deletes messages. Test with a dedicated mailbox first.
- `imap-queue-in` can expunge messages that already have the IMAP `\\Deleted` flag when `Expunge deleted front` is enabled.
- If your IMAP server does not support UIDPLUS, an EXPUNGE operation may expunge all messages in the selected mailbox that already have `\\Deleted`. Use a dedicated queue mailbox.
- Wire `imap-queue-ack` only after all processing that must succeed.
- If processing fails, do not ACK. The message stays in the mailbox and will be delivered again after the retry timeout or after a restart.

## Upgrade note from 0.2.x to 0.3.x

Version `0.3.0` changes the output shape of `imap-queue-in`:

```text
msg.html             removed
msg.attachments      removed
msg.email.subject    replaced by msg.email.topic
msg.email.headers    replaced by msg.email.header
```

The top-level `msg.topic` still contains the mail subject for normal Node-RED compatibility.

## Upgrade note from 0.1.x

Version `0.1.x` implemented `imap-queue-in` as an automatic source node with internal polling. Version `0.2.0` changes it to an externally triggered input node.

After upgrading, add an Inject node, scheduler, or other trigger in front of `imap-queue-in`. The old settings `pollIntervalMs`, `drainIntervalMs`, and `autoStart` are no longer used.

## GitHub quick start

```bash
git init
git add .
git commit -m "Initial IMAP queue Node-RED nodes"
git branch -M main
git remote add origin https://github.com/compeso/node-red-contrib-imap-queue.git
git push -u origin main
```

## Upgrade note from 0.3.0 to 0.3.1

Version `0.3.1` makes `imap-queue-in` defensive against messages that become `\\Deleted` between the lightweight front-window scan and the full source fetch. Such messages are skipped and optionally expunged instead of being passed to `mailparser` with an empty source.

The stats message may include:

```text
deletedSkippedDuringFetch
missingSource
```

## Upgrade note from 0.3.x to 0.4.x

Version `0.4.0` adds Diagnostics settings and timing counters. `imap-queue-ack` now has a third output for batch stats. Existing output 1 and output 2 wires keep their meaning.

Set Diagnostics to:

```text
stats  recommended during tuning
off    quieter production operation
debug  temporary troubleshooting with redacted runtime debug logs
```
