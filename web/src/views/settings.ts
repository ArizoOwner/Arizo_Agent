// Integrated in-island Settings view: General, Shortcuts, Languages, AI Engine, Sound & Timer, Wardrobe.
// Everything is responsive, neatly organized in category tabs, and saved immediately via Bridge.

import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { card } from "./parts";
import { enhanceSelect } from "./select";
import { applyTheme } from "../core/theme";
import { Bridge, type Language as Lang } from "../core/bridge";
import { recordKey, accelParts } from "../core/hotkey";
import { PROVIDERS, applyPreset, providerForUrl, type ProviderId } from "../core/providers";
import { State, mergeSettings, type SettingsPatch, type Tone } from "../core/state";
import { language, resolveLanguage, setLanguage, t, tl } from "../i18n/i18n";
import { OUTFIT_SELECTIONS, OUTFIT_KEYS, parseOutfit, resolveOutfit, seasonalOutfit } from "../ari/wardrobe";
import { drawWardrobeIcon } from "../ari/outfits";
import type { ViewActions, ViewHost } from "./views";

type Category = "general" | "shortcuts" | "languages" | "engine" | "sound" | "wardrobe";

export function buildSettingsView(actions: ViewActions): ViewHost {
  let activeTab: Category = "general";
  let languagesList: Lang[] = [];
  let loaded = false;
  let testResultText = "";
  let testResultOk: boolean | null = null;
  let isTesting = false;
  let isFetchingModels = false;

  const tabs: { id: Category; labelKey: string; icon: string }[] = [
    { id: "general", labelKey: "General", icon: ICONS.gear },
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
      { class: "settings-nav-btn", type: "button", onclick: () => switchTab(tab.id) },
      svg(tab.icon, 13, { stroke: 2 }),
      span,
    ) as HTMLButtonElement;
    tabButtons.set(tab.id, { btn, span });
    navBar.append(btn);
  }

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
  }

  // ── Helper controls ─────────────────────────────────────────────────────────

  function toggle(on: boolean, onChange: (v: boolean) => void): HTMLElement {
    const sw = h("button", { class: on ? "switch on" : "switch", type: "button" });
    sw.addEventListener("click", () => {
      const next = !sw.classList.contains("on");
      sw.classList.toggle("on", next);
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
    return h("div", { class: "set-row" }, left, control, extra ?? null);
  }

  // ── Render Category Content ─────────────────────────────────────────────────

  function renderGeneral(): HTMLElement {
    const s = State.settings;
    const content = h("div", { class: "set-content-scroll" });

    // 1. Language
    content.append(
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
    content.append(
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
    content.append(
      settingRow(
        t("Launch at startup"),
        t("Start silently in tray with Windows"),
        toggle(s.launchAtStartup, (val) => void save({ launchAtStartup: val })),
      ),
    );

    // 4. Hide on blur
    content.append(
      settingRow(
        t("Hide when I click elsewhere"),
        t("Automatically collapse island when clicking other windows"),
        toggle(s.hideOnBlur, (val) => void save({ hideOnBlur: val })),
      ),
    );

    // 5. Floating bubble
    content.append(
      settingRow(
        t("Floating bubble"),
        t("A small button near selected text in any app"),
        toggle(s.showFloatingBubble, (val) => void save({ showFloatingBubble: val })),
      ),
    );

    // 6. Auto-copy
    content.append(
      settingRow(
        t("Copy automatically"),
        t("Copy translated text to clipboard immediately"),
        toggle(s.autoCopy, (val) => void save({ autoCopy: val })),
      ),
    );

    // 7. Restore clipboard
    content.append(
      settingRow(
        t("Restore the clipboard after replacing"),
        t("Restore previous clipboard content after in-place translation"),
        toggle(s.restoreClipboard, (val) => void save({ restoreClipboard: val })),
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

    content.append(
      settingRow(
        t("Save history"),
        t("Keep past translations saved locally"),
        toggle(s.saveHistory, (val) => void save({ saveHistory: val })),
        h("div", { class: "set-subrow" }, limitInput, h("span", { class: "set-hint", text: t("translations kept") })),
      ),
    );

    return content;
  }

  function renderShortcuts(): HTMLElement {
    const s = State.settings;
    const content = h("div", { class: "set-content-scroll" });

    content.append(
      h("div", { class: "set-banner", text: t("Work from any app. Click a shortcut, then press the new keys. Esc cancels.") }),
    );

    // Island hotkey
    content.append(makeHotkeyRow(t("Translate the selection"), t("Opens the island with selected text"), "hotkey", s.hotkey));

    // In-place hotkey
    content.append(makeHotkeyRow(t("Translate in place"), t("Replaces text directly in chat or apps"), "inlineHotkey", s.inlineHotkey));

    // Hide completely
    content.append(makeHotkeyRow(t("Hide the island completely"), t("Press again to bring it back; works while folded too"), "hideHotkey", s.hideHotkey));

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
        keyBtn.textContent = r.reason === "needsModifier" ? t("Hold Ctrl, Alt or Shift") : t("Invalid key");
        return;
      }
      stop();
      keyBtn.textContent = accelParts(r.accelerator).join(" + ");
      await save({ [keyName]: r.accelerator });
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
      settingRow(
        t("My first language"),
        t("Your primary language (e.g. Persian)"),
        makeSelect(s.nativeLang, (v) => void save({ nativeLang: v })),
      ),
    );

    content.append(
      settingRow(
        t("My second language"),
        t("Default translation target language"),
        makeSelect(s.secondLang, (v) => void save({ secondLang: v })),
      ),
    );

    return content;
  }

  function renderEngine(): HTMLElement {
    const s = State.settings;
    const a = s.aphra;
    const content = h("div", { class: "set-content-scroll" });

    // Default engine
    content.append(
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

    const modelInput = h("input", {
      type: "text",
      class: "set-text-input ltr",
      value: a.model,
      placeholder: "gemini-3.8-flash",
      spellcheck: false,
    }) as HTMLInputElement;

    presetSelect.addEventListener("change", () => {
      const next = applyPreset(presetSelect.value as ProviderId, { baseUrl: urlInput.value, model: modelInput.value });
      urlInput.value = next.baseUrl;
      modelInput.value = next.model;
      void save({ aphra: { baseUrl: next.baseUrl, model: next.model } });
    });

    urlInput.addEventListener("change", () => {
      void save({ aphra: { baseUrl: urlInput.value.trim() } });
    });
    modelInput.addEventListener("change", () => {
      void save({ aphra: { model: modelInput.value.trim() } });
    });

    content.append(
      settingRow(t("AI Provider"), t("Preset or custom OpenAI-compatible endpoint"), presetSelect),
    );

    content.append(
      settingRow(t("Base URL"), t("Endpoint address"), urlInput),
    );

    // Fetch models button + model input
    const fetchModelsBtn = h("button", {
      type: "button",
      class: "btn secondary set-btn-action",
      text: isFetchingModels ? t("Loading…") : t("Fetch models"),
      onclick: async () => {
        if (isFetchingModels) return;
        isFetchingModels = true;
        fetchModelsBtn.textContent = t("Loading…");
        try {
          const res = await Bridge.fetchModels({ baseUrl: urlInput.value.trim(), model: modelInput.value.trim() });
          if (res?.ok && res.models?.length) {
            testResultText = t("✓ {n} models loaded", { n: res.models.length });
            testResultOk = true;
          } else {
            testResultText = (res && !res.ok ? res.error : "") || t("Failed to fetch models");
            testResultOk = false;
          }
        } catch (e: any) {
          testResultText = e?.message || t("Error");
          testResultOk = false;
        } finally {
          isFetchingModels = false;
          render();
        }
      },
    });

    content.append(
      settingRow(t("Model name"), t("LLM model name (e.g. gemini-3.8-flash)"), modelInput, fetchModelsBtn),
    );

    // API Key input with eye & save & remove
    let keyRevealed = false;
    const keyInput = h("input", {
      type: "password",
      class: "set-text-input ltr",
      autocomplete: "off",
      spellcheck: false,
      placeholder: a.hasApiKey ? t("Key is saved (stored in Windows)") : t("API key (sk-...)"),
    }) as HTMLInputElement;

    const eyeBtn = h(
      "button",
      {
        type: "button",
        class: "set-icon-btn",
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

    const saveKeyBtn = h("button", {
      type: "button",
      class: "btn primary set-btn-action",
      text: t("Save key"),
      onclick: async () => {
        const val = keyInput.value.trim();
        if (!val) return;
        await save({}, { apiKey: val });
        keyInput.value = "";
      },
    });

    const removeKeyBtn = h("button", {
      type: "button",
      class: "btn secondary danger set-btn-action",
      text: t("Remove key"),
      style: a.hasApiKey ? "" : "display:none",
      onclick: async () => {
        await save({}, { clearApiKey: true });
        keyInput.value = "";
      },
    });

    const keyActions = h("div", { class: "set-key-wrap" }, keyInput, eyeBtn, saveKeyBtn, removeKeyBtn);
    content.append(
      settingRow(t("API Key"), t("Saved securely in Windows Credential Manager"), keyActions),
    );

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

    content.append(settingRow(t("Translation Tone"), t("Nuance and style control"), toneSelect));

    // Idiom breakdown toggle
    content.append(
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
          const res = await Bridge.testAi({ baseUrl: urlInput.value.trim(), model: modelInput.value.trim() });
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

    content.append(settingRow(t("Test connection"), t("Verify API credentials"), testWrap));

    return content;
  }

  function renderSoundAndTimer(): HTMLElement {
    const s = State.settings;
    const content = h("div", { class: "set-content-scroll" });

    // Sound toggle
    content.append(
      settingRow(
        t("Sound effects"),
        t("Play subtle audio feedback on actions"),
        toggle(s.soundEnabled, () => actions.toggleSound()),
      ),
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
    volInput.addEventListener("input", () => {
      actions.setVolume(Number(volInput.value));
    });

    content.append(settingRow(t("Sound volume"), t("Adjust audio loudness"), volInput));

    // Auto-close interval
    content.append(
      settingRow(
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
      ),
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

    content.append(grid);
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

    switch (activeTab) {
      case "general":
        bodyEl.append(renderGeneral());
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
  const signature = () =>
    JSON.stringify([language(), State.settings, loaded, new Date().toDateString()]);

  return {
    el,
    sync() {
      void loadLanguages();
      const next = signature();
      if (next === drawn) return;
      drawn = next;
      render();
    },
  };
}
