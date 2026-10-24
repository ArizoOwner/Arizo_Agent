// Settings > Island look: the sliders change the real island live (width, height, corners, see-through,
// text size), the floating island drops from the top edge, and "Reset all to default" puts it all back.
// The scene starts and ends on the same screen (Island look, everything at its default), so it loops calmly.
//
// The helpers at the top (exported as `kit`) are shared with folded.mjs. They are time-based: the pointer and
// the scrolling follow the clock, not a step count, so a slow frame capture never stretches the animation.
import { sleep } from "../recorder.mjs";

const START = { x: 520, y: 70 };

/** Opens Settings on the Island look tab with the pointer parked above the island's content. */
export async function openLook(rec) {
  await rec.arizo(`A.island.alert("settings");`);
  await sleep(1300);
  await rec.eval(`document.querySelectorAll(".settings-nav-btn")[1].click()`);
  await sleep(900);
  await rec._mouse("mouseMoved", START.x, START.y);
  rec.mouse = { ...START };
}

export const meta = { file: "look", width: 1040, height: 640, fps: 15, hold: 900, setup: openLook };

const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

/**
 * The page is captured by a loop of screenshots instead of the screencast: the screencast of this large page hands back
 * frames of changing sizes once the island resizes, a loop gives every frame exactly width x height.
 */
export async function lighten(rec) {
  await rec.send("Page.stopScreencast").catch(() => {});
  for (let lane = 0; lane < 3; lane++) (async () => {
    await sleep(lane * 40);
    while (rec.recording) {
      try {
        const r = await rec.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true });
        if (rec.recording) rec.frames.push({ t: Date.now(), png: Buffer.from(r.data, "base64") });
      } catch { /* the page is closing */ }
      await sleep(8);
    }
  })();
  // The pointer glides on the clock (see above), so rec.click / rec.drag take exactly the time they say.
  rec.move = async (x, y, ms = 420, buttons = 0) => {
    const from = { ...rec.mouse }, t0 = Date.now();
    for (;;) {
      const k = Math.min(1, (Date.now() - t0) / ms), e = ease(k);
      await rec._mouse("mouseMoved", from.x + (x - from.x) * e, from.y + (y - from.y) * e, { buttons });
      if (k >= 1) break;
      await sleep(6);
    }
    rec.mouse = { x, y };
  };
}

export const panel = (rec) => rec.eval(`(() => { const e = document.querySelector(".settings-panel"); const b = e.getBoundingClientRect();
  return { l: b.left, t: b.top, w: b.width, h: b.height, top: e.scrollTop, max: e.scrollHeight - e.clientHeight }; })()`);

/** Scrolls the settings panel to `want` with real wheel events, on the clock, so it glides. */
export async function wheelTo(rec, want, ms = 480) {
  let p = await panel(rec);
  want = Math.max(0, Math.min(p.max, Math.round(want)));
  if (Math.abs(want - p.top) < 2) return;
  const inside = rec.mouse.x > p.l && rec.mouse.x < p.l + p.w && rec.mouse.y > p.t && rec.mouse.y < p.t + p.h;
  if (!inside) await rec.move(p.l + p.w * 0.1, p.t + p.h * 0.5, 280);
  const from = p.top, t0 = Date.now();
  for (;;) {
    const k = Math.min(1, (Date.now() - t0) / ms);
    const goal = from + (want - from) * ease(k);
    p = await panel(rec);
    const d = goal - p.top;
    if (Math.abs(d) >= 1) await rec.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: rec.mouse.x, y: rec.mouse.y, deltaX: 0, deltaY: d });
    if (k >= 1) break;
    await sleep(10);
  }
  await sleep(120);
}

/** Scrolls so the n-th element matching the selector sits at `at` (0 = top, 1 = bottom) of the visible panel. */
export async function reveal(rec, selector, n = 0, at = 0.42, ms = 480) {
  const p = await panel(rec);
  const y = await rec.eval(`(() => { const b = document.querySelectorAll(${JSON.stringify(selector)})[${n}].getBoundingClientRect(); return b.top + b.height / 2; })()`);
  // Already well inside the panel: leave the scroll alone, so the story is not a series of scrolls.
  if (y > p.t + 36 && y < p.t + p.h - 36) return;
  await wheelTo(rec, p.top + (y - (p.t + p.h * at)), ms);
}

const geo = (rec, n) => rec.eval(`(() => { const el = document.querySelectorAll(".look-range")[${n}]; const b = el.getBoundingClientRect();
  return { l: b.left, w: b.width, y: b.top + b.height / 2, v: Number(el.value), min: Number(el.min), max: Number(el.max), rtl: getComputedStyle(el).direction === "rtl" }; })()`);
const thumbX = (g, v) => { const f = (v - g.min) / (g.max - g.min); return g.rtl ? g.l + g.w - 6.5 - f * (g.w - 13) : g.l + 6.5 + f * (g.w - 13); };

/**
 * Drags the thumb of the n-th look slider through the given values in one gesture
 * (press, glide to each value in turn, release): the island follows live while it is held.
 */
export async function slide(rec, n, values, { ms = 380, pause = 90, scroll = 0.42, walk = 170 } = {}) {
  await reveal(rec, ".look-range", n, scroll);
  const g = await geo(rec, n);
  await rec.move(thumbX(g, g.v), g.y, walk);
  await sleep(30);
  await rec.press();
  await sleep(50);
  for (const to of values) {
    await rec.move(thumbX(g, to), g.y, ms, 1);
    await sleep(pause);
  }
  await rec.release();
  await sleep(120);
}

export const kit = { openLook, lighten, panel, wheelTo, reveal, slide, START };

// ── the scene ────────────────────────────────────────────────────────────────

export async function scene(rec, lang) {
  await lighten(rec);
  await sleep(300);
  await slide(rec, 0, [114, 100], { ms: 400, pause: 150 });          // width: wider, then back
  await slide(rec, 1, [114], { ms: 340 });                           // height: taller
  await slide(rec, 2, [15, 150], { ms: 320, pause: 40 });            // corners: square, then extra round
  await slide(rec, 3, [55], { ms: 380, pause: 200 });                // transparency: see-through over the wallpaper
  await slide(rec, 4, [120], { ms: 360, pause: 120 });               // text size
  await reveal(rec, ".switch", 0, 0.35);
  await rec.click(".switch", 0, { ms: 280, after: 280 });            // floating island on
  await slide(rec, 5, [36], { ms: 360, pause: 160, scroll: 0.5 });   // distance from the top
  await reveal(rec, ".look-reset-all", 0, 0.7);
  await rec.click(".look-reset-all", 0, { ms: 280, after: 450 });    // everything back to default
  await wheelTo(rec, 0, 380);
  await rec.move(START.x, START.y, 320);
  await sleep(150);
}
