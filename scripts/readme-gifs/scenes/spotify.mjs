// Spotify: a track plays, Ari dances to the beat while the timeline runs, Pause and Play, the timeline
// is dragged forward, the volume is dragged down and back up, and "previous" restarts the song, so the
// loop ends where it began. The track is sample data (a gradient cover drawn as a data: URL).
import { sleep } from "../recorder.mjs";

export const meta = {
  file: "spotify", width: 920, height: 370, fps: 15, hold: 800,
  async setup(rec) { await prepare(rec); },
};

const TRACKS = {
  en: { title: "Neon Skyline", artist: "Sample Artist", album: "Sample Album" },
  fa: { title: "آسمان نئونی", artist: "هنرمند نمونه", album: "آلبوم نمونه" },
};

// A retro sunset: a gradient, a sun cut by dark bars. Made here so no real album art is used.
const COVER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs>
<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b1055"/><stop offset=".55" stop-color="#c13584"/><stop offset="1" stop-color="#ff7a59"/></linearGradient>
<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe29a"/><stop offset="1" stop-color="#ff8a5c"/></linearGradient></defs>
<rect width="200" height="200" fill="url(#g)"/><circle cx="100" cy="92" r="46" fill="url(#s)"/>
<rect x="40" y="96" width="120" height="4" fill="#c13584"/><rect x="40" y="108" width="120" height="6" fill="#c13584"/><rect x="40" y="122" width="120" height="8" fill="#c13584"/>
<rect y="132" width="200" height="68" fill="#1a0b33"/><path d="M0 150h200M0 168h200M0 186h200M40 132L-30 200M80 132L50 200M120 132L150 200M160 132L230 200" stroke="#ff4fa8" stroke-width="1.4" opacity=".7"/></svg>`;

/** Headless Edge sometimes sends a cropped, smaller screencast frame mid-recording: those are dropped and the viewport is set again. */
function guardFrames(rec) {
  const orig = rec.ws.onmessage;
  let lastFix = 0;
  rec.ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.method === "Page.screencastFrame") {
      const png = Buffer.from(msg.params.data, "base64");
      if (png.readUInt32BE(16) !== rec.width || png.readUInt32BE(20) !== rec.height) {
        rec.send("Page.screencastFrameAck", { sessionId: msg.params.sessionId }).catch(() => {});
        if (Date.now() - lastFix > 300) {
          lastFix = Date.now();
          rec.send("Emulation.setDeviceMetricsOverride", { width: rec.width, height: rec.height, deviceScaleFactor: 1, mobile: false, screenWidth: 1920, screenHeight: 1080 })
            .then(() => rec.send("Page.stopScreencast")).then(() => rec.send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: rec.width, maxHeight: rec.height }))
            .catch(() => {});
        }
        return;
      }
    }
    orig(m);
  };
}

async function prepare(rec) {
  guardFrames(rec);
  const t = TRACKS[rec.lang];
  const state = {
    enabled: true, configured: true, connected: false, accountName: "", premium: true, running: true, installed: true,
    source: "local", device: "", error: "", playing: true, shuffle: false, repeat: false, volume: 60,
    track: { id: "spotify:track:sample", title: t.title, artist: t.artist, album: t.album, duration: 168, artUrl: "sample://cover" },
    artworkDataUrl: "data:image/svg+xml;utf8," + encodeURIComponent(COVER),
    capabilities: { playPause: true, next: true, previous: true, seek: true, shuffle: true, repeat: true, volume: true },
  };
  // The island stays open for the whole recording (no auto-close), on the Spotify tab.
  await rec.arizo(`A.State.settings.autoCloseInterval = 600; A.State.settings.ariOutfit = "none"; A.island.fsm.homeToPetitDelay = 600; A.island.alert("spotify");`);
  await sleep(700);
  // The song starts at 0:02 a moment after the recording begins.
  await rec.arizo(`A.spotify.mock(Object.assign(${JSON.stringify(state)}, { position: 2, positionAt: Date.now() + 900 }));`);
  rec.mouse = { x: rec.width - 110, y: rec.height - 22 };
  await rec.drawCursor(rec.mouse.x, rec.mouse.y);
  await sleep(500);
}

/** Moves the pointer by the clock, not by step count: it takes `ms` however slow the browser answers, so a busy machine cannot stretch the GIF. */
async function glide(rec, x, y, ms) {
  const from = { ...rec.mouse }, t0 = Date.now();
  for (;;) {
    const k = Math.min(1, (Date.now() - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    await rec._mouse("mouseMoved", from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    if (k >= 1) break;
    await sleep(14);
  }
  rec.mouse = { x, y };
}

/** Glides to an element, clicks it and waits a beat (rec.click with the clock-based glide). */
async function tap(rec, selector, n, { ms = 450, after = 400 } = {}) {
  const p = await rec.where(selector, n);
  await glide(rec, p.x, p.y, ms);
  await sleep(100);
  await rec.press(p.x, p.y);
  await sleep(60);
  await rec.release(p.x, p.y);
  await sleep(after);
}

/** Presses a slider's thumb, glides through the given values and lets go at the last one. */
async function dragVia(rec, selector, values, { ms = 450, hold = 90 } = {}) {
  const info = await rec.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
    const b = el.getBoundingClientRect(); return { l: b.left, w: b.width, y: b.top + b.height / 2, v: Number(el.value), min: Number(el.min), max: Number(el.max) }; })()`);
  const at = (v) => info.l + 8 + ((v - info.min) / (info.max - info.min)) * (info.w - 16);
  await glide(rec, at(info.v), info.y, 380);
  await sleep(80);
  await rec.press(at(info.v), info.y);
  await sleep(hold);
  for (const v of values) { await glide(rec, at(v), info.y, ms); await sleep(hold); }
  await rec.release(at(values[values.length - 1]), info.y);
  await sleep(220);
}

export async function scene(rec, lang) {
  const home = { ...rec.mouse };
  // 1. The song plays: Ari dances, the clock and the thumb of the timeline move.
  await sleep(800);

  // 2. Pause: Ari stops, the timeline freezes; Play: he dances again.
  await tap(rec, ".spotify-play", 0, { ms: 480, after: 750 });
  await tap(rec, ".spotify-play", 0, { ms: 200, after: 450 });

  // 3. The timeline is dragged to the chorus.
  await dragVia(rec, ".spotify-seek", [118], { ms: 550 });
  await sleep(250);

  // 4. The volume goes down, then comes back up.
  await dragVia(rec, ".spotify-volume", [20, 60], { ms: 380, hold: 60 });
  await sleep(100);

  // 5. "Previous" starts the song over; the pointer leaves.
  await tap(rec, ".spotify-controls .spotify-control", 1, { ms: 450, after: 650 });
  await glide(rec, home.x, home.y, 520);
}
