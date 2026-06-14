# Changelog

All notable changes to `@compeso/node-red-contrib-imap-email` are documented here.

## 0.1.0 - Initial development release

### Added

- Registered the `imap-email account`, `imap-email in` and `imap-email ack` Node-RED types.
- Added shared IMAP account configuration with TLS, credential and timeout settings.
- Added externally triggered IMAP input processing with bounded cursor-window fetch for large mailboxes.
- Added Deleted, Seen, Answered and Flagged selection options.
- Added at-least-once delivery support through volatile inflight tracking and ACK tokens.
- Added ACK actions for delete, move, copy, flag and message-driven action plans.
- Added fail-closed ACK handling for unsafe delete and move capability fallbacks.
- Added diagnostics, stats output, a disabled non-destructive example flow and package consistency tests.
