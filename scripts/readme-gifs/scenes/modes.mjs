// The island's modes: open (Spotify playing) -> Ctrl+M folds it into the capsule (clock, mini Aris, Ari dancing)
// -> the hide shortcut tucks it into the top edge -> the pointer at the top edge wakes it -> a click opens it again.
// The real hide shortcut is a Tauri-only global hotkey; here the page calls what it ends up calling (fsm.forceHidden).
import { sleep } from "../recorder.mjs";

export const meta = {
  file: "modes", width: 920, height: 370, fps: 15, hold: 800,
  async setup(rec) { await prepare(rec); },
};

const TRACKS = {
  en: { title: "Neon Skyline", artist: "Sample Artist", album: "Sample Album" },
  fa: { title: "آسمان نئونی", artist: "هنرمند نمونه", album: "آلبوم نمونه" },
};
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
    track: { id: "spotify:track:sample", title: t.title, artist: t.artist, album: t.album, duration: 600, artUrl: "sample://cover" },
    artworkDataUrl: "data:image/svg+xml;utf8," + encodeURIComponent(COVER),
    capabilities: { playPause: true, next: true, previous: true, seek: true, shuffle: true, repeat: true, volume: true },
  };
  // Ari wears nothing (the default outfit follows the season); a sample football team gives the capsule a fourth mini Ari.
  await rec.settings({ autoCloseInterval: 600, ariOutfit: "none", footballEnabled: true, footballTeamId: "1", footballTeamName: "Sample FC" });
  await rec.arizo(`A.island.fsm.homeToPetitDelay = 600; A.island.alert("spotify");`);
  await sleep(700);
  await rec.arizo(`A.spotify.mock(Object.assign(${JSON.stringify(state)}, { position: 40, positionAt: Date.now() }));`);
  // A small keycap that names the shortcut being pressed (a drawing of the keys, not part of the app).
  await rec.eval(`(() => {
    const s = document.createElement("style");
    s.textContent = "#rec-keys{position:fixed;left:50%;bottom:22px;transform:translateX(-50%) translateY(8px);display:flex;gap:6px;align-items:center;opacity:0;transition:opacity .2s,transform .2s;z-index:2147483645;pointer-events:none;direction:ltr}#rec-keys.on{opacity:1;transform:translateX(-50%)}#rec-keys kbd{font:700 13px/1 Inter,Segoe UI,sans-serif;color:#1c1c22;background:#fff;border-radius:8px;padding:7px 11px;box-shadow:0 2px 0 #b9b9c6,0 5px 14px #0003}#rec-keys i{font:700 13px Inter,sans-serif;color:#4a4a58;font-style:normal}";
    document.head.append(s);
    const k = document.createElement("div"); k.id = "rec-keys"; document.body.append(k);
  })()`);
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

const showKeys = (rec, keys) => rec.eval(`(() => { const k = document.getElementById("rec-keys");
  k.innerHTML = ${JSON.stringify(keys)}.map((x, i) => (i ? "<i>+</i>" : "") + "<kbd>" + x + "</kbd>").join(""); k.classList.add("on"); })()`);
const hideKeys = (rec) => rec.eval(`document.getElementById("rec-keys").classList.remove("on")`);

export async function scene(rec) {
  const home = { ...rec.mouse };
  // 1. The open island: the song plays, Ari dances.
  await sleep(1000);

  // 2. Ctrl+M: the island folds into the capsule (clock, the mini Aris, Ari still dancing).
  await showKeys(rec, ["Ctrl", "M"]);
  await sleep(550);
  await rec.key("m", { code: "KeyM", modifiers: 2, vk: 77 });
  await sleep(400);
  await hideKeys(rec);
  await sleep(1500);

  // 3. The hide shortcut: the island slides up into the top edge and is gone (its keycap stays up meanwhile).
  await showKeys(rec, ["Alt", "Shift", "H"]);
  await sleep(650);
  await rec.arizo(`A.island.fsm.forceHidden();`);
  await sleep(1150);
  await hideKeys(rec);
  // Out of sight, the song is put back so that it reads the same time again when the loop comes round (about 7 s of the clip are left).
  await rec.arizo(`A.spotify.mock({ position: 36, positionAt: Date.now() });`);
  await sleep(250);

  // 4. The pointer touches the top edge: the island peeks out again as the capsule.
  await glide(rec, rec.width / 2, 2, 650);
  await sleep(1100);

  // 5. A click on the capsule opens it again, and the pointer goes back.
  const cap = await rec.where("#island", 0);
  await glide(rec, cap.x, cap.y, 250);
  await sleep(100);
  await rec.press(cap.x, cap.y);
  await sleep(60);
  await rec.release(cap.x, cap.y);
  await sleep(1100);
  await glide(rec, home.x, home.y, 600);
  await sleep(300);
}
