"use strict";

const { ensureMailbox } = require("./imap-utils");

const FLAG_ACTIONS = new Set(["ignore", "set", "clear"]);
const ACTIONS = new Set(["delete", "move", "copy", "flag"]);
const FLAG_MAP = {
  seen: "\\Seen",
  answered: "\\Answered",
  flagged: "\\Flagged"
};
const SYSTEM_FLAG_MAP = new Map([
  ["seen", "\\Seen"],
  ["answered", "\\Answered"],
  ["flagged", "\\Flagged"],
  ["deleted", "\\Deleted"],
  ["draft", "\\Draft"]
]);
const FORBIDDEN_SYSTEM_FLAGS = new Set(["recent", "*"]);
const ATOM_SPECIALS = /[\x00-\x20\x7f(){%*"\\\],]/;

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === "";
}

function normalizeFlagName(flag) {
  const raw = String(flag || "").trim();

  if (!raw) {
    throw new Error("ACK flag name is missing");
  }

  if (raw.startsWith("\\")) {
    const normalized = raw.replace(/^\\+/, "").toLowerCase();
    if (FORBIDDEN_SYSTEM_FLAGS.has(normalized)) {
      throw new Error(`Unsupported ACK flag: ${flag}`);
    }
    if (!SYSTEM_FLAG_MAP.has(normalized)) {
      throw new Error(`Unsupported ACK system flag: ${flag}`);
    }
    return SYSTEM_FLAG_MAP.get(normalized);
  }

  const normalizedSystem = raw.toLowerCase();
  if (SYSTEM_FLAG_MAP.has(normalizedSystem)) {
    return SYSTEM_FLAG_MAP.get(normalizedSystem);
  }
  if (FORBIDDEN_SYSTEM_FLAGS.has(normalizedSystem)) {
    throw new Error(`Unsupported ACK flag: ${flag}`);
  }
  if (ATOM_SPECIALS.test(raw)) {
    throw new Error(`Invalid ACK flag: ${flag}`);
  }

  return raw;
}

function flagIdentity(flag) {
  return String(flag || "")
    .trim()
    .replace(/^\\+/, "")
    .toLowerCase();
}

function normalizeFlagAction(value) {
  if (isBlank(value)) {
    return "ignore";
  }

  const normalized = String(value).trim().toLowerCase();
  if (!FLAG_ACTIONS.has(normalized)) {
    throw new Error(`Invalid ACK flag action: ${value}`);
  }

  return normalized;
}

function addFlagChange(flags, flag, action) {
  if (action === "set") {
    flags.add.push(flag);
  } else if (action === "clear") {
    flags.remove.push(flag);
  }
}

function splitFlagList(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    return value.split(/[,\s]+/);
  }

  throw new Error(`ACK ${fieldName} must be an array or string`);
}

function addRawFlags(flags, list, target) {
  for (const flag of list) {
    if (isBlank(flag)) {
      continue;
    }
    flags[target].push(normalizeFlagName(flag));
  }
}

function dedupeFlags(flags) {
  const result = [];
  const seen = new Set();

  for (const flag of flags) {
    const normalized = normalizeFlagName(flag);
    const key = flagIdentity(normalized);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function normalizeFlags(config = {}) {
  const source = config.flags || {};
  const flags = { add: [], remove: [] };
  addFlagChange(flags, FLAG_MAP.seen, normalizeFlagAction(config.seenAction || source.seen));
  addFlagChange(flags, FLAG_MAP.answered, normalizeFlagAction(config.answeredAction || source.answered));
  addFlagChange(flags, FLAG_MAP.flagged, normalizeFlagAction(config.flaggedAction || source.flagged));
  addRawFlags(flags, splitFlagList(config.flagAdd !== undefined ? config.flagAdd : source.add, "flags.add"), "add");
  addRawFlags(flags, splitFlagList(config.flagRemove !== undefined ? config.flagRemove : source.remove, "flags.remove"), "remove");
  return {
    add: dedupeFlags(flags.add),
    remove: dedupeFlags(flags.remove)
  };
}

function normalizeAckAction(config = {}) {
  const action = String(config.action || "delete").toLowerCase();
  if (!ACTIONS.has(action)) {
    throw new Error(`Unknown ACK action: ${action}`);
  }

  const plan = {
    action,
    disposition: action === "flag" ? "keep" : action,
    targetMailbox: action === "move" || action === "copy" ? String(config.targetMailbox || "").trim() : "",
    flags: normalizeFlags(config)
  };

  validateAckActionPlan(plan);

  return plan;
}

function validateAckActionPlan(plan) {
  if (!plan || typeof plan !== "object") {
    throw new Error("ACK action plan is missing");
  }

  if (!ACTIONS.has(plan.action)) {
    throw new Error(`Unknown ACK action: ${plan.action}`);
  }

  if (!["keep", "delete", "move", "copy"].includes(plan.disposition)) {
    throw new Error(`Invalid ACK disposition: ${plan.disposition}`);
  }

  if (plan.action === "flag" && plan.disposition !== "keep") {
    throw new Error("ACK flag action must keep the message");
  }

  if (plan.action === "delete" && plan.disposition !== "delete") {
    throw new Error("ACK delete action must delete the message");
  }

  if (plan.action === "move" && plan.disposition !== "move") {
    throw new Error("ACK move action must move the message");
  }

  if (plan.action === "copy" && plan.disposition !== "copy") {
    throw new Error("ACK copy action must copy the message");
  }

  const targetMailbox = String(plan.targetMailbox || "").trim();
  if ((plan.action === "move" || plan.action === "copy") && !targetMailbox) {
    throw new Error(`ACK ${plan.action} action requires a target mailbox`);
  }

  if (plan.action !== "move" && plan.action !== "copy" && targetMailbox) {
    throw new Error("ACK target mailbox is only valid for move or copy");
  }

  const flags = plan.flags || { add: [], remove: [] };
  const add = Array.isArray(flags.add) ? flags.add.map(normalizeFlagName) : [];
  const remove = Array.isArray(flags.remove) ? flags.remove.map(normalizeFlagName) : [];
  const added = new Set(add.map(flagIdentity));
  plan.flags = { add, remove };

  for (const flag of remove) {
    if (added.has(flagIdentity(flag))) {
      throw new Error(`Conflicting ACK flag actions for ${flag}`);
    }
  }

  if (plan.action === "delete" && (add.length > 0 || remove.length > 0)) {
    throw new Error("ACK delete cannot be combined with flag changes");
  }

  return true;
}

function getByPath(source, path) {
  return String(path || "")
    .split(".")
    .filter(Boolean)
    .reduce((value, part) => value && value[part], source);
}

function normalizeAckActionFromMessage(msg, path = "imap.ackAction") {
  const action = getByPath(msg, path);
  if (!action || typeof action !== "object") {
    throw new Error(`ACK action object is missing at msg.${path}`);
  }
  if (!action.action) {
    throw new Error(`ACK action value is missing at msg.${path}.action`);
  }
  return normalizeAckAction(action);
}

function getPlanFlags(plan) {
  return {
    add: plan && plan.flags && Array.isArray(plan.flags.add) ? plan.flags.add : [],
    remove: plan && plan.flags && Array.isArray(plan.flags.remove) ? plan.flags.remove : []
  };
}

function buildImapAckResult({
  token = {},
  plan,
  mailbox,
  range = ""
}) {
  return {
    ok: true,
    action: plan.action,
    disposition: plan.disposition,
    mailbox: mailbox || token.mailbox,
    targetMailbox: plan.targetMailbox || "",
    uid: token.uid,
    uidValidity: token.uidValidity,
    flags: getPlanFlags(plan),
    range,
    completed: true
  };
}

function buildImapAckError({
  token = {},
  plan = {},
  mailbox,
  range = "",
  error
}) {
  const result = {
    ok: false,
    action: plan.action,
    disposition: plan.disposition,
    mailbox: mailbox || token.mailbox,
    targetMailbox: plan.targetMailbox || "",
    uid: token.uid,
    uidValidity: token.uidValidity,
    flags: getPlanFlags(plan),
    range,
    completed: false,
    error: error && error.message ? error.message : String(error)
  };
  if (error && error.partial) {
    result.partial = true;
  }
  return result;
}

async function executeAckActionRange({ client, plan, range, mailbox, ensureTargetMailbox = true }) {
  validateAckActionPlan(plan);

  function hasCapability(name) {
    return !!(client
      && client.capabilities
      && typeof client.capabilities.has === "function"
      && client.capabilities.has(name));
  }

  function assertCapability(name, action) {
    if (!hasCapability(name)) {
      throw new Error(`ACK ${action} requires IMAP ${name} capability`);
    }
  }

  function assertImapSucceeded(result, action) {
    if (result === false || result === undefined) {
      throw new Error(`ACK ${action} failed for ${range}`);
    }
    return result;
  }

  async function applyFlagChanges() {
    const add = plan.flags && Array.isArray(plan.flags.add) ? plan.flags.add : [];
    const remove = plan.flags && Array.isArray(plan.flags.remove) ? plan.flags.remove : [];
    let changed = false;

    if (add.length > 0) {
      assertImapSucceeded(await client.messageFlagsAdd(range, add, { uid: true }), "flag add");
      changed = true;
    }
    if (remove.length > 0) {
      try {
        assertImapSucceeded(await client.messageFlagsRemove(range, remove, { uid: true }), "flag remove");
        changed = true;
      } catch (err) {
        if (changed) {
          err.partial = true;
        }
        throw err;
      }
    }
    return changed;
  }

  if (plan.action === "flag") {
    await applyFlagChanges();
  } else if (plan.action === "move") {
    assertCapability("MOVE", "move");
    if (ensureTargetMailbox) {
      await ensureMailbox(client, plan.targetMailbox);
    }
    const flagsChanged = await applyFlagChanges();
    try {
      assertImapSucceeded(await client.messageMove(range, plan.targetMailbox, { uid: true }), "move");
    } catch (err) {
      if (flagsChanged) {
        err.partial = true;
      }
      throw err;
    }
  } else if (plan.action === "copy") {
    if (ensureTargetMailbox) {
      await ensureMailbox(client, plan.targetMailbox);
    }
    const flagsChanged = await applyFlagChanges();
    try {
      assertImapSucceeded(await client.messageCopy(range, plan.targetMailbox, { uid: true }), "copy");
    } catch (err) {
      if (flagsChanged) {
        err.partial = true;
      }
      throw err;
    }
  } else if (plan.action === "delete") {
    assertCapability("UIDPLUS", "delete");
    assertImapSucceeded(await client.messageDelete(range, { uid: true }), "delete");
  } else {
    throw new Error(`Unsupported ACK action: ${plan.action}`);
  }

  return {
    ok: true,
    mailbox,
    range,
    action: plan.action,
    disposition: plan.disposition
  };
}

function actionPlanKey(plan) {
  return JSON.stringify({
    action: plan.action,
    disposition: plan.disposition,
    targetMailbox: plan.targetMailbox || "",
    flags: plan.flags || { add: [], remove: [] }
  });
}

module.exports = {
  normalizeAckAction,
  normalizeAckActionFromMessage,
  validateAckActionPlan,
  buildImapAckResult,
  buildImapAckError,
  executeAckActionRange,
  actionPlanKey
};
