// The Muse section's picture: the island as a small tablet, going through what Muse does in one
// loop — off with Ari asleep, the button pressed, Ari searching while it connects, then a chat
// whose Persian messages read right to left and the English ones left to right, written as you
// watch. Muse's own interface is not drawn (only the island and Ari): the chat is a sketch.
// Pure SVG + CSS (no scripts, no external requests) so GitHub plays it as it is.

export function museArt(u) {
  const { save, svg, ariDefs, ari, splitEyes, CSS, FA } = u;
  const MUSE = "#FF7A59", PURPLE = "#c86bff", INDIGO = "#6366f1", GREEN = "#34d399";
  const W = 1200, H = 600, LOOP = 14;

  // Each phase owns part of the loop (in seconds): off, pressed, connecting, chat.
  const T = { off: [0, 3.2], press: [3.2, 4.0], connect: [4.0, 7.2], chat: [7.2, 14] };
  const pct = (sec) => ((sec / LOOP) * 100).toFixed(2) + "%";
  /** A layer that fades in at `a`, holds, and fades out at `b` (seconds). */
  const phase = (name, a, b) =>
    `@keyframes ${name}{0%,${pct(Math.max(0, a - 0.01))}{opacity:0}${pct(a + 0.35)},${pct(b - 0.35)}{opacity:1}${pct(b)},100%{opacity:0}}
  .${name}{opacity:0;animation:${name} ${LOOP}s infinite both}`;
  /** Shown from `a` (seconds) to the end of the loop: a chat line appearing. */
  const from = (name, a, end = LOOP - 0.4) =>
    `@keyframes ${name}{0%,${pct(a)}{opacity:0;transform:translateY(10px)}${pct(a + 0.4)},${pct(end)}{opacity:1;transform:translateY(0)}100%{opacity:0}}
  .${name}{opacity:0;animation:${name} ${LOOP}s infinite both}`;

  // The tablet-shaped island, centred.
  const IW = 360, IH = 520, IX = (W - IW) / 2, IY = 40;
  const frameX = IX + 16, frameY = IY + 62, frameW = IW - 32, frameH = IH - 80;

  // In right-to-left SVG text "start" is the right edge: Persian lines start at x and run left.
  const rtlText = `text-anchor="start" direction="rtl" style="font-family:${FA}"`;
  // A chat bubble: `rtl` ones sit on the right with their text aligned right.
  const bubble = (cls, y, rtl, lines, me) => {
    const bw = 236, bx = rtl ? frameX + frameW - 14 - bw : frameX + 14;
    const bh = 22 + lines.length * 21;
    const tx = rtl ? bx + bw - 14 : bx + 14;
    const text = lines.map((l, i) => `<text x="${tx}" y="${y + 27 + i * 21}" ${rtl ? rtlText : `text-anchor="start"`} font-size="14" fill="#fff">${l}</text>`).join("");
    const tag = `<text x="${rtl ? bx + 10 : bx + bw - 10}" y="${y - 6}" text-anchor="${rtl ? "start" : "end"}" font-size="10.5" font-weight="700" fill="${rtl ? MUSE : "#93c5fd"}">${rtl ? "RTL ←" : "→ LTR"}</text>`;
    return `<g class="${cls}">${tag}<rect x="${bx}" y="${y}" width="${bw}" height="${bh}" rx="14" fill="${me ? "#2b3a55" : "#20222b"}" stroke="${me ? "#3b5b8f" : "#ffffff14"}"/>${text}</g>`;
  };

  // The answer being written: one Persian line whose words appear one after the other, in
  // reading order. Every word is always laid out (so the line never moves); unwritten ones are clear.
  const typing = (y, words, a, step) => {
    const bw = 280, bx = frameX + frameW - 14 - bw;
    const spans = words.map((w, i) => `<tspan class="tw${i}">${w}</tspan>`).join(" ");
    const css = words.map((_, i) => {
      const at = a + i * step;
      return `@keyframes tw${i}{0%,${pct(at)}{fill-opacity:0}${pct(at + 0.15)},${pct(LOOP - 0.4)}{fill-opacity:1}100%{fill-opacity:0}}
  .tw${i}{fill-opacity:0;animation:tw${i} ${LOOP}s infinite both}`;
    }).join("\n  ");
    return {
      el: `<g class="ans"><text x="${bx + 10}" y="${y - 6}" font-size="10.5" font-weight="700" fill="${MUSE}">RTL ←</text><rect x="${bx}" y="${y}" width="${bw}" height="43" rx="14" fill="#20222b" stroke="#ffffff14"/><text x="${bx + bw - 14}" y="${y + 27}" ${rtlText} font-size="14" fill="#fff">${spans}</text></g>`,
      css,
    };
  };
  const answer = typing(frameY + 256, ["سه", "رستوران", "ایتالیایی", "نزدیک", "شما", "پیدا", "کردم"], 10.4, 0.26);

  const fact = (y, t) => `<g transform="translate(${frameX + 52} ${y})"><circle r="8" fill="${GREEN}" opacity=".18"/><path d="M-3.5 0 -1 2.6 3.8-2.6" fill="none" stroke="${GREEN}" stroke-width="2" stroke-linecap="round"/><text x="16" y="4.5" font-size="12.5" fill="#e5e7eb">${t}</text></g>`;
  const step = (i, t) => `<g transform="translate(${frameX + 80} ${frameY + 300 + i * 26})"><circle class="st${i}" r="5" fill="${INDIGO}"/><text x="14" y="4.5" font-size="12.5" fill="#c7c9d3">${t}</text></g>`;
  const stepCss = [0, 1, 2].map((i) => {
    const a = T.connect[0] + 0.3 + i * 0.95;
    return `@keyframes st${i}{0%,${pct(a)}{fill:#ffffff30}${pct(a + 0.1)},${pct(a + 0.9)}{fill:${INDIGO}}${pct(a + 0.95)},100%{fill:${GREEN}}}
  .st${i}{animation:st${i} ${LOOP}s infinite both}`;
  }).join("\n  ");

  const ariAt = (id, y, drawn) => `<g transform="translate(${W / 2} ${y}) scale(.36)">${drawn ?? ari(id)}</g>`;
  // Asleep: the eyes are closed arcs, the other way up from his happy ones.
  const sleepingAri = (id) => {
    const { before, after } = splitEyes(id);
    const arc = (x) => `<path d="M${x - 16} -4 Q${x} 14 ${x + 16} -4" fill="none" stroke="#0e0c10" stroke-width="8" stroke-linecap="round"/>`;
    return before + `<g class="look">${arc(-46)}${arc(46)}</g>` + after;
  };

  const body = `
<defs>
  ${ariDefs("muoff")}${ariDefs("muconn")}
  <linearGradient id="mbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a0a12"/><stop offset=".6" stop-color="#140f1f"/><stop offset="1" stop-color="#1d1020"/></linearGradient>
  <radialGradient id="mglow" cx=".5" cy=".38" r=".5"><stop offset="0" stop-color="${MUSE}" stop-opacity=".22"/><stop offset="1" stop-color="${MUSE}" stop-opacity="0"/></radialGradient>
  <radialGradient id="cglow" cx=".5" cy=".38" r=".5"><stop offset="0" stop-color="${INDIGO}" stop-opacity=".24"/><stop offset="1" stop-color="${INDIGO}" stop-opacity="0"/></radialGradient>
  <linearGradient id="mbtn" x1="0" x2="1"><stop offset="0" stop-color="#ff9a5a"/><stop offset=".5" stop-color="${MUSE}"/><stop offset="1" stop-color="#e0609a"/></linearGradient>
  <linearGradient id="mbar" x1="0" x2="1"><stop offset="0" stop-color="${INDIGO}" stop-opacity="0"/><stop offset=".5" stop-color="#a78bfa"/><stop offset="1" stop-color="${INDIGO}" stop-opacity="0"/></linearGradient>
  <clipPath id="mframe"><rect x="${frameX}" y="${frameY}" width="${frameW}" height="${frameH}" rx="16"/></clipPath>
  <filter id="mblur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="50"/></filter>
</defs>
<style>${CSS}
  ${phase("off", T.off[0], T.press[1])}
  ${phase("conn", T.connect[0], T.connect[1])}
  ${phase("chat", T.chat[0], LOOP)}
  ${from("b1", 7.6)}
  ${from("b2", 8.6)}
  ${from("b3", 9.6)}
  ${from("ans", 10.2)}
  ${answer.css}
  ${stepCss}
  @keyframes press{0%,${pct(T.press[0])}{transform:scale(1)}${pct(T.press[0] + 0.2)}{transform:scale(.92)}${pct(T.press[0] + 0.45)},100%{transform:scale(1)}}
  .btn{transform-box:fill-box;transform-origin:center;animation:press ${LOOP}s infinite both}
  @keyframes ripple{0%,${pct(T.press[0] + 0.15)}{r:0;opacity:0}${pct(T.press[0] + 0.2)}{r:10;opacity:.7}${pct(T.press[0] + 0.9)},100%{r:70;opacity:0}}
  .ripple{animation:ripple ${LOOP}s infinite both}
  @keyframes zz{0%{transform:translate(0,0);opacity:0}20%{opacity:1}100%{transform:translate(18px,-46px);opacity:0}}
  .z{animation:zz 2.4s ease-out infinite}
  @keyframes slide{0%{transform:translateX(-90px)}100%{transform:translateX(210px)}}
  .bar{animation:slide 1.3s ease-in-out infinite}
  @keyframes scan{0%,100%{transform:translateX(-14px)}50%{transform:translateX(14px)}}
  .scan{animation:scan 1.6s ease-in-out infinite}
  @keyframes cursor{0%,49%{opacity:1}50%,100%{opacity:0}}
  .caret{animation:cursor 1s infinite}
  @keyframes ptr{0%,${pct(T.off[1] - 1.4)}{transform:translate(170px,140px);opacity:0}${pct(T.off[1] - 1.0)}{opacity:1}${pct(T.press[0])}{transform:translate(0,0);opacity:1}${pct(T.press[1] + 0.3)}{transform:translate(0,0);opacity:1}${pct(T.press[1] + 0.8)},100%{transform:translate(120px,160px);opacity:0}}
  .ptr{animation:ptr ${LOOP}s infinite both}
</style>
<rect width="${W}" height="${H}" rx="30" fill="url(#mbg)" stroke="#ffffff14"/>
<circle cx="250" cy="480" r="200" fill="${MUSE}" opacity=".22" filter="url(#mblur)"/>
<circle cx="960" cy="140" r="200" fill="${PURPLE}" opacity=".2" filter="url(#mblur)"/>

<!-- labels on the sides: what is happening now -->
<g font-weight="800">
  <g class="off"><text x="${IX - 50}" y="250" text-anchor="end" font-size="26" fill="#fff">Off at start-up</text><text x="${IX - 50}" y="280" text-anchor="end" font-size="15" fill="#aab0c8">No memory, processor or internet</text>
    <text x="${IX + IW + 50}" y="250" font-size="24" fill="#fff" style="font-family:${FA}">خاموش در شروع</text><text x="${IX + IW + 50}" y="280" font-size="14" fill="#aab0c8" style="font-family:${FA}">از حسابتان خارج نمی‌شوید</text></g>
  <g class="conn"><text x="${IX - 50}" y="250" text-anchor="end" font-size="26" fill="#fff">Ari connects</text><text x="${IX - 50}" y="280" text-anchor="end" font-size="15" fill="#aab0c8">The steps light up one by one</text>
    <text x="${IX + IW + 50}" y="250" font-size="24" fill="#fff" style="font-family:${FA}">آری وصل می‌شود</text><text x="${IX + IW + 50}" y="280" font-size="14" fill="#aab0c8" style="font-family:${FA}">مرحله به مرحله</text></g>
  <g class="chat"><text x="${IX - 50}" y="230" text-anchor="end" font-size="26" fill="#fff">The real muse.ai</text><text x="${IX - 50}" y="260" text-anchor="end" font-size="15" fill="#aab0c8">Persian right to left, English</text><text x="${IX - 50}" y="282" text-anchor="end" font-size="15" fill="#aab0c8">left to right — on its own</text>
    <text x="${IX + IW + 50}" y="230" font-size="24" fill="#fff" style="font-family:${FA}">خود muse.ai</text><text x="${IX + IW + 50}" y="260" font-size="14" fill="#aab0c8" style="font-family:${FA}">راست‌چین و چپ‌چین خودکار</text><text x="${IX + IW + 50}" y="282" font-size="14" fill="#aab0c8" style="font-family:${FA}">با فونت وزیرمتن و اینتر</text></g>
</g>

<!-- the island, a small tablet standing up -->
<rect x="${IX}" y="${IY}" width="${IW}" height="${IH}" rx="34" fill="#000" stroke="#ffffff22"/>
<g font-size="11.5" font-weight="700">
  ${["Translate", "Spotify", "Football", "Crypto"].map((t, i) => `<text x="${IX + 30 + i * 62}" y="${IY + 30}" fill="#7d8191">${t}</text>`).join("")}
  <rect x="${IX + 272}" y="${IY + 15}" width="64" height="22" rx="11" fill="#1d1f26"/><circle cx="${IX + 285}" cy="${IY + 26}" r="5" fill="${MUSE}"/><text x="${IX + 295}" y="${IY + 30}" fill="#fff">Muse</text>
</g>
<circle cx="${IX + 26}" cy="${IY + 49}" r="4" fill="${MUSE}"/><text x="${IX + 36}" y="${IY + 53}" font-size="12" font-weight="700" fill="#fff">Muse</text>
<g class="chat"><text x="${IX + IW - 24}" y="${IY + 53}" text-anchor="end" font-size="13" fill="#9aa0b8">⌂  ↗  ⏻</text></g>

<g clip-path="url(#mframe)">
  <rect x="${frameX}" y="${frameY}" width="${frameW}" height="${frameH}" fill="#14151a"/>

  <!-- off -->
  <g class="off">
    <rect x="${frameX}" y="${frameY}" width="${frameW}" height="${frameH}" fill="url(#mglow)"/>
    ${ariAt("muoff", frameY + 118, sleepingAri("muoff"))}
    <g font-size="20" font-weight="800" fill="#c7c9d3">${[0, 0.8, 1.6].map((d, i) => `<text class="z" style="animation-delay:${d}s" x="${W / 2 + 40 + i * 6}" y="${frameY + 62 - i * 4}" font-size="${14 + i * 4}">z</text>`).join("")}</g>
    <text x="${W / 2}" y="${frameY + 206}" text-anchor="middle" font-size="19" font-weight="800" fill="#fff">Muse is off</text>
    <text x="${W / 2}" y="${frameY + 230}" text-anchor="middle" font-size="12.5" fill="#9aa0b8">Turn it on to use muse.ai right here in the island</text>
    <rect x="${frameX + 34}" y="${frameY + 252}" width="${frameW - 68}" height="92" rx="14" fill="#ffffff0b" stroke="#ffffff10"/>
    ${fact(frameY + 274, "No memory or processor used")}${fact(frameY + 298, "No internet used")}${fact(frameY + 322, "You stay logged in")}
    <g transform="translate(${W / 2} ${frameY + 388})"><g class="btn"><rect x="-96" y="-21" width="192" height="42" rx="21" fill="url(#mbtn)"/><text x="10" y="5.5" text-anchor="middle" font-size="14" font-weight="800" fill="#fff">⏻  Turn Muse on</text></g>
      <circle class="ripple" r="0" fill="none" stroke="#fff" stroke-width="2"/></g>
  </g>

  <!-- connecting -->
  <g class="conn">
    <rect x="${frameX}" y="${frameY}" width="${frameW}" height="${frameH}" fill="url(#cglow)"/>
    <g class="scan">${ariAt("muconn", frameY + 130)}</g>
    <g transform="translate(${W / 2 - 64} ${frameY + 70})"><rect x="0" y="0" width="34" height="18" rx="9" fill="${INDIGO}"/><circle cx="9" cy="9" r="2.4" fill="#fff"/><circle cx="17" cy="9" r="2.4" fill="#fff"/><circle cx="25" cy="9" r="2.4" fill="#fff"/></g>
    <text x="${W / 2}" y="${frameY + 222}" text-anchor="middle" font-size="19" font-weight="800" fill="#fff">Opening Muse…</text>
    <text x="${W / 2}" y="${frameY + 246}" text-anchor="middle" font-size="12.5" fill="#9aa0b8">Ari is connecting to muse.ai</text>
    ${step(0, "Waking Muse up")}${step(1, "Connecting to muse.ai")}${step(2, "Loading your chats")}
    <rect x="${frameX + 64}" y="${frameY + 386}" width="${frameW - 128}" height="3" rx="1.5" fill="#ffffff14"/>
    <g clip-path="inset(0)"><rect class="bar" x="${frameX + 64}" y="${frameY + 386}" width="80" height="3" rx="1.5" fill="url(#mbar)"/></g>
  </g>

  <!-- the chat -->
  <g class="chat">
    ${bubble("b1", frameY + 30, true, ["سلام، برای امشب یک رستوران", "خوب پیدا کن"], true)}
    ${bubble("b2", frameY + 120, false, ["Sure! Any cuisine you prefer?"], false)}
    ${bubble("b3", frameY + 190, true, ["غذای ایتالیایی لطفاً"], true)}
    ${answer.el}
    <rect x="${frameX + 12}" y="${frameY + frameH - 56}" width="${frameW - 24}" height="42" rx="21" fill="#1d1f26" stroke="#ffffff14"/>
    <text x="${frameX + frameW - 34}" y="${frameY + frameH - 30}" ${rtlText} font-size="13" fill="#6b7079">پیام به Muse…</text>
    <rect class="caret" x="${frameX + frameW - 30}" y="${frameY + frameH - 44}" width="1.6" height="18" fill="${MUSE}"/>
  </g>
</g>

<!-- the pointer that presses the button -->
<g transform="translate(${W / 2 + 40} ${frameY + 398})"><g class="ptr"><path d="M0 0 L0 22 6 17 10 26 14 24 10 15 18 15Z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></g></g>`;

  save("muse.svg", svg(W, H, body, 'aria-label="The Muse tab: off with Ari asleep, turned on, Ari connecting, then a chat with Persian messages right to left and English ones left to right"'));
}
