// An in-memory stand-in for the backend, used when the page is opened in a plain
// browser (`npm run dev`, `?mock=1`): the whole interface can be exercised and
// screenshotted without the app. It is never reached inside the real window.

import { DEFAULT_SETTINGS, mergeSettings, type Settings, type SettingsPatch } from "./state";
import type { HistoryItem } from "./history-logic";
import type { TranslateData } from "./bridge";
import { IDLE_SPOTIFY, withPlaying, type SpotifyState } from "./spotify";
import { IDLE_CRYPTO, type CryptoState } from "./crypto";
import { IDLE_FOOTBALL, POPULAR_TEAMS, type FootballMatch, type FootballState, type FootballTeamHit } from "./football";
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

let football: FootballState = { ...IDLE_FOOTBALL, enabled: settings.footballEnabled };

const side = (id: string, name: string, score: number | null = null) => ({ id, name, short: name, score, color: "" });
function sampleMatch(id: string, hours: number, opponent: [string, string], home: boolean, own: number | null, theirs: number | null, state: FootballMatch["state"]): FootballMatch {
  const me = side(settings.footballTeamId || "83", settings.footballTeamName || "Barcelona", own);
  const opp = side(opponent[0], opponent[1], theirs);
  return {
    id, league: "esp.1", leagueName: "LALIGA", date: new Date(Date.now() + hours * 3_600_000).toISOString().slice(0, 16) + "Z",
    state, clock: state === "in" ? "67'" : state === "post" ? "FT" : "", home: home ? me : opp, away: home ? opp : me, goals: [],
  };
}

/** Browser-only football data for the chosen team (a live game when `live` is set). */
let footballLive = false;
export function mockFootball(extra: Partial<FootballState> = {}, live = footballLive) {
  footballLive = live;
  const teamId = settings.footballTeamId;
  football = !settings.footballEnabled || !teamId ? { ...IDLE_FOOTBALL, enabled: settings.footballEnabled } : {
    enabled: true, configured: true, team: { id: teamId, name: settings.footballTeamName },
    live: live ? sampleMatch("9001", -1.1, ["86", "Real Madrid"], true, 1, 1, "in") : null,
    upcoming: [
      sampleMatch("9002", 52, ["160", "Paris Saint-Germain"], false, null, null, "pre"),
      sampleMatch("9003", 190, ["86", "Real Madrid"], true, null, null, "pre"),
      sampleMatch("9004", 330, ["243", "Sevilla"], false, null, null, "pre"),
    ],
    recent: [
      sampleMatch("9010", -70, ["2922", "Getafe"], true, 3, 0, "post"),
      sampleMatch("9011", -240, ["432", "Galatasaray"], false, 4, 1, "post"),
      sampleMatch("9012", -410, ["243", "Sevilla"], false, 1, 1, "post"),
    ],
    updatedAt: Date.now(), error: "", ...extra,
  };
  mockEmit("football", football);
}

let crypto: CryptoState = { ...IDLE_CRYPTO, enabled: settings.cryptoEnabled, phase: "setup" };

/** Browser-only sample prices (only after a token was "connected"); never an exchange. */
export function mockCrypto(patch: Partial<CryptoState> = {}): CryptoState {
  const hasCredential = patch.hasCredential ?? crypto.hasCredential;
  const asset = settings.cryptoAsset;
  const quote = settings.cryptoQuote;
  const usd = asset === "USDT" ? 1 : asset === "BTC" ? 68500 : asset === "ETH" ? 3400 : 150;
  const price = usd * (quote === "IRT" ? 70000 : 1);
  const now = Math.floor(Date.now() / 60_000) * 60_000;
  const candles = hasCredential ? Array.from({ length: 40 }, (_, i) => {
    const wave = Math.sin(i / 3) * price * 0.002;
    const o = price + wave, c = price + Math.sin((i + 1) / 3) * price * 0.002;
    return { t: now - (39 - i) * 60_000, o, h: Math.max(o, c) * 1.0006, l: Math.min(o, c) * 0.9994, c, v: 5 + (i % 7) };
  }) : [];
  crypto = {
    ...crypto, ...patch,
    enabled: settings.cryptoEnabled, provider: settings.cryptoProvider, hasCredential, asset, quote,
    phase: !settings.cryptoEnabled ? "off" : hasCredential ? "live" : "setup",
    timeframe: (patch.timeframe ?? settings.cryptoTimeframe ?? "1m") as any,
    ticker: hasCredential ? { price, open: price * 0.99, high: price * 1.02, low: price * 0.98, change: 1.25, volume: 1.8e9 } : null,
    candles,
    assets: hasCredential ? [...(quote === "IRT" ? ["USDT"] : []), "BTC", "ETH", "SOL", "TON", "BNB", "XRP", "DOGE", "ADA", "TRX", "AVAX", "LINK", "LTC"].map((a, i) => ({ asset: a, price: (a === "USDT" ? 1 : 68500 / (i + 1)) * (quote === "IRT" ? 70000 : 1), change: 1.1 - i * 0.3, volume: 1e9 / (i + 1) })) : [],
    updatedAt: hasCredential ? Date.now() : 0, seq: crypto.seq + 1,
  };
  mockEmit("crypto", crypto);
  return crypto;
}

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
  // Scripts that record the README animations can answer with real-looking translations.
  const demo = (globalThis as { __demoTranslate?: (text: string, engine: string, target: string) => Partial<TranslateData> | null })
    .__demoTranslate?.(p.text, p.engine, target) ?? null;
  const full = demo?.translation ?? `[mock] ${p.text}`;
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
  const data: TranslateData = {
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
    ...(demo ?? {}),
  };
  if (settings.saveHistory) {
    history = [{
      id: `m${Date.now()}`, timestamp: new Date().toISOString(), query: p.text, translation: full,
      detectedLang: detected, targetLang: target, engine: data.engine, favorite: false,
    }, ...history.filter((h) => h.query !== p.text)].slice(0, settings.historyLimit);
  }
  return { requestId: p.requestId, success: true, cached: false, aborted: false, warning, data, error: "", errorCode: "" };
}

/** The browser's screen, as the backend would describe it: `?sw=1366&sh=768` tries a smaller one. */
function mockScreen() {
  const q = new URLSearchParams(location.search);
  const width = Number(q.get("sw")) || screen.width || 1920;
  const height = Number(q.get("sh")) || screen.height || 1080;
  return { x: 0, y: 0, width, height, scale: 1, workWidth: width, workHeight: height - 48 };
}

export async function mockInvoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  switch (cmd) {
    case "boot":
      return {
        settings, version: "3.5.1", cursorPoll: false,
        screen: mockScreen(),
      };
    case "screen_info":
      return mockScreen();
    case "set_ui_zoom":
      // What the backend's rasterization scale does to the page, near enough to look at it.
      document.documentElement.style.zoom = String(args.zoom);
      return null;
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
      mockFootball();
      return { ok: true, hotkeyOk: true, inlineHotkeyOk: true, hideHotkeyOk: true, settings };
    }
    case "football_refresh":
      if (!football.configured && settings.footballTeamId) mockFootball();
      return football;
    case "football_search": {
      const q = String(args.query ?? "").toLowerCase();
      return POPULAR_TEAMS.filter((tm) => tm.name.toLowerCase().includes(q)).map((tm): FootballTeamHit => ({ ...tm, league: "esp.1" }));
    }
    case "football_logo":
      return null;
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
      // Like the backend: a window only cancels its own translation (ids from 1_000_000 are the bubble's).
      if (((args.requestId as number) >= 1_000_000) === (newest >= 1_000_000)) newest = -1;
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
    case "crypto_state":
      return crypto;
    case "crypto_connect": {
      // The browser has no exchange: a token is accepted so the screens can be seen, with sample prices.
      const token = String(args.token ?? "").trim();
      if (!token) throw new Error("invalid_input");
      if (!args.secret) throw new Error("secret_required");
      settings = { ...settings, cryptoProvider: args.provider === "binance" || args.provider === "toobit" ? args.provider : "nobitex", cryptoEnabled: true };
      mockEmit("settings-changed", settings);
      return mockCrypto({ hasCredential: true });
    }
    case "crypto_disconnect":
      return mockCrypto({ hasCredential: false });
    case "crypto_select":
      settings = { ...settings, cryptoAsset: String(args.asset), cryptoQuote: args.quote === "IRT" ? "IRT" : "USDT" };
      mockEmit("settings-changed", settings);
      return mockCrypto({});
    case "crypto_set_timeframe":
      settings = { ...settings, cryptoTimeframe: args.timeframe as any };
      mockEmit("settings-changed", settings);
      return mockCrypto({ timeframe: args.timeframe as any });
    case "crypto_active":
      return null;
    case "list_monitors":
      return [{ key: "at:0,0", label: "Display 1 (1920×1080)" }];
    default:
      // copy_text, replace_text, set_island_rect, focus_window, window commands…
      return null;
  }
}
