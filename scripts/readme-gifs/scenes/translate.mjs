// The heart of the app: the compact capsule opens, a sentence is typed, the translation streams in,
// the Fast and Smart engines are compared, History is opened and browsed, and Copy folds the island
// back into the capsule (so the loop ends where it began).
import fs from "node:fs";
import path from "node:path";
import { sleep } from "../recorder.mjs";

export const meta = {
  file: "translate", width: 920, height: 500, fps: 15, hold: 800,
  async setup(rec) { guardFrameSize(rec); await prepare(rec); },
};

// What the mock backend answers. The sentence is an idiom on purpose: the Fast engine renders it word
// for word and the Smart engine understands it, which is the whole point of having two engines.
const DEMO = {
  en: {
    text: "Break a leg tomorrow!",
    fast: "فردا پایت را بشکن!",
    smart: "فردا موفق باشی!",
    breakdown: [{ term: "Break a leg", meaning: "موفق باشی", explanation: "A theatre wish for good luck, never meant literally." }],
    notes: "A warm, informal tone was kept.",
  },
  fa: {
    text: "دستت درد نکنه، خیلی کمکم کردی",
    fast: "May your hand not hurt, you helped me a lot",
    smart: "Thanks so much, you've been a huge help!",
    breakdown: [{ term: "دستت درد نکنه", meaning: "Thank you", explanation: "A friendly thank-you; literally \"may your hand not hurt\"." }],
    notes: "A warm, informal tone was kept.",
  },
};

/**
 * Headless Edge sometimes starts sending screencast frames at a different size once the island has
 * grown (e.g. 896x374 instead of 920x500), which would garble the GIF. Such frames are dropped as they
 * arrive and the viewport override is applied again, so every frame kept has the canvas size.
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
  fs.writeFileSync(path.join(dir, `translate-${rec.lang}-${name}.png`), Buffer.from(r.data, "base64"));
}

const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

/** Glides the pointer in real time: the recorder's own move takes about three times its nominal duration. */
async function glide(rec, x, y, ms) {
  const from = { ...rec.mouse };
  const t0 = Date.now();
  for (;;) {
    const k = Math.min(1, (Date.now() - t0) / ms);
    await rec._mouse("mouseMoved", from.x + (x - from.x) * ease(k), from.y + (y - from.y) * ease(k));
    if (k >= 1) break;
  }
  rec.mouse = { x, y };
}

/** Waits (up to 4 s) until a view has drawn the element, so a slow machine cannot outrun the page. */
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

async function tap(rec, selector, n = 0, { ms = 350, after = 500 } = {}) {
  const p = await hover(rec, selector, n, ms);
  await sleep(80);
  await rec.press(p.x, p.y);
  await sleep(50);
  await rec.release(p.x, p.y);
  await sleep(after);
}

async function prepare(rec) {
  const d = DEMO[rec.lang];
  await rec.eval(`globalThis.__demoTranslate = (text, engine) => {
    const D = ${JSON.stringify(d)};
    const smart = engine === "aphra";
    const full = smart ? D.smart : D.fast;
    const typed = text.trim();
    if (typed !== D.text) {
      // The debounce fired mid-sentence: answer with the matching share of the translation.
      if (!D.text.startsWith(typed)) return null;
      return { translation: full.slice(0, Math.max(1, Math.ceil(full.length * typed.length / D.text.length))), translit: "", alternatives: [], breakdown: [] };
    }
    return { translation: full, translit: "", alternatives: [],
      breakdown: smart ? D.breakdown : [], critiqueNotes: smart ? D.notes : "" };
  }`);
  // A made-up key, only so the mock treats the Smart engine as set up (it is never shown anywhere).
  await rec.eval(`import("/src/core/bridge.ts").then((m) => m.Bridge.saveSettings({}, { apiKey: "sk-demo-not-a-real-key" }))`);
  await rec.arizo(`A.island.collapse();`);
  rec.mouse = { x: rec.width - 130, y: rec.height - 100 };
  await rec.drawCursor(rec.mouse.x, rec.mouse.y);
  await sleep(900);
}

export async function scene(rec, lang) {
  const d = DEMO[lang];
  const T0 = Date.now(); const lap = (n) => { if (process.env.GIF_TIMING) console.log("  t", n, Date.now() - T0); };
  const home = { ...rec.mouse };
  await sleep(300);

  // 1. The capsule is clicked and opens into the translator.
  await tap(rec, "#island", 0, { ms: 420, after: 350 });
  await tap(rec, ".src-input", 0, { ms: 280, after: 80 });

  lap("opened");
  // 2. A sentence is typed; the translation streams into the result card.
  await rec.type(d.text, { delay: 24 });
  await sleep(650);
  await shot(rec, "a-fast");

  lap("typed");
  // 3. Smart reads the idiom, Fast takes it word for word.
  await tap(rec, ".engine-pills .pill", 1, { ms: 300, after: 750 });
  await shot(rec, "b-smart");
  await sleep(250);

  lap("pills");
  // 4. History: open it, glide over two rows, come back.
  await tap(rec, ".history-btn", 0, { ms: 300, after: 400 });
  await hover(rec, ".hist-row", 0, 320);
  await sleep(300);
  await shot(rec, "c-history");
  await hover(rec, ".hist-row", 1, 260);
  await sleep(220);
  await tap(rec, ".hist-back", 0, { ms: 300, after: 350 });

  lap("history");
  // 5. Copy: the island folds back into the capsule, the pointer leaves.
  await tap(rec, ".copy-btn", 0, { ms: 300, after: 500 });
  await glide(rec, home.x, home.y, 400);
  lap("copied");
  // The "copied" toast is up for 2.2 s: wait it out so the last frame is the capsule alone, like the first.
  await sleep(1500);
}
