// History list: tab filter, search words, time labels.

import { test } from "node:test";
import assert from "node:assert/strict";

const { filterHistory, foldForSearch, timeAgoParts } = await import("../src/core/history-logic.ts");

const item = (id, query, translation, favorite = false) => ({
  id, timestamp: "2026-01-01T00:00:00Z", query, translation,
  detectedLang: "en", targetLang: "fa", engine: "google", favorite,
});

const ITEMS = [
  item("1", "Where is the pharmacy?", "داروخانه کجاست؟", true),
  item("2", "Thank you very much", "خیلی ممنون"),
  item("3", "می‌خوام یه قرار بذارم", "I want to set up a meeting", true),
];

test("the All tab shows everything, Starred only the starred", () => {
  assert.deepEqual(filterHistory(ITEMS, "all", "").map((i) => i.id), ["1", "2", "3"]);
  assert.deepEqual(filterHistory(ITEMS, "starred", "").map((i) => i.id), ["1", "3"]);
});

test("search matches the query or the translation, case-insensitively", () => {
  assert.deepEqual(filterHistory(ITEMS, "all", "PHARMACY").map((i) => i.id), ["1"]);
  assert.deepEqual(filterHistory(ITEMS, "all", "ممنون").map((i) => i.id), ["2"]);
  assert.deepEqual(filterHistory(ITEMS, "all", "meeting").map((i) => i.id), ["3"]);
});

test("every word of the search must match, in any order", () => {
  assert.deepEqual(filterHistory(ITEMS, "all", "very thank").map((i) => i.id), ["2"]);
  assert.deepEqual(filterHistory(ITEMS, "all", "very pharmacy").map((i) => i.id), []);
});

test("search and tab combine", () => {
  assert.deepEqual(filterHistory(ITEMS, "starred", "thank").map((i) => i.id), []);
  assert.deepEqual(filterHistory(ITEMS, "starred", "قرار").map((i) => i.id), ["3"]);
});

test("search ignores the zero-width joiner and Arabic yeh and kaf", () => {
  assert.equal(foldForSearch("می‌خوام"), "میخوام");
  assert.deepEqual(filterHistory(ITEMS, "all", "میخوام").map((i) => i.id), ["3"]);
  assert.deepEqual(filterHistory(ITEMS, "all", "كجاست").map((i) => i.id), ["1"]);
  assert.deepEqual(filterHistory(ITEMS, "all", "يه").map((i) => i.id), ["3"]);
});

test("timeAgoParts picks the unit", () => {
  const now = Date.parse("2026-01-10T12:00:00Z");
  const ago = (s) => new Date(now - s * 1000).toISOString();
  assert.deepEqual(timeAgoParts(ago(10), now), ["now", 0]);
  assert.deepEqual(timeAgoParts(ago(180), now), ["m", 3]);
  assert.deepEqual(timeAgoParts(ago(3 * 3600), now), ["h", 3]);
  assert.deepEqual(timeAgoParts(ago(2 * 86400), now), ["d", 2]);
  assert.deepEqual(timeAgoParts("garbage", now), ["now", 0]);
});
