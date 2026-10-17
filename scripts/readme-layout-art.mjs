// The README's frame: the header, the section banners, the feature cards, the install steps.
// Pure SVG + CSS/SMIL (no scripts, no external requests) so GitHub plays them as they are.

export function layoutArt(u) {
  const { save, svg, ariDefs, ari, star, note, CSS, SPOT_CSS, SANS, FA, VIOLET, BLUE, BEAT, kitAri, shade } = u;
  const GREEN = "#1DB954", TEAL = "#2dd4bf", AMBER = "#fbbf24", ROSE = "#f472b6";

  const wrap = (t, n) => { const out = []; let cur = ""; for (const w of t.split(" ")) { if ((cur + " " + w).trim().length > n) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim(); } if (cur) out.push(cur); return out; };
  const lines = (t, n, x, y, lh, size, fill) => wrap(t, n).map((l, i) => `<text x="${x}" y="${y + i * lh}" font-size="${size}" fill="${fill}">${l}</text>`).join("");

  const stars = (n, W, H, seed0 = 3) => {
    let sd = seed0;
    const r = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);
    return Array.from({ length: n }, () => `<circle class="twinkle" style="animation-delay:${(r() * 4).toFixed(2)}s" cx="${(r() * W).toFixed(0)}" cy="${(r() * H).toFixed(0)}" r="${(0.7 + r() * 1.6).toFixed(1)}" fill="#fff"/>`).join("");
  };

  // ───────────────────────────────────────────── header
  function header() {
    const W = 1200, H = 560, LOOP = 30;
    // Seven features, each owns a slot of the loop: the island shows its name, Ari wears its look.
    const F = [
      { en: "Translate anywhere", fa: "ترجمه در هر جا", c: BLUE, icon: "T", sub: "Alt+Shift+D replaces your text in place" },
      { en: "Fast &amp; Smart engines", fa: "دو موتور ترجمه", c: VIOLET, icon: "✦", sub: "Free Google · AI with tone &amp; idioms" },
      { en: "Quick bubble", fa: "حباب ترجمه‌ی سریع", c: ROSE, icon: "◎", sub: "Select text anywhere, one click" },
      { en: "Spotify player", fa: "پخش‌کننده‌ی اسپاتیفای", c: GREEN, icon: "♪", sub: "Cover, controls, Ari dances to the beat" },
      { en: "Live football", fa: "فوتبال زنده", c: TEAL, icon: "⚽", sub: "A show for every goal, card and whistle" },
      { en: "Team kits", fa: "پیراهن تیم‌ها", c: AMBER, icon: "👕", sub: "Ari wears your team's real shirt" },
      { en: "Wardrobe &amp; seasons", fa: "کمد لباس و فصل‌ها", c: "#fb923c", icon: "🎩", sub: "Hats, glasses, crowns — and the seasons" },
    ];
    const N = F.length, SLOT = LOOP / N;
    const pct = (v) => (v * 100).toFixed(3) + "%";
    const a0 = 0.012, a1 = 0.035, b0 = 1 / N - 0.035, b1 = 1 / N - 0.012; // fade in / hold / fade out inside a slot
    const keyed = (i) => {
      const s = i / N;
      return [0, s + a0 / 1, s + a1, s + b0, s + b1].map((v) => Math.min(1, Math.max(0, v)));
    };
    const showFrames = (i) => {
      const [, k1, k2, k3, k4] = keyed(i);
      const lo = (v) => pct(v);
      return `@keyframes sh${i}{0%,${lo(k1)}{opacity:0;transform:translateY(10px) scale(.97)}${lo(k2)},${lo(k3)}{opacity:1;transform:translateY(0) scale(1)}${lo(k4)},100%{opacity:0;transform:translateY(-8px) scale(.98)}}`;
    };
    const css = F.map((_, i) => showFrames(i) + `.sh${i}{opacity:0;animation:sh${i} ${LOOP}s infinite both}`).join("\n  ");

    // Ari's looks (SVG, drawn small on top of the shared Ari)
    const look = (i) => {
      switch (i) {
        case 0: return `<g transform="translate(0 -4)"><text x="0" y="-130" text-anchor="middle" font-size="26" font-weight="800" fill="${BLUE}">Hello → سلام</text></g>`;
        case 1: return `<g transform="translate(0 -92)"><path d="M-50 12 L-62 -10 -30 0 0 -34 30 0 62 -10 50 12Z" fill="#f5b53d" stroke="#b7791f" stroke-width="3" stroke-linejoin="round"/><circle cx="0" cy="-34" r="6" fill="${VIOLET}"/></g>`;
        case 2: return `<g transform="translate(0 -4)"><rect x="-82" y="-24" width="66" height="44" rx="16" fill="#0b0b10" stroke="#475569" stroke-width="3"/><rect x="16" y="-24" width="66" height="44" rx="16" fill="#0b0b10" stroke="#475569" stroke-width="3"/><path d="M-16 -8 H16" stroke="#475569" stroke-width="5"/></g>`;
        case 3: return `<g transform="translate(0 -88)"><path d="M-70 14 C-70 -50 70 -50 70 14" fill="none" stroke="#e5e7eb" stroke-width="10" stroke-linecap="round"/><rect x="-92" y="-10" width="30" height="48" rx="12" fill="#1f2937" stroke="${GREEN}" stroke-width="4"/><rect x="62" y="-10" width="30" height="48" rx="12" fill="#1f2937" stroke="${GREEN}" stroke-width="4"/></g>`;
        case 4: return `<g transform="translate(60 70)"><circle r="22" fill="#fff"/><path d="M0-12 9-4 6 8H-6L-9-4Z" fill="#1f2937"/></g>`;
        case 5: return `<g transform="translate(0 -88)"><path d="M-86 -52 Q0 -86 86 -52 L84 -40 Q0 -72 -84 -40Z" fill="#A50044" stroke="#EDBB00" stroke-width="2"/></g>`;
        default: return `<g transform="translate(0 -86)"><ellipse cx="0" cy="6" rx="112" ry="19" fill="#5b21b6"/><path d="M-62 4 C-40 -20 -22 -70 6 -128 C12 -90 38 -40 62 4Z" fill="#7c3aed"/><path d="M-62 4 Q0 20 62 4 L58 -10 Q0 4 -58 -10Z" fill="#f97316"/></g>`;
      }
    };
    const looks = F.map((_, i) => `<g class="sh${i}" style="animation-name:sh${i}">${look(i)}</g>`).join("");

    // The island: a pill that morphs per feature (width) with the icon, name and subtitle.
    const islandPills = F.map((f, i) => `
    <g class="sh${i}">
      <rect x="${600 - 232}" y="26" width="464" height="46" rx="23" fill="#000" stroke="${f.c}" stroke-opacity=".6"/>
      <circle cx="${600 - 204}" cy="49" r="13" fill="${f.c}" opacity=".22"/>
      <text x="${600 - 204}" y="55" text-anchor="middle" font-size="15" font-weight="800" fill="${f.c}">${f.icon}</text>
      <text x="${600 - 178}" y="45" font-size="14.5" font-weight="700" fill="#fff">${f.en}</text>
      <text x="${600 - 178}" y="62" font-size="11.5" fill="#9aa0b8">${f.sub}</text>
      <text x="${600 + 218}" y="54" text-anchor="end" font-size="14" font-weight="600" fill="${f.c}" style="font-family:${FA}">${f.fa}</text>
    </g>`).join("");

    const dots = F.map((f, i) => `<circle cx="${600 - (N - 1) * 11 + i * 22}" cy="96" r="3.6" fill="#ffffff26"><animate attributeName="fill" calcMode="discrete" dur="${LOOP}s" repeatCount="indefinite" keyTimes="0;${(i / N).toFixed(4)};${((i + 1) / N).toFixed(4)}" values="#ffffff26;${f.c};#ffffff26"/></circle>`).join("");

    // Floating feature glyphs around Ari
    const orbit = [
      ["⚡", 190, 250, BLUE, 0], ["✦", 1010, 230, VIOLET, 1.2], ["♪", 250, 140, GREEN, 2.1], ["⚽", 960, 140, TEAL, 0.7],
      ["👕", 150, 360, AMBER, 1.7], ["🎩", 1060, 360, "#fb923c", 2.6],
    ].map(([g, x, y, c, d]) => `<g transform="translate(${x} ${y})"><g class="drift" style="animation-delay:${d}s"><circle r="26" fill="${c}" opacity=".14"/><circle r="26" fill="none" stroke="${c}" stroke-opacity=".5"/><text y="9" text-anchor="middle" font-size="24" style="font-family:'Segoe UI Emoji','Apple Color Emoji',sans-serif">${g}</text></g></g>`).join("");

    const body = `
<defs>
  ${ariDefs("hd")}
  <linearGradient id="hbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#090912"/><stop offset=".55" stop-color="#101424"/><stop offset="1" stop-color="#1a1030"/></linearGradient>
  <linearGradient id="htitle" gradientUnits="userSpaceOnUse" x1="300" y1="0" x2="900" y2="0" spreadMethod="reflect">
    <stop offset="0" stop-color="#60a5fa"/><stop offset=".5" stop-color="#f5f3ff"/><stop offset="1" stop-color="${VIOLET}"/>
    <animateTransform attributeName="gradientTransform" type="translate" from="-600 0" to="600 0" dur="7s" repeatCount="indefinite"/>
  </linearGradient>
  <filter id="hglow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="60"/></filter>
  <filter id="hsh" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10"/></filter>
  <clipPath id="hclip"><rect width="${W}" height="${H}" rx="32"/></clipPath>
</defs>
<style>${CSS}
  ${css}
  .ring{transform-box:fill-box;transform-origin:center;animation:ring 4s ease-out infinite}
  @keyframes ring{0%{transform:scale(.7);opacity:.55}100%{transform:scale(1.5);opacity:0}}
</style>
<g clip-path="url(#hclip)">
  <rect width="${W}" height="${H}" fill="url(#hbg)"/>
  <circle r="260" fill="${BLUE}" opacity=".42" filter="url(#hglow)"><animate attributeName="cx" values="120;320;120" dur="12s" repeatCount="indefinite"/><animate attributeName="cy" values="500;400;500" dur="12s" repeatCount="indefinite"/></circle>
  <circle r="240" fill="${VIOLET}" opacity=".4" filter="url(#hglow)"><animate attributeName="cx" values="1100;880;1100" dur="14s" repeatCount="indefinite"/><animate attributeName="cy" values="60;180;60" dur="14s" repeatCount="indefinite"/></circle>
  <circle r="200" fill="${GREEN}" opacity=".18" filter="url(#hglow)"><animate attributeName="cx" values="640;520;640" dur="16s" repeatCount="indefinite"/><animate attributeName="cy" values="560;520;560" dur="16s" repeatCount="indefinite"/></circle>
  ${stars(46, W, H)}
  ${star(250, 230, 1.1, 0)}${star(960, 270, 1.3, 1.1)}${star(380, 110, .8, 2)}${star(830, 100, 1, .6)}

  <!-- the island -->
  ${islandPills}
  ${dots}
  ${orbit}

  <!-- Ari -->
  <ellipse cx="600" cy="352" rx="120" ry="14" fill="#000" opacity=".55" filter="url(#hsh)"><animate attributeName="rx" values="120;100;120" dur="5s" repeatCount="indefinite"/></ellipse>
  <circle class="ring" cx="600" cy="236" r="150" fill="none" stroke="${VIOLET}" stroke-opacity=".5"/>
  <g transform="translate(600 238) scale(.92)"><g class="float">
    ${ari("hd")}
    ${looks}
  </g></g>

  <!-- titles -->
  <text x="600" y="446" text-anchor="middle" font-size="62" font-weight="800" fill="url(#htitle)" letter-spacing="1">Arizo-Agent</text>
  <text x="600" y="486" text-anchor="middle" font-size="22" fill="#c9cde0">A tiny friend at the top of your Windows screen</text>
  <text x="600" y="520" text-anchor="middle" font-size="20" fill="#9a8fd8" direction="rtl" style="font-family:${FA}">یک دوست کوچک در بالای صفحه‌ی ویندوز شما</text>
</g>
<rect width="${W}" height="${H}" rx="32" fill="none" stroke="#ffffff14"/>`;
    save("header.svg", svg(W, H, body, 'aria-label="Arizo-Agent: Ari shows translation, the two engines, the quick bubble, Spotify, live football, team kits and the wardrobe"'));
  }

  // ───────────────────────────────────────────── section banners
  function banner(name, { en, fa, c, c2, icon, art }) {
    const W = 1200, H = 120;
    const body = `
<defs>
  <linearGradient id="bg${name}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c}" stop-opacity=".28"/><stop offset=".6" stop-color="#0d0d16"/><stop offset="1" stop-color="${c2}" stop-opacity=".25"/></linearGradient>
  <linearGradient id="ln${name}" x1="0" x2="1"><stop offset="0" stop-color="${c}" stop-opacity="0"/><stop offset=".4" stop-color="${c}"/><stop offset=".6" stop-color="${c2}"/><stop offset="1" stop-color="${c2}" stop-opacity="0"/></linearGradient>
  <filter id="gl${name}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
</defs>
<style>${CSS}
  .sweep{animation:sweep 6s ease-in-out infinite}
  @keyframes sweep{0%{transform:translateX(-120px)}100%{transform:translateX(1320px)}}
  .icon{transform-box:fill-box;transform-origin:center;animation:icon 3.2s ease-in-out infinite}
  @keyframes icon{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-6px) rotate(4deg)}}
</style>
<rect width="${W}" height="${H}" rx="26" fill="#0d0d16"/><rect width="${W}" height="${H}" rx="26" fill="url(#bg${name})" stroke="#ffffff16"/>
${stars(18, W, H, name.length + 9)}
<g transform="translate(78 60)"><circle r="38" fill="${c}" opacity=".16"/><circle r="38" fill="none" stroke="${c}" stroke-opacity=".6" stroke-width="2"/>
  <g class="icon"><text y="13" text-anchor="middle" font-size="38" style="font-family:'Segoe UI Emoji','Apple Color Emoji',sans-serif">${icon}</text></g></g>
<text x="142" y="62" font-size="38" font-weight="800" fill="#fff">${en}</text>
<text x="142" y="92" font-size="16" fill="#aab0c8">${art}</text>
<text x="1140" y="62" text-anchor="end" font-size="34" font-weight="800" fill="#fff" style="font-family:${FA}">${fa}</text>
<rect x="60" y="112" width="1080" height="2.5" rx="1.2" fill="url(#ln${name})" opacity=".8"/>
<g clip-path="inset(0)"><circle class="sweep" cx="0" cy="113" r="6" fill="#fff" filter="url(#gl${name})"/></g>`;
    save(`banner-${name}.svg`, svg(W, H, body, `aria-label="${en}"`));
  }

  const BANNERS = {
    translate: { en: "Translate anywhere", fa: "ترجمه در هر جا", c: BLUE, c2: VIOLET, icon: "🌐", art: "Type, paste, select — the island answers without taking your focus" },
    spotify: { en: "Spotify, in the island", fa: "اسپاتیفای در جزیره", c: GREEN, c2: TEAL, icon: "🎵", art: "Cover, timeline and controls — and Ari dances to the beat" },
    football: { en: "Live football", fa: "فوتبال زنده", c: TEAL, c2: "#34d399", icon: "⚽", art: "Every goal, card and whistle gets its own show" },
    wardrobe: { en: "Ari's wardrobe", fa: "کمد لباس آری", c: "#fb923c", c2: ROSE, icon: "🎩", art: "Hats, glasses and crowns — and the seasons dress him on their own" },
    engines: { en: "Two engines", fa: "دو موتور ترجمه", c: VIOLET, c2: BLUE, icon: "✦", art: "Fast and free, or Smart with tone, idioms and alternatives" },
    start: { en: "Get started", fa: "شروع کنید", c: AMBER, c2: ROSE, icon: "🚀", art: "Install in seconds — no administrator rights, no account" },
    privacy: { en: "Private by design", fa: "حریم خصوصی", c: "#22c55e", c2: TEAL, icon: "🔒", art: "No telemetry. Your key stays in the Windows Credential Manager" },
    dev: { en: "For developers", fa: "برای توسعه‌دهندگان", c: "#60a5fa", c2: VIOLET, icon: "🛠️", art: "Rust + Tauri 2 + TypeScript — build it yourself in three commands" },
  };

  // ───────────────────────────────────────────── feature cards (an animated grid)
  function cards() {
    const W = 1200, H = 540;
    const items = [
      ["⚡", "Translate in place", "ترجمه در محل", "Alt+Shift+D swaps your text for its translation in any app", BLUE],
      ["🎯", "Quick bubble", "حباب سریع", "Select text anywhere — a button appears by the cursor", ROSE],
      ["🧠", "Smart language handling", "تشخیص هوشمند", "Auto direction, Persian-aware detection, idiom polish", VIOLET],
      ["🔁", "Never empty-handed", "همیشه جواب می‌دهد", "If Smart fails, Fast answers — and tells you why", "#38bdf8"],
      ["🎵", "Spotify player", "پخش‌کننده", "On this PC with no setup, or your account on any device", GREEN],
      ["⚽", "Live football", "فوتبال زنده", "Score every 3 s, a show for every moment of the match", TEAL],
      ["👕", "Your team's kit", "پیراهن تیم شما", "Ari wears the real shirt, drawn in 3D with his head", AMBER],
      ["👗", "Wardrobe &amp; seasons", "کمد لباس", "Hats and accessories — and the seasons dress him alone", "#fb923c"],
      ["🗣️", "Speech", "گفتار", "Reads the translation aloud — including Persian", "#a3e635"],
      ["📋", "History &amp; clipboard", "تاریخچه", "Star, search, bilingual copy, PDF line-break cleaner", "#f0abfc"],
      ["🔊", "30 original sounds", "۳۰ صدای اصلی", "Synthesized from code for every gesture", "#67e8f9"],
      ["🔒", "Private &amp; light", "خصوصی و سبک", "No telemetry; Rust + WebView2, no bundled Chromium", "#22c55e"],
    ];
    const cw = 264, ch = 150, gx = 24, gy = 24, x0 = 36, y0 = 36;
    const tiles = items.map(([ic, en, fa, sub, c], i) => {
      const col = i % 4, row = Math.floor(i / 4);
      const x = x0 + col * (cw + gx), y = y0 + row * (ch + gy);
      const d = (i * 0.12).toFixed(2);
      return `
  <g transform="translate(${x} ${y})"><g class="tile" style="animation-delay:${d}s">
    <rect width="${cw}" height="${ch}" rx="22" fill="#12121c" stroke="${c}" stroke-opacity=".35"/>
    <rect width="${cw}" height="${ch}" rx="22" fill="${c}" opacity=".06"/>
    <circle cx="44" cy="46" r="26" fill="${c}" opacity=".16"/>
    <g class="gl" style="animation-delay:${(i * 0.27).toFixed(2)}s"><text x="44" y="56" text-anchor="middle" font-size="27" style="font-family:'Segoe UI Emoji','Apple Color Emoji',sans-serif">${ic}</text></g>
    <text x="84" y="44" font-size="15" font-weight="800" fill="#fff">${en}</text>
    <text x="84" y="64" font-size="13" fill="${c}" style="font-family:${FA}">${fa}</text>
    ${lines(sub, 36, 20, 96, 18, 12.5, "#aab0c8")}
  </g></g>`;
    }).join("");
    const body = `
<defs><linearGradient id="cbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a0a12"/><stop offset="1" stop-color="#12101f"/></linearGradient></defs>
<style>${CSS}
  .tile{opacity:0;animation:tile 12s ease-out infinite both}
  @keyframes tile{0%{opacity:0;transform:translateY(16px) scale(.96)}6%,92%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:1}}
  .gl{transform-box:fill-box;transform-origin:center;animation:gl 4s ease-in-out infinite}
  @keyframes gl{0%,100%{transform:scale(1) rotate(0)}50%{transform:scale(1.14) rotate(-6deg)}}
</style>
<rect width="${W}" height="${H}" rx="30" fill="url(#cbg)" stroke="#ffffff14"/>
${tiles}`;
    save("cards.svg", svg(W, H, body, 'aria-label="Everything Arizo-Agent does"'));
  }

  // ───────────────────────────────────────────── install steps
  function steps() {
    const W = 1200, H = 210;
    const S = [
      ["1", "Download", "دانلود", "Installer or portable exe from Releases", "⬇️", BLUE],
      ["2", "Run", "اجرا", "No administrator rights, no account", "▶️", VIOLET],
      ["3", "Meet Ari", "آری را ببینید", "He lives at the top of your screen", "👋", AMBER],
      ["4", "Press Alt+D", "Alt+D", "Translate, play music, follow your team", "✨", GREEN],
    ];
    const cw = 250, gap = 40, x0 = 40;
    const tiles = S.map(([n, en, fa, sub, ic, c], i) => {
      const x = x0 + i * (cw + gap);
      return `
  <g transform="translate(${x} 36)"><g class="st" style="animation-delay:${(i * 0.6).toFixed(1)}s">
    <rect width="${cw}" height="138" rx="22" fill="#12121c" stroke="${c}" stroke-opacity=".45"/>
    <circle cx="40" cy="40" r="22" fill="${c}"/><text x="40" y="48" text-anchor="middle" font-size="22" font-weight="900" fill="#0b0b12">${n}</text>
    <text x="${cw - 24}" y="52" text-anchor="end" font-size="30" style="font-family:'Segoe UI Emoji','Apple Color Emoji',sans-serif">${ic}</text>
    <text x="24" y="86" font-size="20" font-weight="800" fill="#fff">${en}</text>
    <text x="${cw - 24}" y="86" text-anchor="end" font-size="14" fill="${c}" style="font-family:${FA}">${fa}</text>
    ${lines(sub, 30, 24, 108, 17, 12.5, "#aab0c8")}
  </g></g>
  ${i < 3 ? `<g transform="translate(${x + cw + gap / 2} 105)"><path class="arrow" d="M-8-8 L6 0 -8 8" fill="none" stroke="#ffffff55" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="animation-delay:${(i * 0.3).toFixed(1)}s"/></g>` : ""}`;
    }).join("");
    const body = `
<style>${CSS}
  .st{opacity:0;animation:st 8s ease-out infinite both}
  @keyframes st{0%{opacity:0;transform:translateY(14px)}8%,94%{opacity:1;transform:translateY(0)}100%{opacity:1}}
  .arrow{animation:arrow 1.4s ease-in-out infinite}
  @keyframes arrow{0%,100%{transform:translateX(-3px);opacity:.35}50%{transform:translateX(4px);opacity:1}}
</style>
<rect width="${W}" height="${H}" rx="26" fill="#0b0b13" stroke="#ffffff14"/>
${tiles}`;
    save("steps.svg", svg(W, H, body, 'aria-label="Download, run, meet Ari, press Alt+D"'));
  }

  header();
  for (const [name, b] of Object.entries(BANNERS)) banner(name, b);
  cards();
  steps();
}
