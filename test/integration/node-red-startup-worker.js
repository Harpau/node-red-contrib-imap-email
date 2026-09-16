"use strict";

// A fresh process is required: Node-RED explicitly does not support start() again
// after stop() in the same process. Load a copy of actual persisted fixture flows
// and encrypted synthetic credentials; never call the deploy API in this worker.
const { startNodeRed, waitFor, delay } = require("./node-red-harness");

(async () => {
  const harness = await startNodeRed({ persistedDir: process.argv[2] });
  try {
    const initial = { statuses: 0, messages: 0, logs: 0 };
    await waitFor(() => ["input-main", "ack-main"].every(id => harness.statusesSince(initial, id)
      .some(status => status.text === "connected")), "startup probes from persisted flow");
    await delay(30);
    process.stdout.write(JSON.stringify({
      input: harness.statusesSince(initial, "input-main"),
      ack: harness.statusesSince(initial, "ack-main"),
      statusMessages: harness.collectedSince(initial, "status").map(msg => msg.status),
      warnings: harness.warningsSince(initial).length,
      outputMessages: harness.messages.filter(entry => entry.kind !== "status").length
    }));
  } finally { await harness.close(); }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
