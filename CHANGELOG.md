# Changelog

All notable changes to `@compeso/node-red-contrib-imap-email` are documented here.

## Unreleased

Target: compatible feature release `1.1.0`. The development package retains
version `1.0.1` until release preparation; the entries below describe unreleased
changes and do not certify completed release tests.

### Added

- Check the IMAP connection and authenticated session automatically when an
  active input or ACK node starts. Concurrent users of one account share the
  short-lived check, with a fixed 30-second overall timeout, safe status messages
  and cancellation on close or redeploy.
- Keep regular message processing independent of the startup check. No mailbox
  is selected and no mail or ACK action is performed by the check.

### Changed

- Update runtime dependency requirements to ImapFlow `^2.0.5` and Mailparser
  `^3.9.28`, retaining Node.js `>=22.0.0` and Node-RED `>=4.0.0`. The ImapFlow
  update includes bounded downloads when a server ignores partial-fetch limits.
- Check production dependencies in CI and update GitHub checkout/setup-node
  actions to v7.
- Update maintenance and release documentation, including the historical 1.0.1
  changes, actual-library checks and isolated Node-RED deploy acceptance tests.

### Fixed

- Guard ACK deletion and input window expunge against a false success from
  ImapFlow: confirm setting `\Deleted`, check the delete result and verify that
  no UIDs remain through a successful search restricted to the same bounded
  UID chunk, with connection and mailbox identity checks throughout. Retain
  `UIDPLUS` as a requirement; perform no mailbox-wide search.
- Preserve ACK inflight and stop later chunks in the group after a partial
  deletion failure. Abort input cleanup on partial or connection failures
  without counting unconfirmed removals. Earlier side effects are not rolled
  back. See [the historical reproduction and validation limits](docs/KNOWN_ISSUES.md).

## 1.0.1

### Fixed

- Abort active input fetches, downloads and parsing streams when the node
  closes. Bound close completion, suppress late outputs and preserve retry
  cursors and already-emitted inflight messages during interrupted batches.

### Changed

- Move input and ACK nodes to the Node-RED `network` palette group and use the
  IMAP mail color.
- Update dependency declarations from ImapFlow `1.0.76` to `^1.4.2` and from
  Mailparser `3.9.10` to `^3.9.11`, with an updated lockfile.
- Add regression coverage for input close behavior and update package metadata
  checks for the released version.

These entries were reconstructed from the repository changes between tags
`v1.0.0` and `v1.0.1`.

## 1.0.0 - Stable public release

### Added

- Declared the currently tested Node-RED IMAP email nodes as the first stable public release.
- Kept the Node.js `>=22.0.0` and Node-RED `>=4.0.0` compatibility baseline from `0.2.0`.

### Notes

- This release does not change runtime behavior from the tested development line.

## 0.2.0 - Development compatibility update

### Changed

- Raised the minimum runtime requirements to Node.js `>=22.0.0` and Node-RED
  `>=4.0.0`.
- Dropped Node.js 18, Node.js 20 and Node-RED 3 compatibility in this
  pre-1.0 development line. Node.js 18 reached end-of-life on 2025-04-30 and
  Node.js 20 reached end-of-life on 2026-04-30.
- Changed the `copy` ACK action in the pre-1.0 development line to copy the
  source message before applying configured flag changes to the source message.
- Updated `mailparser` to 3.9.10, which uses `nodemailer` 9.0.0 and removes
  the transitive Nodemailer audit path for `nodemailer <=8.0.8`.
- Hardened ACK inflight handling with bounded completion guards, active
  inflight protection during re-fetch and expunge, signed opaque ACK tokens,
  collision-resistant queue keys and prototype-safe parsed headers.
- Made the example account and editor defaults provider-neutral.

## 0.1.0 - Initial development release

### Added

- Registered the `imap-email account`, `imap-email in` and `imap-email ack` Node-RED types.
- Added shared IMAP account configuration with TLS, credential and timeout settings.
- Added externally triggered IMAP input processing with bounded cursor-window fetch for large mailboxes.
- Added Deleted, Seen, Answered and Flagged selection options.
- Added at-least-once delivery support through volatile inflight tracking and ACK tokens.
- Added ACK actions for delete, move, copy, flag and message-driven action plans.
- Added fail-closed ACK handling for unsafe delete and move capability fallbacks.
- Pinned production dependencies to an installable Node.js 18-compatible set.
- Added diagnostics, stats output, a disabled non-destructive example flow and package consistency tests.
