// The setup window: installs or removes Arizo-Agent with Ari on stage. The work
// itself is the NSIS installer run silently by the backend (src-tauri/src/setup.rs);
// this page is the face of it, in Persian or English.
//
// Ari is the app's own engine (ari/engine.ts): the eyes follow the pointer, a
// click is a pat (three are too many), the buttons make him look and lean, the
// progress makes him work, the end makes him cheer, and leaving makes him sad.

import "../style.css";
import "./setup.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { BotEngine } from "../ari/engine";
import { SeasonCache } from "../ari/wardrobe";
import { Sound } from "../core/sound";
import { h, svg } from "../views/dom";

type Lang = "fa" | "en";
interface Info { mode: "install" | "uninstall"; version: string; installed: string | null; dir: string; lang: Lang }
type Phase = "welcome" | "working" | "done" | "failed";

const IS_TAURI = "__TAURI_INTERNALS__" in window;

/** Every word of the page, in both languages. */
const TEXT = {
  en: {
    installTitle: "Meet Ari", installLead: "Your Dynamic Island companion: translation in a keystroke, your music, your team and your coins, at the top of the screen.",
    updateTitle: "A new Ari is here", updateLead: "Version {old} is installed. Updating keeps your settings, history and connected accounts.",
    reinstallTitle: "Ari is already here", reinstallLead: "This version is installed. Installing again repairs it and keeps your settings.",
    install: "Install", update: "Update", reinstall: "Reinstall", desktop: "Shortcut on the desktop", where: "Installs to",
    working: "Installing…", workingUpdate: "Updating…", steps: ["Unpacking Ari", "Setting up the island", "Adding the shortcuts", "Almost there"],
    doneTitle: "All set!", doneLead: "Ari is waiting at the top of your screen. Press Alt+Q on any text to translate it.",
    launch: "Open Arizo-Agent", close: "Close", failTitle: "That did not work", failLead: "The installation could not finish. Close Arizo-Agent if it is open and try again.",
    retry: "Try again",
    unTitle: "Leaving so soon?", unLead: "Arizo-Agent {v} will be removed from this PC.", wipe: "Also delete all my data",
    wipeHint: "Settings, history, saved keys and tokens, and the start-up entry. Nothing of Arizo stays behind.",
    keepHint: "Your settings and accounts stay, ready for the next install.",
    uninstall: "Uninstall", keep: "Keep Ari", unWorking: "Removing…", unSteps: ["Closing Arizo-Agent", "Removing the files", "Cleaning up"],
    unDoneTitle: "Goodbye for now", unDoneLead: "Arizo-Agent has been removed.", unDoneWiped: "Arizo-Agent and all of its data have been removed.",
    unFailLead: "Removal could not finish. Close Arizo-Agent and try again.",
    minimize: "Minimize", lang: "فارسی",
  },
  fa: {
    installTitle: "با آری آشنا شو", installLead: "همراه داینامیک آیلند تو: ترجمه با یک کلید، موسیقی، تیم و ارزهای تو، همه بالای صفحه.",
    updateTitle: "آری تازه رسید", updateLead: "نسخه {old} نصب است. به‌روزرسانی، تنظیمات، تاریخچه و حساب‌های متصل را نگه می‌دارد.",
    reinstallTitle: "آری همین‌جاست", reinstallLead: "همین نسخه نصب است. نصب دوباره آن را ترمیم می‌کند و تنظیمات می‌ماند.",
    install: "نصب", update: "به‌روزرسانی", reinstall: "نصب دوباره", desktop: "میانبر روی دسکتاپ", where: "محل نصب",
    working: "در حال نصب…", workingUpdate: "در حال به‌روزرسانی…", steps: ["باز کردن آری", "آماده کردن جزیره", "ساختن میانبرها", "تقریباً تمام"],
    doneTitle: "همه‌چیز آماده است!", doneLead: "آری بالای صفحه منتظر توست. روی هر متنی Alt+Q را بزن تا ترجمه شود.",
    launch: "باز کردن Arizo-Agent", close: "بستن", failTitle: "نشد", failLead: "نصب کامل نشد. اگر Arizo-Agent باز است آن را ببند و دوباره امتحان کن.",
    retry: "دوباره",
    unTitle: "به این زودی؟", unLead: "Arizo-Agent نسخه {v} از این کامپیوتر حذف می‌شود.", wipe: "همه داده‌های من هم پاک شود",
    wipeHint: "تنظیمات، تاریخچه، کلیدها و توکن‌های ذخیره‌شده و اجرای خودکار. هیچ اثری از آریزو نمی‌ماند.",
    keepHint: "تنظیمات و حساب‌ها می‌مانند، برای نصب بعدی.",
    uninstall: "حذف", keep: "آری بماند", unWorking: "در حال حذف…", unSteps: ["بستن Arizo-Agent", "حذف فایل‌ها", "پاک‌سازی"],
    unDoneTitle: "فعلاً خداحافظ", unDoneLead: "Arizo-Agent حذف شد.", unDoneWiped: "Arizo-Agent و همه داده‌هایش حذف شد.",
    unFailLead: "حذف کامل نشد. Arizo-Agent را ببند و دوباره امتحان کن.",
    minimize: "کوچک کردن", lang: "English",
  },
} as const;

type Key = keyof typeof TEXT.en;

// ── State ─────────────────────────────────────────────────────────────────────

let info: Info = { mode: "install", version: "", installed: null, dir: "", lang: "en" };
let lang: Lang = "en";
let phase: Phase = "welcome";
let progress = 0;
let shown = 0;
let desktop = true;
let wipe = true;

const tr = (k: Key, vars: Record<string, string> = {}): string => {
  const v = TEXT[lang][k];
  return typeof v === "string" ? v.replace(/\{(\w+)\}/g, (_, n: string) => vars[n] ?? "") : "";
};
const steps = (): readonly string[] => (info.mode === "install" ? TEXT[lang].steps : TEXT[lang].unSteps);

// ── Ari ───────────────────────────────────────────────────────────────────────

const engine = new BotEngine();
const seasons = new SeasonCache();
const stage = h("div", { class: "su-stage" });
const canvas = h("canvas", { class: "su-ari", "aria-hidden": "true" });
const glow = h("div", { class: "su-glow" });
const ring = h("div", { class: "su-ring" });
stage.append(glow, ring, canvas);

const ARI = 196; // CSS px of the canvas (the body is 60 % of it)
const OVERHANG = 60;
const mouse = { x: -1, y: -1 };
let lastFrame = performance.now();

function sizeCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(ARI * dpr);
  canvas.height = Math.round((ARI + OVERHANG) * dpr);
  canvas.style.width = `${ARI}px`;
  canvas.style.height = `${ARI + OVERHANG}px`;
}

function frame(now: number) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  const r = canvas.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + OVERHANG / 2 + ARI / 2;
  if (mouse.x >= 0) {
    engine.lookX = Math.tanh((mouse.x - cx) / 220);
    engine.lookY = -Math.tanh((mouse.y - cy) / 180);
  } else if (phase === "working") {
    // Watching the progress bar under him.
    engine.lookX = lang === "fa" ? 0.25 : -0.25;
    engine.lookY = -0.55;
  }
  engine.particleOverhang = OVERHANG;
  engine.setOutfit(seasons.get("auto"), false);
  engine.setDancing(phase === "done" && info.mode === "install");
  engine.update(dt);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const dpr = canvas.width / ARI;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, ARI, ARI + OVERHANG);
    ctx.save();
    engine.applyDance(ctx, ARI, ARI + OVERHANG);
    engine.draw(ctx, ARI, ARI + OVERHANG);
    ctx.restore();
  }
  // The bar eases towards the real progress.
  shown += (progress - shown) * Math.min(1, dt * 6);
  bar.style.setProperty("--p", String(shown));
  pct.textContent = `${Math.round(shown * 100).toLocaleString(lang === "fa" ? "fa-IR" : "en-US")}%`;
  const step = steps()[Math.min(steps().length - 1, Math.floor(shown * steps().length))];
  if (stepText.textContent !== step) stepText.textContent = step;
  requestAnimationFrame(frame);
}

// Three quick pats make him dizzy for a moment.
engine.onDizzy = () => {
  engine.setState("dizzy");
  setTimeout(() => engine.setState(phase === "working" ? "working" : "idle"), 1600);
};

// ── Page ──────────────────────────────────────────────────────────────────────

const root = document.getElementById("setup-root")!;
const titleEl = h("h1", { class: "su-title" });
const leadEl = h("p", { class: "su-lead" });
const body = h("div", { class: "su-body" });
const actions = h("div", { class: "su-actions" });
const bar = h("div", { class: "su-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100" }, h("i", {}));
const pct = h("span", { class: "su-pct" });
const stepText = h("span", { class: "su-step" });
const progressBox = h("div", { class: "su-progress" }, h("div", { class: "su-progress-row" }, stepText, pct), bar);
const langBtn = h("button", { class: "su-chip", type: "button", onclick: () => { lang = lang === "fa" ? "en" : "fa"; render(); engine.blink(); } });
const minBtn = h("button", { class: "su-win", type: "button", onclick: () => void call("setup_minimize") }, svg("M6 12h12", 14, { stroke: 1.8 }));
const closeBtn = h("button", { class: "su-win su-win-close", type: "button", onclick: () => void close() }, svg("M6 6l12 12M18 6 6 18", 14, { stroke: 1.8 }));
const versionEl = h("span", { class: "su-version" });

const bar_ = h("header", { class: "su-titlebar", "data-tauri-drag-region": "" },
  h("span", { class: "su-brand", "data-tauri-drag-region": "" }, h("b", { text: "Arizo" }), h("span", { text: "Agent" }), versionEl),
  h("div", { class: "su-titlebar-actions" }, langBtn, minBtn, closeBtn));
const panel = h("section", { class: "su-panel" }, titleEl, leadEl, body, progressBox, actions);
root.append(h("div", { class: "su-shell" }, h("div", { class: "su-aurora", "aria-hidden": "true" }, h("i", {}), h("i", {}), h("i", {})), bar_, h("main", { class: "su-main" }, stage, panel)));

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!IS_TAURI) return null;
  try { return await invoke<T>(cmd, args); } catch { return null; }
}

function button(label: string, kind: "primary" | "ghost", onClick: () => void, react: () => void = () => {}) {
  const b = h("button", { class: `su-btn su-btn-${kind}`, type: "button", onclick: onClick }, label);
  b.addEventListener("pointerenter", react);
  b.addEventListener("focus", react);
  return b;
}

function toggle(label: string, on: boolean, onChange: (v: boolean) => void, hint = ""): HTMLElement {
  const box = h("input", { type: "checkbox", class: "su-switch-input" }) as HTMLInputElement;
  box.checked = on;
  box.addEventListener("change", () => onChange(box.checked));
  return h("label", { class: "su-toggle" }, box, h("span", { class: "su-switch", "aria-hidden": "true" }, h("i", {})),
    h("span", { class: "su-toggle-text" }, h("b", { text: label }), hint ? h("small", { text: hint }) : null));
}

function render() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "fa" ? "rtl" : "ltr";
  langBtn.textContent = tr("lang");
  minBtn.title = tr("minimize");
  closeBtn.title = tr("close");
  closeBtn.disabled = phase === "working";
  versionEl.textContent = info.version ? `v${info.version}` : "";
  root.dataset.phase = phase;
  root.dataset.mode = info.mode;
  progressBox.hidden = phase !== "working";
  body.replaceChildren();
  actions.replaceChildren();
  const install = info.mode === "install";

  if (phase === "welcome" && install) {
    const update = !!info.installed && info.installed !== info.version;
    const same = !!info.installed && info.installed === info.version;
    titleEl.textContent = tr(update ? "updateTitle" : same ? "reinstallTitle" : "installTitle");
    leadEl.textContent = tr(update ? "updateLead" : same ? "reinstallLead" : "installLead", { old: info.installed ?? "" });
    if (!info.installed) body.append(toggle(tr("desktop"), desktop, (v) => { desktop = v; engine.triggerEmote(v ? "happy" : "wink", 0.9); }));
    body.append(h("div", { class: "su-path" }, h("small", { text: tr("where") }), h("bdi", { dir: "ltr", text: info.dir })));
    actions.append(button(tr(update ? "update" : same ? "reinstall" : "install"), "primary", () => void start(),
      () => { engine.triggerEmote("surprised", 0.7); Sound.play("hover"); }));
  } else if (phase === "welcome") {
    titleEl.textContent = tr("unTitle");
    leadEl.textContent = tr("unLead", { v: info.version });
    const hint = h("small", { class: "su-hint", text: tr(wipe ? "wipeHint" : "keepHint") });
    body.append(toggle(tr("wipe"), wipe, (v) => {
      wipe = v;
      hint.textContent = tr(v ? "wipeHint" : "keepHint");
      engine.triggerEmote(v ? "surprised" : "happy", 0.9);
    }), hint);
    actions.append(
      button(tr("keep"), "primary", () => { engine.triggerEmote("love", 1.6); Sound.play("love"); setTimeout(() => void close(), 1300); },
        () => { engine.gloomy = false; engine.triggerEmote("happy", 0.8); }),
      button(tr("uninstall"), "ghost", () => void start(), () => { engine.gloomy = true; }),
    );
  } else if (phase === "working") {
    titleEl.textContent = install ? tr(info.installed && info.installed !== info.version ? "workingUpdate" : "working") : tr("unWorking");
    leadEl.textContent = "";
  } else if (phase === "done") {
    titleEl.textContent = tr(install ? "doneTitle" : "unDoneTitle");
    leadEl.textContent = install ? tr("doneLead") : tr(wipe ? "unDoneWiped" : "unDoneLead");
    if (install) {
      actions.append(button(tr("launch"), "primary", () => void call("setup_launch"), () => engine.triggerEmote("happy", 0.8)),
        button(tr("close"), "ghost", () => void close()));
    } else {
      actions.append(button(tr("close"), "primary", () => void close()));
    }
  } else {
    titleEl.textContent = tr("failTitle");
    leadEl.textContent = tr(install ? "failLead" : "unFailLead");
    actions.append(button(tr("retry"), "primary", () => void start()), button(tr("close"), "ghost", () => void close()));
  }
  // Each screen slides in.
  panel.classList.remove("su-enter");
  void panel.offsetWidth;
  panel.classList.add("su-enter");
}

async function start() {
  phase = "working";
  progress = 0;
  shown = 0;
  engine.gloomy = false;
  engine.setState("working");
  engine.squash();
  Sound.play("work");
  render();
  if (!IS_TAURI) {
    // In a browser (npm run dev): a pretend install, to see the page move.
    const t0 = performance.now();
    const fake = window.setInterval(() => {
      progress = Math.min(1, (performance.now() - t0) / 3500);
      if (progress >= 1) { window.clearInterval(fake); finish(true); }
    }, 60);
    return;
  }
  const ok = info.mode === "install"
    ? await call("setup_install", { desktop })
    : await call("setup_uninstall", { wipe });
  if (ok === null) finish(false);
}

function finish(ok: boolean) {
  progress = ok ? 1 : progress;
  window.setTimeout(() => {
    phase = ok ? "done" : "failed";
    if (ok && info.mode === "install") {
      engine.setState("finished");
      engine.triggerEmote("proud", 2.2);
      engine.emit("heart", 5);
      Sound.play("finish");
    } else if (ok) {
      engine.setState("idle");
      engine.gloomy = false;
      engine.greet();
    } else {
      engine.setState("error");
      Sound.play("error");
    }
    render();
  }, ok ? 450 : 0);
}

async function close() {
  if (phase === "working") return;
  if (info.mode === "uninstall" && phase === "welcome") {
    // Leaving the uninstaller keeps Ari: he is pleased.
    engine.triggerEmote("love", 1.2);
    await new Promise((r) => setTimeout(r, 700));
  }
  if (IS_TAURI) await call("setup_close");
  else window.close();
}

// ── Start ─────────────────────────────────────────────────────────────────────

window.addEventListener("pointermove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; Sound.resume(); });
document.addEventListener("pointerleave", () => { mouse.x = -1; mouse.y = -1; });
canvas.addEventListener("pointerdown", () => { engine.slap(); });
canvas.addEventListener("pointerenter", () => { if (phase === "welcome") engine.triggerEmote(info.mode === "install" ? "happy" : "surprised", 0.7); });
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") void close();
  if (e.key === "Enter" && phase !== "working") (actions.querySelector(".su-btn-primary") as HTMLButtonElement | null)?.click();
});

async function boot() {
  const got = await call<Info>("setup_info");
  const params = new URLSearchParams(location.search);
  info = got ?? {
    mode: params.get("mode") === "uninstall" ? "uninstall" : "install",
    version: "3.5.1", installed: params.get("installed"), dir: "C:\\Users\\you\\AppData\\Local\\Arizo-Agent",
    lang: params.get("lang") === "fa" ? "fa" : "en",
  };
  lang = info.lang;
  if (IS_TAURI) {
    await listen<number>("setup-progress", (e) => { progress = Math.max(progress, e.payload); });
    await listen<{ ok: boolean }>("setup-done", (e) => finish(e.payload.ok));
  }
  sizeCanvas();
  window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener?.("change", sizeCanvas);
  Sound.setVolume(0.35);
  void Sound.preload();
  render();
  requestAnimationFrame((t) => { lastFrame = t; frame(t); });
  // Ari arrives: a hop and a wave, or a worried look when he is about to be removed.
  window.setTimeout(() => {
    if (info.mode === "install") engine.greet();
    else { engine.triggerEmote("surprised", 1); window.setTimeout(() => { engine.gloomy = true; }, 1100); }
  }, 350);
}

void boot();
// The page recorder (scripts/readme-gifs) waits for this handle.
if (import.meta.env.DEV) (window as unknown as { __arizo: unknown }).__arizo = { engine };
