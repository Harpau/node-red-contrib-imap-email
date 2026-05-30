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

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return !["false", "0", "no", "nein", "off"].includes(String(value).toLowerCase());
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

function flagsToArray(flags) {
  if (!flags) {
    return [];
  }
  return Array.isArray(flags) ? flags.map(String) : Array.from(flags).map(String);
}

function headersToObject(headers) {
  const result = {};

  if (!headers || typeof headers[Symbol.iterator] !== "function") {
    return result;
  }

  for (const [key, value] of headers) {
    result[key] = value;
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
  parseBoolean,
  hasFlag,
  isDeleted,
  flagsToArray,
  headersToObject,
  ensureMailbox
};
