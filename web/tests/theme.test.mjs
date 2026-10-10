// The theme every window resolves, and the bubble's window sizes.

import test from "node:test";
import assert from "node:assert/strict";
import { resolveDark } from "../src/core/theme.ts";
import * as G from "../src/bubble/geometry.ts";

test("dark and light are what they say, whatever Windows prefers", () => {
  assert.equal(resolveDark("dark", true), true);
  assert.equal(resolveDark("dark", false), true);
  assert.equal(resolveDark("light", true), false);
  assert.equal(resolveDark("light", false), false);
});

test("system follows Windows", () => {
  assert.equal(resolveDark("system", true), false, "Windows is light: light");
  assert.equal(resolveDark("system", false), true, "Windows is dark: dark");
});

test("a stale or missing preference is the island's own look, dark", () => {
  for (const bad of ["neon", "", undefined, null]) assert.equal(resolveDark(bad, true), true);
});

test("the bubble's window is as big as what it shows, never a patch of invisible glass", () => {
  assert.equal(G.BUTTON_WINDOW, 44 + 2 * G.PAD);
  assert.equal(G.CARD_WINDOW_W, G.CARD_WIDTH + 2 * G.PAD);
  assert.equal(G.cardWindowHeight(150), 150 + 2 * G.PAD, "a short card gets a short window");
  assert.equal(G.cardWindowHeight(150.2), 151 + 2 * G.PAD, "rounded up, never clipped");
  assert.ok(G.cardWindowHeight(0) > 0 && G.cardWindowHeight(NaN) > 0, "a card not measured yet still has a window");
  assert.equal(G.cardWindowHeight(10_000), 440, "capped");
});
