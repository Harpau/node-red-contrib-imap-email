# Changelog

All notable changes to `@compeso/node-red-contrib-imap-email` are documented here.

This package is derived from `@compeso/node-red-contrib-imap-queue`, but it is versioned and published independently.

## 0.1.0 - Independent package rename

### Changed

- Renamed the npm package to `@compeso/node-red-contrib-imap-email`.
- Updated GitHub metadata to `https://github.com/Harpau/node-red-contrib-imap-email`.
- Renamed the public Node-RED types to:
  - `imap email account`
  - `imap email in`
  - `imap email ack`
- Renamed the public node implementation files to `nodes/imap-email-*.js`.
- Updated the example flow, Node-RED editor HTML, tests, and documentation to use the new names.

### Removed

- The old public `imap queue nack` node is not registered in this new package. Unified failure actions are planned for a later `imap email ack` feature step.

### Unchanged

- No new selection criteria were added in this rename.
- No ACK/NACK action model was redesigned in this rename.
- The existing bounded front-window fetch strategy remains in place.
- The existing positive ACK behavior still deletes messages by UID after successful processing.
