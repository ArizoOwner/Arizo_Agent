// The island's look: ranges that match the backend's, repair of stored values, what each
// number means, and the window that has to grow when the island does.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const A = await import("../src/core/appearance.ts");
const LAYOUT = await import("../src/core/layout.ts");

const RUST = readFileSync(fileURLToPath(new URL("../../src-tauri/src/store.rs", import.meta.url)), "utf8");
const rustRange = (name) => {
  const m = RUST.match(new RegExp(`pub const ${name}: \\(f64, f64\\) = \\((\\d+(?:\\.\\d+)?), (\\d+(?:\\.\\d+)?)\\);`));
  assert.ok(m, `${name} is declared in store.rs`);
  return [Number(m[1]), Number(m[2])];
};

test("every range is the one the backend enforces", () => {
  const pairs = {
    uiWidth: "UI_WIDTH", uiHeight: "UI_HEIGHT", uiTransparency: "UI_TRANSPARENCY",
    uiFontScale: "UI_FONT_SCALE", uiCorner: "UI_CORNER", uiFloatGap: "UI_FLOAT_GAP",
    uiCompactWidth: "UI_COMPACT_WIDTH", uiCompactHeight: "UI_COMPACT_HEIGHT", uiCompactScale: "UI_COMPACT_SCALE",
  };
  for (const [key, name] of Object.entries(pairs)) {
    assert.deepEqual([A.LOOK[key].min, A.LOOK[key].max], rustRange(name), `${key} matches ${name}`);
  }
  assert.deepEqual(Object.keys(A.LOOK).sort(), Object.keys(pairs).sort(), "no setting without a Rust range");
});

test("the defaults are inside their ranges and give back the design", () => {
  for (const key of A.NUM_KEYS) {
    const s = A.LOOK[key];
    assert.ok(s.def >= s.min && s.def <= s.max, `${key} default is in range`);
    assert.equal(A.DEFAULT_LOOK[key], s.def);
  }
  assert.equal(A.DEFAULT_LOOK.uiFloating, false);
  assert.equal(A.allDefault(A.DEFAULT_LOOK), true);
  assert.equal(A.fontScale(A.DEFAULT_LOOK), 1);
  assert.equal(A.bodyAlpha(A.DEFAULT_LOOK), 1, "solid");
  assert.equal(A.cornerRadius(22, A.DEFAULT_LOOK), 22, "the designed corner");
  assert.equal(A.floatOffset(A.DEFAULT_LOOK, false), 0, "touching the top edge");
});

test("stored values are repaired, never trusted", () => {
  assert.deepEqual(A.lookOf({}), A.DEFAULT_LOOK, "an old settings file has none of them");
  const l = A.lookOf({ uiWidth: 5000, uiHeight: -1, uiTransparency: 33.6, uiFontScale: "big", uiCorner: NaN, uiFloatGap: 2, uiFloating: "yes" });
  assert.equal(l.uiWidth, A.LOOK.uiWidth.max);
  assert.equal(l.uiHeight, A.LOOK.uiHeight.min);
  assert.equal(l.uiTransparency, 34, "rounded to a whole number");
  assert.equal(l.uiFontScale, A.LOOK.uiFontScale.def, "not a number: the default");
  assert.equal(l.uiCorner, A.LOOK.uiCorner.def);
  assert.equal(l.uiFloatGap, A.LOOK.uiFloatGap.min);
  assert.equal(l.uiFloating, false, "only a real boolean turns it on");
  assert.equal(A.lookOf({ uiFloating: true }).uiFloating, true);
});

test("each reset restores only its own setting, and reset all restores every one", () => {
  const moved = { uiWidth: 120, uiHeight: 110, uiTransparency: 40, uiFontScale: 120, uiCorner: 50, uiFloatGap: 30, uiCompactWidth: 120, uiCompactHeight: 130, uiCompactScale: 150, uiFloating: true };
  assert.equal(A.allDefault(moved), false);
  for (const key of A.LOOK_KEYS) {
    assert.equal(A.isDefault(key, moved[key]), false, `${key} is changed`);
    const back = { ...moved, ...A.resetPatch(key) };
    assert.equal(A.isDefault(key, back[key]), true, `${key} goes back`);
    for (const other of A.LOOK_KEYS.filter((k) => k !== key)) assert.equal(back[other], moved[other], `${other} is untouched by the ${key} reset`);
  }
  const all = { ...moved, ...A.resetPatch() };
  assert.deepEqual(all, A.DEFAULT_LOOK);
  assert.equal(A.allDefault(all), true);
  assert.deepEqual(Object.keys(A.resetPatch()).sort(), [...A.LOOK_KEYS].sort(), "the all-reset names every setting");
});

test("what the numbers mean", () => {
  assert.equal(A.cornerRadius(22, { ...A.DEFAULT_LOOK, uiCorner: 0 }), 0, "square");
  assert.equal(A.cornerRadius(22, { ...A.DEFAULT_LOOK, uiCorner: 150 }), 33);
  assert.equal(A.bodyAlpha({ ...A.DEFAULT_LOOK, uiTransparency: 45 }), 0.55);
  assert.ok(A.bodyAlpha({ ...A.DEFAULT_LOOK, uiTransparency: A.LOOK.uiTransparency.max }) > 0, "never fully invisible");
  assert.equal(A.fontScale({ ...A.DEFAULT_LOOK, uiFontScale: 130 }), 1.3);
  assert.equal(A.floatOffset({ ...A.DEFAULT_LOOK, uiFloating: true, uiFloatGap: 30 }, false), 30);
  assert.equal(A.floatOffset({ ...A.DEFAULT_LOOK, uiFloating: true, uiFloatGap: 30 }, true), 0, "a hidden island is not hanging anywhere");
  assert.equal(A.floatOffset({ ...A.DEFAULT_LOOK, uiFloating: false, uiFloatGap: 30 }, false), 0, "the gap alone does nothing");
});

test("the island's size follows the look, and bigger text never cuts a view off", () => {
  const screen = { w: 1896, h: 1032 };
  assert.deepEqual(A.scaledIsland({ w: 760, h: 410 }, false, A.DEFAULT_LOOK, screen), { w: 760, h: 410 }, "the design, untouched");
  assert.deepEqual(A.scaledIsland({ w: 760, h: 410 }, false, { ...A.DEFAULT_LOOK, uiWidth: 120 }, screen), { w: 912, h: 410 });
  assert.equal(A.scaledIsland({ w: 760, h: 410 }, false, { ...A.DEFAULT_LOOK, uiFontScale: 130 }, screen).h, Math.round(410 * 1.3), "fixed-height views grow with the text");
  assert.equal(A.scaledIsland({ w: 760, h: 410 }, false, { ...A.DEFAULT_LOOK, uiFontScale: 80 }, screen).h, 410, "smaller text does not shrink them");
  // The translator follows its content: a shorter island never goes below what its cards need.
  assert.equal(A.scaledIsland({ w: 760, h: 300 }, true, { ...A.DEFAULT_LOOK, uiHeight: 90 }, screen, 290).h, 290);
  assert.equal(A.scaledIsland({ w: 760, h: 300 }, true, { ...A.DEFAULT_LOOK, uiHeight: 90 }, screen, 100).h, 270);
  // Never bigger than the screen.
  const big = A.scaledIsland({ w: 860, h: 640 }, false, { ...A.DEFAULT_LOOK, uiWidth: 130, uiHeight: 130, uiFontScale: 140 }, { w: 900, h: 700 });
  assert.ok(big.w <= 900 && big.h <= 700);
});

test("the window is the default one until the island needs more, then grows in steps", () => {
  const panel = { w: 920, h: 640 };
  const screen = { w: 2536, h: 1392 };
  const largest = [{ w: 860, h: 640, fitsContent: true }, { w: 760, h: 452, fitsContent: false }];
  assert.deepEqual(A.panelFor(A.DEFAULT_LOOK, panel, largest, 20, screen), panel, "the default look needs exactly the default window");
  assert.deepEqual(A.panelFor({ ...A.DEFAULT_LOOK, uiWidth: 80, uiHeight: 90 }, panel, largest, 20, screen), panel, "a smaller island never shrinks the window below the default");
  const wide = A.panelFor({ ...A.DEFAULT_LOOK, uiWidth: 130 }, panel, largest, 20, screen);
  assert.ok(wide.w >= Math.round(860 * 1.3) + 40, "room for the widest island and its shadow");
  assert.equal(wide.w % A.PANEL_STEP, 0, "in steps");
  const float = A.panelFor({ ...A.DEFAULT_LOOK, uiFloating: true, uiFloatGap: 60 }, panel, largest, 20, screen);
  assert.ok(float.h >= 640 + 60, "room for the gap the island floats at");
  const huge = A.panelFor({ ...A.DEFAULT_LOOK, uiWidth: 130, uiHeight: 130, uiFontScale: 140 }, panel, largest, 20, { w: 1000, h: 700 });
  assert.ok(huge.w <= 1000 + A.PANEL_STEP && huge.h <= 700 + 60 + A.PANEL_STEP, "bounded by the screen");
});

test("readouts use the digits of the language", () => {
  assert.equal(A.readout(112, false), "112%");
  assert.equal(A.readout(112, true), "۱۱۲٪");
  assert.equal(A.readout(40, false, "px"), "40 px");
  assert.equal(A.readout(40, true, "px"), "۴۰ پیکسل");
});

test("the folded island: the design by default, then the user's width, height and zoom", () => {
  const L = LAYOUT;
  assert.deepEqual(L.compactSize(A.DEFAULT_LOOK), { w: 288, h: 32 }, "the design, untouched");
  assert.deepEqual(L.compactSize({ ...A.DEFAULT_LOOK, uiCompactWidth: 150 }), { w: 432, h: 32 });
  assert.deepEqual(L.compactSize({ ...A.DEFAULT_LOOK, uiCompactHeight: 150 }), { w: 288, h: 48 });
  assert.deepEqual(L.compactSize({ ...A.DEFAULT_LOOK, uiCompactScale: 150 }), { w: 432, h: 48 }, "the zoom grows both");
  const d = L.compactLayout(A.DEFAULT_LOOK);
  assert.equal(d.k, 1);
  assert.deepEqual([d.ariCx, d.ariCy, d.ariD, d.inset], [40, 16, 20, 40], "Ari and the minis sit where the design puts them");
  assert.deepEqual(L.botPosition("compact", "translate", 32), { cx: 40, cy: 16, diameter: 20, opacity: 1 }, "layout.ts keeps the design's own numbers");
});

test("the folded island never cuts what is in it, at any width, height and zoom", () => {
  const L = LAYOUT;
  for (const uiCompactWidth of [60, 100, 160]) for (const uiCompactHeight of [90, 100, 180]) for (const uiCompactScale of [70, 100, 180]) for (const rows of [2, 3]) {
    const look = { ...A.DEFAULT_LOOK, uiCompactWidth, uiCompactHeight, uiCompactScale };
    const c = L.compactLayout(look, rows);
    const tag = `${uiCompactWidth}/${uiCompactHeight}/${uiCompactScale} rows ${rows}`;
    assert.ok(c.gridH <= c.h + 0.001, `the minis fit the height (${tag})`);
    assert.ok(c.ariD <= c.h + 0.001, `Ari fits the height (${tag})`);
    assert.ok(c.ariCx + c.ariD / 2 <= c.w - c.inset - c.gridW / 2 + 0.001, `Ari does not touch the minis (${tag})`);
    assert.ok(c.ariCx - c.ariD / 2 >= -0.001 && c.inset + c.gridW / 2 <= c.w + 0.001, `both stay inside the capsule (${tag})`);
    assert.ok(c.k > 0.29, `never vanishingly small (${tag})`);
  }
});