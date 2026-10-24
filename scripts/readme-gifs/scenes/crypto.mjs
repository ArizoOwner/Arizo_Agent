// Crypto tab: connect a (fake, read-only) exchange key, then live price + candles, search a coin,
// star it, change the timeframe, switch USDT / Toman, then un-star and "Change API" back to the connect card.
import { sleep } from "../recorder.mjs";

export const meta = { file: "crypto", width: 920, height: 600, fps: 15, hold: 600 };

/** Index of the first element of `selector` whose text contains `needle`. */
async function indexOfText(rec, selector, needle) {
  const i = await rec.eval(`[...document.querySelectorAll(${JSON.stringify(selector)})].findIndex((e) => e.textContent.includes(${JSON.stringify(needle)}))`);
  if (i < 0) throw new Error(`no ${selector} with "${needle}"`);
  return i;
}

export async function scene(rec, lang) {
  const fa = lang === "fa";
  // The island resizes the headless viewport while it opens a view (frames would change size mid-GIF):
  // keep re-applying the canvas size for the whole recording.
  // Each mouse step costs about 16 ms of protocol time on top of its sleep, so a nominal glide takes ~1.8x as long
  // as asked: scale the glide durations so they last about what the scene says.
  const glide = rec.move.bind(rec);
  rec.move = (x, y, ms = 420) => glide(x, y, ms * 0.5);
  const pin = setInterval(() => {
    rec.send("Emulation.setDeviceMetricsOverride", { width: rec.width, height: rec.height, deviceScaleFactor: 1, mobile: false, screenWidth: 1920, screenHeight: 1080 }).catch(() => {});
  }, 250);
  try {
    await rec.arizo(`A.island.alert("crypto");`);
    await sleep(700);

    // 1. Pick the exchange: look down the list, settle on Nobitex.
    await rec.click(".cp-setup-form .dd", 0, { ms: 260, after: 250 });
    await rec.moveTo(".dd-menu .dd-item", 2, 140);
    await sleep(100);
    await rec.click(".dd-menu .dd-item", 0, { ms: 140, after: 180 });

    // 2. A fake, read-only key and secret (shown as dots), then Connect.
    await rec.click(".cp-setup-form input", 0, { ms: 200, after: 80 });
    await rec.type("demo-key-1234", { delay: 20 });
    await rec.click(".cp-setup-form input", 1, { ms: 170, after: 80 });
    await rec.type("demo-secret-99", { delay: 20 });
    await sleep(100);
    await rec.click(".cp-setup-btn-primary", 0, { ms: 220, after: 550 });

    // 3. Live price and chart: hover along the candles.
    const c = await rec.where(".cp-chart-svg", 0);
    await rec.move(c.l + c.w * 0.25, c.y, 180);
    await rec.move(c.l + c.w * 0.6, c.y, 240);

    // 4. Search a coin, pick it.
    await rec.click(".cp-dropdown-trigger", 0, { ms: 220, after: 200 });
    await rec.type(fa ? "سولانا" : "sol", { delay: 50 });
    await sleep(180);
    await rec.click(".cp-dropdown-item", await indexOfText(rec, ".cp-dropdown-item", "SOL"), { ms: 180, after: 400 });

    // 5. Star it as a favourite.
    await rec.click(".cp-star-btn", 0, { ms: 220, after: 350 });

    // 6. Timeframe from the dropdown.
    await rec.click(".cp-tf-trigger", 0, { ms: 220, after: 200 });
    await rec.click(".cp-tf-item", 2, { ms: 150, after: 400 });

    // 7. USDT to Toman.
    await rec.click(".cp-heading-actions .cp-btn-pill", 0, { ms: 220, after: 550 });

    // 8. Un-star again and go back to the connect card, so the loop closes where it started.
    await rec.click(".cp-star-btn", 0, { ms: 220, after: 250 });
    await rec.click(".cp-heading-actions .cp-btn-pill", 1, { ms: 220, after: 550 });
    await rec.move(rec.width / 2 + 60, 40, 200);
    await sleep(100);
  } finally {
    rec.move = glide;
    clearInterval(pin);
  }
}
