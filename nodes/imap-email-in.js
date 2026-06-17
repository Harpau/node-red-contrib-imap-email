"use strict";

const { Transform } = require("node:stream");
const { MailParser } = require("mailparser");
const { buildAckToken } = require("../lib/ack-token");
const registry = require("../lib/runtime-registry");
const { chunkUids, compressUids } = require("../lib/uid-range");
const {
  parseInteger,
  parseBoolean,
  isDeleted,
  normalizeFlagSelection,
  matchesFlagSelections,
  flagsToArray,
  flagsToState,
  headersToObject
} = require("../lib/imap-utils");
const {
  formatImapError,
  isTransientImapConnectionError,
  safeLogout
} = require("../lib/imap-connection");
const diagnostics = require("../lib/diagnostics");

const DEFAULT_DOWNLOAD_CHUNK_SIZE = 64 * 1024;
const TOO_LARGE_CODE = "IMAP_EMAIL_MESSAGE_TOO_LARGE";
const DEFAULT_SCAN_TIME_LIMIT_MS = 10000;

function buildTooLargeError(limit) {
  const err = new Error(`IMAP message exceeds maxMessageBytes (${limit})`);
  err.code = TOO_LARGE_CODE;
  return err;
}

function isTooLargeError(err) {
  return err && err.code === TOO_LARGE_CODE;
}

function createCountingStream(limit, collectRaw) {
  let bytes = 0;
  const chunks = [];

  const stream = new Transform({
    transform(chunk, encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      bytes += buffer.length;

      if (collectRaw) {
        chunks.push(buffer);
      }

      if (limit > 0 && bytes > limit) {
        callback(buildTooLargeError(limit));
        return;
      }

      callback(null, buffer);
    }
  });

  stream.getRaw = function getRaw() {
    return collectRaw ? Buffer.concat(chunks, bytes) : undefined;
  };

  return stream;
}

function headersToMailFields(mail) {
  [
    "subject",
    "references",
    "date",
    "to",
    "from",
    "cc",
    "bcc",
    "message-id",
    "in-reply-to",
    "reply-to"
  ].forEach((key) => {
    if (mail.headers && mail.headers.has(key)) {
      mail[key.replace(/-([a-z])/g, (match, chr) => chr.toUpperCase())] = mail.headers.get(key);
    }
  });
}

function drainAttachment(data, includeAttachments, done) {
  if (includeAttachments) {
    const chunks = [];
    let chunkLength = 0;

    data.content.on("readable", () => {
      let chunk;
      while ((chunk = data.content.read()) !== null) {
        chunks.push(chunk);
        chunkLength += chunk.length;
      }
    });

    data.content.once("end", () => {
      data.content = Buffer.concat(chunks, chunkLength);
      if (typeof data.release === "function") {
        data.release();
      }
      done();
    });
  } else {
    data.content.on("readable", () => {
      while (data.content.read() !== null) {
        // Drain the stream so MailParser can continue without buffering it.
      }
    });

    data.content.once("end", () => {
      if (typeof data.release === "function") {
        data.release();
      }
      done();
    });
  }

  data.content.once("error", done);
}

function parseMailStream(source, options = {}) {
  return new Promise((resolve, reject) => {
    const includeAttachments = !!options.includeAttachments;
    const emitRaw = !!options.emitRaw;
    const maxMessageBytes = Math.max(0, Number(options.maxMessageBytes) || 0);
    const mail = includeAttachments ? { attachments: [] } : {};
    const counter = createCountingStream(maxMessageBytes, emitRaw);
    const parser = new MailParser({
      skipImageLinks: !includeAttachments,
      skipTextToHtml: true
    });
    let settled = false;
    let reading = false;

    function unpipeQuietly(from, to) {
      try {
        if (from && typeof from.unpipe === "function") {
          from.unpipe(to);
        }
      } catch (ignored) {
        // ignore
      }
    }

    function destroyQuietly(stream) {
      try {
        if (stream && typeof stream.destroy === "function" && !stream.destroyed) {
          stream.destroy();
        }
      } catch (ignored) {
        // ignore
      }
    }

    function finish(err, value) {
      if (settled) {
        return;
      }
      settled = true;

      if (err) {
        unpipeQuietly(source, counter);
        unpipeQuietly(counter, parser);
        destroyQuietly(source);
        destroyQuietly(counter);
        destroyQuietly(parser);
        reject(err);
      } else {
        resolve(value);
      }
    }

    function readNext() {
      reading = true;

      let data;
      while ((data = parser.read()) !== null) {
        if (data.type === "text") {
          for (const key of Object.keys(data)) {
            if (["text", "html"].includes(key)) {
              mail[key] = data[key];
            }
          }
          continue;
        }

        if (data.type === "attachment") {
          if (includeAttachments) {
            mail.attachments.push(data);
          }
          drainAttachment(data, includeAttachments, (err) => {
            if (err) {
              finish(err);
              return;
            }
            readNext();
          });
          return;
        }
      }

      reading = false;
    }

    parser.on("headers", (headers) => {
      mail.headers = headers;
      mail.headerLines = parser.headerLines;
    });

    parser.on("readable", () => {
      if (!reading) {
        readNext();
      }
    });

    parser.on("error", finish);
    counter.on("error", finish);
    source.on("error", finish);

    parser.once("end", () => {
      headersToMailFields(mail);

      function finishParsed(html) {
        if (html) {
          mail.html = html;
        }
        if (emitRaw) {
          mail.raw = counter.getRaw();
        }
        finish(null, mail);
      }

      if (includeAttachments && typeof parser.updateImageLinks === "function") {
        parser.updateImageLinks(
          (attachment, done) => done(false, `data:${attachment.contentType};base64,${attachment.content.toString("base64")}`),
          (err, html) => {
            if (err) {
              finish(err);
              return;
            }
            finishParsed(html);
          }
        );
        return;
      }

      finishParsed();
    });

    source.pipe(counter).pipe(parser);
  });
}

module.exports = function registerImapEmailIn(RED) {
  function ImapEmailInNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    node.account = RED.nodes.getNode(config.account);
    node.name = config.name || "";
    node.mailbox = config.mailbox || "INBOX";
    node.batchSize = parseInteger(config.batchSize, 50, 1, 5000);
    node.frontWindowSize = parseInteger(config.frontWindowSize, 500, 1, 100000);
    node.maxInflight = parseInteger(config.maxInflight, 500, 1, 100000);
    node.retryAfterMs = parseInteger(config.retryAfterMs, 30 * 60 * 1000, 1000, 7 * 24 * 60 * 60 * 1000);
    node.scanTimeLimitMs = parseInteger(config.scanTimeLimitMs, DEFAULT_SCAN_TIME_LIMIT_MS, 0, 10 * 60 * 1000);
    node.maxUidPerCommand = parseInteger(config.maxUidPerCommand, 500, 1, 5000);
    node.deletedSelection = normalizeFlagSelection(config.deletedSelection, "exclude");
    node.seenSelection = normalizeFlagSelection(config.seenSelection, "ignore");
    node.answeredSelection = normalizeFlagSelection(config.answeredSelection, "ignore");
    node.flaggedSelection = normalizeFlagSelection(config.flaggedSelection, "ignore");
    node.selection = {
      deleted: node.deletedSelection,
      seen: node.seenSelection,
      answered: node.answeredSelection,
      flagged: node.flaggedSelection
    };
    node.expungeDeletedFront = parseBoolean(config.expungeDeletedFront, true);
    node.expungeDeletedFrontLimit = parseInteger(config.expungeDeletedFrontLimit, 200, 0, 10000);
    node.maxMessageBytes = parseInteger(config.maxMessageBytes, 0, 0, Number.MAX_SAFE_INTEGER);
    node.downloadChunkSize = parseInteger(config.downloadChunkSize, DEFAULT_DOWNLOAD_CHUNK_SIZE, 1024, 16 * 1024 * 1024);
    node.includeAttachments = parseBoolean(config.includeAttachments, false);
    node.emitRaw = parseBoolean(config.emitRaw, false);
    node.diagnostics = diagnostics.normalizeDiagnostics(config.diagnostics, "stats");

    node.closed = false;
    node.running = false;
    node.closeDone = null;
    node.scanCursor = 1;
    node.scanUidValidity = null;
    node.newUidCursor = null;

    if (!node.account) {
      node.status({ fill: "red", shape: "ring", text: "missing account" });
      node.error("Missing imap email account configuration");
      return;
    }

    node.queueKey = registry.makeQueueKey({
      accountId: node.account.id,
      host: node.account.host,
      user: node.account.getUsername(),
      mailbox: node.mailbox
    });

    function buildBaseStats() {
      return {
        ok: true,
        type: "imap email in stats",
        diagnostics: node.diagnostics,
        mailbox: node.mailbox,
        exists: 0,
        uidValidity: null,
        uidNextSnapshot: null,
        scanTimeLimitMs: node.scanTimeLimitMs,
        scanTimeLimitReached: false,
        phase: null,
        windowPhasesRead: [],
        frontWindowSize: node.frontWindowSize,
        frontWindowRead: 0,
        windowsRead: 0,
        scanCursorStart: null,
        scanCursorEnd: null,
        scanCursorNext: node.scanCursor,
        scanCursorReset: false,
        scanCursorAdjusted: false,
        scanCursorHeld: false,
        scanWrapped: false,
        newUidCursor: node.newUidCursor,
        newUidCursorInitialized: false,
        uidWindowStart: null,
        uidWindowEnd: null,
        uidWindowNext: null,
        activeInflight: 0,
        activeInflightAfter: 0,
        inflightTotal: 0,
        inflightPruned: 0,
        maxInflight: node.maxInflight,
        capacity: 0,
        candidates: 0,
        candidateOverflow: false,
        windowUnselectedCandidates: 0,
        filteredByFlags: 0,
        filteredByInflight: 0,
        fetched: 0,
        emitted: 0,
        parseErrors: 0,
        deletedFlagged: 0,
        deletedExpunged: 0,
        deletedExpungeSkipped: 0,
        deletedExpungeSkippedInflight: 0,
        deletedExpungeErrors: 0,
        deletedExpungeSkipReason: undefined,
        deletedSkippedDuringFetch: 0,
        missingSource: 0,
        missingMessages: 0,
        tooLarge: 0,
        connectionErrors: 0,
        maxMessageBytes: node.maxMessageBytes,
        downloadChunkSize: node.downloadChunkSize,
        skipped: false,
        reason: undefined,
        queueKey: node.queueKey,
        selection: node.selection,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        timings: {}
      };
    }

    function emitStats(send, stats) {
      stats.finishedAt = new Date().toISOString();
      if (diagnostics.wantsStats(node.diagnostics)) {
        send([null, null, { payload: stats }]);
      }
      diagnostics.debug(node, node.diagnostics, "imap email in.stats", stats);
    }

    function addTiming(timing, name, startedAt) {
      const ms = Math.max(0, Date.now() - startedAt);
      timing.marks[name] = Math.max(0, Number(timing.marks[name] || 0) + ms);
    }

    function buildImapMeta(uid, uidValidity, imapMessage, ackToken) {
      return {
        accountId: node.account.id,
        mailbox: node.mailbox,
        uid,
        uidValidity,
        size: imapMessage && imapMessage.size,
        flags: flagsToArray(imapMessage && imapMessage.flags),
        flagState: flagsToState(imapMessage && imapMessage.flags),
        ackToken,
        delivery: {
          mode: "at-least-once",
          duplicatePossible: true
        }
      };
    }

    function ensureScanUidValidity(uidValidity) {
      let reset = false;

      if (node.scanUidValidity === null) {
        node.scanUidValidity = uidValidity;
      } else if (node.scanUidValidity !== uidValidity) {
        node.scanUidValidity = uidValidity;
        node.scanCursor = 1;
        node.newUidCursor = null;
        reset = true;
      }

      return reset;
    }

    function prepareScanWindow(exists, uidValidity, requestedWindowSize) {
      let reset = ensureScanUidValidity(uidValidity);
      const size = parseInteger(requestedWindowSize, node.frontWindowSize, 1, node.frontWindowSize);

      if (!Number.isSafeInteger(node.scanCursor) || node.scanCursor < 1 || node.scanCursor > exists) {
        node.scanCursor = 1;
        reset = true;
      }

      const windowStart = node.scanCursor;
      const windowEnd = Math.min(exists, windowStart + size - 1);
      const measuredWindowSize = Math.max(0, windowEnd - windowStart + 1);
      const nextCursor = windowEnd >= exists ? 1 : windowEnd + 1;

      return {
        windowStart,
        windowEnd,
        windowSize: measuredWindowSize,
        nextCursor,
        reset,
        wrapped: nextCursor === 1
      };
    }

    function splitPriorityWindowSizes() {
      const newWindowSize = Math.max(1, Math.ceil(node.frontWindowSize / 2));
      const backlogWindowSize = Math.max(1, node.frontWindowSize - newWindowSize);
      return { newWindowSize, backlogWindowSize };
    }

    function isValidUid(uid) {
      return Number.isSafeInteger(uid) && uid > 0;
    }

    function normalizeUidNext(value) {
      const uidNext = Number(value);
      return isValidUid(uidNext) ? uidNext : null;
    }

    function hasKnownNewUidCursor() {
      return isValidUid(Number(node.newUidCursor));
    }

    function buildAckTokenForUid(uid, uidValidity) {
      return buildAckToken({
        accountId: node.account.id,
        queueKey: node.queueKey,
        host: node.account.host,
        port: node.account.port,
        secure: node.account.secure,
        user: node.account.getUsername(),
        mailbox: node.mailbox,
        uid,
        uidValidity
      });
    }

    function supportsUidExpunge(client) {
      return !!(client
        && client.capabilities
        && typeof client.capabilities.has === "function"
        && client.capabilities.has("UIDPLUS"));
    }

    async function expungeDeletedUids(client, uidValidity, uids, stats, timing) {
      if (!node.expungeDeletedFront || node.expungeDeletedFrontLimit <= 0 || uids.length === 0) {
        return false;
      }

      if (!supportsUidExpunge(client)) {
        stats.deletedExpungeSkipped += uids.length;
        stats.deletedExpungeSkipReason = "uidplus unavailable";
        return false;
      }

      let expungedAny = false;
      const started = Date.now();
      const expungeUids = [];
      const activeCheckNow = Date.now();

      for (const uid of uids) {
        if (registry.isActiveInflight(node.queueKey, uidValidity, uid, node.retryAfterMs, activeCheckNow)) {
          stats.deletedExpungeSkippedInflight += 1;
          continue;
        }
        expungeUids.push(uid);
      }

      if (expungeUids.length === 0) {
        addTiming(timing, "expungeMs", started);
        return false;
      }

      for (const uidChunk of chunkUids(expungeUids, node.maxUidPerCommand)) {
        const range = compressUids(uidChunk);
        try {
          const ok = await client.messageDelete(range, { uid: true });
          if (ok === false) {
            stats.deletedExpungeErrors += uidChunk.length;
            continue;
          }

          stats.deletedExpunged += uidChunk.length;
          expungedAny = true;

          for (const uid of uidChunk) {
            registry.removeInflight(node.queueKey, uidValidity, uid, {
              retryAfterMs: node.retryAfterMs,
              now: Date.now()
            });
          }
        } catch (err) {
          stats.deletedExpungeErrors += uidChunk.length;
          diagnostics.warn(node, `IMAP expunge failed for ${node.mailbox} ${range}: ${err.message}`);
        }
      }

      addTiming(timing, "expungeMs", started);
      return expungedAny;
    }

    function markInflight(ackToken, meta = {}) {
      return registry.markInflight(node.queueKey, ackToken, meta);
    }

    function noteConnectionError(stats, err, operation) {
      stats.ok = false;
      stats.error = err.message;
      stats.connectionErrors += 1;
      diagnostics.warn(node, `${operation} failed for ${node.mailbox}: ${formatImapError(err)}`);
    }

    node.runFetchCycle = async function runFetchCycle(triggerMsg, send) {
      if (node.closed) {
        return;
      }

      const fallbackSend = function fallbackSend(output) { node.send(output); };
      send = send || fallbackSend;

      const timing = diagnostics.createTimings();
      const stats = buildBaseStats();
      let activeInflightForStatus = 0;

      function finishStats() {
        stats.inflightPruned += registry.pruneExpiredInflight(node.queueKey, node.retryAfterMs);
        stats.activeInflightAfter = registry.countActiveInflight(node.queueKey, node.retryAfterMs);
        stats.inflightTotal = registry.countAllInflight(node.queueKey);
        stats.timings = timing.finish();
        return stats;
      }

      function markInflightForFetch(ackToken, meta = {}) {
        const now = Date.now();
        const wasActive = registry.isActiveInflight(
          node.queueKey,
          ackToken.uidValidity,
          ackToken.uid,
          node.retryAfterMs,
          now
        );
        const entry = markInflight(ackToken, {
          ...meta,
          retryAfterMs: node.retryAfterMs,
          now
        });
        if (!entry) {
          stats.filteredByInflight += 1;
          return null;
        }
        if (entry && !wasActive) {
          activeInflightForStatus += 1;
        }
        return entry;
      }

      function removeInflightForFetch(uidValidity, uid) {
        const now = Date.now();
        const wasActive = registry.isActiveInflight(node.queueKey, uidValidity, uid, node.retryAfterMs, now);
        const removed = registry.removeInflight(node.queueKey, uidValidity, uid, {
          retryAfterMs: node.retryAfterMs,
          now
        });
        if (removed && wasActive && activeInflightForStatus > 0) {
          activeInflightForStatus -= 1;
        }
        return removed;
      }

      function updateSentStatus() {
        node.status({
          fill: "green",
          shape: "dot",
          text: `sent ${stats.emitted}, inflight ${activeInflightForStatus}/${node.maxInflight}`
        });
      }

      if (node.running) {
        stats.skipped = true;
        stats.reason = "already running";
        stats.activeInflight = registry.countActiveInflight(node.queueKey, node.retryAfterMs);
        finishStats();

        node.status({ fill: "yellow", shape: "ring", text: "trigger skipped: running" });
        emitStats(send, stats);
        return;
      }

      node.running = true;
      node.status({ fill: "blue", shape: "dot", text: "triggered" });
      diagnostics.debug(node, node.diagnostics, "imap email in.triggered", {
        mailbox: node.mailbox,
        queueKey: node.queueKey
      });

      stats.inflightPruned += registry.pruneExpiredInflight(node.queueKey, node.retryAfterMs);

      const activeInflight = registry.countActiveInflight(node.queueKey, node.retryAfterMs);
      const capacity = Math.max(0, node.maxInflight - activeInflight);
      activeInflightForStatus = activeInflight;
      stats.activeInflight = activeInflight;
      stats.capacity = capacity;

      let client;
      let lock;

      try {
        if (capacity <= 0) {
          stats.skipped = true;
          stats.reason = "max inflight reached";
          finishStats();

          node.status({ fill: "yellow", shape: "ring", text: `inflight ${activeInflight}/${node.maxInflight}` });
          emitStats(send, stats);
          return;
        }

        client = node.account.createClient({ node, context: "imap email in" });

        let started = Date.now();
        await client.connect();
        addTiming(timing, "connectMs", started);

        started = Date.now();
        lock = await client.getMailboxLock(node.mailbox);
        addTiming(timing, "lockMs", started);

        const mailboxInfo = client.mailbox || {};
        const exists = Number(mailboxInfo.exists || 0);
        const uidValidity = String(mailboxInfo.uidValidity || "");
        const uidNextSnapshot = normalizeUidNext(mailboxInfo.uidNext);
        stats.exists = exists;
        stats.uidValidity = uidValidity;
        stats.uidNextSnapshot = uidNextSnapshot;

        if (exists < 1) {
          const uidReset = ensureScanUidValidity(uidValidity);
          node.scanCursor = 1;
          node.scanUidValidity = uidValidity || null;
          node.newUidCursor = uidNextSnapshot;
          stats.phase = node.newUidCursor !== null ? "new-uid-priority" : "cursor-window";
          stats.scanCursorStart = 1;
          stats.scanCursorEnd = 0;
          stats.scanCursorNext = 1;
          stats.scanCursorReset = stats.scanCursorReset || uidReset;
          stats.newUidCursorInitialized = node.newUidCursor !== null;
          stats.newUidCursor = node.newUidCursor;
          finishStats();
          node.status({ fill: "green", shape: "ring", text: "empty" });
          emitStats(send, stats);
          return;
        }

        const candidateLimit = Math.min(node.batchSize, capacity);
        const deletedUids = [];
        const candidates = [];
        const candidateSet = new Set();
        const candidateRetryCursors = new Map();
        const now = Date.now();
        let highestUidSeen = 0;
        let cursorAfterCycle = node.scanCursor;
        let sequenceRetryCursor = null;
        let newUidRetryCursor = null;
        let initializedNewUidCursorThisCycle = false;
        let warmupStartedAt = Date.now();

        function noteScanWindow(window) {
          stats.phase = window.phase;
          if (window.windowPhase && !stats.windowPhasesRead.includes(window.windowPhase)) {
            stats.windowPhasesRead.push(window.windowPhase);
          }
          stats.windowsRead += 1;
          stats.frontWindowRead += window.windowSize;

          if (window.uid) {
            if (stats.uidWindowStart === null) {
              stats.uidWindowStart = window.windowStart;
            }
            stats.uidWindowEnd = window.windowEnd;
            stats.uidWindowNext = window.nextCursor;
            return;
          }

          if (stats.scanCursorStart === null) {
            stats.scanCursorStart = window.windowStart;
          }
          stats.scanCursorEnd = window.windowEnd;
          stats.scanCursorNext = window.nextCursor;
          stats.scanCursorReset = stats.scanCursorReset || window.reset;
          stats.scanWrapped = window.wrapped;
        }

        function updateWindowStatus(window) {
          const label = window.windowPhase === "cursor"
            ? "cursor-window"
            : window.windowPhase === "new-uid"
              ? "new UIDs"
              : window.windowPhase === "backlog"
                ? "backlog"
                : "window";
          node.status({
            fill: "blue",
            shape: "ring",
            text: `${label} ${window.windowStart}:${window.windowEnd}, candidates ${candidates.length}/${candidateLimit}`
          });
        }

        async function readCandidateWindow(window) {
          const result = {
            selected: 0,
            validUidsRead: 0,
            lastSelectedUid: null,
            firstUnselectedUid: null,
            unselectedCandidates: 0,
            candidateOverflow: false
          };
          const validWindowUids = window.uid ? (window.validWindowUids || new Set()) : null;

          const fetchStarted = Date.now();
          const fetchOptions = window.uid ? { uid: true } : undefined;

          for await (const item of client.fetch(`${window.windowStart}:${window.windowEnd}`, {
            uid: true,
            flags: true,
            size: true
          }, fetchOptions)) {
            const uid = Number(item.uid);
            if (!isValidUid(uid)) {
              continue;
            }

            if (validWindowUids && validWindowUids.size < exists && !validWindowUids.has(uid)) {
              validWindowUids.add(uid);
              result.validUidsRead += 1;
            }
            highestUidSeen = Math.max(highestUidSeen, uid);

            const deleted = isDeleted(item.flags);
            if (deleted) {
              stats.deletedFlagged += 1;
            }

            if (!matchesFlagSelections(item.flags, node.selection)) {
              stats.filteredByFlags += 1;
              if (deleted && node.deletedSelection === "exclude") {
                if (deletedUids.length < node.expungeDeletedFrontLimit) {
                  deletedUids.push(uid);
                }
                removeInflightForFetch(uidValidity, uid);
              }
              continue;
            }

            if (registry.isActiveInflight(node.queueKey, uidValidity, uid, node.retryAfterMs, now)) {
              stats.filteredByInflight += 1;
              continue;
            }

            if (candidateSet.has(uid)) {
              continue;
            }

            candidateSet.add(uid);
            stats.candidates += 1;
            if (candidates.length < candidateLimit) {
              candidates.push(uid);
              candidateRetryCursors.set(uid, {
                sequenceRetryCursor: window.uid ? null : window.windowStart,
                newUidRetryCursor: window.uid ? uid : null
              });
              result.selected += 1;
              result.lastSelectedUid = uid;
            } else {
              result.unselectedCandidates += 1;
              result.candidateOverflow = true;
              stats.candidateOverflow = true;
              stats.windowUnselectedCandidates += 1;
              if (result.firstUnselectedUid === null || uid < result.firstUnselectedUid) {
                result.firstUnselectedUid = uid;
              }
            }
          }

          addTiming(timing, "frontFetchMs", fetchStarted);
          noteScanWindow(window);
          updateWindowStatus(window);
          return result;
        }

        function initializeNewUidCursor(value) {
          node.newUidCursor = value;
          initializedNewUidCursorThisCycle = node.newUidCursor !== null;
          stats.newUidCursorInitialized = initializedNewUidCursorThisCycle;
          stats.newUidCursor = node.newUidCursor;
        }

        function clearInitializedNewUidCursor() {
          if (!initializedNewUidCursorThisCycle) {
            return;
          }
          node.newUidCursor = null;
          stats.newUidCursor = null;
          stats.newUidCursorInitialized = false;
          initializedNewUidCursorThisCycle = false;
        }

        async function readCursorWindow(phase, windowPhase, windowSize, options = {}) {
          const scanWindow = prepareScanWindow(exists, uidValidity, windowSize);
          if (sequenceRetryCursor === null) {
            sequenceRetryCursor = scanWindow.windowStart;
          }

          const result = await readCandidateWindow({
            phase,
            windowPhase,
            uid: false,
            ...scanWindow
          });
          const holdCursor = options.holdOnOverflow && result.candidateOverflow;
          cursorAfterCycle = holdCursor ? scanWindow.windowStart : scanWindow.nextCursor;
          node.scanCursor = cursorAfterCycle;
          if (holdCursor) {
            stats.scanCursorHeld = true;
            stats.scanCursorAdjusted = true;
            stats.scanCursorNext = cursorAfterCycle;
            stats.scanWrapped = false;
          }
          return { scanWindow, result };
        }

        async function readNewUidWindow(uidWindowStart, uidWindowEnd, uidNext) {
          const aggregate = {
            validUidsRead: 0,
            candidateOverflow: false,
            firstUnselectedUid: null,
            nextCursor: uidWindowStart
          };
          const validWindowUids = new Set();
          let chunkStart = uidWindowStart;

          while (chunkStart <= uidWindowEnd && candidates.length < candidateLimit) {
            const chunkEnd = Math.min(uidWindowEnd, chunkStart + node.maxUidPerCommand - 1);
            const result = await readCandidateWindow({
              phase: "new-uid-priority",
              windowPhase: "new-uid",
              uid: true,
              validWindowUids,
              windowStart: chunkStart,
              windowEnd: chunkEnd,
              windowSize: Math.max(0, chunkEnd - chunkStart + 1),
              nextCursor: chunkEnd + 1,
              reset: false,
              wrapped: chunkEnd + 1 >= uidNext
            });

            aggregate.validUidsRead += result.validUidsRead;
            aggregate.nextCursor = chunkEnd + 1;

            if (result.candidateOverflow) {
              aggregate.candidateOverflow = true;
              aggregate.firstUnselectedUid = result.firstUnselectedUid;
              break;
            }

            chunkStart = chunkEnd + 1;
          }

          return aggregate;
        }

        async function readCursorWindowPhase() {
          stats.phase = "cursor-window";
          warmupStartedAt = Date.now();

          while (candidates.length < candidateLimit) {
            const { scanWindow, result } = await readCursorWindow("cursor-window", "cursor", node.frontWindowSize, {
              holdOnOverflow: true
            });

            if (result.candidateOverflow) {
              break;
            }

            if (scanWindow.wrapped) {
              initializeNewUidCursor(uidNextSnapshot || (highestUidSeen > 0 ? highestUidSeen + 1 : null));
              break;
            }

            if (node.scanTimeLimitMs === 0) {
              break;
            }

            if (Date.now() - warmupStartedAt >= node.scanTimeLimitMs) {
              stats.scanTimeLimitReached = true;
              break;
            }
          }
        }

        async function readAdaptiveWindows() {
          const uidReset = ensureScanUidValidity(uidValidity);
          stats.scanCursorReset = stats.scanCursorReset || uidReset;

          if (!hasKnownNewUidCursor()) {
            await readCursorWindowPhase();
            return;
          }

          stats.phase = "new-uid-priority";

          if (uidNextSnapshot && Number(node.newUidCursor) > uidNextSnapshot) {
            node.newUidCursor = uidNextSnapshot;
          }

          const { newWindowSize, backlogWindowSize } = splitPriorityWindowSizes();
          let newUidWindowCoveredMailbox = false;

          if (uidNextSnapshot && Number(node.newUidCursor) < uidNextSnapshot && candidates.length < candidateLimit) {
            const uidWindowStart = Number(node.newUidCursor);
            const uidWindowEnd = Math.min(uidNextSnapshot - 1, uidWindowStart + newWindowSize - 1);
            const result = await readNewUidWindow(uidWindowStart, uidWindowEnd, uidNextSnapshot);
            newUidWindowCoveredMailbox = !result.candidateOverflow
              && result.nextCursor >= uidNextSnapshot
              && result.validUidsRead >= exists;

            if (result.candidateOverflow && result.firstUnselectedUid !== null) {
              node.newUidCursor = result.firstUnselectedUid;
            } else {
              node.newUidCursor = result.nextCursor;
            }
          }

          stats.newUidCursor = node.newUidCursor;

          if (newUidWindowCoveredMailbox && (
            !Number.isSafeInteger(node.scanCursor) ||
            node.scanCursor < 1 ||
            node.scanCursor > exists
          )) {
            node.scanCursor = 1;
            cursorAfterCycle = 1;
            stats.scanCursorReset = true;
            stats.scanCursorNext = 1;
          }

          if (candidates.length < candidateLimit && !newUidWindowCoveredMailbox) {
            await readCursorWindow("new-uid-priority", "backlog", backlogWindowSize, {
              holdOnOverflow: true
            });
          }
        }

        await readAdaptiveWindows();

        stats.newUidCursor = node.newUidCursor;
        if (stats.scanCursorStart === null) {
          stats.scanCursorStart = node.scanCursor;
          stats.scanCursorEnd = node.scanCursor - 1;
          stats.scanCursorNext = node.scanCursor;
        }

        let expungedAny = await expungeDeletedUids(client, uidValidity, deletedUids, stats, timing);
        activeInflightForStatus = registry.countActiveInflight(node.queueKey, node.retryAfterMs);
        const deletedSeenDuringFetch = [];
        const deletedSeenSet = new Set();
        let connectionInterrupted = false;

        function rememberDeletedDuringFetch(uid) {
          if (deletedSeenSet.has(uid)) {
            return;
          }
          if (stats.deletedExpunged + deletedSeenDuringFetch.length >= node.expungeDeletedFrontLimit) {
            return;
          }
          deletedSeenSet.add(uid);
          deletedSeenDuringFetch.push(uid);
        }

        for (const uid of candidates) {
          let imapMessage;
          const candidateRetry = candidateRetryCursors.get(uid) || {};
          if (Object.prototype.hasOwnProperty.call(candidateRetry, "sequenceRetryCursor")) {
            sequenceRetryCursor = candidateRetry.sequenceRetryCursor;
          }
          if (Object.prototype.hasOwnProperty.call(candidateRetry, "newUidRetryCursor")) {
            newUidRetryCursor = candidateRetry.newUidRetryCursor;
          }

          started = Date.now();
          try {
            imapMessage = await client.fetchOne(String(uid), {
              uid: true,
              envelope: true,
              flags: true,
              internalDate: true,
              size: true
            }, { uid: true });
            addTiming(timing, "fullFetchMs", started);
          } catch (err) {
            addTiming(timing, "fullFetchMs", started);
            if (!isTransientImapConnectionError(err)) {
              throw err;
            }

            noteConnectionError(stats, err, "IMAP fetchOne");
            send([
              null,
              {
                error: diagnostics.errorToObject(err),
                imap: {
                  ...buildImapMeta(uid, uidValidity, null),
                  queueKey: node.queueKey
                }
              },
              null
            ]);
            connectionInterrupted = true;
            break;
          }

          if (!imapMessage) {
            stats.missingMessages += 1;
            continue;
          }

          const fetchedUid = Number(imapMessage.uid || uid);
          if (!Number.isSafeInteger(fetchedUid) || fetchedUid < 1) {
            continue;
          }

          stats.fetched += 1;
          const messageDeleted = isDeleted(imapMessage.flags);
          const ackToken = buildAckTokenForUid(fetchedUid, uidValidity);

          if (!matchesFlagSelections(imapMessage.flags, node.selection)) {
            stats.filteredByFlags += 1;
            if (messageDeleted && node.deletedSelection === "exclude") {
              stats.deletedSkippedDuringFetch += 1;
              rememberDeletedDuringFetch(fetchedUid);
              removeInflightForFetch(uidValidity, fetchedUid);
            }
            continue;
          }

          const messageSize = Number(imapMessage.size);
          if (node.maxMessageBytes > 0 && Number.isFinite(messageSize) && messageSize > node.maxMessageBytes) {
            const err = buildTooLargeError(node.maxMessageBytes);
            if (!markInflightForFetch(ackToken, {
              subject: imapMessage.envelope && imapMessage.envelope.subject
            })) {
              continue;
            }
            stats.tooLarge += 1;
            send([
              null,
              {
                error: diagnostics.errorToObject(err),
                imap: buildImapMeta(fetchedUid, uidValidity, imapMessage, ackToken)
              },
              null
            ]);
            continue;
          }

          let download;
          try {
            started = Date.now();
            download = await client.download(String(fetchedUid), false, {
              uid: true,
              chunkSize: node.downloadChunkSize
            });
            addTiming(timing, "downloadMs", started);
          } catch (err) {
            const markedInflight = markInflightForFetch(ackToken, {
              subject: imapMessage.envelope && imapMessage.envelope.subject
            });
            if (markedInflight) {
              stats.parseErrors += 1;
              send([
                null,
                {
                  error: diagnostics.errorToObject(err),
                  imap: buildImapMeta(fetchedUid, uidValidity, imapMessage, ackToken)
                },
                null
              ]);
            }
            if (isTransientImapConnectionError(err)) {
              noteConnectionError(stats, err, "IMAP download");
              connectionInterrupted = true;
              break;
            }
            continue;
          }

          if (!download || !download.content) {
            if (!markInflightForFetch(ackToken, {
              subject: imapMessage.envelope && imapMessage.envelope.subject
            })) {
              continue;
            }
            stats.missingSource += 1;
            stats.parseErrors += 1;
            send([
              null,
              {
                error: {
                  message: "IMAP message source is missing",
                  code: "IMAP_EMAIL_MISSING_SOURCE"
                },
                imap: buildImapMeta(fetchedUid, uidValidity, imapMessage, ackToken)
              },
              null
            ]);
            continue;
          }

          try {
            started = Date.now();
            const parsed = await parseMailStream(download.content, {
              includeAttachments: node.includeAttachments,
              emitRaw: node.emitRaw,
              maxMessageBytes: node.maxMessageBytes
            });
            addTiming(timing, "parseMs", started);

            if (!markInflightForFetch(ackToken, {
              messageId: parsed.messageId,
              subject: parsed.subject
            })) {
              continue;
            }

            const out = {
              topic: parsed.subject || "",
              payload: parsed.text || "",
              email: {
                topic: parsed.subject || "",
                messageId: parsed.messageId || "",
                date: parsed.date || imapMessage.internalDate,
                from: parsed.from ? parsed.from.text : "",
                to: parsed.to ? parsed.to.text : "",
                cc: parsed.cc ? parsed.cc.text : "",
                bcc: parsed.bcc ? parsed.bcc.text : "",
                text: parsed.text || "",
                html: parsed.html || undefined,
                header: headersToObject(parsed.headers)
              },
              imap: {
                accountId: node.account.id,
                mailbox: node.mailbox,
                uid: fetchedUid,
                uidValidity,
                flags: flagsToArray(imapMessage.flags),
                flagState: flagsToState(imapMessage.flags),
                internalDate: imapMessage.internalDate,
                size: imapMessage.size,
                ackToken,
                delivery: {
                  mode: "at-least-once",
                  duplicatePossible: true
                }
              }
            };

            if (node.includeAttachments) {
              out.email.attachments = parsed.attachments || [];
            }

            if (node.emitRaw) {
              out.raw = parsed.raw;
            }

            stats.emitted += 1;
            updateSentStatus();
            send([out, null, null]);
          } catch (err) {
            const markedInflight = markInflightForFetch(ackToken, {
              subject: imapMessage.envelope && imapMessage.envelope.subject
            });

            if (markedInflight) {
              if (isTooLargeError(err)) {
                stats.tooLarge += 1;
              } else {
                stats.parseErrors += 1;
              }

              send([
                null,
                {
                  error: diagnostics.errorToObject(err),
                  imap: buildImapMeta(fetchedUid, uidValidity, imapMessage, ackToken)
                },
                null
              ]);
            }
            if (isTransientImapConnectionError(err)) {
              noteConnectionError(stats, err, "IMAP parse");
              connectionInterrupted = true;
              break;
            }
          }
        }

        if (!connectionInterrupted && deletedSeenDuringFetch.length > 0) {
          const didExpunge = await expungeDeletedUids(client, uidValidity, deletedSeenDuringFetch, stats, timing);
          expungedAny = expungedAny || didExpunge;
        }

        if (connectionInterrupted) {
          if (sequenceRetryCursor !== null) {
            cursorAfterCycle = sequenceRetryCursor;
            stats.scanCursorAdjusted = true;
            stats.scanCursorNext = cursorAfterCycle;
            stats.scanWrapped = cursorAfterCycle === 1;
          }
          if (newUidRetryCursor !== null) {
            node.newUidCursor = newUidRetryCursor;
            stats.newUidCursor = node.newUidCursor;
          } else if (stats.newUidCursorInitialized && sequenceRetryCursor !== null) {
            clearInitializedNewUidCursor();
          }
        } else if (expungedAny) {
          if (sequenceRetryCursor !== null) {
            cursorAfterCycle = sequenceRetryCursor;
            stats.scanCursorAdjusted = true;
            stats.scanCursorNext = cursorAfterCycle;
            stats.scanWrapped = cursorAfterCycle === 1;
            if (stats.phase === "cursor-window") {
              clearInitializedNewUidCursor();
            }
          }
        }

        node.scanCursor = cursorAfterCycle;
        node.scanUidValidity = uidValidity;

        finishStats();
        emitStats(send, stats);
        node.status({
          fill: stats.ok ? (stats.emitted > 0 ? "green" : "grey") : "red",
          shape: stats.ok ? "dot" : "ring",
          text: stats.ok ? `sent ${stats.emitted}, inflight ${stats.activeInflightAfter}/${node.maxInflight}` : stats.error
        });
      } catch (err) {
        const transientConnectionError = isTransientImapConnectionError(err);
        stats.ok = false;
        stats.error = err.message;
        if (transientConnectionError) {
          stats.connectionErrors += 1;
        }
        finishStats();

        node.status({ fill: "red", shape: "ring", text: err.message });
        send([
          null,
          {
            error: diagnostics.errorToObject(err),
            imap: {
              mailbox: node.mailbox,
              queueKey: node.queueKey
            }
          },
          null
        ]);
        emitStats(send, stats);
        if (transientConnectionError) {
          diagnostics.warn(node, `IMAP fetch failed for ${node.mailbox}: ${formatImapError(err)}`);
        } else {
          node.error(err, triggerMsg);
        }
      } finally {
        try {
          if (lock) {
            lock.release();
          }
        } catch (err) {
          // ignore
        }
        try {
          if (client) {
            const started = Date.now();
            const result = await safeLogout(client);
            if (!result.skipped) {
              addTiming(timing, "logoutMs", started);
            }
          }
        } catch (err) {
          // ignore
        }

        node.running = false;

        if (node.closeDone) {
          const done = node.closeDone;
          node.closeDone = null;
          done();
        }
      }
    };

    node.on("input", function onInput(msg, send, done) {
      send = send || function fallbackSend(output) { node.send(output); };
      node.runFetchCycle(msg, send).then(() => {
        if (done) {
          done();
        }
      }).catch((err) => {
        node.status({ fill: "red", shape: "ring", text: err.message });
        node.error(err, msg);
        if (done) {
          done(err);
        }
      });
    });

    node.on("close", function onClose(removed, done) {
      node.closed = true;
      if (node.running) {
        node.closeDone = done;
      } else {
        done();
      }
    });

    node.status({ fill: "grey", shape: "ring", text: "waiting for trigger" });
  }

  RED.nodes.registerType("imap-email in", ImapEmailInNode);
};
