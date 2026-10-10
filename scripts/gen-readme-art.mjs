// Draws the animated SVGs used by the README (Ari, the demo, the wardrobe, the marquee…).
// Pure SVG + CSS/SMIL, no scripts and no external requests, so GitHub plays them as-is.
//   npm run readme-art

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "assets", "readme");
mkdirSync(outDir, { recursive: true });

const SANS = "'Segoe UI','Inter',system-ui,-apple-system,Arial,sans-serif";
const FA = "Vazirmatn,Tahoma,'Segoe UI',sans-serif";
const BLUE = "#3b82f6";
const VIOLET = "#a78bfa";

let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

const svg = (w, h, body, extra = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" ${extra}>\n${body}\n</svg>\n`;
const save = (name, content) => writeFileSync(join(outDir, name), content);

/** Keyframed SMIL <animate>. frames = [[t0..1, value], ...] */
function anim(attr, dur, frames, extra = "") {
  const kt = frames.map(([t]) => t).join(";");
  const vals = frames.map(([, v]) => v).join(";");
  return `<animate attributeName="${attr}" dur="${dur}s" repeatCount="indefinite" keyTimes="${kt}" values="${vals}" ${extra}/>`;
}

function squircle(cx, cy, rx, ry, p = 3.3, n = 96) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    pts.push([cx + rx * Math.sign(c) * Math.abs(c) ** (2 / p), cy + ry * Math.sign(s) * Math.abs(s) ** (2 / p)]);
  }
  return "M" + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L") + "Z";
}

const BODY_RX = 120, BODY_RY = 98;
const BODY = squircle(0, 0, BODY_RX, BODY_RY);

const ariDefs = (id) => `
  <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbfbfd"/><stop offset="1" stop-color="#c4c8d3"/></linearGradient>
  <radialGradient id="${id}e" cx="0.5" cy="0.5" r="0.62"><stop offset="0.62" stop-color="#8e94a8" stop-opacity="0"/><stop offset="1" stop-color="#8e94a8" stop-opacity="0.5"/></radialGradient>
  <radialGradient id="${id}h" cx="0.36" cy="0.3" r="0.45"><stop offset="0" stop-color="#fff" stop-opacity="0.85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <filter id="${id}blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>`;

/** Ari in local coordinates (origin = body centre). */
function ari(id, { outfit = "", eyesAnim = "", extraBody = "" } = {}) {
  const eye = (x) => `<g class="eye"><ellipse cx="${x}" cy="-4" rx="11" ry="17" fill="#0e0c10"/><circle cx="${x + 3.5}" cy="-10" r="3.6" fill="#fff"/></g>`;
  return `
  <g class="breathe">
    <path d="${BODY}" fill="url(#${id}b)"/>
    <path d="${BODY}" fill="url(#${id}e)"/>
    <path d="${BODY}" fill="url(#${id}h)"/>
    ${extraBody}
    <ellipse cx="-74" cy="22" rx="17" ry="9" fill="#ff8fa6" opacity="0.38" filter="url(#${id}blur)" style="filter:blur(4px)"/>
    <ellipse cx="74" cy="22" rx="17" ry="9" fill="#ff8fa6" opacity="0.38" style="filter:blur(4px)"/>
    <g class="look">${eyesAnim}${eye(-46)}${eye(46)}</g>
    ${outfit}
  </g>`;
}

const CSS = `
  text{font-family:${SANS}}
  .float{animation:float 5s ease-in-out infinite}
  @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
  .breathe{transform-box:fill-box;transform-origin:50% 100%;animation:breathe 4s ease-in-out infinite}
  @keyframes breathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.025,.972)}}
  .eye{transform-box:fill-box;transform-origin:center;animation:blink 5s infinite}
  @keyframes blink{0%,91%,100%{transform:scaleY(1)}94%{transform:scaleY(.08)}}
  .look{animation:look 9s ease-in-out infinite}
  @keyframes look{0%,100%{transform:translate(0,0)}15%{transform:translate(-14px,3px)}35%{transform:translate(12px,-3px)}55%{transform:translate(0,6px)}75%{transform:translate(8px,2px)}}
  .spark{transform-box:fill-box;transform-origin:center;animation:spark 3s ease-in-out infinite}
  @keyframes spark{0%,100%{transform:scale(.2) rotate(0);opacity:0}50%{transform:scale(1) rotate(45deg);opacity:1}}
  .drift{animation:drift 7s ease-in-out infinite}
  @keyframes drift{0%,100%{transform:translate(0,0)}50%{transform:translate(0,-14px)}}
  .twinkle{animation:twinkle 4s ease-in-out infinite}
  @keyframes twinkle{0%,100%{opacity:.15}50%{opacity:.9}}
  .pair{transform-box:fill-box;transform-origin:center;animation:pair 9s infinite both;opacity:0}
  @keyframes pair{0%{opacity:0;transform:scale(.7) translateY(10px)}4%{opacity:1;transform:scale(1.04) translateY(0)}6%{transform:scale(1)}29%{opacity:1;transform:scale(1)}33%{opacity:0;transform:scale(.9) translateY(-8px)}100%{opacity:0}}
`;

const star = (x, y, s, delay) =>
  `<g transform="translate(${x} ${y}) scale(${s})"><path class="spark" style="animation-delay:${delay}s" d="M0-10 L2.6-2.6 10 0 2.6 2.6 0 10 -2.6 2.6 -10 0 -2.6-2.6Z" fill="#fff"/></g>`;

// ─────────────────────────────────────────────── hero
function hero() {
  const W = 1200, H = 500;
  const dots = Array.from({ length: 34 }, () => {
    const x = rnd() * W, y = rnd() * H, r = 0.8 + rnd() * 1.8, d = (rnd() * 4).toFixed(2);
    return `<circle class="twinkle" style="animation-delay:${d}s" cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}" fill="#fff"/>`;
  }).join("");
  const pairs = [
    ["Good morning!", "صبح بخیر!"],
    ["Thank you", "ممنون"],
    ["See you soon", "به زودی می‌بینمت"],
  ];
  const bubble = (x, y, text, dir, delay, rtl) => {
    const w = 210, h = 54, tx = dir > 0 ? x + w - 34 : x + 34;
    return `
    <g class="pair" style="animation-delay:${delay}s">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="${rtl ? "#1a1530" : "#10203a"}" stroke="${rtl ? VIOLET : BLUE}" stroke-opacity=".6"/>
      <path d="M${tx - 9} ${y + h - 1} L${tx + (dir > 0 ? 14 : -14)} ${y + h + 16} L${tx + 9} ${y + h - 1}Z" fill="${rtl ? "#1a1530" : "#10203a"}" stroke="${rtl ? VIOLET : BLUE}" stroke-opacity=".6" stroke-linejoin="round"/>
      <rect x="${tx - 8}" y="${y + h - 3}" width="16" height="4" fill="${rtl ? "#1a1530" : "#10203a"}"/>
      <text x="${x + w / 2}" y="${y + 35}" text-anchor="middle" font-size="${rtl ? 24 : 22}" font-weight="600" fill="#fff" ${rtl ? `style="font-family:${FA}"` : ""}>${text}</text>
    </g>`;
  };
  const bubbles = pairs
    .map(([en, fa], i) => bubble(250, 150, en, 1, i * 3, false) + bubble(740, 150, fa, -1, i * 3, true))
    .join("");

  const body = `
<defs>
  ${ariDefs("a")}
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a0a12"/><stop offset="1" stop-color="#15101f"/></linearGradient>
  <linearGradient id="title" gradientUnits="userSpaceOnUse" x1="300" y1="0" x2="900" y2="0" spreadMethod="reflect">
    <stop offset="0" stop-color="#60a5fa"/><stop offset=".5" stop-color="#f5f3ff"/><stop offset="1" stop-color="${VIOLET}"/>
    <animateTransform attributeName="gradientTransform" type="translate" from="-600 0" to="600 0" dur="6s" repeatCount="indefinite"/>
  </linearGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="55"/></filter>
  <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10"/></filter>
  <clipPath id="clip"><rect width="${W}" height="${H}" rx="30"/></clipPath>
</defs>
<style>${CSS}</style>
<g clip-path="url(#clip)">
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <circle r="230" fill="${BLUE}" opacity=".5" filter="url(#glow)"><animate attributeName="cx" values="140;300;140" dur="11s" repeatCount="indefinite"/><animate attributeName="cy" values="470;380;470" dur="11s" repeatCount="indefinite"/></circle>
  <circle r="210" fill="${VIOLET}" opacity=".45" filter="url(#glow)"><animate attributeName="cx" values="1070;900;1070" dur="13s" repeatCount="indefinite"/><animate attributeName="cy" values="40;150;40" dur="13s" repeatCount="indefinite"/></circle>
  ${dots}
  ${star(250, 230, 1.1, 0)}${star(960, 270, 1.3, 1.1)}${star(380, 70, .8, 2)}${star(830, 60, 1, .6)}${star(110, 350, .9, 1.6)}${star(1100, 370, .8, 2.4)}

  <!-- the island -->
  <g>
    <rect y="22" height="34" rx="17" fill="#000" stroke="#ffffff22">
      ${anim("x", 8, [[0, 480], [0.18, 480], [0.26, 410], [0.7, 410], [0.78, 480], [1, 480]])}
      ${anim("width", 8, [[0, 240], [0.18, 240], [0.26, 380], [0.7, 380], [0.78, 240], [1, 240]])}
    </rect>
    <circle cx="512" cy="39" r="5" fill="${BLUE}"><animate attributeName="opacity" values="1;.4;1" dur="2s" repeatCount="indefinite"/></circle>
    <circle cx="532" cy="39" r="5" fill="${VIOLET}"><animate attributeName="opacity" values=".4;1;.4" dur="2s" repeatCount="indefinite"/></circle>
    <text x="600" y="44" text-anchor="middle" font-size="13" fill="#9aa0ad" opacity="0">Alt+Shift+D
      ${anim("opacity", 8, [[0, 0], [0.26, 0], [0.32, 1], [0.66, 1], [0.72, 0], [1, 0]])}
    </text>
  </g>

  <!-- Ari -->
  <ellipse cx="600" cy="342" rx="120" ry="14" fill="#000" opacity=".55" filter="url(#shadow)">
    <animate attributeName="rx" values="120;102;120" dur="5s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values=".55;.35;.55" dur="5s" repeatCount="indefinite"/>
  </ellipse>
  <g transform="translate(600 218)"><g class="float">${ari("a")}</g></g>
  ${bubbles}

  <!-- titles -->
  <text x="600" y="410" text-anchor="middle" font-size="58" font-weight="800" fill="url(#title)" letter-spacing="1">Arizo Translate</text>
  <text x="600" y="446" text-anchor="middle" font-size="21" fill="#c9cde0">A Dynamic Island translator for Windows 10 &amp; 11</text>
  <text x="600" y="480" text-anchor="middle" font-size="20" fill="#9a8fd8" direction="rtl" style="font-family:${FA}">مترجم داینامیک آیلند برای ویندوز</text>
</g>
<rect width="${W}" height="${H}" rx="30" fill="none" stroke="#ffffff14"/>`;
  save("hero.svg", svg(W, H, body, 'aria-label="Arizo Translate: Ari the mascot greeting in English and Persian"'));
}

// ─────────────────────────────────────────────── demo
function demo() {
  const W = 900, H = 350, D = 10;
  const T = (a, b) => [[0, 0], [a, 0], [b, 1], [0.96, 1], [0.965, 0], [1, 0]];
  const reveal = (a, b, full) => anim("width", D, T(a, b).map(([t, v]) => [t, v * full]));
  const body = `
<defs>
  ${ariDefs("d")}
  <clipPath id="l1"><rect x="64" y="146" height="30">${reveal(0.03, 0.17, 340)}</rect></clipPath>
  <clipPath id="l2"><rect x="64" y="178" height="30">${reveal(0.17, 0.3, 300)}</rect></clipPath>
  <clipPath id="r1"><rect y="146" height="34">
    ${anim("x", D, [[0, 840], [0.44, 840], [0.54, 440], [0.96, 440], [0.965, 840], [1, 840]])}
    ${anim("width", D, [[0, 0], [0.44, 0], [0.54, 400], [0.96, 400], [0.965, 0], [1, 0]])}
  </rect></clipPath>
  <clipPath id="r2"><rect y="180" height="34">
    ${anim("x", D, [[0, 840], [0.54, 840], [0.62, 520], [0.96, 520], [0.965, 840], [1, 840]])}
    ${anim("width", D, [[0, 0], [0.54, 0], [0.62, 320], [0.96, 320], [0.965, 0], [1, 0]])}
  </rect></clipPath>
</defs>
<style>${CSS}</style>
<rect x="10" y="10" width="880" height="330" rx="30" fill="#07070b" stroke="#ffffff18"/>
<!-- top bar -->
<rect x="34" y="28" width="58" height="32" rx="16" fill="#1c1c25"/>
<path d="M63 36 l-9 8 h3 v7 h12 v-7 h3z" fill="#fff"/>
<circle cx="118" cy="44" r="8" fill="none" stroke="#7b7f8c" stroke-width="2"/><path d="M118 39v5l3 2" stroke="#7b7f8c" stroke-width="2" fill="none"/>
<path d="M156 36 l2.6 5.4 5.4 2.6 -5.4 2.6 -2.6 5.4 -2.6-5.4 -5.4-2.6 5.4-2.6z" fill="#7b7f8c"/>
<circle cx="850" cy="44" r="8" fill="none" stroke="#7b7f8c" stroke-width="2.4" stroke-dasharray="3 3"/>
<!-- Ari in the bar -->
<g transform="translate(450 44) scale(.2)">
  <g>${ari("d", { eyesAnim: `<animateTransform attributeName="transform" type="translate" dur="${D}s" repeatCount="indefinite" keyTimes="0;0.03;0.3;0.34;0.44;0.54;0.78;1" values="0 0;-26 8;-26 8;0 -12;0 -12;30 8;30 8;0 0"/>` })}
    <animateTransform attributeName="transform" type="translate" dur="${D}s" repeatCount="indefinite" keyTimes="0;0.74;0.78;0.82;0.86;1" values="0 0;0 0;0 -60;0 0;0 -26;0 0" additive="sum"/>
  </g>
</g>
<g fill="${VIOLET}" font-size="20" font-weight="800" text-anchor="middle">
  <text x="450" y="70" opacity="0">· · ·${anim("opacity", D, [[0, 0], [0.33, 0], [0.35, 1], [0.44, 1], [0.46, 0], [1, 0]])}</text>
  <text x="508" y="52" fill="#ff7a9c" opacity="0">♥${anim("opacity", D, [[0, 0], [0.78, 0], [0.8, 1], [0.9, 0], [1, 0]])}</text>
  <text x="392" y="48" fill="#ff7a9c" font-size="16" opacity="0">♥${anim("opacity", D, [[0, 0], [0.8, 0], [0.82, 1], [0.92, 0], [1, 0]])}</text>
</g>
<!-- left panel -->
<rect x="34" y="84" width="404" height="236" rx="22" fill="#15151b"/>
<rect x="50" y="98" width="82" height="30" rx="15" fill="none" stroke="#3a3a46"/><text x="91" y="118" text-anchor="middle" font-size="14" fill="#cfd2dc">English</text>
<rect x="144" y="98" width="104" height="30" rx="15" fill="#1d1d26" stroke="#3a3a46"/><text x="196" y="118" text-anchor="middle" font-size="14" font-weight="600" fill="#fff">Auto → FA</text>
<g font-size="20" fill="#fff">
  <text x="64" y="168" textLength="330" lengthAdjust="spacingAndGlyphs" clip-path="url(#l1)">Good morning! Could you send</text>
  <text x="64" y="200" textLength="270" lengthAdjust="spacingAndGlyphs" clip-path="url(#l2)">me the report by tonight?</text>
</g>
<rect y="150" width="2.4" height="24" rx="1" fill="${BLUE}">
  ${anim("x", D, [[0, 64], [0.03, 64], [0.17, 394], [0.1700001, 394], [1, 394]])}
  ${anim("opacity", D, [[0, 1], [0.17, 1], [0.1700001, 0], [1, 0]])}
</rect>
<rect y="182" width="2.4" height="24" rx="1" fill="${BLUE}" opacity="0">
  ${anim("x", D, [[0, 64], [0.17, 64], [0.3, 334], [1, 334]])}
  ${anim("opacity", D, [[0, 0], [0.17, 0], [0.18, 1], [0.3, 1], [0.34, 0], [1, 0]])}
</rect>
<text x="52" y="304" font-size="12" fill="#6e7280">54</text>
<!-- right panel -->
<rect x="462" y="84" width="404" height="236" rx="22" fill="#15151b"/>
<rect x="476" y="96" width="118" height="34" rx="17" fill="#0e2547" stroke="${BLUE}"/><circle cx="496" cy="113" r="9" fill="${BLUE}"/><text x="552" y="118" text-anchor="middle" font-size="15" font-weight="700" fill="#fff">Fast</text>
<rect x="604" y="96" width="118" height="34" rx="17" fill="#1b1a2a" stroke="#34344a"/><circle cx="624" cy="113" r="9" fill="${VIOLET}"/><text x="680" y="118" text-anchor="middle" font-size="15" fill="#aeb2c4">Smart</text>
<g font-size="22" fill="#fff" direction="rtl" text-anchor="start" style="font-family:${FA}">
  <text x="840" y="170" clip-path="url(#r1)" direction="rtl">صبح بخیر! می‌توانید گزارش را</text>
  <text x="840" y="204" clip-path="url(#r2)" direction="rtl">تا امشب برایم بفرستید؟</text>
</g>
<g opacity="0">
  ${anim("opacity", D, [[0, 0], [0.62, 0], [0.66, 1], [0.96, 1], [0.965, 0], [1, 0]])}
  <circle cx="482" cy="262" r="4" fill="${BLUE}"><animate attributeName="opacity" values="1;.3;1" dur="1.4s" repeatCount="indefinite"/></circle>
  <text x="494" y="266" font-size="12" fill="#8b90a0">Fast · 214 ms</text>
</g>
<g>
  <rect x="476" y="278" width="92" height="34" rx="17" fill="#fff"><animate attributeName="fill" dur="${D}s" repeatCount="indefinite" keyTimes="0;0.7;0.72;0.8;0.82;1" values="#fff;#fff;#a7f3d0;#a7f3d0;#fff;#fff"/></rect>
  <text x="522" y="300" text-anchor="middle" font-size="14" font-weight="700" fill="#0b0b10">Copy
    <animate attributeName="opacity" dur="${D}s" repeatCount="indefinite" keyTimes="0;0.7;0.72;0.8;0.82;1" values="1;1;0;0;1;1"/>
  </text>
  <text x="522" y="300" text-anchor="middle" font-size="14" font-weight="700" fill="#065f46" opacity="0">Copied ✓
    <animate attributeName="opacity" dur="${D}s" repeatCount="indefinite" keyTimes="0;0.7;0.72;0.8;0.82;1" values="0;0;1;1;0;0"/>
  </text>
  <rect x="578" y="278" width="138" height="34" rx="17" fill="#1f1f27"/><text x="647" y="300" text-anchor="middle" font-size="14" fill="#cfd2dc">↗ Replace in app</text>
</g>
<rect x="476" y="278" width="92" height="34" rx="17" fill="none" stroke="#fff" opacity="0">
  <animate attributeName="opacity" dur="${D}s" repeatCount="indefinite" keyTimes="0;0.66;0.7;0.76;1" values="0;0;.9;0;0"/>
  <animate attributeName="stroke-width" dur="${D}s" repeatCount="indefinite" keyTimes="0;0.66;0.76;1" values="1;1;10;10"/>
</rect>
${star(850, 300, .8, 0)}`;
  save("demo.svg", svg(W, H, body, 'aria-label="Typing a sentence and getting its Persian translation in the island"'));
}

// ─────────────────────────────────────────────── outfits
function outfits() {
  const W = 900, H = 330, N = 6, S = 2;
  const items = [
    ["Witch hat", `<g transform="translate(0 -86)"><ellipse cx="0" cy="6" rx="112" ry="19" fill="#5b21b6"/><path d="M-62 4 C-40 -20 -22 -70 6 -128 C12 -90 38 -40 62 4Z" fill="#7c3aed"/><path d="M-62 4 Q0 20 62 4 L58 -10 Q0 4 -58 -10Z" fill="#f97316"/><rect x="-9" y="-12" width="18" height="16" rx="3" fill="none" stroke="#fde68a" stroke-width="3.5"/></g>`],
    ["Party hat", `<g transform="translate(14 -92) rotate(12)"><path d="M-34 14 L0 -86 L34 14Z" fill="#f472b6"/><path d="M-22 -22 l44 0 M-28 -4 l56 0" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".8"/><circle cx="0" cy="-90" r="10" fill="#fde68a"/></g>`],
    ["Crown", `<g transform="translate(0 -92)"><path d="M-58 14 L-66 -34 -34 -10 0 -48 34 -10 66 -34 58 14Z" fill="#f5b53d" stroke="#b7791f" stroke-width="3" stroke-linejoin="round"/><circle cx="0" cy="-48" r="6" fill="#ef4444"/><circle cx="-66" cy="-34" r="5" fill="#60a5fa"/><circle cx="66" cy="-34" r="5" fill="#60a5fa"/></g>`],
    ["Sunglasses", `<g transform="translate(0 -4)"><rect x="-82" y="-24" width="66" height="44" rx="16" fill="#0b0b10" stroke="#475569" stroke-width="3"/><rect x="16" y="-24" width="66" height="44" rx="16" fill="#0b0b10" stroke="#475569" stroke-width="3"/><path d="M-16 -8 H16" stroke="#475569" stroke-width="5"/><path d="M-70 -14 l16 -2 M28 -14 l16 -2" stroke="#fff" stroke-width="3" opacity=".35" stroke-linecap="round"/></g>`],
    ["Bunny ears", `<g transform="translate(0 -88)"><g transform="rotate(-14 -46 0)"><ellipse cx="-46" cy="-50" rx="19" ry="52" fill="#fbfbfd" stroke="#c4c8d3" stroke-width="2.5"/><ellipse cx="-46" cy="-48" rx="9" ry="36" fill="#fbcfe8"/></g><g transform="rotate(14 46 0)"><ellipse cx="46" cy="-50" rx="19" ry="52" fill="#fbfbfd" stroke="#c4c8d3" stroke-width="2.5"/><ellipse cx="46" cy="-48" rx="9" ry="36" fill="#fbcfe8"/></g></g>`],
    ["Santa hat", `<g transform="translate(0 -84)"><path d="M-82 8 C-70 -52 -10 -98 56 -62 C74 -50 86 -20 82 8Z" fill="#dc2626"/><rect x="-90" y="-4" width="180" height="26" rx="13" fill="#fff"/><circle cx="62" cy="-66" r="14" fill="#fff"/></g>`],
  ];
  const fits = items
    .map(([, art], i) => `<g class="fit" style="animation-delay:${i * S}s">${art}</g>`)
    .join("");
  const names = items
    .map(([n], i) => `<text class="fit2" style="animation-delay:${i * S}s" x="450" y="300" text-anchor="middle" font-size="22" font-weight="700" fill="#e9e6ff">${n}</text>`)
    .join("");
  const dotsRow = items
    .map((_, i) => `<circle cx="${450 + (i - (N - 1) / 2) * 22}" cy="318" r="4" fill="#3a3a52"/><circle class="fit2" style="animation-delay:${i * S}s" cx="${450 + (i - (N - 1) / 2) * 22}" cy="318" r="4" fill="${VIOLET}"/>`)
    .join("");
  const body = `
<defs>${ariDefs("o")}
  <linearGradient id="obg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b0b13"/><stop offset="1" stop-color="#171124"/></linearGradient>
  <filter id="og" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter>
</defs>
<style>${CSS}
  .fit{animation:fit ${N * S}s infinite both;opacity:0}
  @keyframes fit{0%{opacity:0;transform:translateY(-70px) rotate(-6deg)}3.5%{opacity:1;transform:translateY(6px) rotate(0)}5.5%{transform:translateY(0)}14%{opacity:1;transform:translateY(0)}16.6%{opacity:0;transform:translateY(-26px)}100%{opacity:0}}
  .fit2{animation:fit2 ${N * S}s infinite both;opacity:0}
  @keyframes fit2{0%{opacity:0}3%{opacity:1}14%{opacity:1}16.6%{opacity:0}100%{opacity:0}}
</style>
<rect width="${W}" height="${H}" rx="28" fill="url(#obg)"/>
<circle cx="150" cy="260" r="120" fill="${BLUE}" opacity=".35" filter="url(#og)"/>
<circle cx="760" cy="60" r="120" fill="${VIOLET}" opacity=".35" filter="url(#og)"/>
${star(120, 80, 1.1, 0)}${star(790, 230, 1.2, 1)}${star(700, 110, .8, 2)}${star(210, 190, .8, .5)}
<ellipse cx="450" cy="268" rx="92" ry="10" fill="#000" opacity=".5" style="filter:blur(8px)"/>
<g transform="translate(450 188) scale(.72)"><g class="float">${ari("o", { outfit: fits })}</g></g>
${names}${dotsRow}
<rect width="${W}" height="${H}" rx="28" fill="none" stroke="#ffffff14"/>`;
  save("outfits.svg", svg(W, H, body, 'aria-label="Ari trying on hats and accessories from the wardrobe"'));
}

// ─────────────────────────────────────────────── marquee
function marquee() {
  const W = 1200, H = 52, GAP = 236;
  const items = ["⚡ Fast engine", "✦ Smart AI engine", "🏝️ Dynamic Island", "Alt+Shift+D in place", "🎯 Quick bubble", "فارسی ⇄ English", "🗣️ Speech for every language", "🔒 No telemetry", "🪶 3.7 MB installer"];
  const row = (off) => items.map((t, i) => `<text x="${off + i * GAP + 20}" y="32" font-size="18" fill="#d6d9ec" ${/[؀-ۿ]/.test(t) ? `style="font-family:${FA}"` : ""}>${t}</text><circle cx="${off + i * GAP + GAP - 20}" cy="26" r="3" fill="${VIOLET}"/>`).join("");
  const total = items.length * GAP;
  const body = `
<defs>
  <linearGradient id="fade" x1="0" x2="1"><stop offset="0" stop-color="#000"/><stop offset=".07" stop-color="#fff"/><stop offset=".93" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
  <mask id="m"><rect width="${W}" height="${H}" fill="url(#fade)"/></mask>
</defs>
<style>text{font-family:${SANS}}</style>
<rect width="${W}" height="${H}" rx="26" fill="#0c0c14" stroke="#ffffff14"/>
<g mask="url(#m)"><g>
  ${row(0)}${row(total)}
  <animateTransform attributeName="transform" type="translate" from="0 0" to="-${total} 0" dur="34s" repeatCount="indefinite"/>
</g></g>`;
  save("marquee.svg", svg(W, H, body, 'aria-label="Feature ticker"'));
}

// ─────────────────────────────────────────────── divider
function divider() {
  const W = 1200, H = 28;
  const body = `
<defs>
  <linearGradient id="ln" x1="0" x2="1"><stop offset="0" stop-color="${BLUE}" stop-opacity="0"/><stop offset=".3" stop-color="${BLUE}"/><stop offset=".7" stop-color="${VIOLET}"/><stop offset="1" stop-color="${VIOLET}" stop-opacity="0"/></linearGradient>
  <filter id="g" x="-300%" y="-300%" width="700%" height="700%"><feGaussianBlur stdDeviation="3"/></filter>
</defs>
<rect x="60" y="13" width="1080" height="2" rx="1" fill="url(#ln)" opacity=".7"/>
<circle r="5" cy="14" fill="#fff" filter="url(#g)"><animate attributeName="cx" values="80;1120;80" dur="7s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.5;1" keySplines=".45 0 .55 1;.45 0 .55 1"/></circle>
<circle r="2.2" cy="14" fill="#fff"><animate attributeName="cx" values="80;1120;80" dur="7s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.5;1" keySplines=".45 0 .55 1;.45 0 .55 1"/></circle>
<g transform="translate(600 14)"><path d="M0-9 L9 0 0 9 -9 0Z" fill="#0b0b12" stroke="${VIOLET}" stroke-width="2"><animateTransform attributeName="transform" type="rotate" values="0;90" dur="4s" repeatCount="indefinite"/></path>
<circle r="3" fill="${BLUE}"><animate attributeName="r" values="2;4;2" dur="2s" repeatCount="indefinite"/></circle></g>`;
  save("divider.svg", svg(W, H, body, 'aria-hidden="true"'));
}

// ─────────────────────────────────────────────── footer
function footer() {
  const W = 1200, H = 190;
  const wave = (a, b, c) => `M0 ${a} C 200 ${a - 40}, 400 ${a + 40}, 600 ${a} S 1000 ${b}, 1200 ${c} V${H} H0 Z`;
  const body = `
<defs>
  ${ariDefs("f")}
  <linearGradient id="fbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a0a12"/><stop offset="1" stop-color="#16101f"/></linearGradient>
  <linearGradient id="w1" x1="0" x2="1"><stop offset="0" stop-color="${BLUE}" stop-opacity=".5"/><stop offset="1" stop-color="${VIOLET}" stop-opacity=".5"/></linearGradient>
  <clipPath id="fc"><rect width="${W}" height="${H}" rx="26"/></clipPath>
</defs>
<style>${CSS}</style>
<g clip-path="url(#fc)">
  <rect width="${W}" height="${H}" fill="url(#fbg)"/>
  <path fill="url(#w1)" opacity=".5"><animate attributeName="d" dur="9s" repeatCount="indefinite" values="${wave(120, 160, 120)};${wave(140, 110, 150)};${wave(120, 160, 120)}"/></path>
  <path fill="url(#w1)" opacity=".35"><animate attributeName="d" dur="12s" repeatCount="indefinite" values="${wave(150, 120, 160)};${wave(130, 170, 120)};${wave(150, 120, 160)}"/></path>
  <g transform="translate(600 196) scale(.62)"><g class="drift">${ari("f")}</g></g>
  <text x="48" y="74" font-size="22" font-weight="700" fill="#fff">Made with <tspan fill="#ff7a9c">♥</tspan> by ArizoOwner</text>
  <text x="48" y="104" font-size="15" fill="#9aa0b8">If Ari made you smile, a ⭐ helps a lot.</text>
  <text x="1152" y="74" text-anchor="end" font-size="20" font-weight="700" fill="#fff">arizoteam.ir</text>
  <text x="1152" y="104" text-anchor="end" font-size="15" fill="#9aa0b8" direction="rtl" style="font-family:${FA}">اگر آری لبخندی روی لبتان آورد، یک ⭐ بدهید</text>
  ${star(300, 140, .9, 0)}${star(900, 60, 1.1, 1)}${star(1010, 150, .7, 2)}
</g>
<rect width="${W}" height="${H}" rx="26" fill="none" stroke="#ffffff14"/>`;
  save("footer.svg", svg(W, H, body, 'aria-label="Made by ArizoOwner"'));
}

hero(); demo(); outfits(); marquee(); divider(); footer();
console.log(`README art written to ${outDir}`);
