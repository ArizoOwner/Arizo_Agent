// Right to left: Ari moves to the other side with the cards, and nothing else
// about the island's geometry changes.

import test from "node:test";
import assert from "node:assert/strict";
import * as L from "../src/core/layout.ts";

const EXPANDED_VIEWS = ["translate", "settings", "wardrobe", "note", "spotify"];

test("in a right-to-left language Ari sits on the mirrored side of the island", () => {
  for (const view of EXPANDED_VIEWS) {
    const { w, h } = L.islandSize("expanded", view);
    const ltr = L.botPosition("expanded", view, h, false, w);
    const rtl = L.botPosition("expanded", view, h, true, w);
    assert.equal(rtl.cx, w - ltr.cx, `${view}: mirrored across the island`);
    assert.equal(rtl.cy, ltr.cy, `${view}: same height`);
    assert.equal(rtl.diameter, ltr.diameter, `${view}: same size`);
  }
});

test("the compact capsule, the hidden island and the greeting are not mirrored", () => {
  for (const mode of ["hidden", "compact"]) {
    assert.deepEqual(L.botPosition(mode, "translate", 32, true), L.botPosition(mode, "translate", 32, false));
  }
  assert.deepEqual(L.botPosition("expanded", "greeting", 160, true), L.botPosition("expanded", "greeting", 160, false));
});

test("left to right is the default and Ari stays inside the island either way", () => {
  assert.deepEqual(L.botPosition("expanded", "translate", 290), L.botPosition("expanded", "translate", 290, false));
  for (const view of EXPANDED_VIEWS) {
    const { w, h } = L.islandSize("expanded", view);
    for (const rtl of [false, true]) {
      const p = L.botPosition("expanded", view, h, rtl, w);
      assert.ok(p.cx - p.diameter / 2 >= 0 && p.cx + p.diameter / 2 <= w, `${view} (rtl=${rtl}) inside`);
    }
  }
});

test("the island is wide enough for its window", () => {
  assert.ok(L.EXPANDED_W <= L.PANEL_W - 40);
  assert.ok(L.PANEL_W - L.TRANSLATE_MAX_W >= 40, "room for the island's shadow on both sides");
});
