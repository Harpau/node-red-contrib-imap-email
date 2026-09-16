# Actual Node-RED integration tests

These tests load the packed npm package into an actual Node-RED runtime. They use
only the loopback IMAP fixture and synthetic credentials. Each run creates and
removes an isolated Node-RED user directory; it never uses the normal user profile.

Prepare a separate installation with Node-RED 4.x and the freshly generated package
tarball. Set `NODE_RED_TEST_DIR` to that installation directory, then run:

```sh
NODE_RED_TEST_DIR=/private/tmp/imap-email-integration-env node --test test/integration/*.test.js
```

The harness refuses a package symlink to the source checkout. Refresh the installed
tarball after runtime changes. These tests are deliberately separate from the unit
test command and fail when the required runtime/package installation is missing.
They must be run explicitly for the deploy feature's technical acceptance.

The suite deploys through the actual runtime API, exercises the real credential
store and full/modified-nodes/modified-flows lifecycle, and observes both runtime
status events and built-in Status node output. Direct `receive` calls simulate
input messages; they do not replace the IMAP client or node constructors. No custom
node types are registered by the harness.

The external provider test and later GitHub CI run remain separate release checks.
