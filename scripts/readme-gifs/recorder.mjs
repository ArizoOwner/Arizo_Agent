// Records the README animations from the app itself: the real interface (the Vite page that is
// also inside the Tauri window) is driven in headless Edge with real mouse and keyboard events, and
// what it paints is saved as a small, looping GIF. Nothing here is drawn by hand.
//
//   import { Recorder } from "./recorder.mjs";
//   const rec = await Recorder.open({ port: 9500, width: 840, height: 520, lang: "en", url: "?mock=1" });
//   await rec.start();  ... rec.click(".tab[data-view=spotify]") ...  await rec.save("docs/media/x.gif");

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import gifenc from "gifenc";
import pngjs from "pngjs";

const { GIFEncoder, quantize, applyPalette } = gifenc;
const { PNG } = pngjs;

const EDGES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const edgePath = () => {
  const found = EDGES.find((p) => fs.existsSync(p));
  if (!found) throw new Error("Microsoft Edge was not found: it is what the animations are recorded with");
  return found;
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The desktop the island hangs over in the recordings: a soft wallpaper, so the dark island reads clearly. */
const WALLPAPER = `
  html, body { background: linear-gradient(135deg, #f7d9c4 0%, #ecbfd0 48%, #b7c6ee 100%) !important; overflow: hidden !important; }
  #rec-cursor { position: fixed; left: 0; top: 0; width: 22px; height: 22px; z-index: 2147483647; pointer-events: none;
    transform: translate(-100px, -100px); filter: drop-shadow(0 1px 2px rgba(0,0,0,.45)); will-change: transform; }
  #rec-ring { position: fixed; left: 0; top: 0; width: 30px; height: 30px; margin: -15px 0 0 -15px; border-radius: 50%;
    border: 2px solid rgba(66,133,244,.85); z-index: 2147483646; pointer-events: none; opacity: 0; }
  #rec-ring.on { animation: rec-ring .5s ease-out; }
  @keyframes rec-ring { from { opacity: .95; transform: scale(.3); } to { opacity: 0; transform: scale(1.5); } }
`;

const CURSOR_SVG = `<svg viewBox="0 0 22 22" width="22" height="22"><path d="M3 2l14 8.5-6.2 1.5 3.6 6.6-2.6 1.4-3.6-6.6L4.6 17.2z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>`;

export class Recorder {
  static async open({ port, width = 840, height = 520, lang = "en", url = "/?mock=1", setup }) {
    const rec = new Recorder(port, width, height, lang);
    await rec.launch();
    await rec.load(url, setup);
    return rec;
  }

  constructor(port, width, height, lang) {
    this.port = port;
    this.width = width;
    this.height = height;
    this.lang = lang;
    this.profile = path.join(os.tmpdir(), `arizo-gif-${port}-${process.pid}`);
    this.id = 0;
    this.pending = new Map();
    this.frames = [];
    this.recording = false;
    this.mouse = { x: width / 2, y: 40 };
  }

  async launch() {
    fs.rmSync(this.profile, { recursive: true, force: true });
    this.edge = spawn(edgePath(), [
      "--headless=new", `--remote-debugging-port=${this.port}`, `--user-data-dir=${this.profile}`,
      `--window-size=${this.width},${this.height}`, "--no-first-run", "--hide-scrollbars",
      // GIF_GPU=1 lets the browser paint on the graphics card (Direct3D 11) instead of in software.
      ...(process.env.GIF_GPU
        ? ["--use-angle=d3d11", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--enable-zero-copy"]
        : ["--disable-gpu"]),
      "--force-color-profile=srgb", "about:blank",
    ], { stdio: "ignore" });
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      try { target = (await (await fetch(`http://127.0.0.1:${this.port}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* not up yet */ }
      if (!target) await sleep(250);
    }
    if (!target) throw new Error("Edge did not start");
    this.ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      } else if (msg.method === "Page.screencastFrame") {
        this.send("Page.screencastFrameAck", { sessionId: msg.params.sessionId }).catch(() => {});
        if (this.recording) this.frames.push({ t: msg.params.metadata.timestamp * 1000, png: Buffer.from(msg.params.data, "base64") });
      }
    };
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Emulation.setDeviceMetricsOverride", {
      width: this.width, height: this.height, deviceScaleFactor: 1, mobile: false, screenWidth: 1920, screenHeight: 1080,
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const n = ++this.id;
      this.pending.set(n, { resolve, reject });
      this.ws.send(JSON.stringify({ id: n, method, params }));
    });
  }

  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? "eval failed");
    return r.result.value;
  }

  /** Opens the page, waits for the app, sets the language, and puts the cursor and the wallpaper in. */
  async load(url, setup) {
    const base = "http://127.0.0.1:1420";
    await this.send("Page.navigate", { url: url.startsWith("http") ? url : base + url });
    for (let i = 0; i < 80; i++) { if (await this.eval("!!window.__arizo").catch(() => false)) break; await sleep(250); }
    await this.eval(`import("/src/core/bridge.ts").then((m) => m.Bridge.saveSettings({ appLanguage: "${this.lang}" }))`);
    await sleep(500);
    await this.eval(`(() => {
      const s = document.createElement("style"); s.textContent = ${JSON.stringify(WALLPAPER)}; document.head.append(s);
      const c = document.createElement("div"); c.id = "rec-cursor"; c.innerHTML = ${JSON.stringify(CURSOR_SVG)}; document.body.append(c);
      const r = document.createElement("div"); r.id = "rec-ring"; document.body.append(r);
      // The pointer is drawn by the page from the real mouse events: one protocol call per step, not two.
      window.addEventListener("mousemove", (e) => { c.style.transform = "translate(" + (e.clientX - 4) + "px, " + (e.clientY - 3) + "px)"; }, true);
    })()`);
    if (setup) await setup(this);
    await sleep(600);
  }

  // ── Page access ────────────────────────────────────────────────────────────

  /** The app's own handles (window.__arizo): State, island, engine, football/spotify/crypto mocks. */
  arizo(code) { return this.eval(`(() => { const A = window.__arizo; ${code} })()`); }

  async settings(patch) {
    await this.arizo(`Object.assign(A.State.settings, ${JSON.stringify(patch)}); A.island.applyLook(); A.State.notify();`);
  }

  /** Centre of the first element matching a selector (or the n-th, 0-based), in page pixels. */
  async where(selector, n = 0) {
    const r = await this.eval(`(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${n}]; if (!el) return null;
      el.scrollIntoView({ block: "nearest", inline: "nearest" }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height, l: b.left, t: b.top }; })()`);
    if (!r) throw new Error(`nothing matches ${selector} [${n}]`);
    return r;
  }

  exists(selector) { return this.eval(`!!document.querySelector(${JSON.stringify(selector)})`); }

  // ── Mouse and keyboard, as a person does it ─────────────────────────────────

  async drawCursor(x, y) {
    await this.eval(`(() => { const c = document.getElementById("rec-cursor"); if (c) c.style.transform = "translate(${x - 4}px, ${y - 3}px)"; })()`);
  }

  async _mouse(type, x, y, extra = {}) {
    await this.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" || type === "mouseMoved" ? 0 : 1, clickCount: 1, ...extra });
  }

  /** Glides the pointer to (x, y) in a smooth, slightly eased path. */
  async move(x, y, ms = 420) {
    const from = { ...this.mouse };
    const steps = Math.max(4, Math.round(ms / 22));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const px = from.x + (x - from.x) * e, py = from.y + (y - from.y) * e;
      await this._mouse("mouseMoved", px, py);
      await sleep(ms / steps);
    }
    this.mouse = { x, y };
  }

  async moveTo(selector, n = 0, ms = 420) {
    const p = await this.where(selector, n);
    await this.move(p.x, p.y, ms);
    return p;
  }

  async press(x = this.mouse.x, y = this.mouse.y) {
    await this.eval(`(() => { const r = document.getElementById("rec-ring"); r.style.left = "${x}px"; r.style.top = "${y}px"; r.classList.remove("on"); void r.offsetWidth; r.classList.add("on"); })()`);
    await this._mouse("mousePressed", x, y);
  }

  async release(x = this.mouse.x, y = this.mouse.y) { await this._mouse("mouseReleased", x, y); }

  /** Moves to the element, clicks it, and waits a beat. */
  async click(selector, n = 0, { ms = 420, after = 380 } = {}) {
    const p = await this.moveTo(selector, n, ms);
    await sleep(120);
    await this.press(p.x, p.y);
    await sleep(70);
    await this.release(p.x, p.y);
    await sleep(after);
    return p;
  }

  /** Types a string one character at a time into the focused field. */
  async type(text, { delay = 55 } = {}) {
    for (const ch of text) {
      await this.send("Input.insertText", { text: ch });
      await sleep(delay + (ch === " " ? 25 : 0));
    }
  }

  async key(key, { code = key, modifiers = 0, vk } = {}) {
    const base = { key, code, modifiers, windowsVirtualKeyCode: vk ?? key.toUpperCase().charCodeAt(0) };
    await this.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }

  /** Drags from one point to another (mouse down, eased moves, mouse up). */
  async drag(from, to, { ms = 700, hold = 160 } = {}) {
    await this.move(from.x, from.y, 360);
    await sleep(100);
    await this.press(from.x, from.y);
    await sleep(hold);
    await this.move(to.x, to.y, ms);
    await sleep(hold);
    await this.release(to.x, to.y);
    await sleep(260);
  }

  /** Sets a range input by dragging its thumb the way a hand would. */
  async dragSlider(selector, n, toValue, { ms = 900 } = {}) {
    const info = await this.eval(`(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${n}]; el.scrollIntoView({ block: "nearest" });
      const b = el.getBoundingClientRect(); return { l: b.left, w: b.width, y: b.top + b.height / 2, v: Number(el.value), min: Number(el.min), max: Number(el.max) }; })()`);
    const at = (v) => info.l + 7 + ((v - info.min) / (info.max - info.min)) * (info.w - 14);
    await this.drag({ x: at(info.v), y: info.y }, { x: at(toValue), y: info.y }, { ms });
  }

  // ── Recording ──────────────────────────────────────────────────────────────

  async start() {
    this.frames = [];
    this.recording = true;
    await this.send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: this.width, maxHeight: this.height });
    // The first frame is taken by hand: the screencast only speaks when something changes.
    await this.snap();
  }

  async snap() {
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    this.frames.push({ t: Date.now(), png: Buffer.from(r.data, "base64") });
  }

  async stop(holdMs = 900) {
    await sleep(holdMs);
    await this.snap();
    this.recording = false;
    await this.send("Page.stopScreencast").catch(() => {});
  }

  /**
   * Saves what was recorded as a GIF. Frames are put on a steady clock (`fps`), identical ones
   * are merged into one longer frame, and only the pixels that changed are written again,
   * so a mostly still island stays small.
   */
  async save(file, { fps = 15, colors = 255, keyframes = null, maxBytes = 5.2e6 } = {}) {
    const frames = this.frames.slice().sort((a, b) => a.t - b.t);
    if (frames.length < 2) throw new Error("nothing was recorded");
    const t0 = frames[0].t, t1 = frames[frames.length - 1].t;
    const step = 1000 / fps;
    const picked = [];
    let j = 0;
    for (let t = t0; t <= t1 + 1; t += step) {
      while (j + 1 < frames.length && frames[j + 1].t <= t) j++;
      picked.push(j);
    }
    picked.push(frames.length - 1);

    // One palette for the whole recording, made from a sample of its frames.
    const decoded = new Map();
    const rgba = (i) => {
      if (!decoded.has(i)) decoded.set(i, new Uint8Array(PNG.sync.read(frames[i].png).data));
      return decoded.get(i);
    };
    const uniq = [...new Set(picked)];
    const sample = uniq.filter((_, k) => k % Math.max(1, Math.floor(uniq.length / 14)) === 0).slice(0, 16);
    const stride = 5;
    const parts = [];
    for (const i of sample) { const d = rgba(i); for (let p = 0; p < d.length; p += 4 * stride) parts.push(d[p], d[p + 1], d[p + 2], 255); }
    const palette = quantize(new Uint8Array(parts), colors, { format: "rgb565" });
    while (palette.length < 256) palette.push([0, 0, 0]);
    const TRANSPARENT = 255;

    const w = this.width, h = this.height;
    const gif = GIFEncoder();
    let prev = null, pendingDelay = 0, pendingIndex = null, first = true, written = 0;
    const flush = () => {
      if (!pendingIndex) return;
      gif.writeFrame(pendingIndex.pixels, w, h, {
        palette: first ? palette : undefined, delay: Math.max(20, Math.round(pendingDelay)),
        transparent: !first, transparentIndex: TRANSPARENT, dispose: 1, repeat: 0,
      });
      first = false; written++; pendingIndex = null;
    };
    for (let k = 0; k < picked.length; k++) {
      const delay = k + 1 < picked.length ? step : 600;
      const full = applyPalette(rgba(picked[k]), palette.slice(0, 255), "rgb565");
      let same = prev !== null;
      let diff = null;
      if (prev) {
        diff = new Uint8Array(full.length);
        for (let p = 0; p < full.length; p++) {
          if (full[p] === prev[p]) diff[p] = TRANSPARENT;
          else { diff[p] = full[p]; same = false; }
        }
      }
      if (same) { pendingDelay += delay; continue; }
      flush();
      pendingIndex = { pixels: prev ? diff : full };
      pendingDelay = delay;
      prev = full;
    }
    flush();
    gif.finish();
    const bytes = gif.bytes();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    if (keyframes) {
      fs.mkdirSync(keyframes, { recursive: true });
      const names = [0.02, 0.2, 0.4, 0.6, 0.8, 0.97].map((q) => picked[Math.min(picked.length - 1, Math.floor(q * picked.length))]);
      names.forEach((i, n) => fs.writeFileSync(path.join(keyframes, `${path.basename(file, ".gif")}-${n}.png`), frames[i].png));
    }
    const seconds = (t1 - t0) / 1000;
    const result = { file, kb: Math.round(bytes.length / 1024), seconds: +seconds.toFixed(1), frames: written, over: bytes.length > maxBytes };
    return result;
  }

  async close() {
    try { this.ws?.close(); } catch { /* already closed */ }
    try { this.edge?.kill(); } catch { /* already gone */ }
    await sleep(300);
    try { fs.rmSync(this.profile, { recursive: true, force: true }); } catch { /* still locked: the temp folder is cleaned later */ }
  }
}
