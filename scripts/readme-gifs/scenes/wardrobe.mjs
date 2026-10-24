// Ari's wardrobe: right-click Ari to open it, rest the pointer on hats to try them on, click to keep one,
// then go back to "auto" and close. The start and the end are the same screen (Translate, Ari in the
// season's hat), so the loop is calm.
//
// The helpers below (`prepare`, `lighten`, `rightClick`, `ariAt`) live here on purpose: they are also
// used by settings.mjs, and the recorder itself is left alone. They are time-based: the pointer follows the
// clock, not a step count, so a slow frame capture never stretches the animation.
import { sleep } from "../recorder.mjs";

const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

/**
 * Makes the headless window big enough that every screencast frame is exactly width x height (a smaller window
 * would scramble the GIF), opens the island on Translate before the recording starts, and parks the pointer.
 */
export function prepare(view = "translate", park = { x: 470, y: 60 }) {
  return async (rec) => {
    try {
      const { windowId } = await rec.send("Browser.getWindowForTarget");
      await rec.send("Browser.setWindowBounds", { windowId, bounds: { width: rec.width + 80, height: rec.height + 220 } });
    } catch { /* an older Edge: fine, screenshots are exact anyway */ }
    await rec.arizo(`A.island.alert(${JSON.stringify(view)});`);
    await sleep(1300);
    await rec._mouse("mouseMoved", park.x, park.y);
    rec.mouse = { ...park };
  };
}

/** Screen captures are the slow part: ask for every second change (the GIF is 15 fps anyway) and glide on the clock. */
export async function lighten(rec) {
  await rec.send("Page.stopScreencast").catch(() => {});
  // A loop of screenshots instead of the screencast: every frame is exactly width x height (as in look.mjs).
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

/** Where Ari is, in page pixels. */
export async function ariAt(rec) {
  return JSON.parse(await rec.arizo(`const r = A.island.islandRect(); return JSON.stringify({ x: r.x + A.island.botCx.value, y: r.y + A.island.botCy.value });`));
}

/** A real right click (the recorder only has the left button), with the same click ring as a left click. */
export async function rightClick(rec, x, y) {
  await rec.eval(`(() => { const r = document.getElementById("rec-ring"); r.style.left = "${x}px"; r.style.top = "${y}px"; r.classList.remove("on"); void r.offsetWidth; r.classList.add("on"); })()`);
  await rec.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "right", buttons: 2, clickCount: 1 });
  await sleep(60);
  await rec.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "right", buttons: 0, clickCount: 1 });
}

export const meta = { file: "wardrobe", width: 920, height: 400, fps: 15, hold: 700, setup: prepare("translate") };

export async function scene(rec, lang) {
  await lighten(rec);
  await sleep(350);
  const a = await ariAt(rec);
  await rec.move(a.x + 6, a.y + 6, 420);
  await sleep(120);
  await rightClick(rec, a.x + 6, a.y + 6);
  await sleep(750);

  const item = (n, ms = 230) => rec.moveTo(".wardrobe-item", n, ms);
  const W = { auto: 0, party: 2, crown: 4, sunglasses: 5, bunny: 12 };
  await item(W.party);      await sleep(480);
  await item(W.crown);      await sleep(300);
  await rec.click(".wardrobe-item", W.crown, { ms: 80, after: 600 });
  await item(W.sunglasses); await sleep(420);
  await item(W.bunny);      await sleep(300);
  await rec.click(".wardrobe-item", W.bunny, { ms: 80, after: 650 });
  await rec.click(".wardrobe-item", W.auto, { ms: 380, after: 550 });

  const b = await ariAt(rec);
  await rec.move(b.x + 6, b.y + 6, 380);
  await sleep(100);
  await rightClick(rec, b.x + 6, b.y + 6);
  await sleep(750);
}
