// Island geometry: sizes per mode and view, the translate view's growth, Ari's place.

import { test } from "node:test";
import assert from "node:assert/strict";

const L = await import("../src/core/layout.ts");

test("hidden, compact and expanded sizes", () => {
  assert.deepEqual(L.islandSize("hidden", "translate"), { w: L.NOTCH_W, h: 0 });
  assert.deepEqual(L.islandSize("compact", "translate"), { w: 288, h: 32 });
  assert.deepEqual(L.islandSize("expanded", "translate"), { w: L.TRANSLATE_MIN_W, h: L.TRANSLATE_MIN_H });
  assert.deepEqual(L.islandSize("expanded", "settings"), { w: L.EXPANDED_W, h: L.VIEW_LAYOUTS.settings.height });
  assert.deepEqual(L.islandSize("expanded", "greeting"), { w: L.GREETING_ISLAND_W, h: L.VIEW_LAYOUTS.greeting.height });
});

test("every view fits the panel window and expanded width", () => {
  for (const [name, v] of Object.entries(L.VIEW_LAYOUTS)) {
    assert.ok(v.height <= L.PANEL_H, `${name} is taller than the window`);
  }
  assert.ok(L.EXPANDED_W <= L.PANEL_W);
});

test("the translate view grows with the text and stops at the window", () => {
  assert.equal(L.translateHeight(0), L.TRANSLATE_MIN_H);
  assert.equal(L.translateHeight(40), L.TRANSLATE_MIN_H, "a short phrase keeps the resting height");
  assert.equal(L.translateHeight(-5), L.TRANSLATE_MIN_H);
  // A card that needs more than the resting island makes the island taller by
  // exactly the difference: nothing scrolls while there is room.
  assert.equal(L.translateHeight(300), 300 + 52);
  assert.ok(L.translateHeight(300) > L.translateHeight(250), "taller content, taller island");
  assert.equal(L.translateHeight(10_000), L.PANEL_H, "capped at the window; only then does a card scroll");
  assert.deepEqual(L.islandSize("expanded", "translate", 300), { w: L.TRANSLATE_MIN_W, h: 300 });
  assert.deepEqual(L.islandSize("expanded", "translate", 300, 700), { w: 700, h: 300 });
});

test("the view list is the translator's own", () => {
  assert.deepEqual(Object.keys(L.VIEW_LAYOUTS).sort(), ["football", "greeting", "note", "settings", "spotify", "translate", "wardrobe"]);
});

test("Ari: hidden has no opacity, compact sits at the left, expanded follows the view", () => {
  assert.equal(L.botPosition("hidden", "translate", 0).opacity, 0);
  assert.deepEqual(L.botPosition("compact", "translate", 32), { cx: 40, cy: 16, diameter: 20, opacity: 1 });
  const p = L.botPosition("expanded", "translate", L.TRANSLATE_MIN_H);
  assert.equal(p.cx, L.VIEW_LAYOUTS.translate.botX);
  assert.ok(p.cy > 42 && p.cy < L.TRANSLATE_MIN_H);
});

test("Ari's glow colour follows his state", () => {
  assert.equal(L.botGlowColor("thinking"), "#A78BFA");
  assert.equal(L.botGlowColor("error"), "#F4505E");
  assert.equal(L.botGlowColor("idle"), "#FFFFFF");
});

test("the translate view's width follows its text only: a standard, stepped scale", () => {
  assert.equal(L.TRANSLATE_MIN_W, 740);
  assert.equal(L.TRANSLATE_MAX_W, 860);
  assert.equal(L.translateWidth(0), L.TRANSLATE_MIN_W, "empty: the compact width");
  assert.equal(L.translateWidth(-5), L.TRANSLATE_MIN_W);
  assert.equal(L.translateWidth(10_000), L.TRANSLATE_MAX_W);
  assert.equal(L.translateWidth(12), L.TRANSLATE_MIN_W, "a few words do not move the island");
  let last = 0;
  const seen = new Set();
  for (let n = 0; n <= 400; n += 1) {
    const w = L.translateWidth(n);
    assert.ok(w >= last, "never narrower for longer text");
    assert.ok(w >= L.TRANSLATE_MIN_W && w <= L.TRANSLATE_MAX_W);
    assert.equal((w - L.TRANSLATE_MIN_W) % 20, 0, "moves in steps of 20");
    seen.add(w);
    last = w;
  }
  assert.deepEqual([...seen], [740, 760, 780, 800, 820, 840, 860], "widths in steps");
  assert.ok(L.translateWidth(80) > L.TRANSLATE_MIN_W && L.translateWidth(80) < L.TRANSLATE_MAX_W, "a paragraph is in between");
  assert.ok(L.TRANSLATE_MAX_W <= L.PANEL_W - 40, "room for the shadow inside the window");
});
