// Thin wrapper over the Tauri commands/events. Every call is a no-op when the
// page is opened in a plain browser, so the island can be iterated on with
// `npm run dev` alone; there, a small in-memory backend (./mock.ts) answers
// instead, so the whole interface can be exercised and screenshotted.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Settings, SettingsPatch } from "./state";
import type { HistoryItem } from "./history-logic";
import type { SpotifyState } from "./spotify";
import type { FootballState, FootballTeamHit } from "./football";
import type { CryptoState } from "./crypto";
import { mockInvoke, mockListen } from "./mock";

export const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** No Tauri around: the in-memory backend answers (plain browser, `?mock=1`). */
export const IS_MOCK = !IS_TAURI && typeof window !== "undefined" && typeof document !== "undefined";

async function raw<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (IS_TAURI) return invoke<T>(cmd, args);
  return mockInvoke(cmd, args) as Promise<T>;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!IS_TAURI && !IS_MOCK) return null;
  try {
    return await raw<T>(cmd, args);
  } catch (err) {
    console.error(`[arizo] ${cmd} failed`, err);
    return null;
  }
}

/** Same as `call`, but surfaces the error so the UI can show what went wrong. */
async function callOrThrow<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!IS_TAURI && !IS_MOCK) throw new Error("not running inside Arizo");
  return raw<T>(cmd, args);
}

export interface BootInfo {
  settings: Settings;
  /** Logical screen rect of the monitor the island lives on. */
  screen: { x: number; y: number; width: number; height: number; scale: number };
  version: string;
  /** False where the OS has no global cursor: see Island.followPageCursor. */
  cursorPoll: boolean;
}

export interface Language {
  code: string;
  name: string;
  native: string;
  rtl: boolean;
}

export interface TranslateParams {
  requestId: number;
  text: string;
  engine: "google" | "aphra";
  tone?: string;
  targetLang: string;
}

export interface Alternative {
  pos: string;
  terms: string[];
}

export interface BreakdownItem {
  term: string;
  meaning: string;
  explanation: string;
}

export interface TranslateData {
  translation: string;
  translit: string;
  alternatives: Alternative[];
  detectedLang: string;
  targetLang: string;
  breakdown: BreakdownItem[];
  variants: string[];
  critiqueNotes: string;
  toneUsed: string;
  engine: string;
}

export interface TranslateWarning {
  code: string;
  message: string;
}

export interface TranslateResult {
  requestId: number;
  success: boolean;
  cached: boolean;
  aborted: boolean;
  warning: TranslateWarning | null;
  data: TranslateData | null;
  error: string;
  errorCode: string;
}

export interface AiConfig {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

export type TestAiResult = { ok: true; ms: number; model: string } | { ok: false; error: string };

export interface ModelInfo {
  id: string;
  displayName: string;
}

export type FetchModelsResult = { ok: true; models: ModelInfo[] } | { ok: false; error: string };

export interface SaveResult {
  ok: boolean;
  hotkeyOk: boolean;
  inlineHotkeyOk: boolean;
  hideHotkeyOk: boolean;
  settings: Settings;
}

export interface SaveOptions {
  /** Sent once; the page never gets it back. */
  apiKey?: string;
  clearApiKey?: boolean;
}

export const Bridge = {
  boot: () => call<BootInfo>("boot"),
  /** The system's languages as the webview sees them, for the backend's own texts. */
  setSystemLanguages: (languages: string[]) => call<void>("set_system_languages", { languages }),

  getSettings: () => call<Settings>("get_settings"),
  /** Saves; the answer says whether each shortcut could be registered. */
  saveSettings: (settings: SettingsPatch, opts: SaveOptions = {}) =>
    call<SaveResult>("save_settings", { settings, ...opts }),

  /** The room the island needs (logical px): the window grows past its default for a wider or taller island. */
  setPanelSize: (width: number, height: number) => call<void>("set_panel_size", { width, height }),

  /** Shrink the window down to the invisible wake strip (hidden) or back to full. */
  setCollapsed: (collapsed: boolean) => call<void>("set_collapsed", { collapsed }),

  /**
   * Pushes the island shape in window coordinates. The backend flips click-through
   * from its own cursor poll, so the flag is never a frame behind a click.
   */
  setIslandRect: (x: number, y: number, width: number, height: number) =>
    call<void>("set_island_rect", { x, y, width, height }),

  /** Give the window keyboard focus (a text field) and take it away again. */
  focusWindow: (focused: boolean) => call<void>("focus_window", { focused }),

  reposition: () => call<void>("reposition"),

  /** Displays the island can be pinned to: `key` is what `settings.screen` stores. */
  listMonitors: () => call<{ key: string; label: string }[]>("list_monitors"),

  openUrl: (url: string) => call<void>("open_url", { url }),
  quit: () => call<void>("quit_app"),
  openSettingsWindow: () => call<void>("open_settings_window"),

  /** Writes to the log file, next to the backend's own lines. */
  log: (message: string) => call<void>("log_line", { message }),

  // ── Translation ───────────────────────────────────────────────────────────
  getLanguages: () => call<Language[]>("get_languages"),
  /** Rejects with the backend's message when the call itself fails. */
  translate: (params: TranslateParams) => callOrThrow<TranslateResult>("translate", { params }),
  translateCancel: (requestId: number) => call<void>("translate_cancel", { requestId }),
  /** Base64 mp3 of the text read aloud. */
  tts: (text: string, lang: string) => call<{ ok: boolean; audio?: string }>("tts", { text, lang }),
  testAi: (cfg: AiConfig) => callOrThrow<TestAiResult>("test_ai", { cfg }),
  fetchModels: (cfg: AiConfig) => callOrThrow<FetchModelsResult>("fetch_models", { cfg }),

  // ── Local Spotify player ──────────────────────────────────────────────────
  spotifyRefresh: () => call<SpotifyState>("spotify_refresh"),
  /** Rejects with the backend's short error code (see ERROR_TEXT in core/spotify.ts). */
  spotifyControl: (action: string, value?: number) => callOrThrow<boolean>("spotify_control", { action, value }),
  spotifyOpen: () => call<boolean>("spotify_open"),
  spotifyInstalled: () => call<boolean>("spotify_installed"),
  /** Opens the browser for the account approval; resolves when it is done. Rejects with a code. */
  spotifyConnect: () => callOrThrow<boolean>("spotify_connect"),
  spotifyCancelConnect: () => call<void>("spotify_cancel_connect"),
  spotifyDisconnect: () => call<boolean>("spotify_disconnect"),
  /** The address to register in the Spotify developer dashboard. */
  spotifyRedirectUri: () => call<string>("spotify_redirect_uri"),

  // ── Football ──────────────────────────────────────────────────────────────
  footballRefresh: () => call<FootballState>("football_refresh"),
  footballSearch: (query: string) => callOrThrow<FootballTeamHit[]>("football_search", { query }),
  /** A crest as a data URL, or null when there is none. */
  footballLogo: (id: string) => call<string | null>("football_logo", { id }),

  // ── Crypto ────────────────────────────────────────────────────────────────
  cryptoState: () => call<CryptoState>("crypto_state"),
  /** Checks the credentials with the exchange; rejects with a short code (see CRYPTO_ERRORS). */
  cryptoConnect: (provider: string, token: string, secret?: string) =>
    callOrThrow<CryptoState>("crypto_connect", { provider, token, secret: secret ?? null }),
  /** Forgets the stored credentials of the exchange in use. */
  cryptoDisconnect: () => callOrThrow<CryptoState>("crypto_disconnect"),
  cryptoSelect: (asset: string, quote: string) => callOrThrow<CryptoState>("crypto_select", { asset, quote }),
  cryptoSetTimeframe: (timeframe: string) => callOrThrow<CryptoState>("crypto_set_timeframe", { timeframe }),
  /** Whether the crypto section is on screen: nothing is read while it is not. */
  cryptoActive: (active: boolean) => call<void>("crypto_active", { active }),

  // ── Muse (muse.ai in a child webview, src-tauri/src/muse.rs) ────────────────
  museShow: (r: { x: number; y: number; width: number; height: number }) => callOrThrow<void>("muse_show", r),
  museHide: () => call<void>("muse_hide"),
  museFocus: () => call<void>("muse_focus"),
  museReload: () => call<void>("muse_reload"),
  musePowerOff: () => call<void>("muse_power_off"),

  // ── History ───────────────────────────────────────────────────────────────
  getHistory: () => call<HistoryItem[]>("get_history"),
  clearHistory: () => call<void>("clear_history"),
  deleteHistoryItem: (id: string) => call<void>("delete_history_item", { id }),
  toggleFavoriteItem: (id: string) => call<void>("toggle_favorite_item", { id }),

  // ── Clipboard and the app in front ────────────────────────────────────────
  copyText: (text: string) => call<boolean>("copy_text", { text }),
  readClipboardText: () => call<string>("read_clipboard_text"),
  /** Pastes the translation over the selection in the app that was in front. */
  replaceText: (text: string) => call<void>("replace_text", { text }),
  captureSelectedText: () => call<string>("capture_selected_text"),

  // ── The bubble ────────────────────────────────────────────────────────────
  hideBubble: () => call<void>("hide_bubble_window"),
  setBubbleSize: (width: number, height: number) => call<void>("set_bubble_size", { width, height }),
  replaceBubbleText: (text: string) => call<void>("replace_bubble_text", { text }),
  openIslandWithText: (text: string) => call<void>("open_island_with_text", { text }),

  // ── Global shortcuts ──────────────────────────────────────────────────────
  /** Lets go of the global shortcuts while Settings records a new one. */
  shortcutsSuspend: (suspended: boolean) => call<void>("shortcuts_suspend", { suspended }),
};

export type BridgeEvent =
  | { name: "cursor"; payload: { x: number; y: number } }
  | { name: "tray"; payload: "open" | "settings" }
  | { name: "screen-changed"; payload: null }
  | { name: "settings-changed"; payload: Settings }
  | { name: "spotify"; payload: SpotifyState }
  | { name: "crypto"; payload: CryptoState }
  | { name: "captured-text"; payload: string }
  | { name: "toast"; payload: string }
  | { name: "translate-partial"; payload: { requestId: number; text: string } }
  | { name: "bubble-init"; payload: { text: string } }
  | { name: "bubble-hide"; payload: null };

export async function onEvent<T>(name: string, handler: (payload: T) => void) {
  if (IS_MOCK) return mockListen<T>(name, handler);
  if (!IS_TAURI) return () => {};
  return listen<T>(name, (e) => handler(e.payload));
}
