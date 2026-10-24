// Drag and drop for the header's feature tabs. Pick a tab up, slide it along the
// row, and the others spring aside to make room; let go and it settles into its
// place. The order itself is plain data (core/feature-order.ts); this file only
// moves elements and reports the new order once the drop has settled.
//
// Alt+Left / Alt+Right on a focused tab moves it one place, for the keyboard.
// Positions are physical (getBoundingClientRect + translate3d), so the same maths
// serves the right-to-left Persian layout, where the first tab is the rightmost.

import { dragRange, insertionIndex, moved, rowLefts } from "../core/feature-order";

/** How far the pointer must travel before a press becomes a drag (a click stays a click). */
const THRESHOLD = 5;
/** How far past the row's end a dragged tab may travel, beyond what its width needs. */
const END_SLACK = 8;
/** A little longer than the CSS transition of a settling tab (.tabs.sorting in style.css). */
const SETTLE_MS = 300;

export type TabDragCue = "pickup" | "swap" | "drop";

export interface TabDragOptions {
  /** The row of tab buttons; every tab carries `data-view`. */
  container: HTMLElement;
  rtl: () => boolean;
  /** The full order of the tabs' `data-view` ids after a move, hidden tabs included. */
  onReorder: (order: string[]) => void;
  /** A sound or haptic hook. */
  onCue?: (cue: TabDragCue) => void;
}

interface Drag {
  el: HTMLElement;
  /** The tabs on screen when the drag began, in reading order, and their boxes then. */
  tabs: HTMLElement[];
  rects: DOMRect[];
  from: number;
  to: number;
  startX: number;
  pointerId: number;
  gap: number;
  rtl: boolean;
  anchor: number;
  /** How far the dragged tab may travel each way and stay inside the row. */
  lo: number;
  hi: number;
}

export function enableTabDrag(opts: TabDragOptions): () => void {
  const { container } = opts;
  let press: { el: HTMLElement; pointerId: number; x: number } | null = null;
  let drag: Drag | null = null;
  let busy = false; // a drop or a key move is still settling
  let swallowClick = false;

  const visible = (): HTMLElement[] =>
    Array.from(container.children).filter(
      (c): c is HTMLElement => c instanceof HTMLElement && c.dataset.view != null && c.offsetWidth > 0,
    );

  const tabOf = (target: EventTarget | null): HTMLElement | null => {
    const tab = (target as Element | null)?.closest<HTMLElement>("[data-view]") ?? null;
    return tab && tab.parentElement === container ? tab : null;
  };

  /** Puts every tab but the dragged one where the new order wants it; returns the dragged tab's slot. */
  function arrange(d: Drag): number {
    const order = moved(d.tabs, d.from, d.to);
    const lefts = rowLefts(order.map((t) => d.rects[d.tabs.indexOf(t)].width), d.gap, d.rtl, d.anchor);
    d.tabs.forEach((t, i) => {
      if (i !== d.from) t.style.transform = `translate3d(${lefts[order.indexOf(t)] - d.rects[i].left}px,0,0)`;
    });
    return lefts[d.to];
  }

  /** Writes a new order into the DOM (visible tabs take the visible places) and reports it. */
  function commit(tabs: HTMLElement[], order: HTMLElement[]): void {
    const shown = new Set(tabs);
    let next = 0;
    const all = Array.from(container.children) as HTMLElement[];
    const placed = all.map((el) => (shown.has(el) ? order[next++] : el));
    container.append(...placed);
    opts.onReorder(placed.map((el) => el.dataset.view ?? ""));
  }

  function begin(p: { el: HTMLElement; pointerId: number; x: number }): void {
    const tabs = visible();
    const from = tabs.indexOf(p.el);
    press = null;
    if (from < 0 || tabs.length < 2) return;
    const rects = tabs.map((t) => t.getBoundingClientRect());
    const rtl = opts.rtl();
    const range = dragRange(rects, from, END_SLACK);
    drag = {
      el: p.el, tabs, rects, from, to: from, startX: p.x, pointerId: p.pointerId,
      gap: Math.max(0, rtl ? rects[0].left - rects[1].right : rects[1].left - rects[0].right),
      rtl,
      anchor: rtl ? rects[0].right : rects[0].left,
      lo: range.lo,
      hi: range.hi,
    };
    swallowClick = true;
    try { p.el.setPointerCapture(p.pointerId); } catch { /* the pointer is already gone */ }
    container.classList.add("sorting");
    p.el.classList.add("dragging");
    opts.onCue?.("pickup");
  }

  function follow(x: number): void {
    const d = drag;
    if (!d) return;
    const dx = Math.min(d.hi, Math.max(d.lo, x - d.startX));
    d.el.style.transform = `translate3d(${dx}px,0,0) scale(1.08)`;
    // Reading order along the row, whichever way it reads.
    const sign = d.rtl ? -1 : 1;
    const centre = d.rects[d.from].left + dx + d.rects[d.from].width / 2;
    const others = d.rects.filter((_, i) => i !== d.from).map((r) => sign * (r.left + r.width / 2));
    const to = insertionIndex(others, sign * centre, d.from);
    if (to !== d.to) {
      d.to = to;
      arrange(d);
      opts.onCue?.("swap");
    }
  }

  function finish(cancel: boolean): void {
    const d = drag;
    if (!d) return;
    drag = null;
    busy = true;
    if (cancel) d.to = d.from;
    const slot = arrange(d);
    d.el.classList.remove("dragging");
    d.el.classList.add("dropping");
    d.el.style.transform = `translate3d(${slot - d.rects[d.from].left}px,0,0)`;
    try { d.el.releasePointerCapture(d.pointerId); } catch { /* already released */ }
    opts.onCue?.("drop");
    window.setTimeout(() => (swallowClick = false), 30);
    window.setTimeout(() => {
      // Every transform goes and the DOM takes the new order in the same frame, with
      // transitions off, so nothing flashes between the animation and the real layout.
      container.classList.add("no-anim");
      for (const t of d.tabs) {
        t.style.transform = "";
        t.classList.remove("dragging", "dropping");
      }
      if (d.to !== d.from) commit(d.tabs, moved(d.tabs, d.from, d.to));
      void container.offsetWidth;
      container.classList.remove("no-anim", "sorting");
      busy = false;
    }, SETTLE_MS);
  }

  /** Alt+arrow: one place along the row, animated from where the tab was. */
  function nudge(tab: HTMLElement, step: number): void {
    const tabs = visible();
    const i = tabs.indexOf(tab);
    const j = i + step;
    if (i < 0 || j < 0 || j >= tabs.length) return;
    const before = new Map(tabs.map((t) => [t, t.getBoundingClientRect().left] as const));
    busy = true;
    container.classList.add("no-anim", "sorting");
    commit(tabs, moved(tabs, i, j));
    for (const t of tabs) t.style.transform = `translate3d(${(before.get(t) ?? 0) - t.getBoundingClientRect().left}px,0,0)`;
    void container.offsetWidth;
    container.classList.remove("no-anim");
    for (const t of tabs) t.style.transform = "";
    tab.focus({ preventScroll: true });
    opts.onCue?.("swap");
    window.setTimeout(() => {
      container.classList.remove("sorting");
      busy = false;
    }, SETTLE_MS);
  }

  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || busy || drag) return;
    const tab = tabOf(e.target);
    if (tab && visible().length >= 2) press = { el: tab, pointerId: e.pointerId, x: e.clientX };
  };
  const onMove = (e: PointerEvent): void => {
    if (drag) {
      if (e.pointerId === drag.pointerId) follow(e.clientX);
      return;
    }
    if (!press || e.pointerId !== press.pointerId || Math.abs(e.clientX - press.x) < THRESHOLD) return;
    begin(press);
    follow(e.clientX);
  };
  const onUp = (e: PointerEvent): void => {
    if (press && e.pointerId === press.pointerId) press = null;
    else if (drag && e.pointerId === drag.pointerId) finish(false);
  };
  const onCancel = (e: PointerEvent): void => {
    if (press && e.pointerId === press.pointerId) press = null;
    else if (drag && e.pointerId === drag.pointerId) finish(true);
  };
  const onBlur = (): void => {
    press = null;
    finish(true);
  };
  /** A drag ends with a click on the tab it started on; that click must not switch view. */
  const onClick = (e: MouseEvent): void => {
    if (!swallowClick) return;
    e.stopPropagation();
    e.preventDefault();
  };
  /** Escape puts the tab back, and must not also close the island (captured before it). */
  const onEscape = (e: KeyboardEvent): void => {
    if (!drag || e.key !== "Escape") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    finish(true);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (busy || drag || !e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    const tab = tabOf(e.target);
    if (!tab) return;
    e.preventDefault();
    // ArrowLeft is "visually left": earlier in a left-to-right row, later in a right-to-left one.
    const left = e.key === "ArrowLeft";
    nudge(tab, left === opts.rtl() ? 1 : -1);
  };

  container.addEventListener("pointerdown", onDown);
  container.addEventListener("click", onClick, true);
  container.addEventListener("keydown", onKey);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("blur", onBlur);
  window.addEventListener("keydown", onEscape, true);

  return () => {
    container.removeEventListener("pointerdown", onDown);
    container.removeEventListener("click", onClick, true);
    container.removeEventListener("keydown", onKey);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("keydown", onEscape, true);
  };
}
