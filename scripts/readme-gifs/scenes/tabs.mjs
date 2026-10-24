// The header tabs can be rearranged by drag and drop: a tab is picked up, carried across the others
// (they slide aside), dropped, opened, and carried back, so the loop ends in the order it began.
import fs from "node:fs";
import path from "node:path";
import { sleep } from "../recorder.mjs";

export const meta = {
  file: "tabs", width: 920, height: 500, fps: 15, hold: 800,
  async setup(rec) { guardFrameSize(rec); await prepare(rec); },
};

const TABS = ".tabs [data-view]";
const MOVED = "crypto"; // the last tab: it has the longest way to travel

/**
 * Headless Edge sometimes starts sending screencast frames at a different size once the island has
 * resized (e.g. 896x374 instead of 920x500), which would garble the GIF. Such frames are dropped as
 * they arrive and the viewport override is applied again, so every frame kept has the canvas size.
 */
function guardFrameSize(rec) {
  const handler = rec.ws.onmessage;
  const want = `${rec.width}x${rec.height}`;
  let fixedAt = 0;
  rec.ws.onmessage = (m) => {
    const before = rec.frames.length;
    handler(m);
    if (rec.frames.length === before) return;
    const png = rec.frames[rec.frames.length - 1].png;
    if (`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}` === want) return;
    rec.frames.pop();
    if (Date.now() - fixedAt < 120) return;
    fixedAt = Date.now();
    rec.send("Emulation.setDeviceMetricsOverride", {
      width: rec.width, height: rec.height, deviceScaleFactor: 1, mobile: false, screenWidth: 1920, screenHeight: 1080,
    }).catch(() => {});
  };
}

/** A look at the screen at this moment, saved next to the keyframes (only when keyframes are asked for). */
async function shot(rec, name) {
  const dir = process.env.GIF_KEYFRAMES;
  if (!dir) return;
  const r = await rec.send("Page.captureScreenshot", { format: "png" });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `tabs-${rec.lang}-${name}.png`), Buffer.from(r.data, "base64"));
}

const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

/** Glides the pointer in real time (the recorder's own move takes about three times its nominal duration). */
async function glide(rec, x, y, ms, extra = {}) {
  const from = { ...rec.mouse };
  const t0 = Date.now();
  for (;;) {
    const k = Math.min(1, (Date.now() - t0) / ms);
    await rec._mouse("mouseMoved", from.x + (x - from.x) * ease(k), from.y + (y - from.y) * ease(k), extra);
    if (k >= 1) break;
  }
  rec.mouse = { x, y };
}

/** Waits (up to 4 s) until the page has drawn the element, so a slow machine cannot outrun it. */
async function waitFor(rec, selector, n = 0) {
  for (let i = 0; i < 80; i++) {
    if (await rec.eval(`document.querySelectorAll(${JSON.stringify(selector)}).length > ${n}`)) return;
    await sleep(50);
  }
}

async function hover(rec, selector, n, ms) {
  await waitFor(rec, selector, n);
  const p = await rec.where(selector, n);
  await glide(rec, p.x, p.y, ms);
  return p;
}

const tab = (view) => `.tabs [data-view="${view}"]`;

async function tap(rec, selector, n = 0, { ms = 350, after = 500 } = {}) {
  const p = await hover(rec, selector, n, ms);
  await sleep(80);
  await rec.press(p.x, p.y);
  await sleep(50);
  await rec.release(p.x, p.y);
  await sleep(after);
}

/** Where the tabs sit now, in reading order of the DOM (the first is the rightmost one in Persian). */
const tabRects = (rec) => rec.eval(`Array.from(document.querySelectorAll(${JSON.stringify(TABS)}))
  .filter((el) => el.offsetWidth > 0)
  .map((el) => { const b = el.getBoundingClientRect(); return { view: el.dataset.view, x: b.left + b.width / 2, y: b.top + b.height / 2 }; })`);

/**
 * Picks the tab up with the mouse button held, carries it to where the tab in slot `slot` is, and lets go.
 * `look` is called half way, with the tab in the air and the others already slid aside.
 */
async function dragTab(rec, view, slot, look) {
  const before = await tabRects(rec);
  const mine = before.find((t) => t.view === view);
  const target = before[slot];
  const p = await hover(rec, tab(view), 0, 420);
  await sleep(140);
  await rec.press(p.x, p.y);
  await sleep(160);
  const held = { buttons: 1 };
  // A little past the middle of the target tab, so the order flips for sure (a tie would not).
  const dx = target.x - mine.x + Math.sign(target.x - mine.x) * 26;
  await glide(rec, p.x + dx * 0.55, p.y + 3, 560, held);
  if (look) await look();
  await glide(rec, p.x + dx, p.y, 520, held);
  await sleep(180);
  await rec.release(p.x + dx, p.y);
  await sleep(520); // the drop settles into its slot (300 ms) and the order is written
}

async function prepare(rec) {
  await rec.arizo(`A.island.alert("translate");`);
  await waitFor(rec, TABS, 3);
  rec.mouse = { x: rec.width - 130, y: rec.height - 100 };
  await rec.drawCursor(rec.mouse.x, rec.mouse.y);
  await sleep(900);
}

export async function scene(rec, lang) {
  const home = { ...rec.mouse };
  const T0 = Date.now();
  const lap = (n) => { if (process.env.GIF_TIMING) console.log("  t", n, Date.now() - T0); };
  await sleep(350);

  // 1. Pick the last tab up, carry it across the others to the front, drop it.
  await dragTab(rec, MOVED, 0, () => shot(rec, "a-air"));
  await shot(rec, "b-dropped");
  lap("moved");

  // 2. Open it: it is a tab like any other, wherever it sits.
  await sleep(200);
  await tap(rec, tab(MOVED), 0, { ms: 150, after: 900 });
  await shot(rec, "c-opened");
  lap("opened");

  // 3. And carry it back to the end of the row.
  await dragTab(rec, MOVED, 3);
  lap("back");

  // 4. Back to the first tab, so the loop ends where it began; the pointer leaves.
  await tap(rec, tab("translate"), 0, { ms: 420, after: 380 });
  await glide(rec, home.x, home.y, 380);
  await sleep(200);
}
