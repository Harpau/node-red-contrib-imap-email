"use strict";

const VALID_LEVELS = new Set(["off", "stats", "debug"]);
const REDACTED = "[redacted]";
const DEFAULT_MAX_STRING_LENGTH = 500;

function normalizeDiagnostics(value, fallback = "stats") {
  const normalized = String(value || fallback || "stats").toLowerCase();
  return VALID_LEVELS.has(normalized) ? normalized : fallback;
}

function wantsStats(level) {
  return normalizeDiagnostics(level) !== "off";
}

function wantsDebug(level) {
  return normalizeDiagnostics(level) === "debug";
}

function redact(value, depth = 0) {
  if (depth > 6) {
    return "[max-depth]";
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return `[buffer:${value.length}]`;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => redact(item, depth + 1));
  }

  if (typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (/pass(word)?|token|secret|credential|auth|raw|source|attachments?/i.test(key)) {
        result[key] = REDACTED;
      } else if (key === "stack" && typeof item === "string") {
        result[key] = item.split("\n").slice(0, 8).join("\n");
      } else {
        result[key] = redact(item, depth + 1);
      }
    }
    return result;
  }

  if (typeof value === "string" && value.length > DEFAULT_MAX_STRING_LENGTH) {
    return `${value.slice(0, DEFAULT_MAX_STRING_LENGTH)}...[${value.length} chars]`;
  }

  return value;
}

function safeStringify(value) {
  try {
    return JSON.stringify(redact(value));
  } catch (err) {
    return String(value);
  }
}

function debug(node, level, event, data = {}) {
  if (!wantsDebug(level) || !node || typeof node.debug !== "function") {
    return;
  }

  node.debug(safeStringify({ event, ...data }));
}

function warn(node, message) {
  if (node && typeof node.warn === "function") {
    node.warn(message);
  }
}

function errorToObject(err) {
  return {
    message: err && err.message ? err.message : String(err),
    code: err && err.code ? err.code : undefined,
    stack: err && err.stack ? err.stack : undefined
  };
}

function createTimings() {
  const startedAt = Date.now();
  return {
    startedAt,
    marks: {},
    add(name, ms) {
      this.marks[name] = Math.max(0, Math.round(ms || 0));
    },
    measure(name, since) {
      this.add(name, Date.now() - since);
    },
    finish() {
      this.marks.totalMs = Math.max(0, Date.now() - startedAt);
      return this.marks;
    }
  };
}

module.exports = {
  normalizeDiagnostics,
  wantsStats,
  wantsDebug,
  redact,
  safeStringify,
  debug,
  warn,
  errorToObject,
  createTimings
};
