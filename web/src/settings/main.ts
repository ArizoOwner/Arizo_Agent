// Settings window: General, Languages, Shortcuts, Engines, About. Everything
// is saved as soon as it changes. The API key is the one exception to "the page
// knows its settings": the page never receives it, only `hasApiKey`; the key is
// sent once, in the save that carries it.

import "./settings.css";
import "../views/select.css";
import { Bridge, onEvent, type Language as Lang } from "../core/bridge";
import { recordKey, accelParts } from "../core/hotkey";
import {
  PROVIDERS,
  applyPreset,
  needsKey,
  providerForUrl,
  getAvailableModels,
  saveCachedModels,
  type ProviderId,
} from "../core/providers";
import { DEFAULT_SETTINGS, mergeSettings, type Settings, type SettingsPatch, type Tone } from "../core/state";
import { h, clear, svg } from "../views/dom";
import { ICONS } from "../views/icons";
import { enhanceSelect } from "../views/select";
import { applyTheme as applyThemeTo, watchSystemTheme } from "../core/theme";
import { LANGUAGES, isRtl, onLanguageChange, resolveLanguage, setLanguage, t } from "../i18n/i18n";

const VERSION_FALLBACK = "3.0.1";
const REPO_URL = "https://github.com/ArizoOwner/arizo-translate";

let settings: Settings = { ...DEFAULT_SETTINGS };
let version = VERSION_FALLBACK;
let languages: Lang[] = [];

const root = document.getElementById("settings-root")!;

/** Sends a change; what comes back (the backend's own idea of the settings) wins. */
async function save(patch: SettingsPatch, opts: { apiKey?: string; clearApiKey?: boolean } = {}) {
  settings = mergeSettings(settings, patch);
  const res = await Bridge.saveSettings(patch, opts);
  if (res?.settings) settings = mergeSettings(settings, res.settings);
  return res;
}

// ── Reusable bits ─────────────────────────────────────────────────────────────

function toggle(on: boolean, onChange: (v: boolean) => void): HTMLElement {
  const el = h("button", { class: on ? "switch on" : "switch", "aria-pressed": on, type: "button" });
  el.addEventListener("click", () => {
    const next = !el.classList.contains("on");
    el.classList.toggle("on", next);
    el.setAttribute("aria-pressed", String(next));
    onChange(next);
  });
  return el;
}

function segmented<T extends string>(
  options: readonly { value: T; label: string }[],
  current: T,
  onChange: (v: T) => void,
): HTMLElement {
  const buttons = options.map((o) => h("button", { type: "button", text: o.label, "data-v": o.value }));
  const seg = h("div", { class: "seg" }, ...buttons);
  const paint = (value: T) => buttons.forEach((b) => b.classList.toggle("on", b.dataset.v === value));
  paint(current);
  buttons.forEach((b) =>
    b.addEventListener("click", () => {
      const v = b.dataset.v as T;
      paint(v);
      onChange(v);
    }),
  );
  return seg;
}

function row(label: string, ...controls: (Node | string | null)[]): HTMLElement {
  return h("div", { class: "row" }, h("label", { text: label }), ...controls);
}

function section(title: string, ...children: (Node | null)[]): HTMLElement {
  return h("section", {}, h("h2", {}, h("span", { text: title })), ...children);
}

function langSelect(current: string, onChange: (code: string) => void): HTMLSelectElement {
  const sel = enhanceSelect(h("select", {}) as HTMLSelectElement);
  for (const l of languages) sel.append(h("option", { value: l.code, text: `${l.native} (${l.code})` }));
  sel.value = current;
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}

// ── General ───────────────────────────────────────────────────────────────────

function generalSection(): HTMLElement {
  const historyLimit = h("input", {
    type: "number", min: "10", max: "1000", step: "10", value: String(settings.historyLimit), style: "width:84px",
  }) as HTMLInputElement;
  historyLimit.addEventListener("change", () => {
    const n = Math.max(10, Math.min(1000, Math.round(Number(historyLimit.value) || 100)));
    historyLimit.value = String(n);
    void save({ historyLimit: n });
  });

  return section(
    t("General"),
    row(t("Interface language"), segmented(
      LANGUAGES.map((l) => ({ value: l.code, label: l.name })),
      resolveLanguage(settings.appLanguage),
      (v) => { void save({ appLanguage: v }); applyLanguage(); },
    )),
    row(t("Theme"), segmented(
      [
        { value: "dark" as const, label: t("Dark") },
        { value: "light" as const, label: t("Light") },
        { value: "system" as const, label: t("System") },
      ],
      settings.theme,
      (v) => { void save({ theme: v }); applyTheme(); },
    )),
    row(t("Launch at startup"), toggle(settings.launchAtStartup, (v) => void save({ launchAtStartup: v }))),
    row(t("Hide when I click elsewhere"), toggle(settings.hideOnBlur, (v) => void save({ hideOnBlur: v }))),
    row(t("Copy the translation automatically"), toggle(settings.autoCopy, (v) => void save({ autoCopy: v }))),
    row(t("Restore the clipboard after replacing"), toggle(settings.restoreClipboard, (v) => void save({ restoreClipboard: v }))),
    row(t("Save history"), toggle(settings.saveHistory, (v) => void save({ saveHistory: v })), historyLimit,
      h("span", { class: "hint", text: t("translations kept") })),
    row(t("Floating bubble"), toggle(settings.showFloatingBubble, (v) => void save({ showFloatingBubble: v })),
      h("span", { class: "hint", text: t("A small button near selected text") })),
  );
}

// ── Languages ─────────────────────────────────────────────────────────────────

function languagesSection(): HTMLElement {
  return section(
    t("Languages"),
    h("div", { class: "hint", text: t("Text in your first language is translated into the second, and anything else into the first.") }),
    row(t("My first language"), langSelect(settings.nativeLang, (c) => void save({ nativeLang: c }))),
    row(t("My second language"), langSelect(settings.secondLang, (c) => void save({ secondLang: c }))),
  );
}

// ── Shortcuts ─────────────────────────────────────────────────────────────────

type HotkeyName = "hotkey" | "inlineHotkey" | "hideHotkey";

/** A keycap that records the next combination when clicked. Esc cancels. */
function hotkeyRow(label: string, hint: string, name: HotkeyName, failed: Set<HotkeyName>): HTMLElement {
  const cap = h("button", { class: "keycap", type: "button" });
  const tag = h("span", { class: "tag err", text: t("Unavailable, the previous one was kept") });
  const note = h("span", { class: "hint" });
  let recording = false;

  const paint = () => {
    cap.classList.toggle("recording", recording);
    clear(cap);
    cap.textContent = recording ? t("Press keys…") : accelParts(settings[name]).join(" + ");
    tag.style.display = failed.has(name) && !recording ? "" : "none";
  };

  function stop() {
    recording = false;
    window.removeEventListener("keydown", onKey, true);
    cap.blur();
    void Bridge.shortcutsSuspend(false);
    paint();
  }

  async function onKey(e: KeyboardEvent) {
    // Capture phase: this runs before anything else on the page sees the key.
    e.preventDefault();
    e.stopPropagation();
    const r = recordKey(e);
    if (r.kind === "wait") return;
    if (r.kind === "cancel") return stop();
    if (r.kind === "invalid") {
      note.textContent = r.reason === "needsModifier"
        ? t("Hold Ctrl, Alt or Shift with it.")
        : t("That key can't be used in a shortcut.");
      return;
    }
    note.textContent = "";
    stop();
    const res = await save({ [name]: r.accelerator } as SettingsPatch);
    const ok = name === "hotkey" ? res?.hotkeyOk : name === "inlineHotkey" ? res?.inlineHotkeyOk : res?.hideHotkeyOk;
    if (res && ok === false) failed.add(name);
    else failed.delete(name);
    paint();
  }

  cap.addEventListener("click", () => {
    if (recording) return;
    recording = true;
    note.textContent = "";
    // The global shortcuts are let go of while recording, or pressing the
    // current one would trigger it instead of being recorded.
    void Bridge.shortcutsSuspend(true);
    window.addEventListener("keydown", onKey, true);
    paint();
  });
  cap.addEventListener("blur", () => { if (recording) stop(); });

  paint();
  return h("div", { class: "row shortcut" },
    h("div", { class: "shortcut-name" }, h("div", { text: label }), h("div", { class: "hint", text: hint })),
    note, tag, cap);
}

function shortcutsSection(): HTMLElement {
  const failed = new Set<HotkeyName>();
  return section(
    t("Shortcuts"),
    h("div", { class: "hint", text: t("Work from any app. Click a shortcut, then press the new keys. Esc cancels.") }),
    hotkeyRow(t("Translate the selection"), t("Opens the island with the selected text"), "hotkey", failed),
    hotkeyRow(t("Translate in place"), t("Shows the bubble over the selected text"), "inlineHotkey", failed),
    hotkeyRow(t("Hide the island completely"), t("Press again to bring it back; works while folded too"), "hideHotkey", failed),
  );
}

// ── Engines ───────────────────────────────────────────────────────────────────

function enginesSection(): HTMLElement {
  const a = settings.aphra;
  const state = { hasKey: a.hasApiKey, pendingKey: "", reveal: false };

  const preset = enhanceSelect(h("select", {}) as HTMLSelectElement);
  for (const p of PROVIDERS) preset.append(h("option", { value: p.id, text: p.id === "custom" ? t("Custom") : p.name }));
  preset.value = providerForUrl(a.baseUrl);

  const baseUrl = h("input", { type: "text", class: "inline-input ltr", value: a.baseUrl, spellcheck: false, placeholder: "https://…/v1" }) as HTMLInputElement;
  const modelList = enhanceSelect(h("select", { class: "inline-input" }) as HTMLSelectElement);
  const model = h("input", { type: "text", class: "inline-input ltr", value: a.model, spellcheck: false, placeholder: t("Model name") }) as HTMLInputElement;
  const fetchBtn = h("button", { type: "button", text: t("Fetch models") });
  const testBtn = h("button", { type: "button", text: t("Test connection") });
  const result = h("div", { class: "notice", style: "display:none" });

  function updateModelList() {
    const list = getAvailableModels(baseUrl.value, model.value);
    clear(modelList);
    for (const m of list) {
      modelList.append(h("option", { value: m.id, text: m.name }));
    }
    modelList.append(h("option", { value: "__custom__", text: `✎ ${t("Custom model…")}` }));
    if (list.some((m) => m.id === model.value)) {
      modelList.value = model.value;
      model.style.display = "none";
    } else {
      modelList.value = "__custom__";
      model.style.display = "";
    }
    modelList.style.display = list.length ? "" : "none";
  }

  updateModelList();

  const keyInput = h("input", {
    type: "password", class: "ltr", autocomplete: "off", spellcheck: false,
    placeholder: state.hasKey ? t("A key is stored (hidden)") : t("API key"),
  }) as HTMLInputElement;
  const eye = h("button", { type: "button", class: "icon-toggle", title: t("Show or hide the key") }, svg(ICONS.eye, 14, { stroke: 2 }));
  const removeKey = h("button", { type: "button", class: "danger", text: t("Remove key") });
  const keyBadge = h("span", { class: "tag" });

  function paintKey() {
    keyBadge.textContent = state.hasKey ? t("Key stored") : t("No key");
    keyBadge.className = state.hasKey ? "tag ok" : "tag warn";
    removeKey.style.display = state.hasKey ? "" : "none";
    keyInput.type = state.reveal ? "text" : "password";
    keyInput.placeholder = state.hasKey ? t("A key is stored (hidden)") : t("API key");
    clear(eye);
    eye.append(svg(state.reveal ? ICONS.eyeOff : ICONS.eye, 14, { stroke: 2 }));
  }

  function show(kind: "ok" | "err" | "warn", message: string) {
    result.className = `notice ${kind}`;
    result.textContent = message;
    result.style.display = "";
  }

  /** What the buttons test: the typed address and model, and a key typed but not saved yet. */
  const cfg = () => ({
    baseUrl: baseUrl.value.trim(),
    model: model.value.trim(),
    apiKey: keyInput.value.trim() || undefined,
  });

  async function saveAi() {
    await save({ aphra: { baseUrl: baseUrl.value.trim(), model: model.value.trim() } });
  }

  preset.addEventListener("change", () => {
    const next = applyPreset(preset.value as ProviderId, { baseUrl: baseUrl.value, model: "" });
    baseUrl.value = next.baseUrl;
    const providerModels = getAvailableModels(next.baseUrl);
    model.value = next.model || (providerModels[0]?.id ?? "");
    updateModelList();
    void saveAi();
  });
  baseUrl.addEventListener("change", () => {
    preset.value = providerForUrl(baseUrl.value);
    updateModelList();
    void saveAi();
  });
  model.addEventListener("change", () => void saveAi());
  modelList.addEventListener("change", () => {
    if (modelList.value === "__custom__") {
      model.style.display = "";
      model.focus();
    } else {
      model.value = modelList.value;
      model.style.display = "none";
      void saveAi();
    }
  });

  fetchBtn.addEventListener("click", async () => {
    fetchBtn.disabled = true;
    result.style.display = "none";
    try {
      const res = await Bridge.fetchModels(cfg());
      if (res.ok) {
        saveCachedModels(baseUrl.value, res.models);
        if (res.models.length && !res.models.some((m) => m.id === model.value)) {
          model.value = res.models[0].id;
        }
        updateModelList();
        void saveAi();
        show(res.models.length ? "ok" : "warn", t("{n} models found", { n: res.models.length }));
      } else show("err", res.error);
    } catch (err) {
      show("err", String(err instanceof Error ? err.message : err));
    }
    fetchBtn.disabled = false;
  });

  testBtn.addEventListener("click", async () => {
    testBtn.disabled = true;
    result.style.display = "none";
    try {
      const res = await Bridge.testAi(cfg());
      if (res.ok) show("ok", t("Connected: {model} answered in {ms} ms", { model: res.model, ms: res.ms }));
      else show("err", res.error);
    } catch (err) {
      show("err", String(err instanceof Error ? err.message : err));
    }
    testBtn.disabled = false;
  });

  // The key is sent once, when the field is left; the field is emptied right after.
  keyInput.addEventListener("change", async () => {
    const key = keyInput.value.trim();
    if (!key) return;
    await save({}, { apiKey: key });
    keyInput.value = "";
    state.hasKey = settings.aphra.hasApiKey;
    paintKey();
  });
  eye.addEventListener("click", () => { state.reveal = !state.reveal; paintKey(); });
  removeKey.addEventListener("click", async () => {
    await save({}, { clearApiKey: true });
    keyInput.value = "";
    state.hasKey = settings.aphra.hasApiKey;
    paintKey();
  });

  paintKey();
  void needsKey; // the hint below uses it
  const local = !needsKey(a.baseUrl);

  return section(
    t("Engines"),
    row(t("Default engine"), segmented(
      [{ value: "google" as const, label: `⚡ ${t("Fast")}` }, { value: "aphra" as const, label: `✦ ${t("Smart")}` }],
      settings.defaultEngine,
      (v) => void save({ defaultEngine: v }),
    )),
    h("div", { class: "subhead", text: t("Smart engine (AI)") }),
    h("div", { class: "hint", text: local ? t("A local server needs no key.") : t("Any service that speaks the OpenAI chat API. Your key is stored in the Windows Credential Manager.") }),
    row(t("Provider"), preset),
    row(t("Address"), baseUrl),
    row(t("Model"), modelList, model, fetchBtn),
    row(t("API key"), h("div", { class: "key-field" }, keyInput, eye), keyBadge, removeKey),
    row(t("Default tone"), segmented(
      (["auto", "formal", "colloquial", "technical", "literary"] as Tone[]).map((v) => ({
        value: v,
        label: t(({ auto: "Auto tone", formal: "Formal", colloquial: "Colloquial", technical: "Technical", literary: "Literary" } as const)[v]),
      })),
      a.tone,
      (v) => void save({ aphra: { tone: v } }),
    )),
    row(t("Show the idiom breakdown"), toggle(a.showBreakdown, (v) => void save({ aphra: { showBreakdown: v } }))),
    h("div", { class: "row" }, testBtn),
    result,
  );
}

// ── About ─────────────────────────────────────────────────────────────────────

function aboutSection(): HTMLElement {
  return section(
    t("About"),
    row(t("Version"), h("span", { class: "path", text: version })),
    row(t("License"), h("span", { text: "MIT" })),
    row(t("Made by"), h("span", { text: "ArizoOwner" })),
    h("div", { class: "row" }, h("button", { type: "button", text: t("Open the project page"), onclick: () => void Bridge.openUrl(REPO_URL) })),
    h("div", { class: "hint", text: t("No telemetry. Text is only sent to the translation service you use.") }),
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function applyLanguage() {
  setLanguage(resolveLanguage(settings.appLanguage));
}

function applyDirection() {
  document.documentElement.dir = isRtl() ? "rtl" : "ltr";
  document.title = t("Arizo Translate — Settings");
}

function applyTheme() {
  applyThemeTo(settings.theme);
}

function render() {
  const scroll = document.scrollingElement?.scrollTop ?? 0;
  clear(root);
  root.append(
    h("h1", {}, h("span", { text: t("Arizo Translate") }), h("span", { class: "version", text: version })),
    generalSection(),
    languagesSection(),
    shortcutsSection(),
    enginesSection(),
    aboutSection(),
  );
  if (document.scrollingElement) document.scrollingElement.scrollTop = scroll;
}

async function main() {
  const boot = await Bridge.boot();
  if (boot) {
    settings = mergeSettings(settings, boot.settings);
    version = boot.version || VERSION_FALLBACK;
  }
  languages = (await Bridge.getLanguages()) ?? [];
  applyLanguage();
  applyDirection();
  applyTheme();
  watchSystemTheme(() => settings.theme);
  onLanguageChange(() => {
    applyDirection();
    render();
  });
  render();

  // The island changed something (sound, outfit…): keep what is shown fresh, but
  // never redraw under a field that is being edited.
  void onEvent<Settings>("settings-changed", (s) => {
    settings = mergeSettings(settings, s);
    applyLanguage();
    applyTheme();
    const tag = document.activeElement?.tagName;
    if (tag !== "INPUT" && tag !== "SELECT" && !document.querySelector(".keycap.recording")) render();
  });
}

void main();
