# @compeso/node-red-contrib-imap-email

Node-RED nodes for externally triggered IMAP email processing with bounded cursor-window fetch and at-least-once ACK handling.

## Nodes

The package registers these Node-RED types:

```text
Flow type           Palette label        Purpose
imap-email account  imap email account   shared IMAP account configuration
imap-email in       imap email in        externally triggered bounded cursor-window fetch
imap-email ack      imap email ack       batched acknowledgement and UID actions
```

## Requirements

- Node.js `>=22.0.0`
- Node-RED `>=4.0.0`

Node-RED 5.x can require a stricter Node.js patch level than this package
declares. Check the Node-RED runtime requirement when upgrading Node-RED itself.

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

Import [examples/basic-at-least-once-flow.json](examples/basic-at-least-once-flow.json) in Node-RED, open the `imap email account` config node, and enter your IMAP username and password. The example tab is disabled by default, the Inject node does not run automatically, and the ACK path only marks messages as seen. The visible palette labels use spaces; the stored Flow-JSON types use the `imap-email ...` prefix.

Minimal flow:

```text
Inject / scheduler / HTTP trigger
  -> imap-email in
      -> your successful processing
          -> imap-email ack
```

Only wire messages to `imap-email ack` after all processing that must succeed has actually succeeded.

`imap-email ack` can be configured multiple times in one flow. Typical modes:

```text
delete       delete the mail by UID and complete it; requires IMAP UIDPLUS
move         optionally update flags, move the mail and complete it; requires native IMAP MOVE
copy         optionally update source flags, copy the mail to a target folder and complete it
flag         set or clear flags, keep the mail and complete it
set by msg.imap.ackAction
             read action, target folder and flags from the message
```

The ack node can set or clear `\Seen`, `\Answered`, `\Flagged`, other IMAP
system flags such as `\Draft`, and custom keywords such as `$Processed` in
`flag`, `move` and `copy` mode. With `move` and `copy`, flags are updated on the
source message before it is moved or copied. Use `delete` to delete mail;
setting `\Deleted` as a raw flag is an advanced flag operation and does not
replace the delete action.

## Large Mailboxes

`imap-email in` is designed for mailboxes that may contain many messages. It
does not run an unbounded mailbox-wide search. Instead, each trigger reads one
or more bounded windows and emits at most the configured batch size. Each
window is streamed and discarded before another window is read; only selected
candidate UIDs up to the remaining batch/inflight capacity are kept in memory.

Important settings:

```text
Batch size       maximum messages emitted per trigger
Front window     maximum messages inspected per trigger from the current cursor
Max inflight     maximum emitted but not-yet-ACKed messages tracked in memory
Retry after ms   time after which an un-ACKed message may be emitted again
Scan time ms     initial cursor-window soft time budget; 0 means one cursor window
UIDs/command     maximum UID count per IMAP command chunk
Max bytes        maximum RFC822 bytes per message, 0 means unlimited
Chunk bytes      streamed IMAP download chunk size
```

Selection settings:

```text
Deleted   Any | Only with flag | Only without flag
Seen      Any | Only with flag | Only without flag
Answered  Any | Only with flag | Only without flag
Flagged   Any | Only with flag | Only without flag
```

The defaults are `Deleted = Only without flag` and all other flags set to
`Any`. These filters are applied only inside the bounded cursor window. A
selective filter may emit fewer messages than `Batch size`; it never causes a
full-mailbox scan to fill the batch. When the cursor reaches the end of the
mailbox, it wraps back to the first sequence number. The cursor is volatile and
resets when Node-RED restarts or when IMAP UIDVALIDITY changes.

The node always uses an adaptive scan strategy. After restart or UIDVALIDITY
reset it starts in the `cursor-window` phase with full `Front window` sized
sequence windows. Empty windows are discarded and the node updates its status
after every read window. The phase stops when the batch/capacity is filled, the
mailbox end is reached, or `Scan time ms` expires; `0` means only one cursor
window. If a window contains more selectable messages than the remaining
batch/capacity can hold, the scan cursor is kept on that window so a later
trigger can continue draining it instead of leaving messages behind. This is
especially useful when the ACK node deletes or moves processed mails: after
those mails leave the mailbox, remaining messages shift into the held sequence
window and can be drained without being skipped. An empty mailbox with a valid
`UIDNEXT` is treated as already at the mailbox end.

Once the mailbox end has been reached without candidate overflow, the node
records the current `UIDNEXT`. Later triggers enter the `new-uid-priority`
phase: they first read newly arrived UIDs up to a per-trigger `UIDNEXT`
snapshot, then read one cyclic backlog window if capacity remains. In this
phase the new-UID and backlog windows each use about half of `Front window`,
with the larger half assigned to new UIDs. The logical new-UID window is still
bounded by `Front window`, and its UID fetches are additionally split into
commands of at most `UIDs/command` UIDs. New UIDs are emitted before backlog
messages and in ascending UID order, but the node does not guarantee globally
oldest unread delivery across the whole mailbox. Backlog windows are also held
on candidate overflow. If the new-UID window already covers all messages that
currently exist in the mailbox, the redundant backlog window is skipped.
New-UID windows advance to the first UID that did not fit into the current
batch, or to the next UID after the last actually read command chunk.

Stats report `phase` as the current operating phase (`cursor-window` or
`new-uid-priority`). `windowPhasesRead` contains the ordered unique window
types read during the trigger (`cursor`, `new-uid`, `backlog`); the last entry
is the last window type read.

Output messages include the server flags as an array:

```js
msg.imap.flags // for example ["\\Seen", "\\Flagged"]
msg.imap.flagState // { deleted: false, seen: true, answered: false, flagged: true }
```

Message bodies are downloaded as streams after the bounded front window has
selected candidate UIDs. Attachments are drained without buffering unless
`Attachments` is enabled. `Raw source` intentionally buffers the full RFC822
message in `msg.raw`; keep it disabled for very large messages. Set `Max bytes`
to a positive value to reject oversized messages on output 2 with
`msg.imap.ackToken` instead of parsing them.

## Delivery Semantics

The package provides at-least-once delivery.

```text
ACK action succeeded = successfully processed and ACKed
ACK action failed    = not successfully ACKed
Duplicate delivery   = possible
Exactly once         = not guaranteed
```

The inflight registry is volatile process memory. If Node-RED restarts after a message was emitted but before it was ACKed, the message remains in the mailbox and may be emitted again.

No message is reported as successfully completed if the configured IMAP action
fails. In that case output 2 receives the original message with
`msg.imapAck.ok = false`, and the inflight entry remains available for a later
retry.

To avoid unsafe IMAP fallback behavior, `delete` requires server support for
`UIDPLUS` and `move` requires native `MOVE`. Without those capabilities the ACK
action fails closed on output 2. `copy` keeps the source message and applies any
configured flag changes before copying it to the target mailbox.

ACK tokens are scoped to the configured IMAP account and must contain the
account, mailbox, UID, UIDVALIDITY and ACK scope fields emitted by
`imap-email in`. If a token is missing required scope fields or names a
different account, host, port, TLS setting, user or internal scope identifier,
the ACK node rejects it on output 2 instead of running an IMAP action against
the wrong account.

For dynamic decisions, configure `imap-email ack` to
`set by msg.imap.ackAction` and set `msg.imap.ackAction`:

```js
msg.imap.ackAction = {
  action: "move",               // delete, move, copy, flag
  targetMailbox: "Archive/Processed",
  flags: {
    seen: "set",                // ignore, set, clear
    answered: "ignore",
    flagged: "clear",
    add: ["$Processed"],
    remove: ["\\Draft"]
  }
};
```

Successful completions add `msg.imapAck` with fields such as `action`,
`disposition`, `mailbox`, `targetMailbox`, `uid`, `uidValidity`, `flags`,
`range` and `completed`. Failed completions may include
`msg.imapAck.partial = true` when flag changes were already applied before a
later IMAP command failed.

## Current Limits

- OAuth2 token acquisition and refresh are not implemented. The account node supports username/password and an optional static access token field.

## Development Checks

```bash
npm test
npm run pack:check
```

Do not publish this package to npm or flows.nodered.org without explicit human approval.
