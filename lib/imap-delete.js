"use strict";

const { isClientClosed } = require("./imap-connection");

// Both callers already chunk at maxUidPerCommand <= 5000. Keep the helper
// unable to turn an accidental wildcard/query or oversized range into a scan.
const MAX_DELETE_UIDS = 5000;
const MAX_UID = 0xffffffff;

function validateRange(range) {
  if (typeof range !== "string" || !/^[1-9]\d*(?::[1-9]\d*)?(?:,[1-9]\d*(?::[1-9]\d*)?)*$/.test(range)) {
    throw new Error("IMAP delete requires a bounded numeric UID range");
  }
  let count = 0;
  for (const part of range.split(",")) {
    const [start, end = start] = part.split(":").map(Number);
    count += end - start + 1;
    if (end < start || start > MAX_UID || end > MAX_UID || count > MAX_DELETE_UIDS) {
      throw new Error(`IMAP delete range must contain at most ${MAX_DELETE_UIDS} valid UIDs`);
    }
  }
}

async function deleteUidRange(client, range) {
  validateRange(range);
  if (!client || !client.capabilities || typeof client.capabilities.has !== "function" || !client.capabilities.has("UIDPLUS")) {
    throw new Error("IMAP delete requires UIDPLUS capability");
  }

  const selected = client.mailbox;
  const path = selected && selected.path;
  const uidValidity = selected && selected.uidValidity !== undefined && selected.uidValidity !== null
    ? String(selected.uidValidity) : "";

  function assertSelected() {
    if (client.usable !== true || isClientClosed(client)) {
      throw Object.assign(new Error("IMAP delete connection is not available"), { code: "NoConnection" });
    }
    if (!path || !uidValidity || !client.mailbox || client.mailbox.path !== path
      || String(client.mailbox.uidValidity) !== uidValidity) {
      throw new Error("IMAP delete selected mailbox changed or is unavailable");
    }
  }

  async function confirmedCommand(run) {
    let sawOk = false;
    let rejected = false;
    const onResponse = (event) => {
      if (event && typeof event.response === "string" && event.response.toUpperCase() === "OK") sawOk = true;
      else rejected = true;
    };
    // The caller owns this client and holds its mailbox lock. Observe only
    // public tagged response statuses, before any other response listener.
    // ImapFlow can otherwise turn certain NO replies into successful results.
    client.prependListener("response", onResponse);
    try {
      const result = await run();
      if (!sawOk || rejected) {
        throw new Error(`IMAP delete command was not confirmed for ${range}`);
      }
      return result;
    } finally {
      client.removeListener("response", onResponse);
    }
  }

  assertSelected();
  // ImapFlow messageDelete() does not check the result of its internal STORE.
  // Check that operation ourselves before allowing any EXPUNGE.
  if (await confirmedCommand(() => client.messageFlagsAdd(range, ["\\Deleted"], { uid: true })) !== true) {
    throw new Error(`IMAP delete flag add failed for ${range}`);
  }

  try {
    assertSelected();
    if (await confirmedCommand(() => client.messageDelete(range, { uid: true })) !== true) {
      throw new Error(`IMAP delete failed for ${range}`);
    }
    assertSelected();
    // A concurrent client may remove Deleted between STORE and EXPUNGE.
    // Restrict SEARCH to this exact numeric UID chunk, never ALL or a wildcard.
    // SEARCH has an explicit result; the response guard also catches NO replies
    // that ImapFlow normalizes into success. FETCH can silently end after
    // exhausted throttling retries in ImapFlow 2.0.5 and cannot prove absence.
    const remaining = await confirmedCommand(() => client.search({ uid: range }, { uid: true }));
    assertSelected();
    if (!Array.isArray(remaining)) {
      throw new Error(`IMAP delete confirmation failed for ${range}`);
    }
    if (remaining.length > 0) {
      throw new Error(`IMAP delete could not confirm removal for ${range}`);
    }
    return true;
  } catch (error) {
    const failure = error instanceof Error ? error : new Error("IMAP delete confirmation failed");
    // Deleted was confirmed; the final outcome may be partially applied. Never
    // roll flags back or let ACK release inflight as successfully completed.
    failure.partial = true;
    throw failure;
  }
}

module.exports = { deleteUidRange };
