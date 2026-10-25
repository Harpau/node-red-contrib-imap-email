# Changelog

All notable changes to `@compeso/node-red-contrib-imap-email` are documented here.

## 1.1.1 - Unpublished release candidate

Package and lockfile version: `1.1.1`. This compatible maintenance release is
being prepared as a local candidate and has not been published. No release date
is assigned. GitHub CI on the final state, external provider testing and
publication approval remain pending; the entries below do not certify release
readiness. The latest published version remains `1.1.0`.

### Security

- Resolve moderate advisories in production dependencies. Nodemailer below
  `10.1.4` (GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w and GHSA-85x2-q946-cp5h
  in the address parser that Mailparser uses for address headers) is excluded
  by the new Mailparser requirement, which resolves Nodemailer `10.2.1`. The
  lockfile resolves `ip-address` `10.7.5` instead of `10.7.2`
  (GHSA-rxp7-6hxx-x8q5); that package is a transitive dependency of `socks`
  via ImapFlow and is not constrained by this package's declared ranges, so
  consumers with their own lockfile should refresh it, for example with
  `npm audit fix`.

### Changed

- Update runtime dependency requirements to ImapFlow `^2.9.1` and Mailparser
  `^3.12.4`, matching the tested lockfile, and retain Node.js `>=22.0.0` and
  Node-RED `>=4.0.0`. ImapFlow `2.0.8` and later check the internal
  `\Deleted` STORE result in `messageDelete()`; the package's bounded deletion
  helper keeps its own explicit check as defense in depth and is otherwise
  unchanged.
- With ImapFlow `2.0.8` and later, a fetch whose server throttling is still
  active after the library's own retries rejects with `ETHROTTLE` instead of
  resolving to an empty window. `imap email in` reports this like any other
  fetch error: red status, error object on output 2 and `node.error`, not as
  a transient connection error. Fresh installations of `1.1.0` already resolve
  these ImapFlow versions through the previous `^2.0.5` range.
- Align the library contract tests with ImapFlow `2.9.1` behavior and add a
  check that pins the upstream STORE result handling. The package's public
  flow contracts are unchanged.

### Documentation

- Document the upstream ImapFlow fix and the retained package protection in
  [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md).

## 1.1.0 - 2026-09-16

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
