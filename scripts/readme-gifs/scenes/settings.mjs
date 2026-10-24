// Settings tour inside the island: General (the theme flips to Light and back, live), Shortcuts (a shortcut
// is being recorded), Languages (a dropdown opens), AI Engine (a made-up key is typed), Sound (the volume
// slider is dragged), then back to General. The start and the end are the same screen (General, dark), so
// the loop is calm.
//
// `prepare` and `lighten` come from wardrobe.mjs (time-based pointer, a fixed-size frame); the recorder is untouched.
import { sleep } from "../recorder.mjs";
import { prepare, lighten } from "./wardrobe.mjs";

const NAV = { general: 0, shortcuts: 2, languages: 3, engine: 4, sound: 5 };
const park = { x: 600, y: 52 };

export const meta = { file: "settings", width: 920, height: 470, fps: 15, hold: 800, setup: prepare("settings", park) };

/** Clicks an element, waiting for it to exist first: saving a setting rebuilds the panel for a moment. */
async function click(rec, selector, n, opts) {
  for (let i = 0; i < 30; i++) {
    if (await rec.eval(`document.querySelectorAll(${JSON.stringify(selector)}).length > ${n}`)) break;
    await sleep(100);
  }
  return rec.click(selector, n, opts);
}

const tab = (rec, id, after = 520) => click(rec, ".settings-nav-btn", NAV[id], { ms: 260, after });

/** Drags the volume thumb to a value and back to where it was, in one gesture, whichever way the slider points. */
async function volume(rec, to) {
  const g = JSON.parse(await rec.eval(`(() => { const el = document.querySelector(".set-range"); el.scrollIntoView({ block: "nearest" });
    const b = el.getBoundingClientRect(); return JSON.stringify({ l: b.left, w: b.width, y: b.top + b.height / 2, v: Number(el.value), min: Number(el.min), max: Number(el.max), rtl: getComputedStyle(el).direction === "rtl" }); })()`));
  const x = (v) => { const f = (v - g.min) / (g.max - g.min); return g.rtl ? g.l + g.w - 7 - f * (g.w - 14) : g.l + 7 + f * (g.w - 14); };
  await rec.move(x(g.v), g.y, 380);
  await sleep(60);
  await rec.press();
  await sleep(80);
  await rec.move(x(to), g.y, 520, 1);
  await sleep(220);
  await rec.move(x(g.v), g.y, 420, 1);
  await sleep(100);
  await rec.release();
  await sleep(300);
}

export async function scene(rec, lang) {
  await lighten(rec);
  await sleep(450);

  // General: the theme flips to Light and back (Dark, Light, System are the 3rd to 5th segment buttons).
  // (Indexes 0 and 1 are the hidden All / Starred filter, 2 and 3 are the languages.)
  await click(rec, ".seg .seg-btn", 5, { ms: 420, after: 1000 });
  await click(rec, ".seg .seg-btn", 4, { ms: 340, after: 650 });

  // Shortcuts: press a shortcut button, it waits for keys; Escape leaves it as it was.
  await tab(rec, "shortcuts", 450);
  try {
    await rec.click(".keycap-btn", 0, { ms: 320, after: 650 });
    await rec.key("Escape", { code: "Escape", vk: 27 });
    await sleep(250);
  } catch { /* the tab still tells the story */ }

  // Languages: open a dropdown, then close it again.
  await tab(rec, "languages", 450);
  try {
    await rec.click(".set-select", 0, { ms: 320, after: 600 });
    await rec.key("Escape", { code: "Escape", vk: 27 });
    await sleep(200);
  } catch { /* ditto */ }

  // AI Engine: a made-up key is typed (only dots are shown unless the eye is pressed).
  await tab(rec, "engine", 450);
  if (await rec.exists(".set-key-input")) {
    await rec.click(".set-key-input", 0, { ms: 320, after: 200 });
    await rec.type("sk-demo-not-a-real-key", { delay: 30 });
    await sleep(450);
  }

  // Sound: the volume slider.
  await tab(rec, "sound", 450);
  await volume(rec, 0.3);

  // Back to General, where it began.
  await tab(rec, "general", 500);
}
