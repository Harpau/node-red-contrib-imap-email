# @compeso/node-red-contrib-imap-queue

Node-RED nodes for using an IMAP mailbox as an **at-least-once queue**.

The package is built for queue mailboxes that may temporarily contain many messages. It does not run an unbounded `SEARCH UNDELETED` over the whole mailbox. Instead, `imap queue in` reads only a bounded front window such as `1:500`, emits a limited batch, and waits for `imap queue ack` to delete messages only after successful downstream processing.

Since version `0.2.0`, mail fetching is **externally triggered only**. The input node has one input and performs exactly one bounded fetch cycle per incoming trigger message. Use an Inject node, scheduler, HTTP endpoint, link call, or your own backpressure logic to trigger it.

## 1. What this package does

The common use case is a dedicated mailbox that acts as a durable queue:

```text
external trigger
  -> imap queue in
      -> your successful processing path
          -> imap queue ack
```

Optional error handling:

```text
imap queue in output 2
  -> inspect/log/route
      -> imap queue nack
```

The mailbox remains the durable source of truth:

```text
message still in mailbox = not successfully ACKed
message deleted          = successfully processed and ACKed
```

## 2. Delivery semantics

The package provides **at-least-once delivery**.

```text
At least once:          yes
Exactly once:           no
Duplicate delivery:     possible
Persistent local state: not required
```

`imap queue in` keeps only a volatile in-memory inflight cache to avoid emitting the same message repeatedly while it is currently being processed. If Node-RED restarts, this cache is lost. Messages may then be emitted again, but they are not silently lost because they remain in the mailbox until `imap queue ack` deletes them.

Typical outcomes:

```text
Fetch -> processing succeeds -> ACK succeeds
  message is deleted from the mailbox.

Fetch -> processing fails -> no ACK
  message remains in the mailbox and is delivered again later.

Node-RED restarts after fetch but before ACK
  message remains in the mailbox and is delivered again.

ACK fails
  message remains in the mailbox and is delivered again.
```

## 3. Nodes

The package contains four Node-RED node types:

```text
imap queue account  shared IMAP account configuration
imap queue in       externally triggered bounded front-window fetch
imap queue ack      batched positive acknowledgement and UID delete
imap queue nack     optional negative acknowledgement / failed-message handling
```

The Node-RED type names intentionally use spaces, not hyphens.

## 4. Node: `imap queue account`

Shared IMAP account configuration used by the runtime nodes.

### Settings

| Setting | Description |
| --- | --- |
| Name | Optional display name for the config node. |
| Host | IMAP server host, for example `imap.strato.de`. |
| Port | IMAP server port. Usually `993` for TLS. |
| TLS | Use a secure TLS connection. Usually enabled for port `993`. |
| Verify cert | Reject unauthorized TLS certificates. Keep enabled for production. |
| Username | IMAP username. For STRATO this is normally the full email address. Stored as a Node-RED credential. |
| Password | IMAP password. Stored as a Node-RED credential. |
| Access token | Optional static OAuth2 access token. Advanced/experimental; no automatic refresh is implemented yet. Stored as a Node-RED credential. |
| Connect ms | Connection timeout in milliseconds. |
| Greeting ms | Server greeting timeout in milliseconds. |
| Socket ms | Socket inactivity timeout in milliseconds. |

### Authentication note

For the current STRATO-focused workflow, password authentication is the recommended and tested mode. OAuth2 refresh-token handling is intentionally not finalized yet. A static access token field exists for advanced manual testing, but the package does not yet acquire or refresh OAuth2 tokens.

## 5. Node: `imap queue in`

Externally triggered input node. Each incoming message starts one bounded fetch cycle.

The node never deletes successfully processed messages itself. It emits messages with `msg.imap.ackToken`; only `imap queue ack` should delete a message after your downstream processing has succeeded.

### Inputs and outputs

Inputs:

```text
Input 1: trigger one bounded fetch cycle
```

Outputs:

```text
Output 1: parsed mail message
Output 2: operational error / parse error / missing source
Output 3: structured stats, when Diagnostics is stats or debug
```

If a trigger arrives while a fetch cycle is already running, the node does not start a parallel IMAP fetch. It emits a stats message on output 3 with:

```js
msg.payload.skipped = true;
msg.payload.reason = "already running";
```

### Settings

| Setting | Description |
| --- | --- |
| Name | Optional display name. |
| Account | Required `imap queue account` config node. |
| Mailbox | Queue mailbox to read from, usually `INBOX`. |
| Batch size | Maximum number of messages emitted per trigger. |
| Front window | Number of messages at the front of the mailbox to inspect, for example `500`. The node does not scan the entire mailbox. |
| Max inflight | Maximum number of not-yet-ACKed messages considered active in memory. If reached, new fetch cycles skip emission until ACKs arrive or retries expire. |
| Retry after ms | Time after which an un-ACKed inflight message may be emitted again. This controls duplicate retry timing. |
| UIDs/command | Maximum number of UIDs per IMAP command/range chunk. Keeps IMAP command lines short. |
| Skip deleted | Skip messages that already have the IMAP `\Deleted` flag. Recommended: enabled. |
| Expunge front | Permanently remove `\Deleted` messages seen in the front window. Recommended for queue mailboxes. |
| Expunge limit | Maximum number of already-`\Deleted` front-window messages to expunge per fetch cycle. |
| Attachments | Include parsed attachments in `msg.email.attachments`. If disabled, attachments are omitted. |
| Raw source | Include the raw RFC822 message source in `msg.raw`. Use carefully; this can be large. |
| Diagnostics | `off`, `stats`, or `debug`. See [Diagnostics](#10-diagnostics-and-timings). |

### Output 1 message shape

```js
msg.topic                 // mail subject, for Node-RED compatibility
msg.payload               // text body

msg.email.topic           // mail subject inside the email object
msg.email.messageId
msg.email.date
msg.email.from
msg.email.to
msg.email.cc
msg.email.bcc
msg.email.text
msg.email.html
msg.email.header          // parsed headers object
msg.email.attachments     // only when Attachments is enabled

msg.raw                   // only when Raw source is enabled

msg.imap.accountId
msg.imap.mailbox
msg.imap.uid
msg.imap.uidValidity
msg.imap.flags
msg.imap.internalDate
msg.imap.size
msg.imap.ackToken         // pass this to imap queue ack or imap queue nack
msg.imap.delivery.mode    // "at-least-once"
msg.imap.delivery.duplicatePossible
```

The node intentionally does **not** emit these top-level fields:

```text
msg.html
msg.attachments
```

HTML and attachments live under `msg.email` only.

### Output 2 error message shape

Output 2 is for messages that could not be parsed or fetched cleanly, but where the flow may still need to decide what to do.

Examples:

```js
msg.error.message
msg.error.code
msg.error.stack
msg.imap.ackToken
msg.imap.uid
msg.imap.uidValidity
```

If the raw source was available but parsing failed, `msg.payload` may contain that raw source. Consider wiring output 2 to logging and, where appropriate, `imap queue nack` with action `move` to prevent permanently broken messages from retrying forever.

### Output 3 stats message shape

When Diagnostics is `stats` or `debug`, output 3 emits one summary per fetch cycle:

```js
msg.payload.ok
msg.payload.type                  // "imap queue in stats"
msg.payload.diagnostics
msg.payload.mailbox
msg.payload.exists
msg.payload.uidValidity
msg.payload.frontWindowSize
msg.payload.frontWindowRead
msg.payload.activeInflight
msg.payload.activeInflightAfter
msg.payload.inflightTotal
msg.payload.maxInflight
msg.payload.capacity
msg.payload.candidates
msg.payload.fetched
msg.payload.emitted
msg.payload.parseErrors
msg.payload.deletedFlagged
msg.payload.deletedExpunged
msg.payload.deletedSkippedDuringFetch
msg.payload.missingSource
msg.payload.skipped
msg.payload.reason
msg.payload.queueKey
msg.payload.startedAt
msg.payload.finishedAt
msg.payload.timings
```

Timing fields may include:

```js
msg.payload.timings.connectMs
msg.payload.timings.lockMs
msg.payload.timings.frontFetchMs
msg.payload.timings.fullFetchMs
msg.payload.timings.parseMs
msg.payload.timings.expungeMs
msg.payload.timings.logoutMs
msg.payload.timings.totalMs
```

## 6. Node: `imap queue ack`

Positive acknowledgement node. Wire this node only after all required processing has succeeded.

The node batches incoming ACK messages internally and deletes the corresponding messages by UID from the mailbox in `msg.imap.ackToken`. No separate ACK flush Inject node is required.

### Inputs and outputs

Inputs:

```text
Input 1: message containing msg.imap.ackToken
```

Outputs:

```text
Output 1: ACK success
Output 2: ACK error
Output 3: ACK batch stats, when Diagnostics is stats or debug
```

### Settings

| Setting | Description |
| --- | --- |
| Name | Optional display name. |
| Account | Required `imap queue account` config node. |
| Mailbox fallback | Mailbox used if the incoming ACK token does not contain a mailbox. Usually `INBOX`. |
| Batch size | Number of ACKs to collect before flushing immediately. |
| Flush ms | Maximum time to wait before flushing a non-empty ACK batch. |
| UIDs/command | Maximum number of UIDs per IMAP delete command/range chunk. |
| Batches/flush | Maximum number of ACK batches processed by one internal flush. Effective upper bound per flush is `Batch size * Batches/flush`. |
| Diagnostics | `off`, `stats`, or `debug`. |

### ACK success shape

Output 1 passes through the original message and adds:

```js
msg.imapAck.ok
msg.imapAck.mailbox
msg.imapAck.uid
msg.imapAck.uidValidity
msg.imapAck.batchSize
msg.imapAck.ranges
```

### ACK error shape

Output 2 passes through the original message and adds:

```js
msg.imapAck.ok       // false
msg.imapAck.mailbox
msg.imapAck.uid
msg.imapAck.uidValidity
msg.imapAck.error
```

ACK errors do not remove inflight entries. The message remains in the mailbox and can be delivered again.

### ACK stats shape

When Diagnostics is `stats` or `debug`, output 3 emits one message per flush:

```js
msg.payload.ok
msg.payload.type             // "imap queue ack stats"
msg.payload.diagnostics
msg.payload.startedAt
msg.payload.finishedAt
msg.payload.requested
msg.payload.groups
msg.payload.okCount
msg.payload.errorCount
msg.payload.pendingAfter
msg.payload.ranges
msg.payload.errors
msg.payload.timings.connectMs
msg.payload.timings.lockMs
msg.payload.timings.deleteMs
msg.payload.timings.logoutMs
msg.payload.timings.totalMs
```

## 7. Node: `imap queue nack`

Optional negative acknowledgement node for messages that should not continue on the normal ACK path.

Use it for parse errors, permanently invalid business messages, or manual retry decisions.

### Inputs and outputs

Inputs:

```text
Input 1: message containing msg.imap.ackToken
```

Outputs:

```text
Output 1: NACK success
Output 2: NACK error
```

### Settings

| Setting | Description |
| --- | --- |
| Name | Optional display name. |
| Account | Required `imap queue account` config node. |
| Mailbox fallback | Mailbox used if the incoming ACK token does not contain a mailbox. Usually `INBOX`. |
| Action | One of `retry`, `retry-now`, `move`, or `delete`. |
| Failed mailbox | Destination mailbox used when Action is `move`, for example `.NodeRED.failed`. |
| Diagnostics | `off` or `debug`. |

### Actions

```text
retry
  Leave the message in the mailbox and keep the inflight entry until the retry timeout.

retry-now
  Leave the message in the mailbox but clear the inflight entry so it may be emitted again immediately.

move
  Move the message by UID to the configured failed mailbox and clear the inflight entry.

delete
  Delete the message by UID and clear the inflight entry.
```

### NACK result shape

Output 1 or 2 passes through the original message and adds:

```js
msg.imapNack.ok
msg.imapNack.action
msg.imapNack.uid
msg.imapNack.mailbox
msg.imapNack.failedMailbox
msg.imapNack.error
```

## 8. STRATO example

For STRATO IMAP, typical account settings are:

```text
Host:        imap.strato.de
Port:        993
TLS:         enabled
Verify cert: enabled
Username:    full email address
Password:    mailbox password
```

A practical starting configuration for a queue mailbox is:

```text
External trigger:      Inject every 1 second
Mailbox:               INBOX
Batch size:            50
Front window:          500
Max inflight:          500
Retry after ms:        1800000
UIDs/command:          500
Skip deleted:          true
Expunge front:         true
Expunge limit:         200
Attachments:           false
Raw source:            false
Diagnostics:           stats

ACK Batch size:        100
ACK Flush ms:          500
ACK UIDs/command:      500
ACK Batches/flush:     20
ACK Diagnostics:       stats
```

If backlog must be drained faster and processing can keep up, increase `Batch size` and `Max inflight`, or trigger more often. The node will skip overlapping fetch triggers rather than running parallel fetch cycles.

## 9. Message format summary

Minimum successful mail message:

```js
{
  topic: "Subject",
  payload: "Text body",
  email: {
    topic: "Subject",
    messageId: "...",
    date: "...",
    from: "...",
    to: "...",
    text: "Text body",
    html: "...",
    header: {}
  },
  imap: {
    mailbox: "INBOX",
    uid: 123,
    uidValidity: "1779869829",
    ackToken: { /* pass to ack or nack */ },
    delivery: {
      mode: "at-least-once",
      duplicatePossible: true
    }
  }
}
```

## 10. Diagnostics and timings

Diagnostics settings:

```text
off
  Keep only node status and normal success/error outputs.

stats
  Emit structured statistics on the stats output. Recommended while tuning.

debug
  Emit stats and write redacted debug summaries to the Node-RED runtime log.
```

Debug output redacts passwords, access tokens, raw message source and attachments.

Recommended production setting after tuning:

```text
imap queue in:   off or stats
imap queue ack:  off or stats
imap queue nack: off
```

Use `debug` only temporarily because it increases log volume.

## 11. Performance tuning

The most important controls are:

```text
Batch size
  How many messages may be emitted per trigger.

Front window
  How many front-of-queue messages are inspected per trigger.

Max inflight
  How many emitted but not-yet-ACKed messages may be active.

Retry after ms
  How long a not-yet-ACKed message is suppressed before it may be delivered again.

ACK batch size / flush ms
  How aggressively ACK deletes are grouped.
```

For a mailbox receiving around one mail per second, a conservative start is:

```text
Trigger interval: 1 second
Batch size:       50
Front window:     500
Max inflight:     500
ACK batch size:   100
ACK flush ms:     500
```

For large backlog recovery:

```text
Trigger interval: 200-500 ms
Batch size:       50-100
Front window:     500-2000
Max inflight:     1000-5000
```

Watch the stats timings to identify bottlenecks:

```text
frontFetchMs high -> IMAP front-window metadata scan is slow
fullFetchMs high  -> fetching message bodies is slow
parseMs high      -> parsing or attachments are expensive
deleteMs high     -> ACK delete/expunge is slow
```

## 12. Troubleshooting

### Messages appear crossed out in webmail

They probably have the IMAP `\Deleted` flag but have not been expunged yet. For a dedicated queue mailbox, enable:

```text
Skip deleted:  true
Expunge front: true
```

### Repeated duplicate delivery

Duplicate delivery is part of at-least-once semantics. If duplicates are too frequent, increase:

```text
Retry after ms
Max inflight
```

Also verify that successful messages actually reach `imap queue ack`.

### ACK is slow

Increase ACK batching:

```text
ACK batch size:      100-500
ACK flush ms:        100-500
ACK UIDs/command:    500
ACK Batches/flush:   20
```

Watch `deleteMs` in ACK stats.

### `UIDVALIDITY mismatch`

The mailbox UID validity changed between fetch and ACK/NACK. The node refuses to delete by stale UID because the UID may now refer to a different message. The message should be delivered again with a fresh token.

### `IMAP message source is missing`

The server did not return message source for a candidate message. If the message is already `\Deleted`, current versions skip it and optionally expunge it. If it is not deleted, output 2 receives an error message so you can decide whether to retry or route it with `imap queue nack`.

## Installation

From the Node-RED user directory, usually `~/.node-red`:

```bash
npm install github:compeso/node-red-contrib-imap-queue
```

Then restart Node-RED.

For a local tarball:

```bash
cd ~/.node-red
npm install /path/to/compeso-node-red-contrib-imap-queue-0.5.0.tgz
```

## Local development

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

After import, open the `imap queue account` config node and enter username and password.

## Safety notes

- `imap queue ack` deletes messages. Test with a dedicated mailbox first.
- `imap queue nack` with action `delete` also deletes messages.
- `imap queue in` can expunge messages that already have the IMAP `\Deleted` flag when `Expunge front` is enabled.
- If your IMAP server does not support UIDPLUS, an EXPUNGE operation may expunge all messages in the selected mailbox that already have `\Deleted`. Use a dedicated queue mailbox.
- Wire `imap queue ack` only after all processing that must succeed.
- If processing fails, do not ACK. The message stays in the mailbox and will be delivered again.

## Upgrade notes

### From 0.4.x to 0.5.0

Version `0.5.0` renames the Node-RED node types to remove hyphens:

```text
imap-queue-account -> imap queue account
imap-queue-in      -> imap queue in
imap-queue-ack     -> imap queue ack
imap-queue-nack    -> imap queue nack
```

Existing flow JSON that contains the old type names must be migrated or the nodes must be recreated in the editor.

### From 0.3.x to 0.4.x

Version `0.4.0` adds Diagnostics settings and timing counters. `imap queue ack` has a third output for batch stats. Existing output 1 and output 2 wires keep their meaning.

Version `0.4.1` removes the obsolete `triggerMode` and `trigger` properties from `imap queue in` stats messages.

### From 0.3.0 to 0.3.1

Version `0.3.1` makes `imap queue in` defensive against messages that become `\Deleted` between the lightweight front-window scan and the full source fetch. Such messages are skipped and optionally expunged instead of being passed to `mailparser` with an empty source.

### From 0.2.x to 0.3.x

Version `0.3.0` changes the output shape of `imap queue in`:

```text
msg.html             removed
msg.attachments      removed
msg.email.subject    replaced by msg.email.topic
msg.email.headers    replaced by msg.email.header
```

The top-level `msg.topic` still contains the mail subject for normal Node-RED compatibility.

### From 0.1.x to 0.2.x

Version `0.1.x` implemented `imap queue in` as an automatic source node with internal polling. Version `0.2.0` changed it to an externally triggered input node.

After upgrading, add an Inject node, scheduler, or other trigger in front of `imap queue in`. The old settings `pollIntervalMs`, `drainIntervalMs`, and `autoStart` are no longer used.
