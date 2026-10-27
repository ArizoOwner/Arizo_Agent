// Draws the animated SVGs used by the README (Ari, the demo, the wardrobe, the marquee…).
// Pure SVG + CSS/SMIL, no scripts and no external requests, so GitHub plays them as-is.
//   npm run readme-art

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { footballArt } from "./readme-football-art.mjs";
import { cryptoArt } from "./readme-crypto-art.mjs";
import { layoutArt } from "./readme-layout-art.mjs";
import { museArt } from "./readme-muse-art.mjs";

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

// ─────────────────────────────────────────────── shared Spotify pieces
const BEAT = 60 / 112; // 112 BPM, the same beat the app dances to

/** A little white/green eighth note that floats up and fades (needs SPOT_CSS). */
const note = (x, y, delay, dir, c, k = 1) => `<g transform="translate(${x} ${y}) scale(${k})"><g class="note" style="animation-delay:${delay}s;--dx:${dir * 46}px"><g transform="scale(${dir} 1)"><ellipse cx="-4" cy="9" rx="7.5" ry="5.4" transform="rotate(-24 -4 9)" fill="${c}"/><path d="M2 8V-12C3 -6 12 -6 10 3" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></g></g></g>`;

const SPOT_CSS = `
  .note{animation:note 3.2s ease-out infinite both;opacity:0}
  @keyframes note{0%{opacity:0;transform:translate(0,0) scale(.6)}12%{opacity:1}100%{opacity:0;transform:translate(var(--dx),-86px) rotate(14deg) scale(1)}}
  .bar{transform-box:fill-box;transform-origin:50% 100%;animation:bar ${BEAT.toFixed(3)}s ease-in-out infinite alternate}
  @keyframes bar{0%{transform:scaleY(.3)}100%{transform:scaleY(1.7)}}
  .prog{animation:prog 14s linear infinite}
  @keyframes prog{0%{transform:translateX(-440px)}100%{transform:translateX(0)}}
  .pulse{animation:pulse ${BEAT.toFixed(3)}s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:center}
  @keyframes pulse{0%{transform:scale(1)}100%{transform:scale(1.06)}}`;

/** Ari's eyes cut out of her drawing, so they can be swapped for the happy "^ ^" ones. */
function splitEyes(id) {
  const full = ari(id);
  const start = full.indexOf('<g class="look">');
  const afterSecondEye = full.indexOf("</g>", full.indexOf("</g>", start) + 4) + 4;
  const close = full.indexOf("</g>", afterSecondEye) + 4; // the .look group itself
  return { before: full.slice(0, start), looks: full.slice(start, close), after: full.slice(close) };
}
const happyEyes = () => {
  const arc = (x) => `<path d="M${x - 16} 2 Q${x} -24 ${x + 16} 2" fill="none" stroke="#0e0c10" stroke-width="9" stroke-linecap="round"/>`;
  return `<g class="look">${arc(-46)}${arc(46)}</g>`;
};

// ─────────────────────────────────────────────── spotify
/** Ari with the happy "^ ^" eyes she has while dancing. */
function happyAri(id) {
  const { before, after } = splitEyes(id);
  return before + happyEyes() + after;
}

function spotify() {
  const W = 900, H = 330, BPM_S = BEAT; // one bounce per beat
  const bars = Array.from({ length: 5 }, (_, i) => `<rect class="bar" style="animation-delay:${(i * 0.13).toFixed(2)}s" x="${690 + i * 12}" y="284" width="6" height="22" rx="2.5" fill="#1DB954"/>`).join("");
  const body = `
<defs>${ariDefs("s")}
  <linearGradient id="sbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b0b13"/><stop offset="1" stop-color="#0f1a14"/></linearGradient>
  <linearGradient id="sprog" x1="0" x2="1"><stop offset="0" stop-color="#1DB954"/><stop offset="1" stop-color="#6ee7a0"/></linearGradient>
  <filter id="sg" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter>
  <clipPath id="sprogclip"><rect x="318" y="226" width="440" height="6" rx="3"/></clipPath>
</defs>
<style>${CSS}
  .dance{transform-box:fill-box;transform-origin:50% 100%;animation:dance ${(BPM_S * 2).toFixed(3)}s ease-in-out infinite}
  @keyframes dance{0%,100%{transform:translate(0,0) rotate(-4deg) scale(1.02,.96)}25%{transform:translate(0,-16px) rotate(0) scale(.98,1.04)}50%{transform:translate(0,0) rotate(4deg) scale(1.02,.96)}75%{transform:translate(0,-16px) rotate(0) scale(.98,1.04)}}
${SPOT_CSS}
</style>
<rect width="${W}" height="${H}" rx="28" fill="url(#sbg)"/>
<circle cx="170" cy="250" r="120" fill="#1DB954" opacity=".3" filter="url(#sg)"/>
<circle cx="780" cy="40" r="110" fill="${VIOLET}" opacity=".25" filter="url(#sg)"/>
${star(70, 70, 1, 0)}${star(840, 250, .9, 1.2)}${star(520, 40, .7, .6)}
<ellipse cx="170" cy="258" rx="74" ry="9" fill="#000" opacity=".5" style="filter:blur(7px)"/>
<g transform="translate(170 178) scale(.46)"><g class="dance">${happyAri("s")}</g></g>
${note(96, 140, 0, -1, "#fff")}${note(246, 132, 1.1, 1, "#fff")}${note(120, 112, 2.1, -1, "#6ee7a0")}${note(222, 116, 0.6, 1, "#6ee7a0")}
<g transform="translate(318 66)">
  <rect class="pulse" width="108" height="108" rx="16" fill="#16241c"/>
  <path d="M38 78V36l36-7v42" fill="none" stroke="#1DB954" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <ellipse cx="30" cy="78" rx="9" ry="7" fill="#1DB954"/><ellipse cx="66" cy="71" rx="9" ry="7" fill="#1DB954"/>
</g>
<text x="448" y="104" font-size="26" font-weight="700" fill="#fff" style="font-family:${SANS}">Little music for your day</text>
<text x="448" y="134" font-size="17" fill="#9aa0b8">Arizo demo · This PC</text>
<g transform="translate(448 160)" fill="#cfd3e6">
  <path d="M0 8h3l9-8v22l-9-8H0z" opacity="0"/>
  <path d="M0 4h4v16H0zM18 4v16L6 12z" transform="translate(40 0)"/>
  <circle cx="92" cy="12" r="22" fill="#1DB954"/><path d="M84 2h5v20h-5zM95 2h5v20h-5z" fill="#06170c"/>
  <path d="M158 4v16l12-8zM172 4h4v16h-4z"/>
</g>
<text x="318" y="216" font-size="12" fill="#7f86a3" font-family="monospace">1:34</text>
<text x="758" y="216" font-size="12" fill="#7f86a3" font-family="monospace" text-anchor="end">4:02</text>
<rect x="318" y="226" width="440" height="6" rx="3" fill="#ffffff1c"/>
<g clip-path="url(#sprogclip)"><rect class="prog" x="318" y="226" width="440" height="6" rx="3" fill="url(#sprog)"/></g>
<g>${bars}</g>
<text x="318" y="290" font-size="14" fill="#7f86a3">This PC  ·  or connect your account for every device</text>
<rect width="${W}" height="${H}" rx="28" fill="none" stroke="#ffffff14"/>`;
  save("spotify.svg", svg(W, H, body, 'aria-label="Ari dancing with music notes while a song plays"'));
}

// ─────────────────────────────────────────────── marquee
function marquee() {
  const W = 1200, H = 52, GAP = 236;
  const items = ["⚡ Fast engine", "✦ Smart AI engine", "🎵 Spotify player", "🏝️ Dynamic Island", "Alt+Shift+D in place", "🎯 Quick bubble", "فارسی ⇄ English", "🗣️ Speech", "⚽ Live football", "🥅 Goal shows", "👕 Team kits", "₿ Live crypto prices", "📈 Candles, 1m to 1d", "⭐ Favourite coins", "🔒 No telemetry", "✨ Animated miniatures"];
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

spotify(); marquee(); footer();
const fb = footballArt({ save, svg, ariDefs, CSS, BODY, SANS, FA, VIOLET });
cryptoArt({ save, svg, ariDefs, ari, star, CSS, SANS, FA, VIOLET });
layoutArt({ save, svg, ariDefs, ari, happyAri, star, note, CSS, SPOT_CSS, BODY, SANS, FA, VIOLET, BLUE, BEAT, anim, rnd, ...fb });
museArt({ save, svg, ariDefs, ari, splitEyes, CSS, FA });
console.log(`README art written to ${outDir}`);
