"use strict";

const { ensureMailbox } = require("./imap-utils");

const FLAG_ACTIONS = new Set(["ignore", "set", "clear"]);
const REQUEUE_MODES = new Set(["complete", "later", "now"]);
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

  const flags = { add: [], remove: [] };
  addFlagChange(flags, FLAG_MAP.seen, normalizeFlagAction(config.seenAction || config.flags && config.flags.seen));
  addFlagChange(flags, FLAG_MAP.answered, normalizeFlagAction(config.answeredAction || config.flags && config.flags.answered));
  addFlagChange(flags, FLAG_MAP.flagged, normalizeFlagAction(config.flaggedAction || config.flags && config.flags.flagged));
  return flags;
}

function normalizeRequeue(value, fallback = "complete") {
  const normalized = String(value || fallback).toLowerCase();
  return REQUEUE_MODES.has(normalized) ? normalized : fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  return !["false", "0", "no", "nein", "off"].includes(String(value).toLowerCase());
}

function normalizeAckAction(config = {}) {
  const mode = String(config.mode || config.actionMode || config.disposition || "delete").toLowerCase();
  let plan;

  if (mode === "delete") {
    plan = {
      mode: "delete",
      disposition: "delete",
      targetMailbox: "",
      createTargetMailbox: false,
      requeue: "complete",
      flags: normalizeFlags(config)
    };
  } else if (mode === "keep-requeue-later" || mode === "retry" || mode === "keep") {
    plan = {
      mode: "keep-requeue-later",
      disposition: "keep",
      targetMailbox: "",
      createTargetMailbox: false,
      requeue: "later",
      flags: normalizeFlags(config)
    };
  } else if (mode === "keep-requeue-now" || mode === "retry-now") {
    plan = {
      mode: "keep-requeue-now",
      disposition: "keep",
      targetMailbox: "",
      createTargetMailbox: false,
      requeue: "now",
      flags: normalizeFlags(config)
    };
  } else if (mode === "move") {
    plan = {
      mode: "move",
      disposition: "move",
      targetMailbox: String(config.targetMailbox || config.failedMailbox || "").trim(),
      createTargetMailbox: normalizeBoolean(config.createTargetMailbox, true),
      requeue: "complete",
      flags: normalizeFlags(config)
    };
  } else if (mode === "custom" || mode === "message") {
    plan = {
      mode,
      disposition: String(config.disposition || "keep").toLowerCase(),
      targetMailbox: String(config.targetMailbox || "").trim(),
      createTargetMailbox: normalizeBoolean(config.createTargetMailbox, false),
      requeue: normalizeRequeue(config.requeue),
      flags: normalizeFlags(config)
    };
  } else {
    throw new Error(`Unknown ACK action mode: ${mode}`);
  }

  validateAckActionPlan(plan);
  return plan;
}

function validateAckActionPlan(plan) {
  if (!plan || typeof plan !== "object") {
    throw new Error("ACK action plan is missing");
  }

  if (!["keep", "delete", "move"].includes(plan.disposition)) {
    throw new Error(`Invalid ACK disposition: ${plan.disposition}`);
  }

  const targetMailbox = String(plan.targetMailbox || "").trim();
  if (plan.disposition === "move" && !targetMailbox) {
    throw new Error("ACK move action requires a target mailbox");
  }

  if (plan.disposition === "delete" && targetMailbox) {
    throw new Error("ACK delete and move target mailbox are mutually exclusive");
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

  if (plan.disposition === "delete" && (add.length > 0 || remove.length > 0)) {
    throw new Error("ACK delete cannot be combined with flag changes");
  }

  if (!REQUEUE_MODES.has(plan.requeue)) {
    throw new Error(`Invalid ACK requeue mode: ${plan.requeue}`);
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
  return normalizeAckAction({ mode: "message", ...action });
}

function buildImapAckResult({
  token = {},
  plan,
  mailbox,
  ranges = [],
  batchSize = 0,
  inflightRemoved = false
}) {
  return {
    ok: true,
    mode: plan.mode,
    disposition: plan.disposition,
    mailbox: mailbox || token.mailbox,
    targetMailbox: plan.targetMailbox || "",
    uid: token.uid,
    uidValidity: token.uidValidity,
    flags: {
      add: plan.flags && Array.isArray(plan.flags.add) ? plan.flags.add : [],
      remove: plan.flags && Array.isArray(plan.flags.remove) ? plan.flags.remove : []
    },
    ranges,
    batchSize,
    requeue: plan.requeue,
    completed: true,
    inflightRemoved
  };
}

function buildImapAckError({
  token = {},
  plan,
  mailbox,
  error,
  inflightRemoved = false
}) {
  return {
    ok: false,
    mode: plan && plan.mode,
    disposition: plan && plan.disposition,
    mailbox: mailbox || token.mailbox,
    targetMailbox: plan && plan.targetMailbox || "",
    uid: token.uid,
    uidValidity: token.uidValidity,
    error: error && error.message ? error.message : String(error),
    completed: false,
    inflightRemoved
  };
}

async function executeAckActionBatch({ client, plan, uidRanges, mailbox }) {
  validateAckActionPlan(plan);
  const ranges = Array.isArray(uidRanges) ? uidRanges : [];
  const add = plan.flags && Array.isArray(plan.flags.add) ? plan.flags.add : [];
  const remove = plan.flags && Array.isArray(plan.flags.remove) ? plan.flags.remove : [];

  if (add.length > 0) {
    for (const range of ranges) {
      await client.messageFlagsAdd(range, add, { uid: true });
    }
  }

  if (remove.length > 0) {
    for (const range of ranges) {
      await client.messageFlagsRemove(range, remove, { uid: true });
    }
  }

  if (plan.disposition === "move") {
    if (plan.createTargetMailbox) {
      await ensureMailbox(client, plan.targetMailbox);
    }
    for (const range of ranges) {
      await client.messageMove(range, plan.targetMailbox, { uid: true });
    }
  } else if (plan.disposition === "delete") {
    for (const range of ranges) {
      await client.messageDelete(range, { uid: true });
    }
  } else if (plan.disposition !== "keep") {
    throw new Error(`Unsupported ACK disposition: ${plan.disposition}`);
  }

  return {
    ok: true,
    mailbox,
    ranges,
    action: plan.mode,
    disposition: plan.disposition
  };
}

function actionPlanKey(plan) {
  return JSON.stringify({
    mode: plan.mode,
    disposition: plan.disposition,
    targetMailbox: plan.targetMailbox || "",
    createTargetMailbox: !!plan.createTargetMailbox,
    requeue: plan.requeue,
    flags: plan.flags || { add: [], remove: [] }
  });
}

module.exports = {
  normalizeAckAction,
  normalizeAckActionFromMessage,
  validateAckActionPlan,
  buildImapAckResult,
  buildImapAckError,
  executeAckActionBatch,
  actionPlanKey
};
