# @compeso/node-red-contrib-imap-queue

Node-RED nodes for using an IMAP mailbox as an **at-least-once queue**.

The package is designed for mailboxes that can temporarily contain many messages. It does not run an unbounded `SEARCH UNDELETED` over the whole mailbox. Instead, the input node reads a bounded front window such as `1:500`, emits only a limited batch, and waits for an ACK node to delete messages after successful processing.

## Nodes

### `imap-queue-account`

Configuration node with IMAP host, port, TLS settings and credentials.

### `imap-queue-in`

Source node. It polls the configured mailbox automatically and emits parsed e-mails.

Outputs:

1. Parsed mail message
2. Error / parse error message
3. Stats message

Important fields on output 1:

```js
msg.payload           // text body
msg.html              // html body if available
msg.email             // parsed metadata
msg.imap.ackToken     // required for imap-queue-ack
```

### `imap-queue-ack`

Input node. Wire this node only after successful processing. It batches ACKs internally and deletes messages by UID from the queue mailbox. No Inject node is required.

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

```text
Mailbox:                 INBOX
Poll interval:           1000 ms
Drain interval:          200 ms
Batch size:              50
Front window size:       500
Max inflight:            500
Retry after:             1800000 ms
ACK batch size:          100
ACK flush:               500 ms
UIDs per command:        500
Skip deleted:            true
Expunge deleted front:   true
Expunge deleted limit:   200
```

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

## GitHub quick start

```bash
git init
git add .
git commit -m "Initial IMAP queue Node-RED nodes"
git branch -M main
git remote add origin https://github.com/compeso/node-red-contrib-imap-queue.git
git push -u origin main
```
