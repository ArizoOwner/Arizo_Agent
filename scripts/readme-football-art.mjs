// Football scenes for the README (imported by gen-readme-art.mjs).
// Pure SVG + CSS/SMIL, like the rest of the README art.

/**
 * @param {object} u  helpers from gen-readme-art.mjs: { save, svg, ariDefs, CSS, BODY, SANS, FA, VIOLET }
 */
export function footballArt(u) {
  const { save, svg, ariDefs, CSS, BODY, SANS, FA, VIOLET } = u;

  const SLOTS = 8, HOLD = ((100 / SLOTS) * 0.78).toFixed(2) + "%", OUT = ((100 / SLOTS) * 0.96).toFixed(2) + "%";
  const FB_CSS = `
  .fbf{opacity:0;animation:fbf var(--dur) infinite both}
  @keyframes fbf{0%{opacity:0;transform:translateY(8px) scale(.96)}2.5%{opacity:1;transform:translateY(0) scale(1)}${HOLD}{opacity:1;transform:translateY(0) scale(1)}${OUT}{opacity:0;transform:translateY(-8px) scale(.98)}100%{opacity:0}}
  .isl{transform-box:fill-box;transform-origin:50% 0;animation:isl var(--dur) infinite both}
  @keyframes isl{0%{transform:scale(.46,.1)}3.5%{transform:scale(1.02,1.02)}5%{transform:scale(1,1)}${HOLD}{transform:scale(1,1)}${OUT}{transform:scale(.46,.1)}100%{transform:scale(.46,.1)}}
  .ball{transform-box:fill-box;transform-origin:center;animation:ball 2.6s linear infinite both;opacity:0}
  @keyframes ball{0%{opacity:0;transform:translate(0,-20px) rotate(0)}10%{opacity:1}100%{opacity:0;transform:translate(var(--sx),230px) rotate(540deg)}}
  .conf{transform-box:fill-box;transform-origin:center;animation:conf 3s ease-in infinite both;opacity:0}
  @keyframes conf{0%{opacity:0;transform:translate(0,-20px) rotate(0)}10%{opacity:1}100%{opacity:0;transform:translate(var(--sx),230px) rotate(420deg)}}
  .card{transform-box:fill-box;transform-origin:center;animation:conf 3.4s ease-in infinite both;opacity:0}
  .drip{transform-box:fill-box;transform-origin:center;animation:conf 2.8s ease-in infinite both;opacity:0}
  .jump{transform-box:fill-box;transform-origin:50% 100%;animation:jump .62s ease-in-out infinite}
  @keyframes jump{0%,100%{transform:translateY(0) scale(1.03,.96)}50%{transform:translateY(-22px) scale(.97,1.04)}}
  .droop{transform-box:fill-box;transform-origin:50% 100%;animation:droop 3s ease-in-out infinite}
  @keyframes droop{0%,100%{transform:translateY(3px) scale(1.02,.96)}50%{transform:translateY(5px) scale(1.03,.95)}}
  .sweat{animation:sweat 2.2s ease-in infinite both;opacity:0}
  @keyframes sweat{0%{opacity:0;transform:translateY(0)}20%{opacity:.9}100%{opacity:0;transform:translateY(34px)}}`;

  /** Ari in a team shirt: stripes (or plain) clipped to the body, V collar, number, headband. */
  function kitAri(id, main, alt, trim, pattern = "stripes") {
    const stripes = pattern === "stripes"
      ? [-100, -60, -20, 20, 60, 100].map((x, i) => (i % 2 === 0 ? `<rect x="${x - 20}" y="14" width="40" height="100" fill="${alt}"/>` : "")).join("")
      : "";
    return `
  <clipPath id="${id}clip"><path d="${BODY}"/></clipPath>
  <g class="breathe">
    <path d="${BODY}" fill="url(#${id}b)"/>
    <path d="${BODY}" fill="url(#${id}e)"/>
    <g clip-path="url(#${id}clip)">
      <rect x="-130" y="14" width="260" height="100" fill="${main}"/>${stripes}
      <rect x="-130" y="14" width="260" height="100" fill="url(#${id}sh)"/>
      <rect x="-130" y="64" width="260" height="6" fill="${trim}" opacity=".9"/>
      <path d="M-34 14 L0 52 L34 14" fill="none" stroke="#000" stroke-opacity=".3" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M-34 14 L0 52 L34 14" fill="none" stroke="${trim}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="0" y="86" text-anchor="middle" font-size="34" font-weight="900" fill="${trim}" stroke="#000" stroke-opacity=".45" stroke-width="3" paint-order="stroke" style="font-family:${SANS}">10</text>
    </g>
    <path d="${BODY}" fill="url(#${id}h)"/>
    <path d="M-86 -52 Q0 -86 86 -52 L84 -40 Q0 -72 -84 -40Z" fill="${main}" stroke="${trim}" stroke-width="2"/>
    <g class="look"><g class="eye"><ellipse cx="-46" cy="-4" rx="11" ry="17" fill="#0e0c10"/><circle cx="-42.5" cy="-10" r="3.6" fill="#fff"/></g><g class="eye"><ellipse cx="46" cy="-4" rx="11" ry="17" fill="#0e0c10"/><circle cx="49.5" cy="-10" r="3.6" fill="#fff"/></g></g>
  </g>`;
  }

  const shade = (id) => `<linearGradient id="${id}sh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".32"/></linearGradient>`;

  // ───────────────────────── the match: the island reacts to every moment
  function football() {
    const W = 900, H = 400, DUR = 36;
    const SHOWS = [
      { word: "KICK-OFF!", fa: "شروع بازی!", sub: "Barcelona  0 – 0  Real Madrid", c: "#34d399", rain: "ball", mood: "jump" },
      { word: "GOAL!", fa: "گل!", sub: "L. Yamal 23'  ·  1 – 0", c: "#fbbf24", rain: "party", mood: "jump" },
      { word: "YELLOW CARD", fa: "کارت زرد", sub: "Pedri 31'", c: "#facc15", rain: "yellow", mood: "calm" },
      { word: "HALF-TIME", fa: "پایان نیمهٔ اول", sub: "Barcelona  1 – 0  Real Madrid", c: "#2dd4bf", rain: "none", mood: "calm" },
      { word: "GOAL CONCEDED", fa: "گل خوردیم", sub: "K. Mbappé 58'  ·  1 – 1", c: "#60a5fa", rain: "drip", mood: "sad" },
      { word: "RED CARD!", fa: "کارت قرمز!", sub: "R. Araujo 64'", c: "#f87171", rain: "red", mood: "sad" },
      { word: "OPPONENT SENT OFF!", fa: "اخراج حریف!", sub: "Tchouameni 71'", c: "#f87171", rain: "red", mood: "jump" },
      { word: "FULL TIME: WIN!", fa: "پایان بازی: برد!", sub: "Barcelona  2 – 1  Real Madrid", c: "#fbbf24", rain: "party", mood: "jump" },
    ];
    const SLOT = DUR / SHOWS.length;
    const rain = (kind, i) => {
      const n = kind === "none" ? 0 : kind === "party" ? 26 : 14;
      let out = "";
      for (let k = 0; k < n; k++) {
        const x = 170 + ((k * 137 + i * 53) % 560), sx = ((k * 61 + i * 17) % 90) - 45, d = ((k * 0.19 + i * 0.07) % 2.4).toFixed(2);
        const hue = (k * 47 + i * 23) % 360;
        const pre = `<g transform="translate(${x} 78)">`;
        if (kind === "ball") out += `${pre}<g class="ball" style="--sx:${sx}px;animation-delay:${d}s"><circle r="9" fill="#fff"/><path d="M0-5 4-1.5 2.6 3.6H-2.6L-4-1.5Z" fill="#1f2937"/></g></g>`;
        else if (kind === "party") out += `${pre}<g class="conf" style="--sx:${sx}px;animation-delay:${d}s"><rect x="-4" y="-7" width="8" height="14" rx="2" fill="hsl(${hue} 90% 62%)"/></g></g>`;
        else if (kind === "yellow" || kind === "red") out += `${pre}<g class="card" style="--sx:${sx}px;animation-delay:${d}s"><rect x="-6" y="-9" width="12" height="18" rx="2.5" fill="${kind === "yellow" ? "#facc15" : "#ef4444"}"/></g></g>`;
        else if (kind === "drip") out += `${pre}<g class="drip" style="--sx:${Math.round(sx / 3)}px;animation-delay:${d}s"><path d="M0-9 C6-1 7 5 0 7 -7 5 -6-1 0-9Z" fill="#60a5fa"/></g></g>`;
      }
      return out;
    };
    const frames = SHOWS.map((sh, i) => {
      const vars = `--dur:${DUR}s;animation-delay:${(i * SLOT).toFixed(2)}s`;
      // Each show is its own element in the loop; its keyframes are relative to the loop, shifted by the delay.
      const kit = kitAri("k" + i, "#A50044", "#004D98", "#EDBB00");
      const ari = sh.mood === "sad"
        ? `<g class="droop">${kit}</g><g transform="translate(70 -34)"><path class="sweat" d="M0-8 C5-1 6 4 0 6 -6 4 -5-1 0-8Z" fill="#9ad1ff"/></g>`
        : sh.mood === "jump" ? `<g class="jump">${kit}</g>` : `<g class="float">${kit}</g>`;
      return `
<g class="fbf" style="${vars}">
  <rect class="isl" x="140" y="62" width="620" height="262" rx="34" fill="#05060a" stroke="${sh.c}" stroke-opacity=".55" style="${vars};filter:drop-shadow(0 12px 30px ${sh.c}44)"/>
  <g>${rain(sh.rain, i)}</g>
  <g transform="translate(450 250) scale(.5)">${ari}</g>
  <text x="450" y="112" text-anchor="middle" font-size="${sh.word.length > 16 ? 34 : 46}" font-weight="900" fill="${sh.c}" style="filter:drop-shadow(0 0 14px ${sh.c}aa)">${sh.word}</text>
  <text x="450" y="140" text-anchor="middle" font-size="22" font-weight="700" fill="#fff" style="font-family:${FA}">${sh.fa}</text>
  <text x="450" y="164" text-anchor="middle" font-size="15" fill="#c9cdea" font-family="monospace">${sh.sub}</text>
</g>`;
    }).join("");
    const dots = SHOWS.map((sh, i) => `<circle cx="${450 - (SHOWS.length - 1) * 9 + i * 18}" cy="372" r="3.4" fill="#ffffff2a"><animate attributeName="fill" calcMode="discrete" dur="${DUR}s" repeatCount="indefinite" keyTimes="0;${((i * SLOT) / DUR).toFixed(4)};${(((i + 1) * SLOT) / DUR).toFixed(4)}" values="#ffffff2a;${sh.c};#ffffff2a"/></circle>`).join("");
    const defs = SHOWS.map((_, i) => ariDefs("k" + i) + shade("k" + i)).join("");
    const body = `
<defs>${defs}
  <linearGradient id="fbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#07130f"/><stop offset="1" stop-color="#0d0d1a"/></linearGradient>
  <filter id="fg" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="46"/></filter>
</defs>
<style>${CSS}${FB_CSS}</style>
<rect width="${W}" height="${H}" rx="28" fill="url(#fbg)"/>
<circle cx="150" cy="330" r="130" fill="#10b981" opacity=".28" filter="url(#fg)"/>
<circle cx="780" cy="40" r="120" fill="${VIOLET}" opacity=".22" filter="url(#fg)"/>
<g fill="none" stroke="#ffffff10" stroke-width="2"><rect x="60" y="300" width="780" height="70" rx="6"/><line x1="450" y1="300" x2="450" y2="370"/><circle cx="450" cy="335" r="22"/></g>
<g transform="translate(46 28)"><rect width="150" height="30" rx="15" fill="#ffffff10" stroke="#ffffff1c"/><circle cx="16" cy="15" r="5" fill="#ef4444"><animate attributeName="opacity" values="1;.25;1" dur="1.2s" repeatCount="indefinite"/></circle><text x="30" y="20" font-size="13" font-weight="700" fill="#fff">LIVE · every 3 s</text></g>
<g transform="translate(704 28)"><rect width="150" height="30" rx="15" fill="#ffffff10" stroke="#ffffff1c"/><text x="75" y="20" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">BAR vs RMA</text></g>
${frames}
${dots}
<rect width="${W}" height="${H}" rx="28" fill="none" stroke="#ffffff14"/>`;
    save("football.svg", svg(W, H, body, 'aria-label="The island growing for every moment of a match while Ari reacts in his team kit"'));
  }

  // ───────────────────────── the kits: Ari in different teams' shirts
  function kits() {
    const W = 900, H = 270;
    const TEAMS = [
      ["Barcelona", "بارسلونا", "#A50044", "#004D98", "#EDBB00", "stripes"],
      ["Real Madrid", "رئال مادرید", "#FFFFFF", "#F1F1F1", "#111111", "solid"],
      ["Juventus", "یوونتوس", "#111111", "#F5F5F5", "#F5F5F5", "stripes"],
      ["Paris Saint-Germain", "پاری‌سن‌ژرمن", "#0A1F44", "#C8102E", "#FFFFFF", "solid"],
      ["AC Milan", "میلان", "#E10A1C", "#111111", "#FFFFFF", "stripes"],
      ["Esteghlal", "استقلال", "#1E6FD9", "#1E6FD9", "#FFFFFF", "solid"],
    ];
    const party = TEAMS.map(([en, fa, a, b, trim, pat], i) => `
  <g transform="translate(${112 + i * 135} 124)">
    <g transform="scale(.36)"><g class="${i % 2 ? "float" : "drift"}" style="animation-delay:${(i * 0.4).toFixed(1)}s">${kitAri("p" + i, a, b, trim, pat)}</g></g>
    <text x="0" y="92" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">${en}</text>
    <text x="0" y="112" text-anchor="middle" font-size="14" fill="#9aa0b8" style="font-family:${FA}">${fa}</text>
  </g>`).join("");
    const defs = TEAMS.map((_, i) => ariDefs("p" + i) + shade("p" + i)).join("");
    const body = `
<defs>${defs}<linearGradient id="kbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b0b13"/><stop offset="1" stop-color="#101a14"/></linearGradient></defs>
<style>${CSS}</style>
<rect width="${W}" height="${H}" rx="28" fill="url(#kbg)"/>
<text x="450" y="40" text-anchor="middle" font-size="20" font-weight="800" fill="#fff">Every team in its own kit</text>
<text x="450" y="64" text-anchor="middle" font-size="15" fill="#9aa0b8" style="font-family:${FA}">هر تیم با پیراهن و رنگ خودش</text>
${party}
<rect width="${W}" height="${H}" rx="28" fill="none" stroke="#ffffff14"/>`;
    save("kits.svg", svg(W, H, body, 'aria-label="Ari wearing the kits of Barcelona, Real Madrid, Juventus, Paris Saint-Germain, AC Milan and Esteghlal"'));
  }

  football();
  kits();
}
