"use strict";

function normalizeUids(uids) {
  if (!Array.isArray(uids)) {
    return [];
  }

  return [...new Set(
    uids
      .map((uid) => Number(uid))
      .filter((uid) => Number.isSafeInteger(uid) && uid > 0)
  )].sort((a, b) => a - b);
}

function compressUids(uids) {
  const sorted = normalizeUids(uids);
  const parts = [];
  let start = null;
  let previous = null;

  for (const uid of sorted) {
    if (start === null) {
      start = uid;
      previous = uid;
      continue;
    }

    if (uid === previous + 1) {
      previous = uid;
      continue;
    }

    parts.push(start === previous ? String(start) : `${start}:${previous}`);
    start = uid;
    previous = uid;
  }

  if (start !== null) {
    parts.push(start === previous ? String(start) : `${start}:${previous}`);
  }

  return parts.join(",");
}

function chunkUids(uids, maxUidsPerChunk) {
  const sorted = normalizeUids(uids);
  const limit = Math.max(1, Number(maxUidsPerChunk) || 1);
  const chunks = [];

  for (let i = 0; i < sorted.length; i += limit) {
    chunks.push(sorted.slice(i, i + limit));
  }

  return chunks;
}

function chunkUidRanges(uids, maxUidsPerCommand) {
  return chunkUids(uids, maxUidsPerCommand)
    .map(compressUids)
    .filter(Boolean);
}

module.exports = {
  normalizeUids,
  compressUids,
  chunkUids,
  chunkUidRanges
};
