// Runs at the start of every muse.ai page, before the site's own code (src-tauri/src/muse.rs
// puts the fonts in place of __INTER__ and __VAZIRMATN__).
//
// 1. Fonts: Inter for Latin and Vazirmatn for Persian, the island's own, one step smaller than
//    the site draws its text. Built into the app: no download, and the site's CSP is not in the
//    way (a font made from bytes is not fetched, and a constructed style sheet is not inline).
// 2. Direction: every paragraph, list, heading, table cell and text field reads in its own
//    direction, right to left when it is mostly Persian (or Arabic, Hebrew…), left to right
//    otherwise. It is decided by most letters, not the first one, so "Muse یک دستیار است…" is
//    Persian; and again while an answer is being written and while the user types.
(() => {
  if (window.__arizoPage) return;
  window.__arizoPage = true;

  // ── Fonts ────────────────────────────────────────────────────────────────────
  // The unicode ranges are web/src/style.css's. size-adjust draws the text a step smaller
  // (93 %); Persian is scaled up against Latin as in the island (114 % of that).
  const bytes = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0)).buffer;
  const faces = [
    ["__INTER__", "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2010-2027, U+2030-205E, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215", "93%"],
    ["__VAZIRMATN__", "U+0600-06FF, U+0750-077F, U+FB50-FDFF, U+FE70-FEFF, U+200C-200D, U+061F", "106%"],
  ];
  for (const [data, unicodeRange, sizeAdjust] of faces) {
    try { document.fonts.add(new FontFace("Arizo Text", bytes(data), { weight: "100 900", unicodeRange, sizeAdjust, display: "swap" })); } catch {}
  }
  // Code keeps its monospace font and icon fonts keep theirs.
  const css = `:is(html, body, body *):not(code, pre, kbd, samp, code *, pre *, svg, svg *, i[class], [class*="icon" i], [class*="icon" i] *, [class*="material" i], [class*="symbol" i]) {
    font-family: "Arizo Text", "Segoe UI", system-ui, sans-serif !important;
  }`;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch {
    const put = () => { const s = document.createElement("style"); s.textContent = css; (document.head || document.documentElement).append(s); };
    if (document.documentElement) put(); else document.addEventListener("DOMContentLoaded", put, { once: true });
  }

  // ── Direction ────────────────────────────────────────────────────────────────
  const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/g;
  const LTR = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/g;
  /** "rtl" when right-to-left letters are at least as many as left-to-right ones; null with no letters. */
  const dirOf = (text) => {
    const r = (text.match(RTL) || []).length;
    const l = (text.match(LTR) || []).length;
    if (!r && !l) return null;
    return r >= l ? "rtl" : "ltr";
  };

  const BLOCKS = "p,li,ul,ol,h1,h2,h3,h4,h5,h6,blockquote,td,th,dd,dt,figcaption,summary";
  const FIELDS = "textarea,input:not([type]),input[type=text],input[type=search],[contenteditable=''],[contenteditable=true],[contenteditable=plaintext-only]";
  const SKIP = "pre,code,kbd,samp,svg,math";
  const ALL = `${BLOCKS},${FIELDS},div`;

  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim());
  // What an element can be: "field", "block", or false. A row laid out with flex or grid (a
  // menu entry with its icon, a toolbar) is left alone: turning it around would move its icon.
  // Remembered, as it does not change; whether a div holds text does (an answer starts as an
  // empty div and is written into it), so that is asked again each time.
  const kinds = new WeakMap();
  const shape = (el) => {
    if (kinds.has(el)) return kinds.get(el);
    let k = false;
    const mine = el.dataset && "arizoDir" in el.dataset;
    if (el.nodeType === 1 && !el.closest(SKIP) && (mine || !el.hasAttribute("dir"))) {
      if (el.matches(FIELDS)) k = "field";
      else if (el.matches(BLOCKS) || el.tagName === "DIV") {
        const d = getComputedStyle(el).display;
        k = d === "inline" || d === "contents" || d === "none" || d.includes("flex") || d.includes("grid") ? false : "block";
      }
    }
    kinds.set(el, k);
    return k;
  };
  const kind = (el) => {
    const k = shape(el);
    // A div is a paragraph only when text sits right in it; otherwise it only holds others.
    return k === "block" && el.tagName === "DIV" && !ownText(el) ? false : k;
  };

  const textOf = (el, k) => (k === "field" && "value" in el && el.tagName !== "DIV" ? el.value : el.textContent) || "";

  const update = (el) => {
    const k = kind(el);
    if (!k) return;
    const d = dirOf(textOf(el, k));
    if (!d) {
      // An emptied field goes back to the site's own direction (its placeholder).
      if (k === "field" && el.dataset.arizoDir) { el.removeAttribute("dir"); delete el.dataset.arizoDir; }
      return;
    }
    if (el.dataset.arizoDir !== d) { el.dir = d; el.dataset.arizoDir = d; }
    // A side the site fixed ("left") would keep Persian on the wrong side; the start of the
    // line follows the direction. Centred and justified text stay as they are.
    if (!el.dataset.arizoAlign) {
      el.dataset.arizoAlign = "1";
      const a = getComputedStyle(el).textAlign;
      if (a === "left" || a === "right") el.style.setProperty("text-align", "start", "important");
    }
  };

  // The nearest element above `node` whose direction is decided here.
  const owner = (node) => {
    let el = node.nodeType === 1 ? node : node.parentElement;
    while (el && el !== document.body && el !== document.documentElement) {
      if (kind(el)) return el;
      el = el.parentElement;
    }
    return null;
  };

  // Changes come in bursts (an answer is written a few letters at a time): they are handled
  // together, a moment later. setTimeout, not requestAnimationFrame, so a hidden page keeps up.
  const roots = new Set();
  const touched = new Set();
  let timer = 0;
  const later = () => { if (!timer) timer = setTimeout(flush, 40); };
  const flush = () => {
    timer = 0;
    const done = new Set();
    const run = (el) => {
      if (!el || done.has(el) || !el.isConnected) return;
      done.add(el);
      update(el);
      // A list follows its items.
      const up = el.parentElement;
      if (el.tagName === "LI" && up && (up.tagName === "UL" || up.tagName === "OL")) { done.delete(up); run(up); }
    };
    for (const root of roots) {
      if (!root.isConnected) continue;
      if (root.nodeType === 1) { run(root); root.querySelectorAll(ALL).forEach(run); }
    }
    for (const node of touched) run(owner(node));
    roots.clear();
    touched.clear();
  };

  const start = () => {
    roots.add(document.body || document.documentElement);
    later();
    new MutationObserver((records) => {
      for (const m of records) {
        if (m.type === "characterData") touched.add(m.target);
        else {
          touched.add(m.target);
          m.addedNodes.forEach((n) => (n.nodeType === 1 ? roots : touched).add(n));
        }
      }
      later();
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    // What is typed into a field is not a change to the page: listen for it.
    document.addEventListener("input", (e) => { if (e.target && e.target.nodeType === 1) { touched.add(e.target); later(); } }, true);
  };
  if (document.documentElement) start(); else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
