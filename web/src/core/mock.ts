// An in-memory stand-in for the backend, used when the page is opened in a plain
// browser (`npm run dev`, `?mock=1`): the whole interface can be exercised and
// screenshotted without the app. It is never reached inside the real window.

import { DEFAULT_SETTINGS, mergeSettings, type Settings, type SettingsPatch } from "./state";
import type { HistoryItem } from "./history-logic";
import { IDLE_SPOTIFY, withPlaying, type SpotifyState } from "./spotify";
import { autoTarget, detectLanguageClient } from "./text";

type Handler = (payload: unknown) => void;
const listeners = new Map<string, Set<Handler>>();

/** Fires an event the way the backend would (used by the dev hooks too). */
export function mockEmit(name: string, payload: unknown) {
  for (const h of listeners.get(name) ?? []) h(payload);
}

export function mockListen<T>(name: string, handler: (payload: T) => void): () => void {
  const set = listeners.get(name) ?? new Set<Handler>();
  set.add(handler as Handler);
  listeners.set(name, set);
  return () => set.delete(handler as Handler);
}

const LANGS = [
  ["fa", "Persian (Farsi)", "فارسی", true], ["en", "English", "English", false],
  ["ar", "Arabic", "العربية", true], ["tr", "Turkish", "Türkçe", false],
  ["de", "German", "Deutsch", false], ["fr", "French", "Français", false],
  ["es", "Spanish", "Español", false], ["it", "Italian", "Italiano", false],
  ["ru", "Russian", "Русский", false], ["zh-CN", "Chinese (Simplified)", "中文", false],
  ["ja", "Japanese", "日本語", false], ["ko", "Korean", "한국어", false],
] as const;

let settings: Settings = mergeSettings(DEFAULT_SETTINGS, { appLanguage: "en" });
let apiKeySet = false;
let spotify: SpotifyState = { ...IDLE_SPOTIFY, enabled: settings.spotifyEnabled };

/** Browser-only sample player; never talks to the real Spotify app. */
export function mockSpotify(state: Partial<SpotifyState>) {
  spotify = { ...spotify, ...state, enabled: settings.spotifyEnabled };
  mockEmit("spotify", spotify);
}

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
let history: HistoryItem[] = [
  { id: "h1", timestamp: ago(3), query: "Where is the nearest pharmacy?", translation: "نزدیک‌ترین داروخانه کجاست؟", detectedLang: "en", targetLang: "fa", engine: "google", favorite: true },
  { id: "h2", timestamp: ago(42), query: "می‌خوام یه قرار بذارم", translation: "I want to set up a meeting", detectedLang: "fa", targetLang: "en", engine: "aphra", favorite: false },
  { id: "h3", timestamp: ago(60 * 26), query: "It's raining cats and dogs", translation: "باران سیل‌آسا می‌بارد", detectedLang: "en", targetLang: "fa", engine: "aphra", favorite: true },
  { id: "h4", timestamp: ago(60 * 24 * 4), query: "Thank you very much", translation: "خیلی ممنون", detectedLang: "en", targetLang: "fa", engine: "google", favorite: false },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Params { requestId: number; text: string; engine: string; tone?: string; targetLang: string }

let newest = 0;

async function translate(p: Params) {
  newest = p.requestId;
  const detected = detectLanguageClient(p.text);
  const target = p.targetLang === "auto"
    ? autoTarget(detected, settings.nativeLang, settings.secondLang)
    : p.targetLang;
  const full = `[mock] ${p.text}`;
  // A few streamed partials, like the smart engine's tokens.
  const steps = 4;
  for (let i = 1; i <= steps; i++) {
    await sleep(100);
    if (newest !== p.requestId) {
      return { requestId: p.requestId, success: false, cached: false, aborted: true, warning: null, data: null, error: "", errorCode: "ABORTED" };
    }
    mockEmit("translate-partial", { requestId: p.requestId, text: full.slice(0, Math.ceil((full.length * i) / steps)) });
  }
  const smart = p.engine === "aphra";
  const warning = smart && !apiKeySet
    ? { code: "MISSING_API_KEY", message: "No key" }
    : null;
  const usedSmart = smart && !warning;
  const data = {
    translation: full,
    translit: target === "fa" ? "[mock] tarjome" : "",
    alternatives: [
      { pos: "noun", terms: ["[mock] one", "[mock] two", "[mock] three"] },
      { pos: "verb", terms: ["[mock] four"] },
    ],
    detectedLang: detected,
    targetLang: target,
    breakdown: usedSmart
      ? [
        { term: "raining cats and dogs", meaning: "باران شدید", explanation: "An English idiom for very heavy rain." },
        { term: "hold your horses", meaning: "کمی صبر کن", explanation: "Wait a moment before acting." },
      ]
      : [],
    variants: [],
    critiqueNotes: usedSmart ? "A natural, neutral tone was used." : "",
    toneUsed: p.tone ?? "auto",
    engine: usedSmart ? "aphra" : "google",
  };
  if (settings.saveHistory) {
    history = [{
      id: `m${Date.now()}`, timestamp: new Date().toISOString(), query: p.text, translation: full,
      detectedLang: detected, targetLang: target, engine: data.engine, favorite: false,
    }, ...history.filter((h) => h.query !== p.text)].slice(0, settings.historyLimit);
  }
  return { requestId: p.requestId, success: true, cached: false, aborted: false, warning, data, error: "", errorCode: "" };
}

export async function mockInvoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  switch (cmd) {
    case "boot":
      return {
        settings, version: "3.1.0", cursorPoll: false,
        screen: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
      };
    case "get_settings":
      return settings;
    case "save_settings": {
      settings = mergeSettings(settings, args.settings as SettingsPatch);
      if (typeof args.apiKey === "string" && args.apiKey) apiKeySet = true;
      if (args.clearApiKey === true) apiKeySet = false;
      settings = { ...settings, aphra: { ...settings.aphra, hasApiKey: apiKeySet } };
      if (!settings.spotifyEnabled) spotify = { ...IDLE_SPOTIFY };
      else spotify = { ...spotify, enabled: true };
      mockEmit("settings-changed", settings);
      mockEmit("spotify", spotify);
      return { ok: true, hotkeyOk: true, inlineHotkeyOk: true, hideHotkeyOk: true, settings };
    }
    case "spotify_refresh":
      return spotify;
    case "spotify_installed":
      return spotify.installed;
    case 'spotify_redirect_uri':
      return 'http://127.0.0.1:43821/callback';
    case 'spotify_connect': {
      const id = settings.spotifyClientId;
      if (!/^[A-Za-z0-9]{20,64}$/.test(id)) throw new Error('bad_client_id');
      spotify = { ...spotify, configured: true, connected: true, premium: true, accountName: 'Demo account', enabled: settings.spotifyEnabled };
      mockEmit('spotify', spotify);
      return true;
    }
    case 'spotify_cancel_connect':
      return null;
    case 'spotify_disconnect':
      spotify = { ...IDLE_SPOTIFY, enabled: settings.spotifyEnabled, configured: !!settings.spotifyClientId };
      mockEmit('spotify', spotify);
      return true;
    case "spotify_open":
      return true;
    case "spotify_control": {
      const local = spotify.source === 'local';
      if (!settings.spotifyEnabled || (!spotify.connected && !local)) throw new Error('not_connected');
      if (!spotify.running || !spotify.track || (!local && !spotify.premium)) throw new Error(local || spotify.premium ? 'no_device' : 'premium_required');
      const action = args.action as keyof SpotifyState["capabilities"];
      if (!spotify.capabilities[action]) throw new Error('bad_action');
      const value = Number(args.value);
      if (["seek", "volume", "shuffle", "repeat"].includes(action) && !Number.isFinite(value)) return false;
      if (action === "playPause") spotify = withPlaying(spotify, !spotify.playing, Date.now());
      else if (action === "seek") spotify = { ...spotify, position: Math.max(0, Math.min(value, spotify.track.duration)), positionAt: Date.now() };
      else if (action === "volume") spotify = { ...spotify, volume: Math.round(Math.max(0, Math.min(100, value))) };
      else if (action === "shuffle") spotify = { ...spotify, shuffle: value !== 0 };
      else if (action === "repeat") spotify = { ...spotify, repeat: value !== 0 };
      else spotify = { ...spotify, position: 0, positionAt: Date.now() };
      mockEmit("spotify", spotify);
      return true;
    }
    case "get_languages":
      return LANGS.map(([code, name, native, rtl]) => ({ code, name, native, rtl }));
    case "translate":
      return translate(args.params as Params);
    case "translate_cancel":
      newest = -1;
      return null;
    case "tts":
      return { ok: false };
    case "test_ai":
      await sleep(500);
      return apiKeySet || (args.cfg as { apiKey?: string })?.apiKey
        ? { ok: true, ms: 412, model: (args.cfg as { model?: string })?.model ?? settings.aphra.model }
        : { ok: false, error: "No API key" };
    case "fetch_models":
      await sleep(300);
      return { ok: true, models: [
        { id: "deepseek/deepseek-chat", displayName: "DeepSeek Chat" },
        { id: "openai/gpt-4o-mini", displayName: "GPT-4o mini" },
        { id: "google/gemini-2.0-flash", displayName: "Gemini 2.0 Flash" },
      ] };
    case "get_history":
      return history;
    case "clear_history":
      history = [];
      return null;
    case "delete_history_item":
      history = history.filter((h) => h.id !== args.id);
      return null;
    case "toggle_favorite_item":
      history = history.map((h) => (h.id === args.id ? { ...h, favorite: !h.favorite } : h));
      return null;
    case "read_clipboard_text":
      return "Hello world, this text came from the clipboard.";
    case "capture_selected_text":
      return "";
    case "list_monitors":
      return [{ key: "at:0,0", label: "Display 1 (1920×1080)" }];
    default:
      // copy_text, replace_text, set_island_rect, focus_window, window commands…
      return null;
  }
}
