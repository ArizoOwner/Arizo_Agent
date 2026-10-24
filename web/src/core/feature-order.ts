// The order of the feature tabs in the island's header, which the user rearranges
// by dragging. Pure helpers: the dragging itself lives in views/tab-drag.ts.

export const FEATURE_IDS = ["translate", "spotify", "football", "crypto"] as const;
export type FeatureId = (typeof FEATURE_IDS)[number];

export const DEFAULT_FEATURE_ORDER: readonly FeatureId[] = FEATURE_IDS;

/**
 * Whatever was stored becomes a complete order: unknown names and repeats go, and
 * the tabs that are missing come back in their default places (store.rs does the same).
 */
export function normalizeOrder(raw: unknown): FeatureId[] {
  const out: FeatureId[] = [];
  if (Array.isArray(raw)) {
    for (const id of raw) {
      if ((FEATURE_IDS as readonly unknown[]).includes(id) && !out.includes(id as FeatureId)) out.push(id as FeatureId);
    }
  }
  for (const id of FEATURE_IDS) if (!out.includes(id)) out.push(id);
  return out;
}

export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Where a dragged tab lands among the others: how many of them lie before it along
 * the reading direction. `othersPos` are the other tabs' centres in reading order and
 * `from` is the dragged tab's place before the drag (so the first `from` of the others
 * started before it). Reaching a tab's centre takes that tab's place, from either side.
 */
export function insertionIndex(othersPos: readonly number[], draggedPos: number, from: number): number {
  let before = 0;
  othersPos.forEach((pos, i) => {
    if (i < from ? pos < draggedPos : pos <= draggedPos) before++;
  });
  return before;
}

/**
 * How far the dragged tab may travel each way (relative to where it started). A tab takes
 * another's place when its centre reaches that tab's centre, and a tab wider than the one at
 * the end of the row sticks out past the row by half the difference when it does: the range
 * allows for that, plus `endSlack`, so every tab can reach every place.
 */
export function dragRange(
  boxes: readonly { left: number; right: number }[],
  from: number,
  endSlack: number,
): { lo: number; hi: number } {
  const me = boxes[from];
  const first = boxes.reduce((a, b) => (b.left < a.left ? b : a));
  const last = boxes.reduce((a, b) => (b.right > a.right ? b : a));
  const wider = (end: { left: number; right: number }) => Math.max(0, (me.right - me.left - (end.right - end.left)) / 2) + endSlack;
  return { lo: first.left - me.left - wider(first), hi: last.right - me.right + wider(last) };
}

/** A copy of `list` with the item at `from` moved to index `to`. */
export function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Left edges of tabs laid out in a row. `anchor` is the left edge of the first tab
 * when the row reads left to right, and its right edge when it reads right to left.
 */
export function rowLefts(widths: readonly number[], gap: number, rtl: boolean, anchor: number): number[] {
  const lefts: number[] = [];
  let used = 0;
  for (const width of widths) {
    lefts.push(rtl ? anchor - used - width : anchor + used);
    used += width + gap;
  }
  return lefts;
}
