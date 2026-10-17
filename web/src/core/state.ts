// App state: what the island needs to know, and nothing else.

import { TRANSLATE_MIN_H, TRANSLATE_MIN_W, type BotEmoteName, type BotStateName, type IslandMode, type IslandViewName } from "./layout";
import type { EyeShape } from "../ari/engine";
import { DEFAULT_ENGINE, PILLS, parseEngine, pillState, type Engine, type EnginePillId } from "./pills";
import { DEFAULT_OUTFIT, type Outfit } from "../ari/wardrobe";

export type Theme = "dark" | "light" | "system";
export type AppLanguage = "fa" | "en";
export type Tone = "auto" | "formal" | "colloquial" | "technical" | "literary";

export interface AphraSettings {
  baseUrl: string;
  model: string;
  tone: Tone;
  showBreakdown: boolean;
  /** The page never receives the key: only whether one is stored. */
  hasApiKey: boolean;
}

/** The public settings, exactly as the backend sends them. */
export interface Settings {
  theme: Theme;
  appLanguage: AppLanguage;
  hotkey: string;
  inlineHotkey: string;
  /** Hides the island completely, capsule included; pressed again it comes back. */
  hideHotkey: string;
  showFloatingBubble: boolean;
  defaultEngine: Engine;
  autoCopy: boolean;
  restoreClipboard: boolean;
  hideOnBlur: boolean;
  launchAtStartup: boolean;
  saveHistory: boolean;
  historyLimit: number;
  nativeLang: string;
  secondLang: string;
  /** "primary", "cursor", or `at:<x>,<y>` for one display (logical origin). */
  screen: string;
  soundEnabled: boolean;
  soundVolume: number;
  spotifyEnabled: boolean;
  /** The public client id of the user's Spotify developer app (no secret is ever stored). */
  spotifyClientId: string;
  /** The football page: live score, fixtures and the goal celebration. */
  footballEnabled: boolean;
  /** Ari wears the favourite team's kit while it plays. */
  footballKit: boolean;
  /** ESPN id and name of the favourite team ("" until one is chosen). */
  footballTeamId: string;
  footballTeamName: string;
  autoCloseInterval: number;
  /** Ari's outfit: "auto" (dresses for the season), "none" or an outfit id. */
  ariOutfit: string;
  /** Kept for the backend; the interface language is `appLanguage`. */
  language: string;
  aphra: AphraSettings;
}

export const DEFAULT_APHRA: AphraSettings = {
  baseUrl: "https://openrouter.ai/api/v1",
  model: "deepseek/deepseek-chat",
  tone: "auto",
  showBreakdown: true,
  hasApiKey: false,
};

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  appLanguage: "fa",
  hotkey: "Alt+D",
  inlineHotkey: "Alt+Shift+D",
  hideHotkey: "Alt+Shift+H",
  showFloatingBubble: true,
  defaultEngine: DEFAULT_ENGINE,
  autoCopy: false,
  restoreClipboard: true,
  hideOnBlur: false,
  launchAtStartup: false,
  saveHistory: true,
  historyLimit: 100,
  nativeLang: "fa",
  secondLang: "en",
  screen: "primary",
  soundEnabled: true,
  soundVolume: 0.5,
  spotifyEnabled: true,
  spotifyClientId: "",
  footballEnabled: true,
  footballKit: true,
  footballTeamId: "",
  footballTeamName: "",
  autoCloseInterval: 15,
  ariOutfit: DEFAULT_OUTFIT,
  language: "",
  aphra: DEFAULT_APHRA,
};

/** A partial save: any setting, and any part of the AI settings. */
export type SettingsPatch = Omit<Partial<Settings>, "aphra"> & { aphra?: Partial<AphraSettings> };

/** Merges what the backend sent into a full settings object (aphra is nested). */
export function mergeSettings(base: Settings, incoming: SettingsPatch | null | undefined): Settings {
  if (!incoming) return base;
  return { ...base, ...incoming, aphra: { ...base.aphra, ...(incoming.aphra ?? {}) } };
}

/** One engine pill: the mini Ari it wears follows `state`. */
export interface PillTask {
  id: EnginePillId;
  name: string;
  color: string;
  state: BotStateName;
  emote?: BotEmoteName | null;
  miniEye?: EyeShape | null;
}

type Listener = () => void;

class AppState {
  mode: IslandMode = "hidden";
  view: IslandViewName = "translate";

  /** The selected engine; its pill is the focused one. */
  engine: Engine = DEFAULT_ENGINE;
  /** The engine a request is running on, null when none is. */
  working: Engine | null = null;
  tasks: PillTask[] = PILLS.map((p) => ({
    id: p.id, name: p.name, color: p.color, state: "idle" as BotStateName,
  }));

  /** What Ari feels: thinking while translating, finished or error after. */
  botState: BotStateName = "idle";

  /** Cursor in logical screen pixels, origin top-left. */
  mouse = { x: 0, y: 0 };
  /** Cursor relative to the island's top-left corner. */
  mouseInIsland = { x: 0, y: 0 };

  /** Height of the translate view: it grows with the text typed in it. */
  translateH = TRANSLATE_MIN_H;
  /** Width of the translate view: follows the text (see translateWidth). */
  translateW = TRANSLATE_MIN_W;

  isPinned = false;
  noteMessage: string | null = null;
  /** The last translation, one line, for the compact capsule. */
  compactPreview = "";

  /** Outfit shown on Ari while the pointer rests on a wardrobe button. */
  wardrobePreview: Outfit | null = null;

  lastActivity = performance.now();
  settings: Settings = { ...DEFAULT_SETTINGS };

  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Marks the UI dirty; the island re-renders on the next frame. */
  notify() {
    for (const fn of this.listeners) fn();
  }

  get focusId(): EnginePillId {
    return PILLS.find((p) => p.engine === this.engine)!.id;
  }

  get effectiveState(): BotStateName {
    return this.botState;
  }

  setEngine(engine: Engine) {
    this.engine = parseEngine(engine);
    this.syncPills();
    this.notify();
  }

  /** Aligns the pills' mini Aris with the engine at work. */
  syncPills() {
    for (const t of this.tasks) {
      const def = PILLS.find((p) => p.id === t.id)!;
      t.state = pillState(def.engine, this.working);
    }
  }

  defaultView(): IslandViewName {
    return "translate";
  }
}

export const State = new AppState();
