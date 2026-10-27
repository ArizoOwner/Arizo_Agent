// Integrated in-island Settings view: General, Shortcuts, Languages, AI Engine, Sound & Timer, Wardrobe.
// Everything is responsive, neatly organized in category tabs, and saved immediately via Bridge.

import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { card } from "./parts";
import { enhanceSelect } from "./select";
import { applyTheme } from "../core/theme";
import { toast } from "../core/toast";
import { Bridge, type Language as Lang } from "../core/bridge";
import { recordKey, accelParts } from "../core/hotkey";
import {
  PROVIDERS,
  applyPreset,
  providerForUrl,
  getAvailableModels,
  saveCachedModels,
  type ProviderId,
} from "../core/providers";
import { State, mergeSettings, type SettingsPatch, type Tone } from "../core/state";
import { language, resolveLanguage, setLanguage, t, tl } from "../i18n/i18n";
import { OUTFIT_SELECTIONS, OUTFIT_KEYS, parseOutfit, resolveOutfit, seasonalOutfit } from "../ari/wardrobe";
import { drawWardrobeIcon } from "../ari/outfits";
import { buildLookSettings } from "./look-settings";
import type { ViewActions, ViewHost } from "./views";

type Category = "general" | "look" | "shortcuts" | "languages" | "engine" | "sound" | "wardrobe";

export function buildSettingsView(actions: ViewActions): ViewHost {
  let activeTab: Category = "general";
  let languagesList: Lang[] = [];
  let loaded = false;
  let testResultText = "";
  let testResultOk: boolean | null = null;
  let isTesting = false;
  let isFetchingModels = false;
  let customModelMode = false;
  let modelStatusText = "";
  let modelStatusOk: boolean | null = null;

  const tabs: { id: Category; labelKey: string; icon: string }[] = [
    { id: "general", labelKey: "General", icon: ICONS.gear },
    { id: "look", labelKey: "Island look", icon: ICONS.eye },
    { id: "shortcuts", labelKey: "Shortcuts", icon: ICONS.timer },
    { id: "languages", labelKey: "Languages", icon: ICONS.swap },
    { id: "engine", labelKey: "AI Engine", icon: ICONS.spark },
    { id: "sound", labelKey: "Sound & Timer", icon: ICONS.speakerOn },
    { id: "wardrobe", labelKey: "Wardrobe", icon: ICONS.stack },
  ];

  // Tab navigation bar
  const navBar = h("div", { class: "settings-nav" });
  const tabButtons = new Map<Category, { btn: HTMLButtonElement; span: HTMLElement }>();

  for (const tab of tabs) {
    const span = h("span", { text: t(tab.labelKey) });
    const btn = h(
      "button",
      { class: "settings-nav-btn", type: "button", title: t(tab.labelKey), onclick: () => switchTab(tab.id) },
      svg(tab.icon, 13, { stroke: 2 }),
      span,
    ) as HTMLButtonElement;
    tabButtons.set(tab.id, { btn, span });
    navBar.append(btn);
  }

  // Liquid-glass pill that glides to the active tab.
  const glass = h("div", { class: "settings-glass", "aria-hidden": "true" });
  navBar.prepend(glass);
  let glassPlaced = false;
  let glassFrom = -1;

  function moveGlass() {
    const target = tabButtons.get(activeTab)?.btn;
    if (!target || !target.offsetWidth) {
      requestAnimationFrame(moveGlass);
      return;
    }
    const x = target.offsetLeft;
    const w = target.offsetWidth;
    glass.style.width = `${w}px`;
    glass.style.transform = `translateX(${x}px)`;
    if (!glassPlaced) {
      glassPlaced = true;
      glassFrom = x;
      requestAnimationFrame(() => glass.classList.add("ready"));
      return;
    }
    if (x !== glassFrom) {
      glass.classList.remove("moving");
      void glass.offsetWidth;
      glass.classList.add("moving");
      glassFrom = x;
      target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }
  }
  glass.addEventListener("animationend", () => glass.classList.remove("moving"));
  new ResizeObserver(() => {
    glass.classList.remove("ready");
    glassPlaced = false;
    moveGlass();
  }).observe(navBar);

  // Content body
  const bodyEl = h("div", { class: "settings-panel" });

  const el = h(
    "div",
    { class: "view settings-integrated" },
    card(null, h("div", { class: "settings-island-card" }, navBar, bodyEl)),
  );

  function switchTab(cat: Category) {
    actions.blip();
    activeTab = cat;
    render();
  }

  async function save(patch: SettingsPatch, opts: { apiKey?: string; clearApiKey?: boolean } = {}) {
    State.settings = mergeSettings(State.settings, patch);
    actions.blip();
    const res = await Bridge.saveSettings(patch, opts);
    if (res && res.ok === false) {
      // Nothing was stored (no settings come back): keep the typed key on screen.
      toast(t("Could not save. Try again."));
      return res;
    }
    if (res?.settings) {
      State.settings = mergeSettings(State.settings, res.settings);
    }
    // Update theme and language if changed
    if (patch.appLanguage) {
      setLanguage(resolveLanguage(State.settings.appLanguage));
    }
    if (patch.theme) {
      applyTheme(State.settings.theme);
    }
    State.notify();
    render();
    return res;
  }

  // ── Helper controls ─────────────────────────────────────────────────────────

  function toggle(on: boolean, onChange: (v: boolean) => void): HTMLElement {
    const sw = h("button", { class: on ? "switch on" : "switch", type: "button", role: "switch", "aria-checked": String(on) });
    sw.addEventListener("click", () => {
      const next = !sw.classList.contains("on");
      sw.classList.toggle("on", next);
      sw.setAttribute("aria-checked", String(next));
      onChange(next);
    });
    return sw;
  }

  function segmented<T extends string>(
    options: readonly { value: T; label: string }[],
    current: T,
    onChange: (v: T) => void,
  ): HTMLElement {
    const buttons = options.map((o) =>
      h("button", {
        type: "button",
        class: o.value === current ? "seg-btn on" : "seg-btn",
        text: o.label,
        onclick: () => {
          buttons.forEach((b) => b.classList.remove("on"));
          onChange(o.value);
        },
      }),
    );
    return h("div", { class: "seg" }, ...buttons);
  }

  function settingRow(label: string, hint: string, control: Node, extra?: Node): HTMLElement {
    const left = h("div", { class: "set-row-text" },
      h("span", { class: "set-label", text: label }),
      hint ? h("span", { class: "set-hint", text: hint }) : null,
    );
    return h("div", { class: "set-row" }, left, h("div", { class: "set-row-control" }, control, extra ?? null));
  }

  /** A titled card that groups related rows, so each tab reads as a few clear blocks. */
  function section(title: string, icon: string, ...rows: (Node | null)[]): HTMLElement {
    return h(
      "section",
      { class: "set-group" },
      h("div", { class: "set-group-head" },
        h("span", { class: "set-group-icon" }, svg(icon, 12, { stroke: 2 })),
        h("span", { class: "set-group-title", text: title }),
      ),
      h("div", { class: "set-group-body" }, ...rows),
    );
  }

  /** Dims a row whose option only matters while another one is on. */
  function dependsOn(row: HTMLElement, on: boolean): HTMLElement {
    row.classList.toggle("set-row-off", !on);
    return row;
  }

  // ── Render Category Content ─────────────────────────────────────────────────

  function renderGeneral(): HTMLElement {
    const s = State.settings;
    const content = h("div", { class: "set-content-scroll" });
    const rows: HTMLElement[] = [];
    const collect = { append: (...n: HTMLElement[]) => rows.push(...n) };

    // 1. Language
    collect.append(
      settingRow(
        t("Interface language"),
        t("Language for menus and controls"),
        segmented(
          [
            { value: "fa" as const, label: "فارسی" },
            { value: "en" as const, label: "English" },
          ],
          resolveLanguage(s.appLanguage),
          (val) => void save({ appLanguage: val }),
        ),
      ),
    );

    // 2. Theme
    collect.append(
      settingRow(
        t("Theme"),
        t("Light, dark, or follow Windows"),
        segmented(
          [
            { value: "dark" as const, label: t("Dark") },
            { value: "light" as const, label: t("Light") },
            { value: "system" as const, label: t("System") },
          ],
          s.theme,
          (val) => void save({ theme: val }),
        ),
      ),
    );

    // 3. Autostart
    collect.append(
      settingRow(
        t("Launch at startup"),
        t("Start silently in tray with Windows"),
        toggle(s.launchAtStartup, (val) => void save({ launchAtStartup: val })),
      ),
    );

    // 4. Hide on blur
    collect.append(
      settingRow(
        t("Hide when I click elsewhere"),
        t("Automatically collapse island when clicking other windows"),
        toggle(s.hideOnBlur, (val) => void save({ hideOnBlur: val })),
      ),
    );

    // 5. Floating bubble
    collect.append(
      settingRow(
        t("Floating bubble"),
        t("A small button near selected text in any app"),
        toggle(s.showFloatingBubble, (val) => void save({ showFloatingBubble: val })),
      ),
    );

    // 6. Auto-copy
    collect.append(
      settingRow(
        t("Copy automatically"),
        t("Copy translated text to clipboard immediately"),
        toggle(s.autoCopy, (val) => void save({ autoCopy: val })),
      ),
    );

    // 7. Restore clipboard
    collect.append(
      settingRow(
        t("Restore the clipboard after replacing"),
        t("Restore previous clipboard content after in-place translation"),
        toggle(s.restoreClipboard, (val) => void save({ restoreClipboard: val })),
      ),
    );

    collect.append(
      settingRow(
        t("Spotify player"),
        t("See and control your Spotify playback from the island"),
        toggle(s.spotifyEnabled, (val) => void save({ spotifyEnabled: val })),
      ),
    );

    collect.append(
      settingRow(
        t("Football"),
        t("Live scores, fixtures and a goal celebration for your favourite team"),
        toggle(s.footballEnabled, (val) => void save({ footballEnabled: val })),
      ),
      dependsOn(settingRow(
        t("Team kit on Ari"),
        t("Ari wears your team's shirt in the Football section"),
        toggle(s.footballKit, (val) => void save({ footballKit: val })),
      ), s.footballEnabled),
      settingRow(
        t("Crypto prices"),
        t("Live prices and a 1-minute chart, read through your own exchange API"),
        toggle(s.cryptoEnabled, (val) => void save({ cryptoEnabled: val })),
      ),
      settingRow(
        t("Muse assistant"),
        t("Use muse.ai, your personal AI agent, right inside the island"),
        toggle(s.museEnabled, (val) => void save({ museEnabled: val })),
      ),
    );

    // 8. Save history & Limit
    const limitInput = h("input", {
      type: "number",
      min: "10",
      max: "1000",
      step: "10",
      class: "set-num-input",
      value: String(s.historyLimit),
    }) as HTMLInputElement;
    limitInput.addEventListener("change", () => {
      const num = Math.max(10, Math.min(1000, Number(limitInput.value) || 100));
      limitInput.value = String(num);
      void save({ historyLimit: num });
    });

    collect.append(
      settingRow(
        t("Save history"),
        t("Keep past translations saved locally"),
        toggle(s.saveHistory, (val) => void save({ saveHistory: val })),
      ),
      dependsOn(settingRow(
        t("History size"),
        t("translations kept"),
        limitInput,
      ), s.saveHistory),
    );

    // rows: 0 lang, 1 theme, 2 startup, 3 hide, 4 bubble, 5 copy, 6 restore,
    //       7 spotify, 8 football, 9 kit, 10 crypto, 11 muse, 12 history, 13 size
    content.append(
      section(t("Appearance"), ICONS.eye, rows[0], rows[1]),
      section(t("Behavior"), ICONS.gear, rows[2], rows[3], rows[4]),
      section(t("Clipboard & history"), ICONS.clipboard, rows[5], rows[6], rows[12], rows[13]),
      section(t("Island widgets"), ICONS.stack, rows[7], rows[8], rows[9], rows[10], rows[11]),
    );
    return content;
  }

  function renderShortcuts(): HTMLElement {
    const s = State.settings;
    const content = h("div", { class: "set-content-scroll" });

    content.append(
      h("div", { class: "set-banner", text: t("Work from any app. Click a shortcut, then press the new keys. Esc cancels.") }),
      section(
        t("Keyboard shortcuts"),
        ICONS.key,
        makeHotkeyRow(t("Translate the selection"), t("Opens the island with selected text"), "hotkey", s.hotkey),
        makeHotkeyRow(t("Translate in place"), t("Replaces text directly in chat or apps"), "inlineHotkey", s.inlineHotkey),
        makeHotkeyRow(t("Hide the island completely"), t("Press again to bring it back; works while folded too"), "hideHotkey", s.hideHotkey),
      ),
    );

    return content;
  }

  function makeHotkeyRow(label: string, hint: string, keyName: "hotkey" | "inlineHotkey" | "hideHotkey", currentVal: string): HTMLElement {
    const keyBtn = h("button", { class: "keycap-btn", type: "button", text: accelParts(currentVal).join(" + ") }) as HTMLButtonElement;
    let recording = false;

    function stop() {
      recording = false;
      keyBtn.classList.remove("recording");
      keyBtn.textContent = accelParts(State.settings[keyName]).join(" + ");
      window.removeEventListener("keydown", onKeyDown, true);
      void Bridge.shortcutsSuspend(false);
    }

    async function onKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      const r = recordKey(e);
      if (r.kind === "wait") return;
      if (r.kind === "cancel") return stop();
      if (r.kind === "invalid") {
        keyBtn.textContent = r.reason === "needsModifier" ? t("Hold Ctrl or Alt") : t("Invalid key");
        return;
      }
      stop();
      keyBtn.textContent = accelParts(r.accelerator).join(" + ");
      const res = await save({ [keyName]: r.accelerator });
      const ok = keyName === "hotkey" ? res?.hotkeyOk : keyName === "inlineHotkey" ? res?.inlineHotkeyOk : res?.hideHotkeyOk;
      if (res && ok === false) toast(t("Unavailable, the previous one was kept"));
    }

    keyBtn.addEventListener("click", () => {
      if (recording) return;
      recording = true;
      keyBtn.classList.add("recording");
      keyBtn.textContent = t("Press keys…");
      void Bridge.shortcutsSuspend(true);
      window.addEventListener("keydown", onKeyDown, true);
    });

    keyBtn.addEventListener("blur", () => {
      if (recording) stop();
    });

    return settingRow(label, hint, keyBtn);
  }

  function renderLanguages(): HTMLElement {
    const s = State.settings;
    const content = h("div", { class: "set-content-scroll" });

    content.append(
      h("div", {
        class: "set-banner",
        text: t("Text in your first language is translated into the second, and anything else into the first."),
      }),
    );

    const makeSelect = (current: string, onChange: (val: string) => void) => {
      const sel = enhanceSelect(h("select", { class: "set-select" }) as HTMLSelectElement);
      for (const l of languagesList) {
        sel.append(h("option", { value: l.code, text: `${l.native} (${l.code})` }));
      }
      sel.value = current;
      sel.addEventListener("change", () => onChange(sel.value));
      return sel;
    };

    content.append(
      section(
        t("Translation languages"),
        ICONS.swap,
        settingRow(
          t("My first language"),
          t("Your primary language (e.g. Persian)"),
          makeSelect(s.nativeLang, (v) => void save({ nativeLang: v })),
        ),
        settingRow(
          t("My second language"),
          t("Default translation target language"),
          makeSelect(s.secondLang, (v) => void save({ secondLang: v })),
        ),
      ),
    );

    return content;
  }

  function renderEngine(): HTMLElement {
    const s = State.settings;
    const a = s.aphra;
    const content = h("div", { class: "set-content-scroll" });
    const engineRows: HTMLElement[] = [];
    const connRows: HTMLElement[] = [];
    const styleRows: HTMLElement[] = [];

    // Default engine
    engineRows.push(
      settingRow(
        t("Default engine"),
        t("Choose default translation engine"),
        segmented(
          [
            { value: "google" as const, label: t("Fast (Free Google)") },
            { value: "aphra" as const, label: t("Smart (Arizo AI)") },
          ],
          s.defaultEngine === "aphra" ? "aphra" : "google",
          (val) => void save({ defaultEngine: val }),
        ),
      ),
    );

    // AI Provider preset
    const presetSelect = enhanceSelect(h("select", { class: "set-select" }) as HTMLSelectElement);
    for (const p of PROVIDERS) {
      presetSelect.append(h("option", { value: p.id, text: p.name }));
    }
    presetSelect.value = providerForUrl(a.baseUrl);

    const urlInput = h("input", {
      type: "text",
      class: "set-text-input ltr",
      value: a.baseUrl,
      placeholder: "https://…/v1",
      spellcheck: false,
    }) as HTMLInputElement;

    presetSelect.addEventListener("change", () => {
      // "Custom" is not a place to go to: it is what a hand-edited URL already is.
      if (presetSelect.value === "custom") {
        presetSelect.value = providerForUrl(urlInput.value);
        urlInput.focus();
        urlInput.select();
        return;
      }
      const next = applyPreset(presetSelect.value as ProviderId, { baseUrl: urlInput.value, model: "" });
      urlInput.value = next.baseUrl;
      customModelMode = false;
      modelStatusText = "";
      modelStatusOk = null;
      const providerModels = getAvailableModels(next.baseUrl);
      const chosenModel = next.model || (providerModels[0]?.id ?? "");
      void save({ aphra: { baseUrl: next.baseUrl, model: chosenModel } });
    });

    urlInput.addEventListener("change", () => {
      customModelMode = false;
      modelStatusText = "";
      modelStatusOk = null;
      void save({ aphra: { baseUrl: urlInput.value.trim() } });
    });

    connRows.push(
      settingRow(t("AI Provider"), t("Preset or custom OpenAI-compatible endpoint"), presetSelect),
      settingRow(t("Base URL"), t("Endpoint address"), urlInput),
    );

    // Available models for this endpoint (cached or popular preset)
    const availableModels = getAvailableModels(urlInput.value, a.model);
    const hasModels = availableModels.length > 0;

    const fetchModelsBtn = h("button", {
      type: "button",
      class: "btn secondary set-btn-action",
      text: isFetchingModels ? t("Loading…") : t("Fetch models"),
      onclick: async () => {
        if (isFetchingModels) return;
        isFetchingModels = true;
        modelStatusText = "";
        modelStatusOk = null;
        render();
        const reqUrl = urlInput.value.trim();
        try {
          const res = await Bridge.fetchModels({ baseUrl: reqUrl, model: a.model });
          if (res?.ok && res.models?.length) {
            saveCachedModels(reqUrl, res.models);
            modelStatusText = t("✓ {n} models loaded", { n: res.models.length });
            modelStatusOk = true;
            customModelMode = false;
            // The settings may have moved to another endpoint or model while the request ran.
            const cur = State.settings.aphra;
            if (cur.baseUrl.trim() === reqUrl && !res.models.some((m) => m.id === cur.model)) {
              void save({ aphra: { model: res.models[0].id } });
            }
          } else {
            modelStatusText = (res && !res.ok ? res.error : "") || t("Failed to fetch models");
            modelStatusOk = false;
          }
        } catch (e: any) {
          modelStatusText = e?.message || t("Error");
          modelStatusOk = false;
        } finally {
          isFetchingModels = false;
          render();
        }
      },
    }) as HTMLButtonElement;

    let modelControl: HTMLElement;

    if (!customModelMode && hasModels) {
      const modelSelect = enhanceSelect(h("select", { class: "set-select" }) as HTMLSelectElement);
      for (const m of availableModels) {
        modelSelect.append(h("option", { value: m.id, text: m.name }));
      }
      modelSelect.append(h("option", { value: "__custom__", text: `✎ ${t("Type custom model…")}` }));

      if (availableModels.some((m) => m.id === a.model)) {
        modelSelect.value = a.model;
      } else {
        modelSelect.value = availableModels[0]?.id ?? "";
      }

      modelSelect.addEventListener("change", () => {
        if (modelSelect.value === "__custom__") {
          customModelMode = true;
          render();
          return;
        }
        void save({ aphra: { model: modelSelect.value } });
      });

      const customBtn = h(
        "button",
        {
          type: "button",
          class: "set-icon-btn",
          title: t("Type custom model…"),
          onclick: () => {
            customModelMode = true;
            render();
          },
        },
        svg(ICONS.pen, 13, { stroke: 2 }),
      );

      modelControl = h("div", { class: "set-model-wrap" }, modelSelect, customBtn, fetchModelsBtn);
    } else {
      const modelInput = h("input", {
        type: "text",
        class: "set-text-input ltr",
        value: a.model,
        placeholder: "gemini-2.5-flash",
        spellcheck: false,
      }) as HTMLInputElement;

      modelInput.addEventListener("change", () => {
        void save({ aphra: { model: modelInput.value.trim() } });
      });

      const listBtn = hasModels
        ? h(
            "button",
            {
              type: "button",
              class: "set-icon-btn",
              title: t("Choose from list"),
              onclick: () => {
                customModelMode = false;
                render();
              },
            },
            svg(ICONS.list, 13, { stroke: 2 }),
          )
        : null;

      modelControl = h("div", { class: "set-model-wrap" }, modelInput, listBtn, fetchModelsBtn);
    }

    const modelRow = settingRow(t("Model name"), t("LLM model name (e.g. gemini-3.8-flash)"), modelControl);
    if (modelStatusText) {
      const badge = h("span", {
        class: `set-model-badge ${modelStatusOk === true ? "ok" : modelStatusOk === false ? "err" : ""}`,
        text: modelStatusText,
      });
      const textCol = modelRow.querySelector(".set-row-text");
      if (textCol) textCol.append(badge);
    }
    connRows.push(modelRow);

    // API key: one field with the eye inside, a status dot, and context actions.
    let keyRevealed = false;
    const keyInput = h("input", {
      type: "password",
      class: "set-key-input ltr",
      autocomplete: "off",
      spellcheck: false,
      placeholder: a.hasApiKey ? "••••••••••••••••" : t("API key (sk-...)"),
    }) as HTMLInputElement;

    const eyeBtn = h(
      "button",
      {
        type: "button",
        class: "set-key-eye",
        title: t("Show or hide the key"),
        onclick: () => {
          keyRevealed = !keyRevealed;
          keyInput.type = keyRevealed ? "text" : "password";
          clear(eyeBtn);
          eyeBtn.append(svg(keyRevealed ? ICONS.eyeOff : ICONS.eye, 14, { stroke: 2 }));
        },
      },
      svg(ICONS.eye, 14, { stroke: 2 }),
    );

    const saveKeyBtn = h(
      "button",
      {
        type: "button",
        class: "set-key-save",
        title: t("Save key"),
        onclick: async () => {
          const val = keyInput.value.trim();
          if (!val) return;
          const res = await save({}, { apiKey: val });
          if (res?.ok !== false) keyInput.value = "";
        },
      },
      svg(ICONS.check, 13, { stroke: 2.4 }),
      h("span", { text: t("Save key") }),
    ) as HTMLButtonElement;

    const removeKeyBtn = a.hasApiKey
      ? h(
          "button",
          {
            type: "button",
            class: "set-key-remove",
            title: t("Remove key"),
            onclick: async () => {
              await save({}, { clearApiKey: true });
              keyInput.value = "";
            },
          },
          svg(ICONS.trash, 13, { stroke: 2 }),
        )
      : null;

    const syncKeyState = () => {
      const has = keyInput.value.trim().length > 0;
      saveKeyBtn.classList.toggle("show", has);
    };
    keyInput.addEventListener("input", syncKeyState);
    keyInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveKeyBtn.click();
    });

    const keyStatus = h(
      "span",
      { class: `set-key-status ${a.hasApiKey ? "ok" : "none"}` },
      h("i"),
      h("span", { text: a.hasApiKey ? t("Key is saved (stored in Windows)") : t("No key yet") }),
    );

    const keyField = h("div", { class: "set-key-field" }, svg(ICONS.key, 13, { stroke: 2 }), keyInput, eyeBtn);
    const keyActions = h("div", { class: "set-key-wrap" }, keyField, saveKeyBtn, removeKeyBtn);
    const keyRow = settingRow(t("API Key"), t("Saved securely in Windows Credential Manager"), keyActions);
    keyRow.classList.add("set-row-stack");
    keyRow.querySelector(".set-row-text")?.append(keyStatus);
    connRows.push(keyRow);

    // Tone selector
    const toneSelect = enhanceSelect(h("select", { class: "set-select" }) as HTMLSelectElement);
    const TONES: { id: Tone; label: string }[] = [
      { id: "auto", label: t("Natural & idiomatic (Auto)") },
      { id: "formal", label: t("Formal & polite (رسمی)") },
      { id: "colloquial", label: t("Casual & colloquial (محاوره‌ای)") },
      { id: "technical", label: t("Technical & scientific (علمی و فنی)") },
      { id: "literary", label: t("Literary & eloquent (ادبی)") },
    ];
    for (const tn of TONES) toneSelect.append(h("option", { value: tn.id, text: tn.label }));
    toneSelect.value = a.tone;
    toneSelect.addEventListener("change", () => {
      void save({ aphra: { tone: toneSelect.value as Tone } });
    });

    styleRows.push(settingRow(t("Translation Tone"), t("Nuance and style control"), toneSelect));

    // Idiom breakdown toggle
    styleRows.push(
      settingRow(
        t("Idiom breakdown"),
        t("Show cultural notes and expression breakdown"),
        toggle(a.showBreakdown, (val) => void save({ aphra: { showBreakdown: val } })),
      ),
    );

    // Test connection button
    const testBtn = h("button", {
      type: "button",
      class: "btn secondary set-btn-action",
      text: isTesting ? t("Testing…") : t("Test connection"),
      onclick: async () => {
        if (isTesting) return;
        isTesting = true;
        testResultText = t("Testing connection…");
        testResultOk = null;
        render();
        try {
          const res = await Bridge.testAi({ baseUrl: urlInput.value.trim(), model: a.model.trim() });
          if (res?.ok) {
            testResultText = t("✓ Connected in {ms}ms ({model})", { ms: res.ms, model: res.model });
            testResultOk = true;
          } else {
            testResultText = res?.error || t("Connection failed");
            testResultOk = false;
          }
        } catch (e: any) {
          testResultText = e?.message || t("Error");
          testResultOk = false;
        } finally {
          isTesting = false;
          render();
        }
      },
    });

    const testWrap = h("div", { class: "set-test-wrap" }, testBtn);
    if (testResultText) {
      testWrap.append(
        h("span", {
          class: `set-test-badge ${testResultOk === true ? "ok" : testResultOk === false ? "err" : ""}`,
          text: testResultText,
        }),
      );
    }

    connRows.push(settingRow(t("Test connection"), t("Verify API credentials"), testWrap));

    content.append(
      section(t("Engine"), ICONS.bolt, ...engineRows),
      section(t("Connection"), ICONS.key, ...connRows),
      section(t("Translation style"), ICONS.pen, ...styleRows),
    );
    return content;
  }

  function renderSoundAndTimer(): HTMLElement {
    const s = State.settings;
    const content = h("div", { class: "set-content-scroll" });

    // Sound toggle
    const soundRow = settingRow(
      t("Sound effects"),
      t("Play subtle audio feedback on actions"),
      toggle(s.soundEnabled, () => actions.toggleSound()),
    );

    // Volume slider
    const volInput = h("input", {
      type: "range",
      min: "0",
      max: "1.0",
      step: "0.05",
      class: "set-range",
      value: String(s.soundVolume),
    }) as HTMLInputElement;
    // Saving rebuilds the view, so the drag only previews; the value is stored on release.
    volInput.addEventListener("input", () => {
      actions.previewVolume(Number(volInput.value));
    });
    volInput.addEventListener("change", () => {
      actions.setVolume(Number(volInput.value));
    });

    const volRow = dependsOn(settingRow(t("Sound volume"), t("Adjust audio loudness"), volInput), s.soundEnabled);
    content.append(section(t("Sound"), ICONS.speakerOn, soundRow, volRow));

    // Auto-close interval
    content.append(
      section(t("Timer"), ICONS.timer, settingRow(
        t("Auto-close timer"),
        t("Seconds before inactive island folds back to compact"),
        segmented(
          [
            { value: "10", label: "10s" },
            { value: "15", label: "15s" },
            { value: "30", label: "30s" },
          ],
          String(Math.round(s.autoCloseInterval)),
          (val) => actions.setAutoClose(Number(val)),
        ),
      )),
    );

    return content;
  }

  function renderWardrobe(): HTMLElement {
    const content = h("div", { class: "set-content-scroll" });

    content.append(
      h("div", {
        class: "set-banner",
        text: t("Customize Ari's look! Select a hat or seasonal outfit:"),
      }),
    );

    const grid = h("div", { class: "set-wardrobe-grid" });
    const current = parseOutfit(State.settings.ariOutfit);
    const season = seasonalOutfit(new Date());
    const ICON_SIZE = 34;

    for (const sel of OUTFIT_SELECTIONS) {
      const canvas = h("canvas") as HTMLCanvasElement;
      const btn = h(
        "button",
        {
          class: `set-wardrobe-item ${sel === current ? "on" : ""}`,
          type: "button",
          title: tl(OUTFIT_KEYS[sel]),
          onclick: () => {
            actions.chooseOutfit(sel);
            actions.previewOutfit(null);
            render();
          },
        },
        canvas,
        h("span", { class: "set-outfit-lbl", text: tl(OUTFIT_KEYS[sel]) }),
      );

      btn.addEventListener("mouseenter", () => {
        actions.previewOutfit(resolveOutfit(sel, new Date()));
      });
      btn.addEventListener("mouseleave", () => {
        actions.previewOutfit(null);
      });

      // Draw outfit icon on canvas
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(ICON_SIZE * dpr);
      canvas.height = Math.round(ICON_SIZE * dpr);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawWardrobeIcon(ctx, ICON_SIZE, sel, season, "AUTO");
      }

      grid.append(btn);
    }

    content.append(section(t("Wardrobe"), ICONS.star, grid));
    return content;
  }

  function render() {
    // Update active tab buttons and labels
    for (const [cat, item] of tabButtons) {
      item.btn.classList.toggle("on", cat === activeTab);
      const tabDef = tabs.find((t) => t.id === cat);
      if (tabDef) item.span.textContent = t(tabDef.labelKey);
    }

    clear(bodyEl);
    requestAnimationFrame(moveGlass);

    switch (activeTab) {
      case "general":
        bodyEl.append(renderGeneral());
        break;
      case "look":
        bodyEl.append(buildLookSettings(actions, { section, settingRow, toggle }));
        break;
      case "shortcuts":
        bodyEl.append(renderShortcuts());
        break;
      case "languages":
        bodyEl.append(renderLanguages());
        break;
      case "engine":
        bodyEl.append(renderEngine());
        break;
      case "sound":
        bodyEl.append(renderSoundAndTimer());
        break;
      case "wardrobe":
        bodyEl.append(renderWardrobe());
        break;
    }
  }

  async function loadLanguages() {
    if (loaded) return;
    try {
      languagesList = (await Bridge.getLanguages()) ?? [];
      loaded = true;
      if (activeTab === "languages") render();
    } catch {}
  }

  /**
   * What the panel shows, as one string. The island calls sync() on every state
   * change (an outfit hover, the mouse, a toast…): rebuilding the panel for each
   * of those replaced the tile under the pointer between press and release, so a
   * click never landed, and wiped a key typed but not yet saved.
   */
  let drawn = "";
  // A look slider being dragged is previewed on the island but is not part of what the panel
  // shows: redrawing it mid-drag would replace the slider under the pointer.
  const signature = () =>
    JSON.stringify([language(), State.settings, loaded, new Date().toDateString()]);

  return {
    el,
    sync() {
      void loadLanguages();
      // A look slider is being dragged: the island shows the preview, the panel stays as it is,
      // or the slider under the pointer would be replaced and letting go would save nothing.
      if (State.lookPreview) return;
      const next = signature();
      if (next === drawn) return;
      drawn = next;
      render();
    },
  };
}
