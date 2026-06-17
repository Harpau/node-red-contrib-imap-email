"use strict";

function parseNumber(value, fallback, min, max) {
  const n = Number(value);
  let result = Number.isFinite(n) ? n : fallback;

  if (Number.isFinite(min)) {
    result = Math.max(min, result);
  }
  if (Number.isFinite(max)) {
    result = Math.min(max, result);
  }

  return result;
}

function parseInteger(value, fallback, min, max) {
  return Math.trunc(parseNumber(value, fallback, min, max));
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === "") {
    return fallback;
  }

  return !["false", "0", "no", "nein", "off"].includes(normalized);
}

function hasFlag(flags, wanted) {
  if (!flags) {
    return false;
  }

  const normalizedWanted = String(wanted).replace(/^\\/, "").toLowerCase();
  const list = Array.isArray(flags) ? flags : Array.from(flags);

  return list.some((flag) => String(flag).replace(/^\\/, "").toLowerCase() === normalizedWanted);
}

function isDeleted(flags) {
  return hasFlag(flags, "Deleted");
}

const VALID_FLAG_SELECTIONS = new Set(["ignore", "require", "exclude"]);

function normalizeFlagSelection(value, fallback = "ignore") {
  const normalized = String(value || "").toLowerCase();
  if (VALID_FLAG_SELECTIONS.has(normalized)) {
    return normalized;
  }
  return VALID_FLAG_SELECTIONS.has(fallback) ? fallback : "ignore";
}

function matchesFlagSelection(flags, wanted, selection) {
  const mode = normalizeFlagSelection(selection);
  if (mode === "ignore") {
    return true;
  }

  const present = hasFlag(flags, wanted);
  return mode === "require" ? present : !present;
}

function matchesFlagSelections(flags, selections = {}) {
  return matchesFlagSelection(flags, "Deleted", selections.deleted)
    && matchesFlagSelection(flags, "Seen", selections.seen)
    && matchesFlagSelection(flags, "Answered", selections.answered)
    && matchesFlagSelection(flags, "Flagged", selections.flagged);
}

function flagsToArray(flags) {
  if (!flags) {
    return [];
  }
  return Array.isArray(flags) ? flags.map(String) : Array.from(flags).map(String);
}

function flagsToState(flags) {
  return {
    deleted: hasFlag(flags, "Deleted"),
    seen: hasFlag(flags, "Seen"),
    answered: hasFlag(flags, "Answered"),
    flagged: hasFlag(flags, "Flagged")
  };
}

function headersToObject(headers) {
  const result = Object.create(null);

  if (!headers || typeof headers[Symbol.iterator] !== "function") {
    return result;
  }

  for (const [key, value] of headers) {
    let baseKey = String(key);
    if (["__proto__", "prototype", "constructor"].includes(baseKey.toLowerCase())) {
      baseKey = `x-imap-email-header-${baseKey}`;
    }

    let targetKey = baseKey;
    let suffix = 2;
    while (Object.prototype.hasOwnProperty.call(result, targetKey)) {
      targetKey = `${baseKey}-${suffix}`;
      suffix += 1;
    }
    result[targetKey] = value;
  }

  return result;
}

async function ensureMailbox(client, mailbox) {
  if (!mailbox) {
    return;
  }

  try {
    await client.mailboxCreate(mailbox);
  } catch (err) {
    const msg = String(err && err.message || "");
    if (!/exists|already/i.test(msg)) {
      throw err;
    }
  }
}

module.exports = {
  parseNumber,
  parseInteger,
  parseBoolean,
  hasFlag,
  isDeleted,
  normalizeFlagSelection,
  matchesFlagSelection,
  matchesFlagSelections,
  flagsToArray,
  flagsToState,
  headersToObject,
  ensureMailbox
};
