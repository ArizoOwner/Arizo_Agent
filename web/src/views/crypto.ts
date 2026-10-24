// Live prices and a 1-minute candlestick chart, read through the user's own exchange.
// The page holds no token and makes no request: it shows what the backend reports
// (core/crypto.ts) and asks it to connect, disconnect or pick another coin.

import { h, clear, svg } from "./dom";
import { card } from "./parts";
import { ICONS } from "./icons";
import { State, mergeSettings } from "../core/state";
import { enhanceSelect } from "./select";
import { Bridge } from "../core/bridge";
import {
  Crypto,
  coinInfo,
  createOfficialCoinLogo,
  cryptoErrorText,
  formatAxisPrice,
  formatChange,
  formatClock,
  formatPrice,
  formatVolume,
  setCryptoState,
  visibleTicker,
  type CryptoAsset,
  type CryptoCandle,
  type CryptoProvider,
  type CryptoQuote,
  type CryptoState,
  type CryptoTimeframe,
} from "../core/crypto";
import { language, t, tl } from "../i18n/i18n";
import type { ViewHost } from "./views";

/** The short code in whatever a rejected call carries (a string from Tauri, an Error from the mock). */
function codeOf(err: unknown): string {
  return String(err instanceof Error ? err.message : err);
}

export function buildCrypto(): ViewHost {
  let dropdownOpen = false;
  let chartMode: "candles" | "line" = "candles";
  let searchQuery = "";
  let lastPrice = 0;
  let lastAsset = "";
  let flashTimer: number | null = null;
  let hoveredIndex: number | null = null;
  let connecting = false;
  let setupError = "";
  let notice = "";
  let shownProvider: CryptoProvider | "" = "";
  /** The market in use before Tether (which only has a Toman market) was picked. */
  let quoteBeforeTether: CryptoQuote = "USDT";

  const apply = (next: CryptoState | null) => {
    if (next && setCryptoState(next)) State.notify();
  };

  // ── Favourites: the coins the user starred, and the one shown at start ───────
  function favoriteList(): string[] {
    return State.settings.cryptoFavorites ?? [];
  }

  function saveFavorites(list: string[], defaultAsset: string) {
    const patch = { cryptoFavorites: list, cryptoDefaultAsset: list.includes(defaultAsset) ? defaultAsset : "" };
    void Bridge.saveSettings(patch).then((saved) => {
      if (saved?.ok) State.settings = mergeSettings(State.settings, saved.settings);
      State.notify();
    });
  }

  function toggleFavorite(asset: string) {
    const list = favoriteList();
    const next = list.includes(asset) ? list.filter((a) => a !== asset) : [...list, asset];
    // The first star is the default until the user says otherwise.
    const fallback = list.length === 0 && !State.settings.cryptoDefaultAsset ? asset : State.settings.cryptoDefaultAsset;
    saveFavorites(next, fallback);
  }

  function toggleDefault(asset: string) {
    saveFavorites(favoriteList(), State.settings.cryptoDefaultAsset === asset ? "" : asset);
  }

  // ── Heading ─────────────────────────────────────────────────────────────────
  const brand = h("div", { class: "cp-brand" }, svg(ICONS.crypto, 16), h("span", { text: tl("Crypto") }));

  const liveDot = h("span", { class: "cp-live-dot" });
  const statusLabel = h("span", { class: "cp-status-text", text: tl("Connecting…") });
  const updatedTag = h("span", { class: "cp-rate-tag", text: "--:--:--" });
  const statusPill = h("div", { class: "cp-status-pill connecting" }, liveDot, statusLabel, updatedTag);

  const quoteBtn = h("button", {
    class: "cp-btn-pill", type: "button", title: tl("Toggle currency USD / Tomans"),
    onclick: () => {
      const s = Crypto.state;
      const next: CryptoQuote = s.quote === "USDT" ? "IRT" : "USDT";
      void Bridge.cryptoSelect(s.asset, next).then(apply, (err) => { notice = cryptoErrorText(codeOf(err)); renderView(); });
    },
  });

  const changeApiBtn = h("button", {
    class: "cp-btn-pill", type: "button", title: tl("Change API"),
    onclick: () => {
      void Bridge.cryptoDisconnect().then(apply, (err) => { notice = cryptoErrorText(codeOf(err)); renderView(); });
    },
  }, svg(ICONS.key, 12, { stroke: 2 }), h("span", { text: tl("Change API") }));

  const heading = h("div", { class: "cp-heading" },
    h("div", { class: "cp-heading-left" }, brand, statusPill),
    h("div", { class: "cp-heading-actions" }, quoteBtn, changeApiBtn),
  );

  // ── Setup: the user's own exchange API ──────────────────────────────────────
  const setupBadge = h("div", { class: "cp-coin-badge lg", text: "₿" });
  setupBadge.style.background = "linear-gradient(135deg, #F59E0B, #D97706)";
  setupBadge.style.boxShadow = "0 4px 14px rgba(245, 158, 11, 0.4)";

  const setupHint = h("div", {
    class: "cp-setup-hint",
    text: tl("To view live cryptocurrency prices and 1-minute real-time charts, please enter your personal exchange API key. All market data is read directly from your configured API."),
  });
  const setupSafe = h("div", {
    class: "cp-setup-hint",
    text: tl("The exchange checks it first. It is then kept in Windows Credential Manager and never shown again."),
  });

  const providerSelect = enhanceSelect(
    h("select", { class: "cp-setup-input", style: "cursor:pointer" },
      h("option", { value: "nobitex", text: tl("Nobitex") }),
      h("option", { value: "binance", text: tl("Binance") }),
      h("option", { value: "toobit", text: tl("Toobit") }),
    ) as HTMLSelectElement,
  );

  const tokenLabel = h("label", { class: "cp-api-label" });
  const secretLabel = h("label", { class: "cp-api-label" });
  const setupNote = h("div", { class: "cp-setup-hint" });

  const tokenInput = h("input", {
    type: "password", class: "cp-setup-input", autocomplete: "off", spellcheck: false,
    onfocus: () => void Bridge.focusWindow(true), onblur: () => void Bridge.focusWindow(false),
  }) as HTMLInputElement;

  const secretInput = h("input", {
    type: "password", class: "cp-setup-input", autocomplete: "off", spellcheck: false,
    onfocus: () => void Bridge.focusWindow(true), onblur: () => void Bridge.focusWindow(false),
  }) as HTMLInputElement;
  const secretField = h("div", { class: "cp-api-field" }, secretLabel, secretInput);

  const setupErrorEl = h("div", { class: "cp-setup-hint cp-error", role: "alert" });

  const connectBtn = h("button", { type: "button", class: "cp-setup-btn-primary", text: tl("Connect & Start Tracking"), onclick: () => void connect() });

  providerSelect.addEventListener("change", () => { setupError = ""; renderView(); });
  for (const input of [tokenInput, secretInput]) {
    input.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") void connect(); });
  }

  async function connect() {
    if (connecting) return;
    const provider = providerSelect.value as CryptoProvider;
    const token = tokenInput.value.trim();
    const secret = secretInput.value.trim();
    if (!token) { tokenInput.focus(); return; }
    if (!secret) { secretInput.focus(); return; }
    connecting = true;
    setupError = "";
    renderView();
    try {
      apply(await Bridge.cryptoConnect(provider, token, secret));
      tokenInput.value = "";
      secretInput.value = "";
    } catch (err) {
      setupError = cryptoErrorText(codeOf(err));
    }
    connecting = false;
    renderView();
  }

  // The card scrolls on its own when the form is taller than the island (always at a large text size).
  const setupCard = h("div", { class: "cp-setup-card", "data-scroll": true },
    h("div", { class: "cp-setup-badge-row" }, setupBadge, h("div", { class: "cp-setup-title", text: tl("Connect Exchange API") })),
    setupHint,
    h("div", { class: "cp-setup-form" },
      h("div", { class: "cp-api-field" }, h("label", { class: "cp-api-label", text: tl("Exchange") }), providerSelect),
      h("div", { class: "cp-api-field" }, tokenLabel, tokenInput),
      secretField,
      setupErrorEl,
      h("div", { class: "cp-setup-actions" }, connectBtn),
    ),
    setupNote,
    setupSafe,
  );

  const offNote = h("div", { class: "cp-setup-card" },
    h("div", { class: "cp-setup-hint", text: tl("Crypto prices are turned off in Settings.") }));

  // ── Coin picker ─────────────────────────────────────────────────────────────
  const triggerLogoWrap = h("span");
  const triggerSymbol = h("span", { class: "cp-trigger-symbol", text: "BTC" });
  const triggerName = h("span", { class: "cp-trigger-name" });
  const triggerPrice = h("span", { class: "cp-trigger-price", text: "-" });
  const triggerChange = h("span", { class: "cp-badge up", text: "0.00%" });

  const dropdownTrigger = h("button", {
    class: "cp-dropdown-trigger", type: "button",
    onclick: (e) => {
      e.stopPropagation();
      dropdownOpen = !dropdownOpen;
      dropdownEl.classList.toggle("open", dropdownOpen);
      if (dropdownOpen) {
        searchInput.value = "";
        searchQuery = "";
        renderDropdownList();
        setTimeout(() => searchInput.focus(), 30);
      }
    },
  },
  h("div", { class: "cp-trigger-left" }, triggerLogoWrap, h("div", { class: "cp-trigger-info" }, triggerSymbol, triggerName)),
  h("div", { class: "cp-trigger-right" }, triggerPrice, triggerChange, h("span", { class: "cp-chevron" }, svg(ICONS.chevronDown, 14, { stroke: 2 }))));

  const searchInput = h("input", {
    class: "cp-dropdown-search-input", type: "text", placeholder: tl("Search all coins…"),
    onclick: (e) => e.stopPropagation(),
    onfocus: () => void Bridge.focusWindow(true), onblur: () => void Bridge.focusWindow(false),
    oninput: (e) => {
      searchQuery = (e.target as HTMLInputElement).value.trim().toUpperCase();
      renderDropdownList();
    },
  }) as HTMLInputElement;

  const dropdownList = h("div", { class: "cp-dropdown-list" });
  const dropdownMenu = h("div", { class: "cp-dropdown-menu", onclick: (e) => e.stopPropagation() },
    h("div", { class: "cp-dropdown-search-box" }, h("span", { class: "cp-search-icon" }, svg(ICONS.search, 14, { stroke: 2 })), searchInput),
    dropdownList);
  const dropdownEl = h("div", { class: "cp-dropdown" }, dropdownTrigger, dropdownMenu);

  const starBtn = h("button", { class: "cp-star-btn", type: "button", onclick: () => toggleFavorite(Crypto.state.asset) });
  const defaultBtn = h("button", {
    class: "cp-default-btn", type: "button", text: tl("Default"),
    onclick: () => toggleDefault(Crypto.state.asset),
  });
  const pickerRow = h("div", { class: "cp-picker-row" }, dropdownEl, starBtn, defaultBtn);
  const favBar = h("div", { class: "cp-fav-bar" });

  document.addEventListener("click", () => {
    if (dropdownOpen) {
      dropdownOpen = false;
      dropdownEl.classList.remove("open");
    }
    if (tfDropdownOpen) {
      tfDropdownOpen = false;
      tfDropdownEl.classList.remove("open");
    }
  });

  function choose(asset: string) {
    dropdownOpen = false;
    dropdownEl.classList.remove("open");
    notice = "";
    const now = Crypto.state;
    // Tether only has a Toman market: it is read there, and the market in use comes back after it.
    let quote: CryptoQuote = now.quote;
    if (asset === "USDT" && now.provider === "nobitex") {
      if (now.asset !== "USDT") quoteBeforeTether = now.quote;
      quote = "IRT";
    } else if (now.asset === "USDT") {
      quote = quoteBeforeTether;
    }
    void Bridge.cryptoSelect(asset, quote).then(apply, (err) => { notice = cryptoErrorText(codeOf(err)); renderView(); });
  }

  function coinName(asset: string): string {
    const info = coinInfo(asset);
    return info ? (language() === "fa" ? info.faName : info.name) : asset;
  }

  /** Every coin the list can show: the exchange's own, plus Tether and the favourites it lacks. */
  function listedAssets(): CryptoAsset[] {
    const s = Crypto.state;
    const have = new Set(s.assets.map((a) => a.asset));
    const extra: CryptoAsset[] = [];
    const add = (asset: string) => {
      if (have.has(asset)) return;
      have.add(asset);
      extra.push({ asset, price: 0, change: 0, volume: 0 });
    };
    // Tether has no market against itself: Nobitex lists it only in Toman, so it is offered here.
    if (s.provider === "nobitex") add("USDT");
    for (const f of favoriteList()) if (f !== "USDT" || s.provider === "nobitex") add(f);
    return [...extra, ...s.assets];
  }

  function coinRow(a: CryptoAsset): HTMLElement {
    const s = Crypto.state;
    const selected = a.asset === s.asset;
    const fav = favoriteList().includes(a.asset);
    const isDefault = State.settings.cryptoDefaultAsset === a.asset;
    const chg = formatChange(a.change);
    const priced = a.price > 0;
    const priceText = priced ? formatPrice(a.price, s.quote) : a.asset === "USDT" ? t("Toman market") : "-";

    const star = h("button", {
      class: fav ? "cp-row-star on" : "cp-row-star", type: "button",
      title: fav ? t("Remove from favorites") : t("Add to favorites"),
      onclick: (e) => { e.stopPropagation(); toggleFavorite(a.asset); },
    }, fav ? svg(ICONS.star, 14) : svg(ICONS.starOutline, 14, { stroke: 1.8 }));

    const pill = fav
      ? h("button", {
        class: isDefault ? "cp-row-default on" : "cp-row-default", type: "button", text: t("Default"),
        title: isDefault ? t("This coin is shown when the app starts") : t("Show this coin when the app starts"),
        onclick: (e) => { e.stopPropagation(); toggleDefault(a.asset); },
      })
      : null;

    return h("div", { class: selected ? "cp-dropdown-item active" : "cp-dropdown-item", onclick: () => choose(a.asset) },
      h("div", { class: "cp-item-left" },
        createOfficialCoinLogo(a.asset, 22),
        h("div", { class: "cp-item-text" },
          h("span", { class: "cp-item-symbol", text: a.asset }),
          h("span", { class: "cp-item-name", text: coinName(a.asset) }))),
      h("div", { class: "cp-item-right" },
        h("span", { class: "cp-item-price", text: priceText }),
        priced ? h("span", { class: `cp-badge ${chg.positive ? "up" : "down"}`, text: chg.text }) : null,
        pill,
        star,
        selected ? svg(ICONS.check, 13, { stroke: 2 }) : null));
  }

  function renderDropdownList() {
    clear(dropdownList);
    const q = searchQuery;
    const favs = favoriteList();
    const matches = (a: CryptoAsset) => !q || a.asset.includes(q)
      || coinName(a.asset).toUpperCase().includes(q) || (coinInfo(a.asset)?.name.toUpperCase().includes(q) ?? false);
    const shown = listedAssets().filter(matches);

    if (q && shown.length === 0 && /^[A-Z0-9]{1,16}$/.test(q)) {
      dropdownList.append(h("div", { class: "cp-dropdown-item", onclick: () => choose(q) },
        h("div", { class: "cp-item-left" },
          createOfficialCoinLogo(q, 22),
          h("div", { class: "cp-item-text" },
            h("span", { class: "cp-item-symbol", text: q }),
            h("span", { class: "cp-item-name", text: t("Add {symbol}", { symbol: q }) })))));
      return;
    }

    const starred = favs.map((f) => shown.find((a) => a.asset === f)).filter((a): a is CryptoAsset => Boolean(a));
    const rest = shown.filter((a) => !favs.includes(a.asset));
    for (const a of starred) dropdownList.append(coinRow(a));
    if (starred.length > 0 && rest.length > 0) dropdownList.append(h("div", { class: "cp-dropdown-sep" }));
    for (const a of rest) dropdownList.append(coinRow(a));
  }

  // ── Spotlight: the big price and the day's range ────────────────────────────
  const bigPrice = h("span", { class: "cp-big-price", text: "-" });
  const changeBadge = h("span", { class: "cp-badge cp-change-lg up", text: "0.00%" });
  const clockBadge = h("span", { class: "cp-ms-badge", text: "--:--:--" });

  const highVal = h("span", { class: "cp-stat-chip-val", text: "-" });
  const lowVal = h("span", { class: "cp-stat-chip-val", text: "-" });
  const volVal = h("span", { class: "cp-stat-chip-val", text: "-" });
  const chip = (label: string, val: HTMLElement) => h("div", { class: "cp-stat-chip" }, h("span", { class: "cp-stat-chip-label", text: tl(label) }), val);

  const spotlightBar = h("div", { class: "cp-spotlight-bar" },
    h("div", { class: "cp-spotlight-left" }, bigPrice, changeBadge, clockBadge),
    h("div", { class: "cp-stats-chips" }, chip("24h High", highVal), chip("24h Low", lowVal), chip("24h Volume", volVal)));

  // ── Real-time Interactive Candlestick Chart: Timeframe Dropdown ────────────
  let tfDropdownOpen = false;
  const TIMEFRAMES: CryptoTimeframe[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

  function tfLabel(tf: CryptoTimeframe): string {
    const isFa = language() === "fa";
    switch (tf) {
      case "1m": return isFa ? "۱ دقیقه" : "1m";
      case "5m": return isFa ? "۵ دقیقه" : "5m";
      case "15m": return isFa ? "۱۵ دقیقه" : "15m";
      case "1h": return isFa ? "۱ ساعت" : "1h";
      case "4h": return isFa ? "۴ ساعت" : "4h";
      case "1d": return isFa ? "۱ روز" : "1d";
      default: return tf;
    }
  }

  const tfTriggerText = h("span", { class: "cp-tf-trigger-text", text: "1m" });
  const tfTriggerChevron = svg(ICONS.chevronDown, 11, { stroke: 2 });
  const tfTrigger = h(
    "button",
    {
      class: "cp-tf-trigger",
      type: "button",
      title: tl("Timeframe"),
      onclick: (e) => {
        e.stopPropagation();
        tfDropdownOpen = !tfDropdownOpen;
        tfDropdownEl.classList.toggle("open", tfDropdownOpen);
        if (tfDropdownOpen) renderTfMenu();
      },
    },
    tfTriggerText,
    tfTriggerChevron,
  );

  const tfMenu = h("div", { class: "cp-tf-menu", onclick: (e) => e.stopPropagation() });
  const tfDropdownEl = h("div", { class: "cp-tf-dropdown" }, tfTrigger, tfMenu);

  function renderTfMenu() {
    clear(tfMenu);
    const curTf = Crypto.state.timeframe || "1m";
    for (const tf of TIMEFRAMES) {
      const isSelected = tf === curTf;
      const item = h(
        "div",
        {
          class: isSelected ? "cp-tf-item active" : "cp-tf-item",
          onclick: () => {
            tfDropdownOpen = false;
            tfDropdownEl.classList.remove("open");
            void Bridge.cryptoSetTimeframe(tf).then(apply, (err) => {
              notice = cryptoErrorText(codeOf(err));
              renderView();
            });
          },
        },
        h("span", { class: "cp-tf-item-name", text: tfLabel(tf) }),
        isSelected ? svg(ICONS.check, 12, { stroke: 2 }) : null,
      );
      tfMenu.append(item);
    }
  }

  const btnCandles = h("button", {
    class: "cp-mode-btn active", type: "button", text: tl("Candles"),
    onclick: () => { chartMode = "candles"; btnCandles.classList.add("active"); btnLine.classList.remove("active"); renderView(); },
  });
  const btnLine = h("button", {
    class: "cp-mode-btn", type: "button", text: tl("Line"),
    onclick: () => { chartMode = "line"; btnLine.classList.add("active"); btnCandles.classList.remove("active"); renderView(); },
  });

  const ohlcOpen = h("b", { text: "-" });
  const ohlcHigh = h("b", { text: "-" });
  const ohlcLow = h("b", { text: "-" });
  const ohlcClose = h("b", { text: "-" });
  const ohlcPair = (label: string, value: HTMLElement) => h("span", { class: "cp-ohlc-item" }, h("span", { text: label }), value);
  const ohlcBar = h("div", { class: "cp-ohlc-bar" },
    ohlcPair("O:", ohlcOpen), ohlcPair("H:", ohlcHigh), ohlcPair("L:", ohlcLow), ohlcPair("C:", ohlcClose));

  const chartTop = h("div", { class: "cp-chart-top" },
    h("div", { class: "cp-chart-toolbar" }, tfDropdownEl, btnCandles, btnLine),
    ohlcBar);
  const chartSvgWrap = h("div", { class: "cp-chart-svg-wrap" });
  const chartEmpty = h("div", { class: "cp-setup-hint" });
  const chartCard = h("div", { class: "cp-chart-card" }, chartTop, chartSvgWrap, chartEmpty);

  const noticeEl = h("div", { class: "cp-setup-hint cp-error", role: "status" });

  const shell = h("div", { class: "cp-shell" }, heading, setupCard, offNote, pickerRow, favBar, spotlightBar, noticeEl, chartCard);
  const el = h("div", { class: "view crypto-view" }, card("amber", shell));

  const NS = "http://www.w3.org/2000/svg";
  const RED = "#F4505E";
  const GREEN = "#22C55E";

  function mk(tag: string, attrs: Record<string, string>): SVGElement {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node as SVGElement;
  }

  function drawChart(candles: CryptoCandle[], quote: CryptoQuote) {
    clear(chartSvgWrap);
    const n = candles.length;
    const width = 590;
    const height = 150;
    const padLeft = 8;
    const padRight = 82;
    const chartW = width - padLeft - padRight;
    const chartH = height - 22;

    const min = Math.min(...candles.map((k) => k.l));
    const max = Math.max(...candles.map((k) => k.h));
    const range = max - min || 1;
    const yOf = (p: number) => chartH - ((p - min) / range) * (chartH - 24) - 12;

    const shownCandle = hoveredIndex !== null && candles[hoveredIndex] ? candles[hoveredIndex] : candles[n - 1];
    ohlcOpen.textContent = formatPrice(shownCandle.o, quote, false);
    ohlcHigh.textContent = formatPrice(shownCandle.h, quote, false);
    ohlcLow.textContent = formatPrice(shownCandle.l, quote, false);
    ohlcClose.textContent = formatPrice(shownCandle.c, quote, false);

    const root = mk("svg", { viewBox: `0 0 ${width} ${height}`, class: "cp-chart-svg" });

    for (const lvl of [0.85, 0.6, 0.35, 0.1]) {
      const y = chartH * lvl;
      const label = mk("text", { x: String(width - padRight + 5), y: String(y), class: "cp-price-label" });
      label.textContent = formatAxisPrice(min + range * (1 - lvl), quote);
      root.append(mk("line", { x1: String(padLeft), y1: String(y), x2: String(width - padRight), y2: String(y), class: "cp-grid-line" }), label);
    }

    const stepX = chartW / n;
    const candleW = Math.max(3, stepX * 0.65);
    const maxVol = Math.max(...candles.map((k) => k.v)) || 1;
    const xOf = (i: number) => padLeft + (i + 0.5) * stepX;

    if (chartMode === "candles") {
      candles.forEach((k, i) => {
        const cx = xOf(i);
        const color = k.c >= k.o ? GREEN : RED;
        root.append(mk("line", { x1: cx.toFixed(1), y1: yOf(k.h).toFixed(1), x2: cx.toFixed(1), y2: yOf(k.l).toFixed(1), stroke: color, "stroke-width": "1.4" }));
        const top = Math.min(yOf(k.o), yOf(k.c));
        root.append(mk("rect", {
          x: (cx - candleW / 2).toFixed(1), y: top.toFixed(1), width: candleW.toFixed(1),
          height: Math.max(2, Math.abs(yOf(k.c) - yOf(k.o))).toFixed(1), rx: "1.2", fill: color,
        }));
        const volH = Math.max(2, (k.v / maxVol) * 18);
        root.append(mk("rect", {
          x: (cx - candleW / 2).toFixed(1), y: (chartH - volH).toFixed(1), width: candleW.toFixed(1),
          height: volH.toFixed(1), fill: color, opacity: "0.25",
        }));
        if (i % 7 === 0 || i === n - 1) {
          const d = new Date(k.t);
          const label = mk("text", { x: cx.toFixed(1), y: String(height - 4), class: "cp-time-axis-text" });
          if (Crypto.state.timeframe === "1d") {
            label.textContent = `${d.getMonth() + 1}/${d.getDate()}`;
          } else if (Crypto.state.timeframe === "4h" || Crypto.state.timeframe === "1h") {
            label.textContent = `${String(d.getHours()).padStart(2, "0")}:00`;
          } else {
            label.textContent = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
          }
          root.append(label);
        }
      });
    } else {
      const up = candles[n - 1].c >= candles[0].o;
      const color = up ? GREEN : RED;
      const gradId = `cp-line-grad-${up ? "up" : "down"}`;
      const grad = mk("linearGradient", { id: gradId, x1: "0", y1: "0", x2: "0", y2: "1" });
      grad.append(
        mk("stop", { offset: "0%", "stop-color": color, "stop-opacity": "0.32" }),
        mk("stop", { offset: "100%", "stop-color": color, "stop-opacity": "0" }));
      const defs = mk("defs", {});
      defs.append(grad);
      const pts = candles.map((k, i) => `${xOf(i).toFixed(1)},${yOf(k.c).toFixed(1)}`);
      const path = `M ${pts.join(" L ")}`;
      root.append(
        defs,
        mk("path", { d: `${path} L ${xOf(n - 1).toFixed(1)},${chartH} L ${xOf(0).toFixed(1)},${chartH} Z`, fill: `url(#${gradId})` }),
        mk("path", { d: path, fill: "none", stroke: color, "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round" }));
    }

    if (hoveredIndex !== null && hoveredIndex < n) {
      const hx = xOf(hoveredIndex).toFixed(1);
      root.append(mk("line", { x1: hx, y1: "0", x2: hx, y2: String(chartH), stroke: "rgba(255,255,255,0.2)", "stroke-dasharray": "2 2" }));
    }

    const last = candles[n - 1];
    const beacon = last.c >= last.o ? GREEN : RED;
    const bx = xOf(n - 1).toFixed(1);
    const by = yOf(last.c).toFixed(1);
    root.append(
      mk("circle", { cx: bx, cy: by, r: "5", fill: beacon, class: "cp-live-beacon" }),
      mk("circle", { cx: bx, cy: by, r: "3.5", fill: "#ffffff", stroke: beacon, "stroke-width": "2" }));

    root.onmousemove = (e) => {
      const rect = root.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * width;
      const idx = Math.max(0, Math.min(n - 1, Math.floor((x - padLeft) / stepX)));
      if (hoveredIndex !== idx) {
        hoveredIndex = idx;
        drawChart(candles, quote);
      }
    };
    root.onmouseleave = () => {
      if (hoveredIndex !== null) {
        hoveredIndex = null;
        drawChart(candles, quote);
      }
    };
    chartSvgWrap.append(root);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  function show(node: HTMLElement, on: boolean) {
    node.style.display = on ? "" : "none";
  }

  function renderView() {
    const s = Crypto.state;
    const needsSetup = s.enabled && !s.hasCredential;
    const running = s.enabled && s.hasCredential;

    show(setupCard, needsSetup);
    show(offNote, !s.enabled);
    show(pickerRow, running);
    show(spotlightBar, running);
    show(chartCard, running);
    show(changeApiBtn, running);
    show(quoteBtn, running && s.provider === "nobitex" && s.asset !== "USDT");
    // Every exchange signs its requests: a public key and a private key (Nobitex), or key and secret.
    const exchange = providerSelect.value;
    const nobitex = exchange === "nobitex";
    const exchangeName = nobitex ? t("Nobitex") : exchange === "toobit" ? t("Toobit") : t("Binance");
    tokenLabel.textContent = nobitex ? t("API key (public)") : t("API key");
    secretLabel.textContent = nobitex ? t("Private key (Secret Key)") : t("API secret");
    tokenInput.placeholder = t("Enter your {exchange} API key", { exchange: exchangeName });
    secretInput.placeholder = nobitex ? t("Enter your Nobitex private key") : t("Enter your API secret");
    setupNote.textContent = nobitex
      ? t("On Nobitex: Account → API services → new key (Read access). The private key is shown only once, when the key is created.")
      : exchange === "toobit"
        ? t("On Toobit: API Management → create a key with Read-only access.")
        : t("On Binance: API Management → create a key with Read-only access.");

    // Status pill
    const live = s.phase === "live";
    statusPill.className = `cp-status-pill${s.phase === "stale" ? " error" : live ? "" : " connecting"}`;
    statusLabel.textContent = !s.enabled ? t("Offline") : needsSetup ? t("No key")
      : live ? t("Live") : s.phase === "stale" ? t("Out of date") : t("Connecting…");
    updatedTag.textContent = running ? formatClock(s.updatedAt) : "";
    statusPill.title = s.error ? cryptoErrorText(s.error) : "";

    // Setup
    if (s.provider !== shownProvider) {
      shownProvider = s.provider;
      providerSelect.value = s.provider;
    }
    connectBtn.textContent = connecting ? t("Connecting…") : t("Connect & Start Tracking");
    (connectBtn as HTMLButtonElement).disabled = connecting;
    setupErrorEl.textContent = setupError || (needsSetup && s.error ? cryptoErrorText(s.error) : "");
    show(setupErrorEl, Boolean(setupErrorEl.textContent));

    if (!running) return;

    quoteBtn.textContent = s.quote === "USDT" ? "USDT" : t("Toman");

    // Sync active timeframe trigger
    const curTf = s.timeframe || "1m";
    tfTriggerText.textContent = tfLabel(curTf);
    if (tfDropdownOpen) renderTfMenu();

    const tk = visibleTicker(s);
    const name = coinName(s.asset);
    clear(triggerLogoWrap);
    triggerLogoWrap.append(createOfficialCoinLogo(s.asset, 24));
    triggerSymbol.textContent = s.asset;
    triggerName.textContent = `· ${name}`;

    // Favourites: the star and the default button for the coin on screen, and the quick-pick bar.
    const favs = favoriteList().filter((f) => f !== "USDT" || s.provider === "nobitex");
    const isFav = favoriteList().includes(s.asset);
    const isDefault = State.settings.cryptoDefaultAsset === s.asset;
    clear(starBtn);
    starBtn.append(isFav ? svg(ICONS.star, 15) : svg(ICONS.starOutline, 15, { stroke: 1.8 }));
    starBtn.classList.toggle("on", isFav);
    starBtn.title = isFav ? t("Remove from favorites") : t("Add to favorites");
    show(defaultBtn, isFav);
    defaultBtn.classList.toggle("on", isDefault);
    defaultBtn.textContent = t("Default");
    defaultBtn.title = isDefault ? t("This coin is shown when the app starts") : t("Show this coin when the app starts");
    clear(favBar);
    for (const f of favs) {
      favBar.append(h("button", { class: f === s.asset ? "cp-fav-chip active" : "cp-fav-chip", type: "button", onclick: () => choose(f) },
        createOfficialCoinLogo(f, 16),
        h("span", { text: f }),
        f === State.settings.cryptoDefaultAsset ? h("span", { class: "cp-chip-star", text: "★" }) : null));
    }
    show(favBar, favs.length > 0);

    if (tk) {
      const priceText = formatPrice(tk.price, s.quote);
      const chg = formatChange(tk.change);
      triggerPrice.textContent = priceText;
      triggerChange.textContent = chg.text;
      triggerChange.className = `cp-badge ${chg.positive ? "up" : "down"}`;
      bigPrice.textContent = priceText;
      bigPrice.classList.toggle("long", priceText.length > 13);
      changeBadge.textContent = chg.text;
      changeBadge.className = `cp-badge cp-change-lg ${chg.positive ? "up" : "down"}`;
      clockBadge.textContent = formatClock(s.updatedAt);
      highVal.textContent = formatAxisPrice(tk.high, s.quote);
      lowVal.textContent = formatAxisPrice(tk.low, s.quote);
      volVal.textContent = formatVolume(tk.volume);

      if (lastAsset === s.asset && lastPrice !== 0 && tk.price !== lastPrice) {
        if (flashTimer) clearTimeout(flashTimer);
        bigPrice.classList.remove("tick-up", "tick-down");
        void bigPrice.offsetWidth;
        bigPrice.classList.add(tk.price > lastPrice ? "tick-up" : "tick-down");
        flashTimer = setTimeout(() => bigPrice.classList.remove("tick-up", "tick-down"), 400) as unknown as number;
      }
      lastPrice = tk.price;
    } else {
      for (const node of [triggerPrice, bigPrice, highVal, lowVal, volVal]) node.textContent = "-";
      triggerChange.textContent = "";
      changeBadge.textContent = "";
      clockBadge.textContent = "--:--:--";
      lastPrice = 0;
    }
    lastAsset = s.asset;

    // A problem while prices are still on screen: say so, they are marked out of date.
    noticeEl.textContent = notice || (s.error ? cryptoErrorText(s.error) : "");
    show(noticeEl, Boolean(noticeEl.textContent));

    if (s.candles.length >= 2) {
      chartEmpty.textContent = "";
      show(chartEmpty, false);
      show(chartSvgWrap, true);
      drawChart(s.candles, s.quote);
    } else {
      clear(chartSvgWrap);
      show(chartSvgWrap, false);
      chartEmpty.textContent = s.candlesError ? cryptoErrorText(s.candlesError) : t("Waiting for the first candles…");
      show(chartEmpty, true);
      for (const node of [ohlcOpen, ohlcHigh, ohlcLow, ohlcClose]) node.textContent = "-";
    }

    if (dropdownOpen) renderDropdownList();
  }

  return {
    el,
    sync: renderView,
  };
}
