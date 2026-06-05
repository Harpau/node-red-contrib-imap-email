# Changelog

All notable changes to `@compeso/node-red-contrib-imap-queue` are documented here.

The package is developed for Node-RED flows that use an IMAP mailbox as a durable at-least-once queue. The mailbox remains the source of truth; messages are deleted only after successful downstream processing and ACK.

## 1.0.1 - IMAP connection error hardening

### Fixed

- Added non-throwing `error` handlers to every ImapFlow client created by the account node. This prevents asynchronous IMAP/TLS errors such as `read ECONNRESET` from becoming uncaught EventEmitter errors that can terminate the Node-RED runtime.
- `imap queue in`, `imap queue ack`, and `imap queue nack` now pass their node context to the account node when creating an IMAP client, so connection-level errors are reported as warnings on the operational node that triggered the connection.

## 1.0.0 - Stable release

First stable public release.

### Changed

- Promotes the successfully tested `0.9.0` release candidate to the stable `1.0.0` line.
- No intentional runtime behavior change from `0.9.0`.

## 0.9.0 - Release candidate

Release-candidate package before the first stable `1.0.0` line.

### Added

- Release-candidate version metadata.
- Public scoped-package publish metadata via `publishConfig.access = public`.
- `CHANGELOG.md`.
- German release checklist in `docs/RELEASE_DE.md`.
- Package metadata tests for release-critical fields.

### Changed

- No intentional runtime behavior change from `0.5.2`.
- Installation examples now reference `0.9.0` artifacts.

## 0.5.2

### Changed

- Default failed mailbox for `imap queue nack` changed from `.NodeRED.failed` to `NodeRED.failed` because some IMAP servers reject mailbox names that start with a dot.
- Bundled example flow replaced with the externally triggered STRATO-oriented queue example.

### Added

- Tests for example-flow validity, missing credentials, and non-dot-prefixed failed-mailbox defaults.

## 0.5.1

### Fixed

- GitHub Actions test workflow now installs runtime dependencies from `package.json` before running the module-load smoke test.
- Removed reliance on repository lockfiles that may have been generated against private or local npm registries.

## 0.5.0

### Changed

- Node-RED type names now use spaces instead of hyphens:
  - `imap-queue-account` -> `imap queue account`
  - `imap-queue-in` -> `imap queue in`
  - `imap-queue-ack` -> `imap queue ack`
  - `imap-queue-nack` -> `imap queue nack`
- README fully rewritten with detailed settings, message shapes, diagnostics, tuning, and troubleshooting sections.
- Node-RED help text expanded for all nodes.

## 0.4.1

### Changed

- Removed obsolete `triggerMode` and `trigger` properties from `imap queue in` stats messages.

## 0.4.0

### Added

- Diagnostics setting for `imap queue in`, `imap queue ack`, and `imap queue nack`.
- Structured timing counters for `imap queue in` stats.
- Third output on `imap queue ack` for ACK batch stats.
- Redacted debug logging helpers.

### Changed

- Operational ACK/NACK errors are routed to node outputs and warnings instead of being over-reported as hard runtime errors.

## 0.3.2

### Added

- GitHub Actions workflow for Node.js 18, 20, 22, and 24.
- Module-load smoke test.

## 0.3.1

### Fixed

- `imap queue in` now skips messages that become `\\Deleted` between front-window scan and full fetch instead of passing an empty source to `mailparser`.
- Added counters for `deletedSkippedDuringFetch` and `missingSource`.

## 0.3.0

### Changed

- Output shape adjusted:
  - Removed top-level `msg.html`.
  - Removed top-level `msg.attachments`.
  - Replaced `msg.email.subject` with `msg.email.topic`.
  - Replaced `msg.email.headers` with `msg.email.header`.
- Attachments are emitted only under `msg.email.attachments` when enabled.

## 0.2.0

### Changed

- `imap queue in` changed from an automatic polling source node to an externally triggered input node.
- Each incoming trigger starts exactly one bounded fetch cycle.
- Internal polling and drain timers removed from fetch behavior.

## 0.1.0

### Added

- Initial package skeleton.
- `imap queue account` config node.
- `imap queue in` bounded front-window fetch node.
- `imap queue ack` batched UID delete node.
- `imap queue nack` optional negative acknowledgement node.
- At-least-once delivery model with volatile in-memory inflight tracking.
