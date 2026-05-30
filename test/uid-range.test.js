"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeUids,
  compressUids,
  chunkUids,
  chunkUidRanges
} = require("../lib/uid-range");

test("normalizeUids filters, sorts and deduplicates", () => {
  assert.deepEqual(normalizeUids([5, "3", 5, 0, -1, "x", 4]), [3, 4, 5]);
});

test("compressUids creates compact IMAP uid ranges", () => {
  assert.equal(compressUids([1, 2, 3, 5, 8, 9, 10]), "1:3,5,8:10");
  assert.equal(compressUids([]), "");
  assert.equal(compressUids([7]), "7");
});

test("chunkUids chunks by UID count", () => {
  assert.deepEqual(chunkUids([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("chunkUidRanges returns compact ranges per chunk", () => {
  assert.deepEqual(chunkUidRanges([1, 2, 3, 7, 8, 20], 4), ["1:3,7", "8,20"]);
});
