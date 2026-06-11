"use strict";

const { ensureMailbox } = require("./imap-utils");

const FLAG_ACTIONS = new Set(["ignore", "set", "clear"]);
const ACTIONS = new Set(["delete", "move", "flag"]);
const FLAG_MAP = {
  seen: "\\Seen",
  answered: "\\Answered",
  flagged: "\\Flagged"
};

function normalizeFlagAction(value) {
  const normalized = String(value || "ignore").toLowerCase();
  return FLAG_ACTIONS.has(normalized) ? normalized : "ignore";
}

function addFlagChange(flags, flag, action) {
  if (action === "set") {
    flags.add.push(flag);
  } else if (action === "clear") {
    flags.remove.push(flag);
  }
}

function normalizeFlags(config = {}) {
  if (config.flags && (Array.isArray(config.flags.add) || Array.isArray(config.flags.remove))) {
    return {
      add: Array.isArray(config.flags.add) ? config.flags.add.map(String) : [],
      remove: Array.isArray(config.flags.remove) ? config.flags.remove.map(String) : []
    };
  }

  const source = config.flags || {};
  const flags = { add: [], remove: [] };
  addFlagChange(flags, FLAG_MAP.seen, normalizeFlagAction(config.seenAction || source.seen));
  addFlagChange(flags, FLAG_MAP.answered, normalizeFlagAction(config.answeredAction || source.answered));
  addFlagChange(flags, FLAG_MAP.flagged, normalizeFlagAction(config.flaggedAction || source.flagged));
  return flags;
}

function normalizeAckAction(config = {}) {
  const action = String(config.action || config.actionMode || "delete").toLowerCase();
  if (!ACTIONS.has(action)) {
    throw new Error(`Unknown ACK action: ${action}`);
  }

  const plan = {
    action,
    disposition: action === "flag" ? "keep" : action,
    targetMailbox: action === "move" ? String(config.targetMailbox || "").trim() : "",
    flags: action === "flag" ? normalizeFlags(config) : normalizeFlags(config)
  };

  validateAckActionPlan(plan);

  if (action !== "flag") {
    plan.flags = { add: [], remove: [] };
  }

  return plan;
}

function validateAckActionPlan(plan) {
  if (!plan || typeof plan !== "object") {
    throw new Error("ACK action plan is missing");
  }

  if (!ACTIONS.has(plan.action)) {
    throw new Error(`Unknown ACK action: ${plan.action}`);
  }

  if (!["keep", "delete", "move"].includes(plan.disposition)) {
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

  const targetMailbox = String(plan.targetMailbox || "").trim();
  if (plan.action === "move" && !targetMailbox) {
    throw new Error("ACK move action requires a target mailbox");
  }

  if (plan.action !== "move" && targetMailbox) {
    throw new Error("ACK target mailbox is only valid for move");
  }

  const flags = plan.flags || { add: [], remove: [] };
  const add = Array.isArray(flags.add) ? flags.add.map(String) : [];
  const remove = Array.isArray(flags.remove) ? flags.remove.map(String) : [];
  const added = new Set(add.map((flag) => flag.toLowerCase()));

  for (const flag of remove) {
    if (added.has(String(flag).toLowerCase())) {
      throw new Error(`Conflicting ACK flag actions for ${flag}`);
    }
  }

  if (plan.action === "delete" && (add.length > 0 || remove.length > 0)) {
    throw new Error("ACK delete cannot be combined with flag changes");
  }

  if (plan.action === "move" && (add.length > 0 || remove.length > 0)) {
    throw new Error("ACK move cannot be combined with flag changes");
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
  return {
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
}

async function executeAckActionRange({ client, plan, range, mailbox, ensureTargetMailbox = true }) {
  validateAckActionPlan(plan);

  if (plan.action === "flag") {
    const add = plan.flags && Array.isArray(plan.flags.add) ? plan.flags.add : [];
    const remove = plan.flags && Array.isArray(plan.flags.remove) ? plan.flags.remove : [];

    if (add.length > 0) {
      await client.messageFlagsAdd(range, add, { uid: true });
    }
    if (remove.length > 0) {
      await client.messageFlagsRemove(range, remove, { uid: true });
    }
  } else if (plan.action === "move") {
    if (ensureTargetMailbox) {
      await ensureMailbox(client, plan.targetMailbox);
    }
    await client.messageMove(range, plan.targetMailbox, { uid: true });
  } else if (plan.action === "delete") {
    await client.messageDelete(range, { uid: true });
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
