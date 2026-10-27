// The Muse tab reads only the page's title: the count in front of it and the title itself.

import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom } from "./fakedom.mjs";

installFakeDom();

const M = await import("../src/views/muse.ts");

test("the count a web app puts before its title is read, anything else is none", () => {
  assert.equal(M.unreadOf("(3) Muse"), 3);
  assert.equal(M.unreadOf(" (12) Chat · Muse"), 12);
  assert.equal(M.unreadOf("(99+) Muse"), 99);
  assert.equal(M.unreadOf("Muse"), 0);
  assert.equal(M.unreadOf("Plan (2) trips"), 0, "only in front");
  assert.equal(M.unreadOf(""), 0);
});

test("the toolbar shows the title without the count", () => {
  assert.equal(M.plainTitle("(3) Weekly budget"), "Weekly budget");
  assert.equal(M.plainTitle("Muse"), "Muse");
});

test("Muse starts switched off: nothing of muse.ai runs until the user turns it on", () => {
  assert.equal(M.Muse.on, false);
  assert.equal(M.Muse.ready, false);
});
