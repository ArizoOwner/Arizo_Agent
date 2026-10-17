// The translate view: the island's home. Same two-card geometry as the
// overview it replaces: the source on the left (language chips, the text),
// the result on the right (engine pills, the translation, footer buttons).

import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { card, btn } from "./parts";
import { enhanceSelect } from "./select";
import { Bridge, type Language, type TranslateData } from "../core/bridge";
import { PILLS, otherEngine, parseEngine, type Engine } from "../core/pills";
import { State } from "../core/state";
import { Translator } from "../core/translator";
import { celebrate, fail, setWorking, setMood } from "../core/mood";
import { toast } from "../core/toast";
import { createMiniBot, pruneMiniBots } from "../ari/minibots";
import {
  autoTarget, cleanPdfText, detectLanguageClient, ellipsize, formatDuration, hasPdfLineBreaks,
  langLabel,
} from "../core/text";
import { HISTORY_PANE_H, translateHeight, translateWidth } from "../core/layout";
import { buildHistory } from "./history";
import { N_, language, t, tl } from "../i18n/i18n";
import type { ViewHost } from "./views";

export interface TranslateHost extends ViewHost {
  /** The island was opened by the hotkey or the tray: fill and translate, or focus. */
  setCaptured(text: string): void;
  /** Puts `text` in the input and translates it (history, bubble). */
  setText(text: string, targetLang?: string): void;
  copyAndClose(): void;
  replaceInApp(): void;
  swapLanguages(): void;
  toggleEngine(): void;
  /** True while a text field has the keyboard. */
  typing(): boolean;
  /** Streamed text from the backend for request `requestId`. */
  partial(requestId: number, text: string): void;
}

export interface TranslateActions {
  closeIsland(): void;
  openSettingsWindow(): void;
  /** The input grew or shrank: the island follows. */
  heightChanged(): void;
  blip(): void;
}

const TONES = ["auto", "formal", "colloquial", "technical", "literary"] as const;
const TONE_LABELS: Record<(typeof TONES)[number], string> = {
  auto: N_("Auto tone"), formal: N_("Formal"), colloquial: N_("Colloquial"), technical: N_("Technical"), literary: N_("Literary"),
};

const POS_FA: Record<string, string> = {
  noun: "اسم", verb: "فعل", adjective: "صفت", adverb: "قید", pronoun: "ضمیر",
  preposition: "حرف اضافه", conjunction: "حرف ربط", interjection: "شبه‌جمله",
};

/** The English part of speech, or its Persian name in the Persian interface. */
function posLabel(pos: string): string {
  if (language() === "fa") return POS_FA[pos.toLowerCase()] ?? pos;
  return pos;
}

const FIELD_TAGS = new Set(["TEXTAREA", "INPUT", "SELECT"]);

export function isTyping(): boolean {
  const tag = document.activeElement?.tagName ?? "";
  return FIELD_TAGS.has(tag);
}

export function buildTranslate(actions: TranslateActions): TranslateHost {
  const translator = new Translator();
  let languages: Language[] = [];
  let targetLang = "auto";
  /** The text shown on the right: the translation, or an alternative the user picked. */
  let shown = "";
  let resultSource = "";
  let resultTarget = "";
  let audio: HTMLAudioElement | null = null;
  let speaking = false;
  let debounce: number | null = null;
  let skipNextFocus = false;
  let breakdownOpen = false;
  let copiedUntil = 0;

  // ── Left card: the source ──────────────────────────────────────────────────
  const srcChip = h("span", { class: "chip src-chip", text: tl("Auto-detect") });
  const swapBtn = h(
    "button",
    { class: "icon-btn swap", title: tl("Swap languages"), onclick: () => swapLanguages() },
    svg(ICONS.swap, 14, { stroke: 2.2 }),
  );
  const targetSelect = enhanceSelect(h("select", { class: "chip target-select", title: tl("Translate into") }));
  targetSelect.addEventListener("change", () => {
    targetLang = targetSelect.value;
    if (input.value.trim()) void run();
  });
  const langRow = h("div", { class: "lang-row" }, srcChip, swapBtn, targetSelect);

  const input = h("textarea", {
    class: "src-input", dir: "auto", rows: 2, spellcheck: false,
    placeholder: tl("Type or paste text to translate…"),
  });
  const clearBtn = h(
    "button",
    { class: "src-action-btn clear-btn", title: tl("Clear"), onclick: () => { setInput(""); translator.cancel(); renderResult(); input.focus(); } },
    svg(ICONS.xmark, 9, { stroke: 2.4 }),
    h("span", { text: tl("Clear") }),
  );
  const pasteBtn = h(
    "button",
    { class: "src-action-btn paste-btn", title: tl("Paste from clipboard"), onclick: () => void paste() },
    svg(ICONS.clipboard, 12, { stroke: 2 }),
    h("span", { text: tl("Paste") }),
  );
  const counter = h("span", { class: "counter" });
  const cleanChip = h(
    "button",
    { class: "src-action-btn clean-chip", title: tl("Join lines broken by a PDF"), onclick: () => cleanLines() },
    svg(ICONS.doc, 11),
    h("span", { text: tl("Fix PDF lines") }),
  );
  const historyBtn = h(
    "button",
    { class: "src-action-btn history-btn", type: "button", title: tl("History"), "aria-label": tl("History"), onclick: () => { actions.blip(); setHistory(true); } },
    svg(ICONS.clock, 12, { stroke: 2.2 }),
    h("span", { text: tl("History") }),
  );
  const srcBar = h("div", { class: "src-bar" }, counter, h("div", { class: "grow" }), cleanChip, historyBtn, pasteBtn, clearBtn);
  const srcBody = h("div", { class: "src-body" }, langRow, input, srcBar);
  const left = card(null, srcBody);

  // ── Right card: the result ─────────────────────────────────────────────────
  const pillEls = new Map<Engine, HTMLElement>();
  const pillsRow = h("div", { class: "engine-pills" });
  for (const def of PILLS) {
    const pill = h(
      "div",
      { class: "pill engine", title: tl(def.hint), onclick: () => { actions.blip(); setEngine(def.engine); } },
      h("span", { class: "lbl", text: tl(def.name) }),
    );
    pillEls.set(def.engine, pill);
    pillsRow.append(pill);
  }
  const toneSelect = enhanceSelect(h("select", { class: "chip tone-select", title: tl("Tone") }));
  for (const tone of TONES) toneSelect.append(h("option", { value: tone, text: tl(TONE_LABELS[tone]) }));
  toneSelect.addEventListener("change", () => {
    void Bridge.saveSettings({ aphra: { tone: toneSelect.value as (typeof TONES)[number] } });
    State.settings.aphra.tone = toneSelect.value as (typeof TONES)[number];
    if (State.engine === "aphra" && input.value.trim()) void run();
  });
  const topRow = h("div", { class: "res-top" }, pillsRow, toneSelect);

  const placeholder = h("div", { class: "res-placeholder", text: tl("The translation appears here.") });
  const loadingEl = h("div", { class: "res-loading shimmer", text: tl("Translating…") });
  const resText = h("div", { class: "res-text", dir: "auto" });
  const translit = h("div", { class: "res-translit", dir: "auto" });
  const noticeText = h("span", {});
  const noticeLink = h("button", {
    class: "link-btn", text: tl("Open settings"), onclick: () => actions.openSettingsWindow(),
  });
  const notice = h("div", { class: "res-notice" }, noticeText, noticeLink);
  const altsEl = h("div", { class: "alts" });
  const bkToggle = h("button", { class: "bk-toggle", onclick: () => { breakdownOpen = !breakdownOpen; renderBreakdown(); fit(); } });
  const bkList = h("div", { class: "bk-list" });
  const breakdownEl = h("div", { class: "breakdown" }, bkToggle, bkList);
  const resScroll = h(
    "div", { class: "res-scroll" },
    notice, placeholder, loadingEl, resText, translit, altsEl, breakdownEl,
  );

  const metaDot = h("span", { class: "meta-dot" });
  const metaText = h("span", {});
  const meta = h("div", { class: "res-meta" }, metaDot, metaText);

  const copyBtn = btn(tl("Copy"), "primary", () => copyAndClose(), "↵");
  const replaceBtn = btn(tl("Replace in app"), "secondary", () => replaceInApp(), "^↵");
  replaceBtn.classList.add("replace-btn");
  replaceBtn.setAttribute("title", t("Replace in app"));
  replaceBtn.prepend(svg(ICONS.arrowUpRight, 13));
  const speakBtn = h(
    "button",
    { class: "btn secondary speak-btn", title: tl("Speak translation out loud"), onclick: () => void speak() },
    svg(ICONS.speakerOn, 14),
    h("span", { text: tl("Speak") }),
  );
  const dualBtn = h(
    "button",
    { class: "btn secondary dual-btn", title: tl("Copy both original and translated texts"), onclick: () => void copyBoth() },
    svg(ICONS.columns, 13, { stroke: 2 }),
    h("span", { text: tl("Bilingual") }),
  );
  const footer = h("div", { class: "res-footer" }, copyBtn, replaceBtn, h("div", { class: "grow" }), speakBtn, dualBtn);
  const resBody = h("div", { class: "res-body" }, topRow, resScroll, meta, footer);
  const right = card(null, resBody);

  // ── History: a pane over both cards, opened from the source card ───────────
  let historyOpen = false;
  const history = buildHistory({
    blip: () => actions.blip(),
    isOpen: () => historyOpen,
    close: () => setHistory(false),
    retranslate: (item) => {
      setHistory(false);
      host.setText(item.query, item.targetLang);
    },
  });

  const el = h("div", { class: "view translate" },
    h("div", { class: "left" }, left),
    h("div", { class: "right" }, right),
    history.el,
  );

  function setHistory(open: boolean) {
    if (historyOpen === open) return;
    historyOpen = open;
    history.el.classList.toggle("open", open);
    history.sync();
    if (open) history.focus?.();
    else input.focus();
    fit();
  }

  // ── Behaviour ──────────────────────────────────────────────────────────────

  translator.onChange = () => renderResult();

  function currentTone(): string {
    return State.settings.aphra.tone;
  }

  function langName(code: string): string {
    const l = languages.find((x) => x.code.toLowerCase() === code.toLowerCase());
    return l ? l.native : langLabel(code);
  }

  /** Where "Auto" goes right now, for the label on the chip. */
  function resolvedTarget(): string {
    if (resultTarget && targetLang === "auto" && translator.result) return resultTarget;
    const text = input.value.trim();
    if (!text) return "";
    const detected = detectLanguageClient(text);
    return autoTarget(detected, State.settings.nativeLang, State.settings.secondLang);
  }

  function fillTargetSelect() {
    const keep = targetLang;
    clear(targetSelect);
    targetSelect.append(h("option", { value: "auto", text: "" }));
    for (const l of languages) {
      targetSelect.append(h("option", { value: l.code, text: `${l.native} (${langLabel(l.code)})` }));
    }
    targetSelect.value = keep;
    updateAutoLabel();
  }

  function updateAutoLabel() {
    const opt = targetSelect.querySelector('option[value="auto"]');
    if (!opt) return;
    const to = resolvedTarget();
    opt.textContent = to ? t("Auto → {lang}", { lang: langLabel(to) }) : t("Auto");
  }

  /** The source chip, the input's direction and the PDF chip follow what is typed. */
  function updateLive() {
    const text = input.value;
    const clean = text.trim();
    const detected = clean ? detectLanguageClient(clean) : "";
    if (!clean) srcChip.textContent = t("Auto-detect");
    else srcChip.textContent = langName(translator.result && resultSource ? resultSource : detected);
    counter.textContent = clean ? String(text.length) : "";
    clearBtn.style.display = text ? "" : "none";
    cleanChip.style.display = hasPdfLineBreaks(text) ? "" : "none";
    updateAutoLabel();
  }

  /**
   * The height an element's content needs, not the height it was stretched to.
   * Both the input and the result list fill the island (flex-grow), and
   * `scrollHeight` never goes below the current height: measured as they are,
   * the island could grow but never shrink back. They are taken out of the flex
   * layout for the read and put back at once, so nothing is painted in between.
   */
  function contentHeight(el: HTMLElement): number {
    const { flex, height } = el.style;
    el.style.flex = "none";
    el.style.height = "auto";
    const needed = el.scrollHeight;
    el.style.flex = flex;
    el.style.height = height;
    return needed;
  }

  /**
   * What a card needs around its growing part: its padding, the gaps and every
   * sibling of the text area (language row, buttons, meta, footer). The text
   * area's own content is measured by contentHeight; this is the rest, so the
   * island is tall enough for the whole card and nothing has to scroll.
   */
  function chromeHeight(body: HTMLElement, grower: HTMLElement): number {
    const cs = getComputedStyle(body);
    const gap = parseFloat(cs.rowGap) || 0;
    let total = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    let n = 0;
    for (const child of Array.from(body.children) as HTMLElement[]) {
      if (child === grower || child.style.display === "none") continue;
      total += child.offsetHeight;
      n += 1;
    }
    return total + gap * n;
  }

  /** The island grows and shrinks with both input and result, avoiding cramped scrolling. */
  function fit() {
    // The two cards are as tall as the island, so it must fit the taller of them.
    const srcNeed = contentHeight(input) + chromeHeight(srcBody, input);
    const resNeed = contentHeight(resScroll) + chromeHeight(resBody, resScroll);
    // translateHeight() adds what the island has around the cards (header, margins).
    // A few pixels of slack: sub-pixel rounding must never leave the last line cut off.
    const needed = Math.max(srcNeed, resNeed) + 4;
    // The history pane covers both cards and wants its own room.
    const next = Math.max(translateHeight(needed), historyOpen ? HISTORY_PANE_H : 0);
    // The width follows the longer of what is typed and what came back. With
    // nothing typed the old result is gone, so the island returns to its base width.
    const typed = input.value.trim().length;
    const hasPdf = hasPdfLineBreaks(input.value);
    const charCount = typed === 0 ? 0 : Math.max(typed, shown.trim().length, hasPdf ? 60 : 0);
    const nextW = translateWidth(charCount);
    if (next !== State.translateH || nextW !== State.translateW) {
      State.translateH = next;
      State.translateW = nextW;
      actions.heightChanged();
    }
    syncFade();
  }

  function setInput(text: string) {
    input.value = text;
    updateLive();
    fit();
  }

  function scheduleRun() {
    if (debounce != null) window.clearTimeout(debounce);
    // The smart engine costs money per call: it waits for a real pause.
    debounce = window.setTimeout(() => void run(), State.engine === "aphra" ? 400 : 250);
  }

  input.addEventListener("input", () => {
    updateLive();
    fit();
    if (!input.value.trim()) {
      translator.cancel();
      if (debounce != null) window.clearTimeout(debounce);
      setWorking(null);
      renderResult();
      return;
    }
    scheduleRun();
  });

  async function run() {
    if (debounce != null) window.clearTimeout(debounce);
    debounce = null;
    const text = input.value.trim();
    if (!text) {
      translator.cancel();
      setWorking(null);
      renderResult();
      return;
    }
    setWorking(State.engine);
    const res = await translator.run({ text, engine: State.engine, tone: currentTone(), targetLang });
    if (translator.phase === "loading") return; // a newer request took over
    setWorking(null);
    if (translator.phase === "done" && res?.data) {
      const d = res.data;
      shown = d.translation || "";
      resultSource = d.detectedLang || resultSource;
      resultTarget = d.targetLang || resultTarget;
      State.compactPreview = ellipsize(shown, 60);
      setMood("idle");
      if (State.settings.autoCopy && shown) {
        void Bridge.copyText(shown);
        toast(t("Copied automatically"));
      }
    } else if (translator.phase === "error") {
      fail();
    }
    renderResult();
    updateLive();
  }

  function setEngine(engine: Engine) {
    const next = parseEngine(engine);
    if (next === State.engine) return;
    State.setEngine(next);
    renderPills();
    if (input.value.trim()) void run();
  }

  function renderPills() {
    for (const [engine, pill] of pillEls) {
      const def = PILLS.find((p) => p.engine === engine)!;
      const on = State.engine === engine;
      pill.classList.toggle("on", on);
      pill.style.borderColor = on ? `${def.color}8c` : `${def.color}24`;
      pill.style.background = on ? `${def.color}2e` : "";
      pill.style.boxShadow = on ? `0 2px 10px ${def.color}40` : "";
      const lbl = pill.querySelector(".lbl") as HTMLElement;
      lbl.style.color = on ? "var(--ink-strong)" : "";
    }
    toneSelect.style.display = State.engine === "aphra" ? "" : "none";
    toneSelect.value = currentTone();
  }

  function engineName(engine: string): string {
    if (engine === "google") return t("Fast");
    if (engine === "aphra") return t("Smart");
    return engine === "mymemory" ? "MyMemory" : engine;
  }

  function engineColor(engine: string): string {
    return PILLS.find((p) => p.engine === engine)?.color ?? "#8e939c";
  }

  function renderBreakdown() {
    const data = translator.result?.data;
    const items = data && State.settings.aphra.showBreakdown ? data.breakdown : [];
    const notes = data?.critiqueNotes ?? "";
    const has = items.length > 0;
    breakdownEl.style.display = has ? "" : "none";
    if (!has) return;
    clear(bkToggle);
    bkToggle.append(
      svg(breakdownOpen ? ICONS.chevronDown : ICONS.chevronRight, 9, { stroke: 2.4 }),
      h("span", { text: t("Idiom breakdown ({n})", { n: items.length }) }),
    );
    bkToggle.setAttribute("aria-expanded", String(breakdownOpen));
    bkList.style.display = breakdownOpen ? "" : "none";
    clear(bkList);
    if (!breakdownOpen) return;
    for (const b of items) {
      bkList.append(
        h("div", { class: "bk-item", dir: "auto" },
          h("span", { class: "bk-term", text: `${b.term}:` }),
          h("span", { class: "bk-meaning", text: ` ${b.meaning}` }),
          b.explanation ? h("div", { class: "bk-desc", text: b.explanation }) : null,
        ),
      );
    }
    if (notes) {
      bkList.append(
        h("div", { class: "bk-item note", dir: "auto" },
          h("span", { class: "bk-term", text: t("Style and tone note:") }),
          h("div", { class: "bk-desc", text: notes }),
        ),
      );
    }
  }

  function renderAlternatives(data: TranslateData | null) {
    clear(altsEl);
    const groups = (data?.alternatives ?? []).filter((a) => a.terms && a.terms.length);
    altsEl.style.display = groups.length ? "" : "none";
    for (const g of groups) {
      const row = h("div", { class: "alt-row" });
      if (g.pos) row.append(h("span", { class: "alt-pos", text: posLabel(g.pos) }));
      for (const term of g.terms.slice(0, 7)) {
        row.append(h("button", {
          class: "alt-pill", dir: "auto", text: term, title: tl("Use this word as the translation"),
          onclick: () => { shown = term; renderResult(true); },
        }));
      }
      altsEl.append(row);
    }
  }

  function renderResult(keepAlts = false) {
    const phase = translator.phase;
    const res = translator.result;
    const data = res?.data ?? null;
    const loading = phase === "loading";
    const streaming = loading && translator.partial.length > 0;

    placeholder.style.display = phase === "idle" ? "" : "none";
    loadingEl.style.display = loading && !streaming ? "" : "none";

    let text = "";
    if (streaming) text = translator.partial;
    else if (phase === "done") text = shown;
    else if (phase === "error") text = translator.error || t("Translation failed.");
    resText.style.display = text ? "" : "none";
    resText.textContent = text;
    resText.classList.toggle("err", phase === "error");
    resText.classList.toggle("live", streaming);

    const tr = (data?.translit ?? "").trim();
    const showTr = phase === "done" && tr.length > 0 && tr.length < 220 && tr.toLowerCase() !== shown.toLowerCase();
    translit.style.display = showTr ? "" : "none";
    translit.textContent = showTr ? tr : "";

    const warning = phase === "done" ? res?.warning ?? null : null;
    notice.style.display = warning ? "" : "none";
    if (warning) {
      noticeText.textContent = warning.code === "MISSING_API_KEY"
        ? t("The AI key is missing. Translated with the fast engine.")
        : t("The AI didn't answer. Translated with the fast engine. ({message})", { message: warning.message });
    }

    if (!keepAlts) renderAlternatives(phase === "done" ? data : null);
    if (phase !== "done") breakdownEl.style.display = "none";
    else renderBreakdown();

    meta.style.display = phase === "done" && data ? "" : "none";
    if (phase === "done" && data) {
      metaDot.style.background = engineColor(data.engine);
      // The duration is isolated left to right so "418 ms" stays whole in Persian.
      metaText.textContent = `${engineName(data.engine)} · ${res?.cached ? t("cached") : `⁦${formatDuration(translator.ms)}⁩`}`;
    }

    const can = phase === "done" && shown.length > 0;
    for (const b of [copyBtn, replaceBtn, speakBtn, dualBtn]) b.classList.toggle("off", !can);
    renderCopyLabel();
    renderPills();
    resScroll.classList.toggle("scroll", true);
    fit();
    syncFade();
  }

  /** The fade at the bottom edge only shows while there is more text below it. */
  function syncFade() {
    const more = resScroll.scrollHeight - resScroll.clientHeight - resScroll.scrollTop > 4;
    resScroll.classList.toggle("more", more);
  }
  resScroll.addEventListener("scroll", syncFade);
  window.addEventListener("resize", syncFade);

  function renderCopyLabel() {
    const done = performance.now() < copiedUntil;
    const label = copyBtn.firstElementChild as HTMLElement;
    const wanted = done ? t("Copied") : t("Copy");
    if (label.textContent !== wanted) label.textContent = wanted;
  }

  function canAct(): boolean {
    return translator.phase === "done" && shown.length > 0;
  }

  async function copyAndClose() {
    if (!canAct()) return;
    await Bridge.copyText(shown);
    copiedUntil = performance.now() + 600;
    renderCopyLabel();
    celebrate();
    toast(t("Text copied"));
    window.setTimeout(() => {
      copiedUntil = 0;
      renderCopyLabel();
      actions.closeIsland();
    }, 450);
  }

  async function replaceInApp() {
    if (!canAct()) return;
    (document.activeElement as HTMLElement)?.blur?.();
    void Bridge.focusWindow(false);
    toast(t("Replacing in the app…"));
    celebrate();
    await Bridge.replaceText(shown);
    actions.closeIsland();
  }

  async function copyBoth() {
    if (!canAct() || !input.value.trim()) return;
    await Bridge.copyText(`${input.value.trim()}\n\n${shown}`);
    celebrate();
    toast(t("Both texts copied"));
  }

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
    if (!canAct()) return;
    speaking = true;
    speakBtn.classList.add("on");
    const lang = resultTarget || "en";
    const res = await Bridge.tts(shown, lang);
    if (!speaking) return;
    if (res && res.ok && res.audio) {
      audio = new Audio(`data:audio/mpeg;base64,${res.audio}`);
      audio.onended = audio.onerror = () => stopAudio();
      audio.play().catch(() => stopAudio());
    } else if (typeof SpeechSynthesisUtterance !== "undefined") {
      // Offline: whatever voices the system has installed.
      const u = new SpeechSynthesisUtterance(shown);
      u.lang = lang;
      u.onend = () => stopAudio();
      speechSynthesis.speak(u);
    } else {
      stopAudio();
    }
  }

  async function paste() {
    const text = (await Bridge.readClipboardText()) ?? "";
    if (text.trim()) {
      setInput(text.trim());
      toast(t("Pasted from the clipboard"));
      void run();
    } else {
      toast(t("The clipboard is empty"));
      input.focus();
    }
  }

  function cleanLines() {
    const cleaned = cleanPdfText(input.value);
    if (!cleaned) return;
    setInput(cleaned);
    toast(t("PDF line breaks cleaned"));
    void run();
  }

  function swapLanguages() {
    actions.blip();
    // Translate back into the language the text came from, or flip the
    // translation into the input.
    const back = resultSource && languages.some((l) => l.code === resultSource) ? resultSource : "auto";
    targetLang = back === targetLang ? "auto" : back;
    targetSelect.value = targetLang;
    if (canAct()) {
      setInput(shown.trim());
      void run();
    } else if (input.value.trim()) {
      void run();
    }
  }

  function toggleEngine() {
    actions.blip();
    setEngine(otherEngine(State.engine));
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────

  window.addEventListener("keydown", (e) => {
    if (State.mode !== "expanded" || State.view !== "translate" || e.defaultPrevented || historyOpen) return;
    const tag = document.activeElement?.tagName ?? "";
    const typing = FIELD_TAGS.has(tag);
    const mod = e.ctrlKey || e.metaKey;

    if (e.key === "Enter" && mod) {
      e.preventDefault();
      replaceInApp();
    } else if (e.key === "Tab" && e.ctrlKey) {
      e.preventDefault();
      toggleEngine();
    } else if ((e.key === "s" || e.key === "S") && e.ctrlKey && !e.altKey) {
      e.preventDefault();
      swapLanguages();
    } else if (e.key === "Enter" && !e.shiftKey && !typing && tag !== "BUTTON") {
      e.preventDefault();
      copyAndClose();
    } else if (e.key.length === 1 && !mod && !e.altKey && !typing) {
      // Just start typing, wherever the focus is.
      input.focus();
    }
  });

  // ── Host ───────────────────────────────────────────────────────────────────

  void Bridge.getLanguages().then((list) => {
    languages = list ?? [];
    fillTargetSelect();
    updateLive();
  });

  renderResult();
  updateLive();

  let lastLang = language();
  let pillsBuilt = false;

  function buildPillBots() {
    pillsBuilt = true;
    for (const def of PILLS) {
      const task = State.tasks.find((x) => x.id === def.id)!;
      const pill = pillEls.get(def.engine)!;
      const mini = createMiniBot(task, 20);
      pill.insertBefore(mini, pill.firstChild);
    }
    pruneMiniBots();
  }

  const host: TranslateHost = {
    el,
    partial(requestId: number, text: string) {
      translator.partialText(requestId, text);
      fit();
    },
    sync() {
      // A folded island forgets the pane: it opens on the translator again.
      if (State.mode !== "expanded" && historyOpen) setHistory(false);
      history.sync();
      if (!pillsBuilt) buildPillBots();
      if (lastLang !== language()) {
        lastLang = language();
        fillTargetSelect();
        renderBreakdown();
      }
      renderPills();
      renderCopyLabel();
      updateLive();
    },
    focus() {
      if (historyOpen) return;
      if (skipNextFocus) {
        skipNextFocus = false;
        return;
      }
      input.focus();
    },
    typing: isTyping,
    setCaptured(text: string) {
      if (historyOpen) setHistory(false);
      const clean = (text || "").trim();
      if (clean) {
        setInput(clean);
        // The input lets go of the keyboard, so Enter copies and Ctrl+Enter replaces at once.
        skipNextFocus = true;
        input.blur();
        void run();
      } else {
        skipNextFocus = false;
        window.setTimeout(() => { input.focus(); input.select(); }, 140);
      }
    },
    setText(text: string, target?: string) {
      if (historyOpen) setHistory(false);
      if (target) {
        targetLang = target;
        targetSelect.value = target;
      }
      setInput(text);
      skipNextFocus = true;
      void run();
    },
    copyAndClose,
    replaceInApp,
    swapLanguages,
    toggleEngine,
  };
  return host;
}
