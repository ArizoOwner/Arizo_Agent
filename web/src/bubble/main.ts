// The floating bubble: a 44px black squircle near the selected text. A click
// expands it into a card that translates the selection; the card can speak,
// copy, replace the selection in the app, or hand the text to the island.
//
// It lives in its own window and has its own translator. The backend shows it
// next to the selection and sends `bubble-init` with the text.

import "../style.css";
import "./bubble.css";
import "../views/select.css";
import { Bridge, onEvent } from "../core/bridge";
import { DEFAULT_ENGINE, parseEngine } from "../core/pills";
import { State, mergeSettings, type Settings } from "../core/state";
import { Translator } from "../core/translator";
import { autoTarget, detectLanguageClient, langLabel } from "../core/text";
import { h, svg, clear } from "../views/dom";
import { ICONS } from "../views/icons";
import { createMiniBot, pruneMiniBots, tickMiniBots } from "../ari/minibots";
import { resolveLanguage, setLanguage, t, tl, onLanguageChange } from "../i18n/i18n";
import { applyTheme, watchSystemTheme } from "../core/theme";
import { BUTTON_WINDOW, CARD_WINDOW_W, cardWindowHeight } from "./geometry";

/** Request numbers of this window start far from the island's, partials are broadcast. */
const translator = new Translator(1_000_000);

const BUTTON_MS = 4500;
const CARD_MS = 9000;
const ERROR_MS = 4000;

let text = "";
let shown = "";
let target = "";
let expanded = false;
let hovering = false;
let timer: number | null = null;
let timerMs = BUTTON_MS;
let audio: HTMLAudioElement | null = null;
let speaking = false;
let rafId: number | null = null;
let lastFrame = 0;

const root = document.getElementById("bubble-root")!;

// ── Pieces ────────────────────────────────────────────────────────────────────

const aphraTask = { id: "engine_aphra" as const, name: "Smart", color: "#A78BFA", state: "idle" as const };

const bubbleBtn = h("button", { class: "bubble-btn", type: "button", title: tl("Translate the selected text") });
bubbleBtn.append(createMiniBot(aphraTask, 20));
bubbleBtn.append(h("span", { class: "glyph" }, svg(ICONS.swap, 10, { stroke: 2.4 })));

const dirChip = h("span", { class: "dir-chip", text: t("Auto") });
const openBtn = h("button", { class: "icon-btn", type: "button", title: tl("Open in the island") }, svg(ICONS.arrowUpRight, 10));
const closeBtn = h("button", { class: "icon-btn", type: "button", title: tl("Close") }, svg(ICONS.xmark, 9));
const srcPreview = h("div", { class: "src-preview", dir: "auto" });
const loadingEl = h("div", { class: "bubble-loading shimmer hidden", text: tl("Translating…") });
const resultEl = h("div", { class: "bubble-result", dir: "auto" });
const speakBtn = h("button", { class: "btn secondary icon-only", type: "button", title: tl("Speak") }, svg(ICONS.speakerOn, 14));
const copyBtn = h("button", { class: "btn secondary", type: "button" }, h("span", { text: tl("Copy") }));
const replaceBtn = h("button", { class: "btn primary", type: "button" }, h("span", { text: tl("Replace in app") }));

const card = h(
  "div",
  { class: "bubble-card hidden" },
  h("div", { class: "bubble-head" }, dirChip, h("div", { class: "head-actions" }, openBtn, closeBtn)),
  srcPreview,
  loadingEl,
  resultEl,
  h("div", { class: "bubble-foot" }, speakBtn, h("div", { class: "grow", style: "flex:1" }), copyBtn, replaceBtn),
);

root.append(bubbleBtn, card);

// ── Timers (4.5 s on the button, 9 s on the card, paused while the mouse is over it) ──

function stopTimer() {
  if (timer != null) window.clearTimeout(timer);
  timer = null;
}

function startTimer(ms: number) {
  stopTimer();
  timerMs = ms;
  if (hovering || ms <= 0) return;
  timer = window.setTimeout(() => dismiss(), ms);
}

// The window never takes focus, and WebView2 does not always send mouseenter to
// the document of such a window: listen on what is actually drawn, and on the
// pointer's first move, so the countdown never runs while the mouse is over it.
function pointerIn() {
  if (hovering) return;
  hovering = true;
  stopTimer();
}
function pointerOut() {
  if (!hovering) return;
  hovering = false;
  startTimer(timerMs);
}
for (const el of [bubbleBtn, card]) {
  el.addEventListener("pointerenter", pointerIn);
  el.addEventListener("pointermove", pointerIn);
  el.addEventListener("pointerleave", pointerOut);
}
document.documentElement.addEventListener("mouseleave", pointerOut);

function dismiss() {
  stopTimer();
  stopAudio();
  translator.cancel();
  stopLoop();
  void Bridge.hideBubble();
}

// ── The mini Ari in the button needs a frame loop, only while the bubble shows ─

function frame(now: number) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  tickMiniBots(dt);
  rafId = expanded ? null : requestAnimationFrame(frame);
}

function startLoop() {
  if (rafId != null) return;
  lastFrame = performance.now();
  rafId = requestAnimationFrame(frame);
}

function stopLoop() {
  if (rafId != null) cancelAnimationFrame(rafId);
  rafId = null;
}

// ── State ─────────────────────────────────────────────────────────────────────

function showButton() {
  expanded = false;
  card.classList.add("hidden");
  bubbleBtn.classList.remove("hidden");
  document.body.style.alignItems = "flex-start";
  void Bridge.setBubbleSize(BUTTON_WINDOW, BUTTON_WINDOW);
  startLoop();
  startTimer(BUTTON_MS);
}

function directionLabel(): string {
  return target ? t("Auto → {lang}", { lang: langLabel(target) }) : t("Auto");
}

let fitTimer: number | null = null;

/** The window follows the card: while the translation streams in and once it is done. */
function fitCard() {
  if (fitTimer != null) return;
  fitTimer = window.setTimeout(() => {
    fitTimer = null;
    if (!expanded) return;
    void Bridge.setBubbleSize(CARD_WINDOW_W, cardWindowHeight(card.offsetHeight));
  }, 30);
}

function render() {
  const phase = translator.phase;
  const streaming = phase === "loading" && translator.partial.length > 0;
  loadingEl.classList.toggle("hidden", !(phase === "loading" && !streaming));
  resultEl.classList.toggle("err", phase === "error");
  resultEl.textContent = streaming
    ? translator.partial
    : phase === "done" ? shown
      : phase === "error" ? translator.error || t("Translation failed.")
        : "";
  dirChip.textContent = directionLabel();
  const can = phase === "done" && shown.length > 0;
  for (const b of [speakBtn, copyBtn, replaceBtn]) b.classList.toggle("off", !can);
  if (expanded) fitCard();
}

translator.onChange = render;

async function expand() {
  stopTimer();
  stopLoop();
  // The selection is read while the app it belongs to still has the focus.
  if (!text.trim()) {
    try {
      const captured = (await Bridge.captureSelectedText()) ?? "";
      if (captured.trim()) text = captured.trim();
    } catch {
      /* nothing selected */
    }
  }
  expanded = true;
  bubbleBtn.classList.add("hidden");
  card.classList.remove("hidden");
  srcPreview.textContent = text;
  void Bridge.setBubbleSize(CARD_WINDOW_W, cardWindowHeight(0));
  fitCard();

  if (!text.trim()) {
    resultEl.classList.add("err");
    resultEl.textContent = t("No text is selected.");
    target = "";
    dirChip.textContent = directionLabel();
    for (const b of [speakBtn, copyBtn, replaceBtn]) b.classList.add("off");
    startTimer(ERROR_MS);
    return;
  }

  const detected = detectLanguageClient(text);
  target = autoTarget(detected, State.settings.nativeLang, State.settings.secondLang);
  render();
  const res = await translator.run({
    text,
    engine: parseEngine(State.settings.defaultEngine ?? DEFAULT_ENGINE),
    tone: State.settings.aphra.tone,
    targetLang: "auto",
  });
  if (translator.phase === "done" && res?.data) {
    shown = res.data.translation || "";
    target = res.data.targetLang || target;
    render();
    fitCard();
    startTimer(CARD_MS);
  } else if (translator.phase === "error") {
    render();
    startTimer(ERROR_MS);
  }
}

// ── Actions ───────────────────────────────────────────────────────────────────

function stopAudio() {
  if (audio) {
    audio.pause();
    audio = null;
  }
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  speaking = false;
  speakBtn.classList.remove("on");
}

async function speak() {
  if (speaking) return stopAudio();
  if (!shown) return;
  speaking = true;
  stopTimer();
  const res = await Bridge.tts(shown, target || "en");
  if (!speaking) return;
  if (res && res.ok && res.audio) {
    audio = new Audio(`data:audio/mpeg;base64,${res.audio}`);
    audio.onended = audio.onerror = () => { stopAudio(); startTimer(CARD_MS); };
    audio.play().catch(() => stopAudio());
  } else if (typeof SpeechSynthesisUtterance !== "undefined") {
    const u = new SpeechSynthesisUtterance(shown);
    u.lang = target || "en";
    u.onend = () => { stopAudio(); startTimer(CARD_MS); };
    speechSynthesis.speak(u);
  } else {
    stopAudio();
  }
}

bubbleBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  void expand();
});
closeBtn.addEventListener("click", () => dismiss());
openBtn.addEventListener("click", () => {
  void Bridge.openIslandWithText(text);
  dismiss();
});
speakBtn.addEventListener("click", () => void speak());
copyBtn.addEventListener("click", async () => {
  if (!shown) return;
  await Bridge.copyText(shown);
  stopTimer();
  (copyBtn.firstElementChild as HTMLElement).textContent = t("Copied");
  window.setTimeout(() => dismiss(), 900);
});
replaceBtn.addEventListener("click", async () => {
  if (!shown) return;
  (replaceBtn.firstElementChild as HTMLElement).textContent = t("Done");
  await Bridge.replaceBubbleText(shown);
  window.setTimeout(() => dismiss(), 300);
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    dismiss();
  }
});

// ── Backend events ────────────────────────────────────────────────────────────

function resetLabels() {
  (copyBtn.firstElementChild as HTMLElement).textContent = t("Copy");
  (replaceBtn.firstElementChild as HTMLElement).textContent = t("Replace in app");
}

void onEvent<{ text: string }>("bubble-init", (data) => {
  text = (data?.text ?? "").trim();
  shown = "";
  target = "";
  stopAudio();
  translator.reset();
  srcPreview.textContent = text;
  resultEl.textContent = "";
  resetLabels();
  render();
  pruneMiniBots();
  showButton();
});

// The backend hid the window (a click elsewhere, Esc in another app, a new
// selection): stop everything that was running for it, as a dismiss does.
void onEvent<null>("bubble-hide", () => {
  stopTimer();
  stopAudio();
  translator.cancel();
  stopLoop();
  expanded = false;
  hovering = false;
});

void onEvent<{ requestId: number; text: string }>("translate-partial", (p) => {
  translator.partialText(p.requestId, p.text);
  if (translator.phase === "loading") startTimer(CARD_MS);
});

void onEvent<Settings>("settings-changed", (s) => {
  State.settings = mergeSettings(State.settings, s);
  setLanguage(resolveLanguage(State.settings.appLanguage));
  applyTheme(State.settings.theme);
});

async function main() {
  const boot = await Bridge.boot();
  if (boot) State.settings = mergeSettings(State.settings, boot.settings);
  onLanguageChange(() => {
    resetLabels();
    render();
  });
  setLanguage(resolveLanguage(State.settings.appLanguage));
  applyTheme(State.settings.theme);
  watchSystemTheme(() => State.settings.theme);
  clear(resultEl);
  render();
  // Opened by hand in a browser (?mock=1): show the button as the backend would.
  const q = new URLSearchParams(location.search);
  if (!boot || q.has("mock") || q.has("text") || q.has("card")) {
    text = q.get("text") ?? "";
    showButton();
    if (q.has("card")) void expand();
  } else {
    showButton();
  }
}

void main();
