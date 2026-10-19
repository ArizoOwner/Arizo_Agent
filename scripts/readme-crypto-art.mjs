// Crypto scenes for the README (imported by gen-readme-art.mjs).
// Pure SVG + CSS/SMIL, like the rest of the README art: no scripts, no external requests,
// and every price on them is invented for the picture.

/**
 * @param {object} u  helpers from gen-readme-art.mjs: { save, svg, ariDefs, ari, star, CSS, SANS, FA, VIOLET, BLUE }
 */
export function cryptoArt(u) {
  const { save, svg, ariDefs, ari, star, CSS, SANS, FA, VIOLET } = u;
  const GOLD = "#F59E0B", UP = "#22c55e", DOWN = "#ef4444";

  // A tiny seeded generator, so the picture is the same every time the art is drawn.
  let sd = 11;
  const r = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);

  /** A walk of candles that ends higher than it starts. */
  function walk(n, drift) {
    let p = 0.5;
    return Array.from({ length: n }, (_, i) => {
      const o = p;
      const c = Math.min(0.92, Math.max(0.08, o + (r() - 0.5 + drift) * 0.16));
      const h = Math.min(0.98, Math.max(o, c) + r() * 0.07);
      const l = Math.max(0.02, Math.min(o, c) - r() * 0.07);
      p = c;
      return { o, c, h, l, up: c >= o };
    });
  }

  const COINS = {
    BTC: { bg: "#F7931A", glyph: `<text y="9" text-anchor="middle" font-size="26" font-weight="900" fill="#fff" style="font-family:${SANS}">₿</text>` },
    ETH: { bg: "#627EEA", glyph: `<path d="M0-13 L8 0 0 4 -8 0Z M0 6 L8 1.5 0 13 -8 1.5Z" fill="#fff"/>` },
    USDT: { bg: "#26A17B", glyph: `<text y="9" text-anchor="middle" font-size="25" font-weight="900" fill="#fff" style="font-family:${SANS}">₮</text>` },
    SOL: { bg: "#14151f", glyph: `<path d="M-9-7H8L10-4H-7Z M-9-1H8L10 2H-7Z M-9 5H8L10 8H-7Z" fill="#9945FF"/>` },
  };
  const coin = (sym, x, y, k = 1) => `<g transform="translate(${x} ${y}) scale(${k})"><circle r="16" fill="${COINS[sym].bg}"/><g transform="scale(.62)">${COINS[sym].glyph}</g></g>`;

  // ───────────────────────── the live island, three coins on three exchanges
  function island() {
    const W = 900, H = 430, DUR = 27;
    const SCENES = [
      { sym: "BTC", name: "Bitcoin", fa: "بیت‌کوین", ex: "Binance", unit: "$", tf: "1m", prices: ["$68,412.50", "$68,431.20", "$68,455.80", "$68,447.10"], chg: "+1.25%", hi: "$68,980", lo: "$67,120", up: true, favs: ["BTC", "ETH", "USDT", "SOL"], on: 0 },
      { sym: "ETH", name: "Ethereum", fa: "اتریوم", ex: "Toobit", unit: "$", tf: "15m", prices: ["$3,402.80", "$3,409.45", "$3,415.10", "$3,411.60"], chg: "+0.84%", hi: "$3,438", lo: "$3,355", up: true, favs: ["BTC", "ETH", "USDT", "SOL"], on: 1 },
      { sym: "BTC", name: "Bitcoin", fa: "بیت‌کوین", ex: "Nobitex", unit: "T", tf: "1h", prices: ["4,799,350,000 T", "4,801,200,000 T", "4,806,900,000 T", "4,803,550,000 T"], chg: "+0.92%", hi: "4,812.0M", lo: "4,741.5M", up: true, favs: ["USDT", "BTC", "ETH", "SOL"], on: 1 },
    ];
    const N = SCENES.length, SLOT = DUR / N;
    const pct = (v) => (v * 100).toFixed(3) + "%";
    const a = 0.012, b = 1 / N - 0.014; // fade in / hold / fade out inside a scene
    const slotCss = SCENES.map((_, i) => {
      const s = i / N;
      return `@keyframes cs${i}{0%,${pct(s + 0.0001)}{opacity:0;transform:translateY(10px) scale(.97)}${pct(s + a + 0.012)},${pct(s + b)}{opacity:1;transform:translateY(0) scale(1)}${pct(s + 1 / N)},100%{opacity:0;transform:translateY(-8px) scale(.98)}}.cs${i}{opacity:0;animation:cs${i} ${DUR}s infinite both}`;
    }).join("\n  ");
    const grow = (0.55 / DUR * 100).toFixed(3) + "%";
    const CSS_C = `
  ${slotCss}
  .cd{transform-box:fill-box;transform-origin:50% 50%;animation:cd ${DUR}s infinite both}
  @keyframes cd{0%{transform:scaleY(0);opacity:0}${grow}{transform:scaleY(1);opacity:1}100%{transform:scaleY(1);opacity:1}}
  .pulse2{transform-box:fill-box;transform-origin:center;animation:pulse2 1.6s ease-in-out infinite}
  @keyframes pulse2{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.8);opacity:.25}}
  .sweep2{animation:sweep2 5.4s ease-in-out infinite alternate}
  @keyframes sweep2{0%{transform:translateX(0)}100%{transform:translateX(486px)}}`;

    const CX = 168, CW = 504, CY = 188, CH = 112, COUNT = 24, STEP = CW / COUNT;
    const frames = SCENES.map((s, i) => {
      sd = 31 + i * 17;
      const cs = walk(COUNT, 0.045);
      const y = (v) => CY + CH - v * CH;
      const candles = cs.map((c, k) => {
        const x = CX + k * STEP + STEP / 2, col = c.up ? UP : DOWN;
        const top = y(Math.max(c.o, c.c)), hgt = Math.max(2.4, Math.abs(y(c.o) - y(c.c)));
        const delay = (i * SLOT + 0.25 + k * 0.07).toFixed(2);
        return `<g class="cd" style="animation-delay:${delay}s"><line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${y(c.h).toFixed(1)}" y2="${y(c.l).toFixed(1)}" stroke="${col}" stroke-width="1.6" stroke-linecap="round"/><rect x="${(x - 5.2).toFixed(1)}" y="${top.toFixed(1)}" width="10.4" height="${hgt.toFixed(1)}" rx="2" fill="${col}"/></g>`;
      }).join("");
      const last = cs[cs.length - 1], ly = y(last.c);
      // The price text ticks: four readings share the scene, one after the other.
      const subs = s.prices.map((p, j) => {
        const t0 = (i / N) + (j / 4) / N, t1 = (i / N) + ((j + 1) / 4) / N;
        const kt = [0, t0, t1, 1].map((v) => Math.min(1, Math.max(0, v)));
        const keyTimes = [...new Set(kt.map((v) => v.toFixed(4)))];
        const vals = keyTimes.map((k) => (+k >= t0 - 1e-6 && +k < t1 - 1e-6 ? "1" : "0"));
        return `<text x="772" y="140" text-anchor="end" font-size="${s.unit === "T" ? 28 : 34}" font-weight="800" fill="#fff" opacity="0" style="font-family:${SANS}">${p}<animate attributeName="opacity" calcMode="discrete" dur="${DUR}s" repeatCount="indefinite" keyTimes="${keyTimes.join(";")}" values="${vals.join(";")}"/></text>`;
      }).join("");
      const fav = s.favs.map((f, k) => {
        const on = k === s.on;
        return `<g transform="translate(${126 + k * 96} 330)"><rect width="84" height="26" rx="13" fill="${on ? "#f59e0b26" : "#ffffff0d"}" stroke="${on ? GOLD : "#ffffff1c"}" stroke-opacity="${on ? 0.9 : 1}"/><text x="14" y="18" font-size="12" fill="${GOLD}">★</text><text x="30" y="18" font-size="12.5" font-weight="700" fill="${on ? "#fff" : "#aab0c8"}">${f}</text></g>`;
      }).join("");
      return `
<g class="cs${i}">
  <rect x="96" y="22" width="708" height="352" rx="32" fill="#05060a" stroke="${GOLD}" stroke-opacity=".45" style="filter:drop-shadow(0 14px 34px #f59e0b30)"/>
  <!-- header: brand, live dot, exchange, timeframe -->
  <g transform="translate(126 44)">
    <rect width="104" height="28" rx="14" fill="#f59e0b22" stroke="${GOLD}" stroke-opacity=".55"/>
    <text x="14" y="19" font-size="13" fill="${GOLD}">◈</text><text x="31" y="19" font-size="13" font-weight="800" fill="#fff">Crypto</text>
    <circle class="pulse2" cx="86" cy="14" r="3.6" fill="${UP}"/>
  </g>
  <g transform="translate(244 44)"><rect width="${s.ex.length * 8 + 30}" height="28" rx="14" fill="#ffffff0d" stroke="#ffffff1c"/><text x="${(s.ex.length * 8 + 30) / 2}" y="19" text-anchor="middle" font-size="12.5" font-weight="700" fill="#cfd3e6">${s.ex}</text></g>
  <g transform="translate(618 44)"><rect width="72" height="28" rx="14" fill="#ffffff0d" stroke="#ffffff1c"/><text x="26" y="19" text-anchor="middle" font-size="12.5" font-weight="800" fill="#fff">${s.tf}</text><path d="M46 12 L52 18 58 12" fill="none" stroke="#9aa0b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g>
  <g transform="translate(702 44)"><rect width="76" height="28" rx="14" fill="#ffffff0d" stroke="#ffffff1c"/><text x="38" y="19" text-anchor="middle" font-size="12" font-weight="700" fill="#cfd3e6">$ ⇄ T</text></g>
  <!-- coin and price -->
  ${coin(s.sym, 146, 130, 1.45)}
  <text x="184" y="124" font-size="24" font-weight="800" fill="#fff">${s.sym}</text>
  <text x="184" y="146" font-size="13" fill="#9aa0b8">${s.name}  ·  <tspan style="font-family:${FA}">${s.fa}</tspan></text>
  ${subs}
  <g transform="translate(772 152)"><rect x="-76" y="0" width="76" height="22" rx="11" fill="#22c55e22"/><text x="-38" y="15.5" text-anchor="middle" font-size="12.5" font-weight="800" fill="${UP}">▲ ${s.chg}</text></g>
  <!-- chart -->
  <g stroke="#ffffff10" stroke-width="1">${[0, 1, 2, 3].map((g) => `<line x1="${CX}" x2="${CX + CW}" y1="${CY + (g * CH) / 3}" y2="${CY + (g * CH) / 3}"/>`).join("")}</g>
  <text x="${CX + CW + 10}" y="${CY + 4}" font-size="10.5" fill="#7f86a3" font-family="monospace">${s.hi}</text>
  <text x="${CX + CW + 10}" y="${CY + CH + 4}" font-size="10.5" fill="#7f86a3" font-family="monospace">${s.lo}</text>
  ${candles}
  <line x1="${CX}" x2="${CX + CW}" y1="${ly.toFixed(1)}" y2="${ly.toFixed(1)}" stroke="${UP}" stroke-opacity=".55" stroke-dasharray="4 4"/>
  <g transform="translate(${CX} ${CY - 6})"><g class="sweep2"><line y1="0" y2="${CH + 12}" stroke="#ffffff55" stroke-dasharray="3 4"/><circle cy="${CH / 2 + 6}" r="4" fill="#fff"/></g></g>
  <!-- favourites -->
  ${fav}
</g>`;
    }).join("");

    const dots = SCENES.map((s, i) => `<circle cx="${450 - (N - 1) * 9 + i * 18}" cy="404" r="3.6" fill="#ffffff2a"><animate attributeName="fill" calcMode="discrete" dur="${DUR}s" repeatCount="indefinite" keyTimes="0;${(i / N).toFixed(4)};${((i + 1) / N).toFixed(4)}" values="#ffffff2a;${GOLD};#ffffff2a"/></circle>`).join("");
    const body = `
<defs>
  <linearGradient id="cbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#150f05"/><stop offset=".55" stop-color="#0d0d1a"/><stop offset="1" stop-color="#0b1320"/></linearGradient>
  <filter id="cg" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="46"/></filter>
</defs>
<style>${CSS}${CSS_C}</style>
<rect width="${W}" height="${H}" rx="28" fill="url(#cbg)"/>
<circle cx="130" cy="360" r="130" fill="${GOLD}" opacity=".26" filter="url(#cg)"/>
<circle cx="800" cy="40" r="120" fill="${VIOLET}" opacity=".22" filter="url(#cg)"/>
${star(60, 70, 1, 0)}${star(846, 380, .9, 1.2)}${star(840, 60, .7, .6)}
${frames}
${dots}
<rect width="${W}" height="${H}" rx="28" fill="none" stroke="#ffffff14"/>`;
    save("crypto.svg", svg(W, H, body, 'aria-label="The crypto section of the island: live price, candlestick chart, timeframe, exchange and favourite coins for Bitcoin, Ethereum and Tether"'));
  }

  // ───────────────────────── four steps and three exchanges
  function flow() {
    const W = 1200, H = 352;
    const S = [
      ["1", "Connect your exchange", "اتصال به صرافی", "Paste a read-only API key — it is checked, then locked away", "🔑", "#f59e0b"],
      ["2", "Pick a coin", "انتخاب ارز", "The list and the icons come from the exchange itself", "🪙", "#38bdf8"],
      ["3", "Star your favourites", "موردعلاقه‌ها", "Choose one as the default: it is the island's first coin", "⭐", "#fbbf24"],
      ["4", "Choose a timeframe", "انتخاب تایم‌فریم", "1m, 5m, 15m, 1h, 4h or 1d candles from a dropdown", "⏱️", "#a78bfa"],
    ];
    const cw = 250, gap = 40, x0 = 40;
    const tiles = S.map(([n, en, fa, sub, ic, c], i) => {
      const x = x0 + i * (cw + gap);
      const words = sub.split(" "); const ls = []; let cur = "";
      for (const w of words) { if ((cur + " " + w).trim().length > 31) { ls.push(cur); cur = w; } else cur = (cur + " " + w).trim(); }
      if (cur) ls.push(cur);
      return `
  <g transform="translate(${x} 34)"><g class="st" style="animation-delay:${(i * 0.6).toFixed(1)}s">
    <rect width="${cw}" height="172" rx="22" fill="#12121c" stroke="${c}" stroke-opacity=".45"/>
    <circle cx="40" cy="40" r="22" fill="${c}"/><text x="40" y="48" text-anchor="middle" font-size="22" font-weight="900" fill="#0b0b12">${n}</text>
    <text x="${cw - 24}" y="52" text-anchor="end" font-size="30" style="font-family:'Segoe UI Emoji','Apple Color Emoji',sans-serif">${ic}</text>
    <text x="24" y="86" font-size="17" font-weight="800" fill="#fff">${en}</text>
    <text x="${cw - 24}" y="108" text-anchor="end" font-size="13.5" fill="${c}" style="font-family:${FA}">${fa}</text>
    ${ls.map((l, k) => `<text x="24" y="${134 + k * 17}" font-size="12.5" fill="#aab0c8">${l}</text>`).join("")}
  </g></g>
  ${i < 3 ? `<g transform="translate(${x + cw + gap / 2} 120)"><path class="arrow" d="M-8-8 L6 0 -8 8" fill="none" stroke="#ffffff55" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="animation-delay:${(i * 0.3).toFixed(1)}s"/></g>` : ""}`;
    }).join("");

    const EX = [
      ["Nobitex", "نوبیتکس", "IRT · USDT", "#2563eb", "Ed25519 signed key"],
      ["Binance", "بایننس", "USDT", "#f0b90b", "HMAC-SHA256 key"],
      ["Toobit", "توبیت", "USDT", "#22c55e", "HMAC-SHA256 key"],
    ];
    const LOOP = 9;
    const chips = EX.map(([en, fa, q, c, note], i) => {
      const x = 130 + i * 340, s = i / EX.length, e = (i + 1) / EX.length;
      const kt = [0, s, e, 1].map((v) => v.toFixed(4)), vals = ["0.35", "1", "0.35", "0.35"];
      const keyTimes = kt.filter((v, k) => k === 0 || v !== kt[k - 1]);
      const values = vals.slice(0, keyTimes.length);
      return `
  <g transform="translate(${x} 236)">
    <rect width="300" height="84" rx="20" fill="#12121c" stroke="${c}" stroke-opacity=".5"/>
    <rect width="300" height="84" rx="20" fill="${c}" opacity="0"><animate attributeName="opacity" calcMode="discrete" dur="${LOOP}s" repeatCount="indefinite" keyTimes="${keyTimes.join(";")}" values="${i === 0 ? "0.14;0.14;0;0" : i === 1 ? "0;0.14;0;0" : "0;0;0.14;0"}"/></rect>
    <circle cx="42" cy="42" r="22" fill="${c}"/><text x="42" y="50" text-anchor="middle" font-size="22" font-weight="900" fill="#0b0b12">${en[0]}</text>
    <text x="78" y="36" font-size="19" font-weight="800" fill="#fff">${en}  <tspan font-size="14" fill="${c}" style="font-family:${FA}">${fa}</tspan></text>
    <text x="78" y="58" font-size="12.5" fill="#aab0c8">${q}  ·  ${note}</text>
  </g>`;
    }).join("");

    const body = `
<style>${CSS}
  .st{opacity:0;animation:st 8s ease-out infinite both}
  @keyframes st{0%{opacity:0;transform:translateY(14px)}8%,94%{opacity:1;transform:translateY(0)}100%{opacity:1}}
  .arrow{animation:arrow 1.4s ease-in-out infinite}
  @keyframes arrow{0%,100%{transform:translateX(-3px);opacity:.35}50%{transform:translateX(4px);opacity:1}}
</style>
<rect width="${W}" height="${H}" rx="26" fill="#0b0b13" stroke="#ffffff14"/>
${tiles}
${chips}`;
    save("crypto-flow.svg", svg(W, H, body, 'aria-label="Connect your exchange, pick a coin, star your favourites, choose a timeframe — Nobitex, Binance or Toobit"'));
  }

  island();
  flow();
}
