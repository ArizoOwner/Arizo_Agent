// The order of the header's feature tabs: what is kept, what is repaired, and the
// maths that decides where a dragged tab lands (left to right and right to left).

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FEATURE_ORDER, dragRange, insertionIndex, moved, normalizeOrder, rowLefts, sameOrder } from "../src/core/feature-order.ts";

test("a stored order is repaired into a full permutation of the four tabs", () => {
  assert.deepEqual(normalizeOrder(["crypto", "translate", "bogus", "crypto", 7]), ["crypto", "translate", "spotify", "football"]);
  assert.deepEqual(normalizeOrder([]), [...DEFAULT_FEATURE_ORDER]);
  assert.deepEqual(normalizeOrder("crypto"), [...DEFAULT_FEATURE_ORDER]);
  assert.deepEqual(normalizeOrder(undefined), [...DEFAULT_FEATURE_ORDER]);
  assert.ok(sameOrder(normalizeOrder(["football", "crypto", "spotify", "translate"]), ["football", "crypto", "spotify", "translate"]));
});

test("a dragged tab lands after as many of the others as lie before it", () => {
  const others = [10, 50, 90]; // the centres of the three other tabs, in reading order
  // A tab that started first (from = 0): only the tabs it has passed lie before it.
  assert.equal(insertionIndex(others, 0, 0), 0);
  assert.equal(insertionIndex(others, 30, 0), 1);
  assert.equal(insertionIndex(others, 70, 0), 2);
  assert.equal(insertionIndex(others, 200, 0), 3);
  // Right to left: the same positions negated, still in reading order.
  assert.equal(insertionIndex([-90, -50, -10], -60, 0), 1);
});

test("reaching the centre of a tab takes its place, from either side", () => {
  const others = [10, 50, 90];
  assert.equal(insertionIndex(others, 50, 0), 2, "dragged forward onto the second other: it ends up after it");
  assert.equal(insertionIndex(others, 50, 3), 1, "dragged back onto the second other: it ends up before it");
  assert.equal(insertionIndex(others, 90, 0), 3);
  assert.equal(insertionIndex(others, 10, 3), 0);
  // Not moving at all: a tab that started in the middle stays in the middle.
  assert.equal(insertionIndex([10, 90], 50, 1), 1);
});

test("every tab can be dragged far enough to reach every place, wide or narrow", () => {
  // Tabs of different widths in a row, the real ones' sizes, with a 5 px gap.
  const widths = [96, 85, 89, 84];
  for (const rtl of [false, true]) {
    const lefts = rowLefts(widths, 5, rtl, rtl ? 500 : 20);
    const boxes = widths.map((w, i) => ({ left: lefts[i], right: lefts[i] + w }));
    for (let from = 0; from < widths.length; from++) {
      const { lo, hi } = dragRange(boxes, from, 0);
      const centre = (b) => (b.left + b.right) / 2;
      for (let to = 0; to < widths.length; to++) {
        const need = centre(boxes[to]) - centre(boxes[from]); // the travel that puts its centre on that place's centre
        assert.ok(need >= lo - 1e-9 && need <= hi + 1e-9, `rtl=${rtl} tab ${from} cannot reach place ${to}: needs ${need}, may travel ${lo}..${hi}`);
      }
    }
  }
});

test("moved returns a reordered copy and leaves the list alone", () => {
  const list = ["a", "b", "c", "d"];
  assert.deepEqual(moved(list, 0, 2), ["b", "c", "a", "d"]);
  assert.deepEqual(moved(list, 3, 0), ["d", "a", "b", "c"]);
  assert.deepEqual(moved(list, 1, 1), list);
  assert.deepEqual(list, ["a", "b", "c", "d"]);
});

test("rows are laid out from the left edge, or from the right edge when they read right to left", () => {
  assert.deepEqual(rowLefts([40, 60, 40], 5, false, 100), [100, 145, 210]);
  // Right to left: the first tab ends at the anchor and the next ones follow to its left.
  assert.deepEqual(rowLefts([40, 60, 40], 5, true, 300), [260, 195, 150]);
});

test("a drag from the first place to the third rearranges both layouts the same way", () => {
  const widths = [38, 70, 62, 66];
  for (const rtl of [false, true]) {
    const order = moved([0, 1, 2, 3], 0, 2);
    const lefts = rowLefts(order.map((i) => widths[i]), 5, rtl, rtl ? 400 : 20);
    // Reading order is preserved: each tab sits one gap away from the previous one.
    for (let i = 1; i < lefts.length; i++) {
      const prev = order[i - 1], cur = order[i];
      const edge = rtl ? lefts[i - 1] - lefts[i] - widths[cur] : lefts[i] - lefts[i - 1] - widths[prev];
      assert.equal(edge, 5);
    }
  }
});
