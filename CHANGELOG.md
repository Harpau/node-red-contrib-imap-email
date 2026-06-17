# Changelog

All notable changes to `@compeso/node-red-contrib-imap-email` are documented here.

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
