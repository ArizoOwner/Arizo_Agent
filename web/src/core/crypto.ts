// Live prices read through the user's own exchange, as the backend reports them.
// The page never touches the network and never holds a token: it asks the backend
// (src-tauri/src/crypto.rs) to connect, and mirrors the `crypto` event, which carries
// only prices. Nothing is shown until the exchange has accepted the credentials, and
// there is no demo data: when a read fails the backend says so and the page keeps what
// it last had, marked as out of date.

import { N_, t } from "../i18n/i18n";

export const CRYPTO_ID = "integration_crypto";
export const CRYPTO_COLOR = "#F59E0B";

export type CryptoProvider = "nobitex" | "binance" | "toobit";
export type CryptoQuote = "USDT" | "IRT";
export type CryptoTimeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
/** "off" (switched off), "setup" (needs the user's API), "connecting", "live" or "stale". */
export type CryptoPhase = "off" | "setup" | "connecting" | "live" | "stale";

export interface CryptoCandle {
  /** Start of the minute, milliseconds since the epoch. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface CryptoTicker {
  price: number;
  open: number;
  high: number;
  low: number;
  /** 24-hour change, in percent. */
  change: number;
  volume: number;
}

export interface CryptoAsset {
  asset: string;
  price: number;
  change: number;
  volume: number;
}

export interface CryptoState {
  enabled: boolean;
  provider: CryptoProvider;
  hasCredential: boolean;
  phase: CryptoPhase;
  /** Short code of the last problem ("" when none); see cryptoErrorText. */
  error: string;
  asset: string;
  quote: CryptoQuote;
  timeframe: CryptoTimeframe;
  ticker: CryptoTicker | null;
  candles: CryptoCandle[];
  candlesError: string;
  assets: CryptoAsset[];
  /** When the last good read arrived, milliseconds since the epoch (0 = never). */
  updatedAt: number;
  /** Grows with every state the backend sends: a late answer is told from a newer event. */
  seq: number;
}

export interface CryptoCatalogItem {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  name: string;
  faName: string;
  color: string;
}

export const IDLE_CRYPTO: CryptoState = {
  enabled: false, provider: "nobitex", hasCredential: false, phase: "off", error: "",
  asset: "BTC", quote: "USDT", timeframe: "1m", ticker: null, candles: [], candlesError: "", assets: [], updatedAt: 0, seq: 0,
};

export const Crypto = {
  state: { ...IDLE_CRYPTO } as CryptoState,
};

/** Takes a state from the backend unless a newer one is already held. */
export function setCryptoState(next: CryptoState): boolean {
  if (next.seq < Crypto.state.seq) return false;
  Crypto.state = next;
  return true;
}

/** What may be drawn: nothing until the user's own exchange has accepted the credentials. */
export function visibleTicker(s: CryptoState = Crypto.state): CryptoTicker | null {
  return s.enabled && s.hasCredential ? s.ticker : null;
}

export function coinInfo(asset: string): CryptoCatalogItem | undefined {
  return POPULAR_COINS.find((c) => c.baseAsset === asset);
}

/** English sentences for the short codes the backend reports (the view translates them). */
export const CRYPTO_ERRORS: Record<string, string> = {
  network: N_("Could not reach the exchange. Check the internet connection."),
  rate_limited: N_("The exchange is busy. Trying again shortly."),
  invalid_credentials: N_("The exchange did not accept these keys. Check both the key and the private key."),
  invalid_secret: N_("The private key does not look right."),
  forbidden: N_("The exchange refused this request. Check the permissions of the token."),
  unavailable: N_("The exchange is not available right now."),
  clock_skew: N_("This PC's clock is off. Set the time automatically and try again."),
  bad_response: N_("The exchange answered with something unexpected."),
  unknown_asset: N_("This exchange has no such coin."),
  no_candles: N_("There are no 1-minute candles for this coin yet."),
  busy: N_("Already connecting."),
  unsupported: N_("This exchange does not support that."),
  invalid_input: N_("That does not look right."),
  secret_required: N_("The private key is needed as well."),
  storage_failed: N_("Could not keep the credentials in Windows."),
};

export function cryptoErrorText(code: string): string {
  if (!code) return "";
  const known = CRYPTO_ERRORS[code];
  if (known) return t(known);
  if (/^http_\d+$/.test(code)) return t("The exchange answered with an error ({code}).", { code: code.slice(5) });
  return t("The exchange answered with something unexpected.");
}

// ── Official Vector Logo Paths & Online CDN Loader ───────────────────────────

export interface OfficialLogoDef {
  bg: string;
  paths: readonly { d: string; fill?: string; opacity?: number }[];
}

export const OFFICIAL_LOGOS: Record<string, OfficialLogoDef> = {
  USDT: {
    bg: "#26A17B",
    paths: [
      {
        d: "M17.922 17.383v-.002c-.11.008-.677.042-1.942.042-1.01 0-1.721-.03-1.971-.042v.003c-3.888-.171-6.79-.848-6.79-1.658 0-.809 2.902-1.486 6.79-1.66v2.644c.254.018.982.061 1.988.061 1.207 0 1.812-.05 1.925-.06v-2.643c3.88.173 6.775.85 6.775 1.658 0 .81-2.895 1.485-6.775 1.657m0-3.59v-2.366h5.414V7.819H8.595v3.608h5.414v2.365c-4.4.202-7.709 1.074-7.709 2.118 0 1.044 3.309 1.915 7.709 2.118v7.582h3.913v-7.584c4.393-.202 7.694-1.073 7.694-2.116 0-1.043-3.301-1.914-7.694-2.117",
        fill: "#ffffff",
      },
    ],
  },
  BTC: {
    bg: "#F7931A",
    paths: [
      {
        d: "M23.19 14.02c.31-2.1-1.28-3.22-3.47-3.98l.71-2.84-1.73-.43-.69 2.76c-.45-.11-.92-.22-1.39-.32l.7-2.79-1.73-.43-.71 2.84c-.38-.09-.75-.17-1.1-.26l-.01-.01-2.38-.6-.46 1.85s1.28.29 1.25.31c.7.18.83.64.81 1.01l-.81 3.23.18.06-.18-.05-1.13 4.53c-.09.22-.3.53-.8.41.02.03-1.25-.31-1.25-.31l-.86 1.97 2.25.57c.42.1.83.21 1.23.31l-.71 2.88 1.72.43.71-2.84c.47.13.93.25 1.38.36l-.71 2.83 1.73.43.72-2.87c2.95.56 5.16.34 6.1-2.33.75-2.15-.04-3.39-1.59-4.2 1.13-.25 1.98-1 2.2-2.53zm-3.95 5.54c-.54 2.14-4.15.98-5.33.69l.95-3.81c1.18.3 4.93.87 4.38 3.12zm.53-5.57c-.49 1.96-3.5.96-4.47.72l.86-3.45c.98.24 4.12.7 3.61 2.73z",
        fill: "#ffffff",
      },
    ],
  },
  ETH: {
    bg: "#627EEA",
    paths: [
      { d: "M16 4v8.87l7 3.35L16 4z", fill: "#ffffff", opacity: 0.6 },
      { d: "M16 4L9 16.22l7-3.35V4z", fill: "#ffffff" },
      { d: "M16 21.97v6.03l7-10.38L16 21.97z", fill: "#ffffff", opacity: 0.6 },
      { d: "M16 28v-6.03L9 17.62 16 28z", fill: "#ffffff" },
      { d: "M16 20.57l7-4.35-7-3.35v7.7z", fill: "#ffffff", opacity: 0.25 },
      { d: "M9 16.22l7 4.35v-7.7L9 16.22z", fill: "#ffffff", opacity: 0.65 },
    ],
  },
  SOL: {
    bg: "#111418",
    paths: [
      { d: "M9.1 8.2c.2-.2.5-.3.8-.3h14.8c.4 0 .7.5.5.9l-2.7 3.6c-.2.2-.5.3-.8.3H6.9c-.4 0-.7-.5-.5-.9l2.7-3.6z", fill: "#00FFA3" },
      { d: "M22.9 13.9c-.2-.2-.5-.3-.8-.3H7.3c-.4 0-.7.5-.5.9l2.7 3.6c.2.2.5.3.8.3h14.8c.4 0 .7-.5.5-.9l-2.7-3.6z", fill: "#33E6BF" },
      { d: "M9.1 20.5c.2-.2.5-.3.8-.3h14.8c.4 0 .7.5.5.9l-2.7 3.6c-.2.2-.5.3-.8.3H6.9c-.4 0-.7-.5-.5-.9l2.7-3.6z", fill: "#DC1FFF" },
    ],
  },
  TON: {
    bg: "#0098EA",
    paths: [
      { d: "M16 6.5l8.5 6-4 13h-9l-4-13 8.5-6zm0 2.2L9.7 13.9l6.3 3.5 6.3-3.5L16 8.7zm-1 9.9l-5.6-3.1 3.2 10.4 2.4-7.3zm2 0l2.4 7.3 3.2-10.4-5.6 3.1z", fill: "#ffffff" },
    ],
  },
  BNB: {
    bg: "#F3BA2F",
    paths: [
      { d: "M12.11 14.28L16 10.39l3.89 3.89 2.27-2.27L16 5.85l-6.16 6.16 2.27 2.27zM5.85 16l2.27-2.27 2.27 2.27-2.27 2.27L5.85 16zm6.26 1.72L16 21.61l3.89-3.89 2.27 2.27L16 26.15l-6.16-6.16 2.27-2.27zm9.74-1.72l2.27-2.27 2.27 2.27-2.27 2.27-2.27-2.27zM16 18.27l2.27-2.27L16 13.73l-2.27 2.27L16 18.27z", fill: "#ffffff" },
    ],
  },
  XRP: {
    bg: "#23292F",
    paths: [
      { d: "M23.95 8h2.38l-6.52 6.44c-2.11 2.08-5.52 2.08-7.63 0L5.67 8h2.38l5.33 5.27c1.4 1.39 3.68 1.39 5.08 0L23.95 8zm0 16h2.38l-6.52-6.44c-2.11-2.08-5.52-2.08-7.63 0L5.67 24h2.38l5.33-5.27c1.4-1.39 3.68-1.39 5.08 0L23.95 24z", fill: "#ffffff" },
    ],
  },
  DOGE: {
    bg: "#C2A633",
    paths: [
      { d: "M12.5 8h4.8c4.6 0 7.7 2.9 7.7 8s-3.1 8-7.7 8h-4.8V8zm4.5 13.3c3 0 4.8-2 4.8-5.3s-1.8-5.3-4.8-5.3h-1.6v10.6h1.6zm-6.8-6.1h6.2v1.7h-6.2v-1.7z", fill: "#ffffff" },
    ],
  },
  ADA: {
    bg: "#0033AD",
    paths: [
      { d: "M16 12.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4zm0-5.7a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zm0 15a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zm-7.5-7.5a1.4 1.4 0 1 0 2.8 0 1.4 1.4 0 0 0-2.8 0z", fill: "#ffffff" },
    ],
  },
  TRX: {
    bg: "#EF0027",
    paths: [
      { d: "M7 8l17 3-12 13L7 8zm2.4 2.2l3 7.8 8.8-7.6-11.8-.2zm3.8 9.5l6.4-5.5-8.5-1.5 2.1 7z", fill: "#ffffff" },
    ],
  },
  AVAX: {
    bg: "#E84142",
    paths: [
      { d: "M19.3 7.2l7.7 13.8c.8 1.4-.2 3.1-1.8 3.1h-4.3l-5.6-10.2 4-6.7zm-6.6 6.7l-4.5 7.6h3.6l3.1-5.4-2.2-2.2zm-4.9 8.2l-1.9 3.2c-.8 1.4.2 3.1 1.8 3.1h4l-3.9-6.3z", fill: "#ffffff" },
    ],
  },
  SUI: {
    bg: "#4DA2FF",
    paths: [
      { d: "M16 6c-3 4-7 10.5-7 15a7 7 0 0 0 14 0c0-4.5-4-11-7-15zm0 19a4.5 4.5 0 0 1-4.5-4.5c0-2.8 2.2-7 4.5-10.5 2.3 3.5 4.5 7.7 4.5 10.5A4.5 4.5 0 0 1 16 25z", fill: "#ffffff" },
    ],
  },
  PEPE: {
    bg: "#3B8226",
    paths: [
      { d: "M9 13a4 4 0 0 1 7-2 4 4 0 0 1 7 2c1 3-1 6-7 6s-8-3-7-6zm3-1a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm8 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-10 9c3 3 10 3 12 0-3 1-9 1-12 0z", fill: "#ffffff" },
    ],
  },
  SHIB: {
    bg: "#FFA409",
    paths: [
      { d: "M16 7l3 5h4l-3 4 2 6-6-3-6 3 2-6-3-4h4l3-5zm0 6l-1.5 2.5h3L16 13zm-2.5 5l2.5-1.5 2.5 1.5-2.5 2-2.5-2z", fill: "#ffffff" },
    ],
  },
  NEAR: {
    bg: "#000000",
    paths: [
      { d: "M22.5 8h-4.3l-5.6 8.5V8H9v16h4.3l5.6-8.5V24h3.6V8z", fill: "#00EC97" },
    ],
  },
  LINK: {
    bg: "#375BD2",
    paths: [
      { d: "M16 6l8 4.6v9.2L16 24.4l-8-4.6v-9.2L16 6zm0 3.2L10.5 12v5.5L16 20.7l5.5-3.2V12L16 9.2z", fill: "#ffffff" },
    ],
  },
  DOT: {
    bg: "#E6007A",
    paths: [
      { d: "M16 7a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 5a4 4 0 1 1 0 8 4 4 0 0 1 0-8z", fill: "#ffffff" },
    ],
  },
  LTC: {
    bg: "#345D9D",
    paths: [
      { d: "M12 7h3v8.5l4.5-1.5-.5 2-4 1.5V24h-3V7z", fill: "#ffffff" },
    ],
  },
  NOT: {
    bg: "#111111",
    paths: [
      { d: "M16 6l9 10-9 10-9-10 9-10zm0 4.2L9.5 16 16 21.8 22.5 16 16 10.2z", fill: "#ffffff" },
    ],
  },
  HMSTR: {
    bg: "#F7941D",
    paths: [
      { d: "M16 8c-4 0-7 3-7 7 0 5 4 9 7 9s7-4 7-9c0-4-3-7-7-7zm-3 6a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z", fill: "#ffffff" },
    ],
  },
  BONK: {
    bg: "#FF8700",
    paths: [
      { d: "M16 7c-4 0-6.5 2.5-6.5 5.5 0 2 1 3.5 2.5 4.5l-2 7 6-3 6 3-2-7c1.5-1 2.5-2.5 2.5-4.5C22.5 9.5 20 7 16 7z", fill: "#ffffff" },
    ],
  },
};

export const POPULAR_COINS: readonly CryptoCatalogItem[] = [
  // Tether has no market against itself, so it is read in Toman (Nobitex's USDT/IRT market).
  { symbol: "USDTIRT", baseAsset: "USDT", quoteAsset: "IRT", name: "Tether", faName: "تتر", color: "#26A17B" },
  { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", name: "Bitcoin", faName: "بیت‌کوین", color: "#F7931A" },
  { symbol: "ETHUSDT", baseAsset: "ETH", quoteAsset: "USDT", name: "Ethereum", faName: "اتریوم", color: "#627EEA" },
  { symbol: "SOLUSDT", baseAsset: "SOL", quoteAsset: "USDT", name: "Solana", faName: "سولانا", color: "#14F195" },
  { symbol: "TONUSDT", baseAsset: "TON", quoteAsset: "USDT", name: "Toncoin", faName: "تون‌کوین", color: "#0098EA" },
  { symbol: "BNBUSDT", baseAsset: "BNB", quoteAsset: "USDT", name: "BNB", faName: "بی‌ان‌بی", color: "#F3BA2F" },
  { symbol: "XRPUSDT", baseAsset: "XRP", quoteAsset: "USDT", name: "Ripple", faName: "ریپل", color: "#23292F" },
  { symbol: "DOGEUSDT", baseAsset: "DOGE", quoteAsset: "USDT", name: "Dogecoin", faName: "دوج‌کوین", color: "#C2A633" },
  { symbol: "ADAUSDT", baseAsset: "ADA", quoteAsset: "USDT", name: "Cardano", faName: "کاردانو", color: "#0033AD" },
  { symbol: "TRXUSDT", baseAsset: "TRX", quoteAsset: "USDT", name: "TRON", faName: "ترون", color: "#EF0027" },
  { symbol: "AVAXUSDT", baseAsset: "AVAX", quoteAsset: "USDT", name: "Avalanche", faName: "آوالانچ", color: "#E84142" },
  { symbol: "SUIUSDT", baseAsset: "SUI", quoteAsset: "USDT", name: "Sui", faName: "سوئی", color: "#4DA2FF" },
  { symbol: "PEPEUSDT", baseAsset: "PEPE", quoteAsset: "USDT", name: "Pepe", faName: "پپه", color: "#3B8226" },
  { symbol: "SHIBUSDT", baseAsset: "SHIB", quoteAsset: "USDT", name: "Shiba Inu", faName: "شیبا اینو", color: "#FFA409" },
  { symbol: "NEARUSDT", baseAsset: "NEAR", quoteAsset: "USDT", name: "NEAR Protocol", faName: "نیر پروتکل", color: "#00EC97" },
  { symbol: "LINKUSDT", baseAsset: "LINK", quoteAsset: "USDT", name: "Chainlink", faName: "چین‌لینک", color: "#375BD2" },
  { symbol: "DOTUSDT", baseAsset: "DOT", quoteAsset: "USDT", name: "Polkadot", faName: "پولکادات", color: "#E6007A" },
  { symbol: "LTCUSDT", baseAsset: "LTC", quoteAsset: "USDT", name: "Litecoin", faName: "لایت‌کوین", color: "#345D9D" },
  { symbol: "NOTUSDT", baseAsset: "NOT", quoteAsset: "USDT", name: "Notcoin", faName: "نات‌کوین", color: "#111111" },
  { symbol: "HMSTRUSDT", baseAsset: "HMSTR", quoteAsset: "USDT", name: "Hamster Kombat", faName: "همستر کامبت", color: "#F7941D" },
  { symbol: "BONKUSDT", baseAsset: "BONK", quoteAsset: "USDT", name: "Bonk", faName: "بونک", color: "#FF8700" },
];

export function createOfficialCoinLogo(baseAsset: string, size = 26): HTMLElement {
  const meta = OFFICIAL_LOGOS[baseAsset];
  const NS = "http://www.w3.org/2000/svg";
  const el = document.createElementNS(NS, "svg");
  el.setAttribute("viewBox", "0 0 32 32");
  el.setAttribute("width", String(size));
  el.setAttribute("height", String(size));
  el.setAttribute("class", "cp-official-logo");

  const circle = document.createElementNS(NS, "circle");
  circle.setAttribute("cx", "16");
  circle.setAttribute("cy", "16");
  circle.setAttribute("r", "16");
  circle.setAttribute("fill", meta?.bg ?? "#2A303C");
  el.append(circle);

  if (meta) {
    for (const part of meta.paths) {
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", part.d);
      p.setAttribute("fill", part.fill ?? "#ffffff");
      if (part.opacity) p.setAttribute("fill-opacity", String(part.opacity));
      el.append(p);
    }
  } else {
    const text = document.createElementNS(NS, "text");
    text.setAttribute("x", "16");
    text.setAttribute("y", "21");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "#ffffff");
    text.setAttribute("font-size", baseAsset.length > 3 ? "10" : "12");
    text.setAttribute("font-weight", "800");
    text.setAttribute("font-family", "system-ui, sans-serif");
    text.textContent = baseAsset.slice(0, 4);
    el.append(text);
  }

  // Live dynamic icon from API / CDN:
  const sym = baseAsset.toLowerCase();
  const img = document.createElementNS(NS, "image");
  img.setAttribute("href", `https://cdn.nobitex.ir/crypto/${sym}.svg`);
  img.setAttribute("x", "0");
  img.setAttribute("y", "0");
  img.setAttribute("width", "32");
  img.setAttribute("height", "32");
  img.setAttribute("preserveAspectRatio", "xMidYMid meet");
  if (typeof img.addEventListener === "function") {
    img.addEventListener("error", () => {
      img.setAttribute("href", `https://assets.coincap.io/assets/icons/${sym}@2x.png`);
      img.addEventListener("error", () => {
        img.remove();
      }, { once: true });
    }, { once: true });
  }
  el.append(img);

  return el as unknown as HTMLElement;
}

// ── Formatters ─────────────────────────────────────────────────────────────────

/**
 * `$` for the USDT markets, `T` for the Nobitex Toman market (already in Toman).
 * `withUnit: false` drops the unit mark where space is tight.
 */
export function formatPrice(price: number, quote: CryptoQuote = "USDT", withUnit = true): string {
  if (!Number.isFinite(price) || price <= 0) return "-";
  const toman = quote === "IRT";
  let body: string;
  if (toman && price >= 100) body = Math.round(price).toLocaleString("en-US");
  else if (price >= 1000) body = price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  else if (price >= 1) body = price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  else if (price >= 0.001) body = price.toFixed(5);
  else body = price.toFixed(8);
  if (!toman) return `$${body}`;
  return withUnit ? `${body} T` : body;
}

/** The chart's price scale is narrow: big Toman numbers are written in millions (4,799.1M). */
export function formatAxisPrice(price: number, quote: CryptoQuote = "USDT"): string {
  if (quote === "IRT" && price >= 1e6) {
    return `${(price / 1e6).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`;
  }
  return formatPrice(price, quote, false);
}

export function formatChange(change: number): { text: string; positive: boolean } {
  const sign = change > 0 ? "+" : "";
  return {
    text: `${sign}${change.toFixed(2)}%`,
    positive: change >= 0,
  };
}

export function formatVolume(vol: number): string {
  if (vol >= 1e9) return (vol / 1e9).toFixed(2) + "B";
  if (vol >= 1e6) return (vol / 1e6).toFixed(2) + "M";
  if (vol >= 1e3) return (vol / 1e3).toFixed(2) + "K";
  return vol.toFixed(0);
}

/** HH:MM:SS in the PC's time zone ("--:--:--" when nothing has been read yet). */
export function formatClock(ms: number): string {
  if (!ms) return "--:--:--";
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}
