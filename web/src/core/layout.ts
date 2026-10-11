// Island geometry. All values are logical pixels.

export type IslandMode = "hidden" | "compact" | "expanded";

export type IslandViewName = "translate" | "history" | "note" | "settings" | "greeting" | "wardrobe";

export type BotStateName =
  | "idle"
  | "working"
  | "thinking"
  | "searching"
  | "approval"
  | "question"
  | "error"
  | "finished"
  | "ratelimit"
  | "sleeping"
  | "dizzy";

export type BotEmoteName = "love" | "surprised" | "proud" | "wink" | "yawn" | "happy" | "annoyed";

export interface ViewLayout {
  height: number;
  botX: number;
  botY: number | null; // null = auto-centred
  botDiameter: number;
}

// The window is a fixed 920×520 (largest view) like the macOS panel; the island is
// drawn inside it, glued to the top edge and horizontally centred.
export const PANEL_W = 920;
export const PANEL_H = 520;

// No notch on a PC: these are the hidden/compact sizes from docs/SPEC.md.
export const NOTCH_W = 184;
export const NOTCH_H = 32;
export const COMPACT_W = 288; // NOTCH_W + 104
export const EXPANDED_W = 760;
/** The intro is drawn on a canvas this wide (ari/greeting.ts): the island matches it exactly. */
export const GREETING_ISLAND_W = 640;

export const ROUNDED_CORNER = 14; // hidden / compact
export const EXPANDED_CORNER = 22;

/** Invisible hover strip that wakes the island when hidden. */
export const WAKE_STRIP_W = 240;
export const WAKE_STRIP_H = 6;

/** The translate view at rest: compact, sleek and legible. It grows with text up to PANEL_H. */
export const TRANSLATE_MIN_H = 235;
/** What the island has around its two cards: the 34px header plus the 8px top and 10px bottom padding. */
const ISLAND_CHROME_PX = 52;

/**
 * The translate view's width follows its text, like its height: a short phrase
 * gets a compact island, a long one grows by steps up to the maximum. Only the
 * text decides: the buttons adapt to the room (container queries in
 * translate.css), the island never widens for them.
 */
export const TRANSLATE_MIN_W = 740;
export const TRANSLATE_MAX_W = 860;
/** Characters at which the translate view has reached its maximum width. */
const WIDTH_FULL_AT_CHARS = 160;
/** Widths move in steps so typing does not make the island breathe on every key. */
const WIDTH_STEP = 20;

export function translateWidth(chars: number): number {
  const t = Math.min(1, Math.max(0, chars) / WIDTH_FULL_AT_CHARS);
  const raw = TRANSLATE_MIN_W + t * (TRANSLATE_MAX_W - TRANSLATE_MIN_W);
  const stepped = TRANSLATE_MIN_W + Math.round((raw - TRANSLATE_MIN_W) / WIDTH_STEP) * WIDTH_STEP;
  return Math.min(TRANSLATE_MAX_W, stepped);
}

/**
 * Island height for two cards that each need `cardPx` to show everything without
 * scrolling (the taller of the two). Never shorter than the resting height, never
 * taller than the window: only past that does a card scroll.
 */
export function translateHeight(cardPx: number): number {
  const wanted = Math.round(Math.max(0, cardPx)) + ISLAND_CHROME_PX;
  return Math.min(PANEL_H, Math.max(TRANSLATE_MIN_H, wanted));
}

export const VIEW_LAYOUTS: Record<IslandViewName, ViewLayout> = {
  // The two-card translator: source on the left, result on the right. Ari sits
  // beside the source text, like in the chat of the app this look comes from.
  translate: { height: TRANSLATE_MIN_H, botX: 54, botY: null, botDiameter: 60 },
  history: { height: 350, botX: 54, botY: null, botDiameter: 60 },
  note: { height: 180, botX: 66, botY: null, botDiameter: 64 },
  settings: { height: 410, botX: 54, botY: null, botDiameter: 60 },
  greeting: { height: 160, botX: 320, botY: 96, botDiameter: 0 },
  wardrobe: { height: 330, botX: 80, botY: null, botDiameter: 76 },
};

export function islandSize(
  mode: IslandMode,
  view: IslandViewName,
  translateH = TRANSLATE_MIN_H,
  translateW = TRANSLATE_MIN_W,
): { w: number; h: number } {
  switch (mode) {
    case "hidden":
      // No notch to hide inside on a PC: the island retracts to zero height and
      // slides into the top edge of the screen instead of sitting there as a bar.
      return { w: NOTCH_W, h: 0 };
    case "compact":
      return { w: COMPACT_W, h: NOTCH_H };
    case "expanded":
      return view === "translate"
        ? { w: translateW, h: translateH }
        : { w: view === "greeting" ? GREETING_ISLAND_W : EXPANDED_W, h: VIEW_LAYOUTS[view].height };
  }
}

export interface BotPlacement {
  cx: number;
  cy: number;
  diameter: number;
  opacity: number;
}

/** IslandRootView.botPosition — cy is measured from the island's top edge. */
export function botPosition(
  mode: IslandMode,
  view: IslandViewName,
  islandH: number,
  rtl = false,
  /** The island's width now (the translate view's depends on its text). */
  width?: number,
): BotPlacement {
  // Right to left mirrors the island: Ari moves to the other side with the cards.
  const place = (p: BotPlacement): BotPlacement =>
    rtl && mode === "expanded" && view !== "greeting"
      ? { ...p, cx: (width ?? islandSize(mode, view).w) - p.cx }
      : p;
  return place(botPositionLtr(mode, view, islandH));
}

function botPositionLtr(mode: IslandMode, view: IslandViewName, islandH: number): BotPlacement {
  switch (mode) {
    case "hidden":
      return { cx: 46, cy: 16, diameter: 6, opacity: 0 };
    case "compact":
      return { cx: 40, cy: 16, diameter: 20, opacity: 1 };
    case "expanded": {
      const layout = VIEW_LAYOUTS[view];
      if (layout.botY != null) {
        return { cx: layout.botX, cy: layout.botY, diameter: layout.botDiameter, opacity: 1 };
      }
      // The card views fill the area under the header: Ari sits at its centre.
      if (view === "translate" || view === "history" || view === "settings") {
        return { cx: layout.botX, cy: 42 + (islandH - 52) / 2, diameter: layout.botDiameter, opacity: 1 };
      }
      // Centre of the fixed 84 pt card (8 pt top inset + 34 pt header → content at y = 42)
      const headerBottom = 42;
      const cardH = 84;
      const cy = headerBottom + (islandH - headerBottom - cardH) / 2 + cardH / 2;
      return { cx: layout.botX, cy, diameter: layout.botDiameter, opacity: 1 };
    }
  }
}

export function botGlowColor(s: BotStateName): string {
  switch (s) {
    case "working":
      return "#3B9EFF";
    case "thinking":
      return "#A78BFA";
    case "searching":
      return "#6366F1";
    case "approval":
      return "#F5A524";
    case "error":
      return "#F4505E";
    case "finished":
      return "#34D399";
    case "ratelimit":
      return "#F59E0B";
    default:
      return "#FFFFFF";
  }
}

export function botGlowOpacity(s: BotStateName): number {
  switch (s) {
    case "idle":
    case "sleeping":
      return 0.15;
    case "dizzy":
      return 0;
    default:
      return 0.65;
  }
}

// Card wash colours (CardBackground.washColor)
export type Wash = "red" | "green" | "pink" | "amber" | "cyan" | "indigo" | "soft" | null;

export function washRGBA(wash: Wash): string {
  switch (wash) {
    case "red":
      return "rgba(244,80,94,0.55)";
    case "green":
      return "rgba(52,211,153,0.5)";
    case "pink":
      return "rgba(244,114,182,0.55)";
    case "amber":
      return "rgba(245,165,36,0.42)";
    case "cyan":
      return "rgba(34,211,238,0.38)";
    case "indigo":
      return "rgba(99,102,241,0.5)";
    case "soft":
      return "rgba(255,255,255,0.08)";
    default:
      return "rgba(0,0,0,0)";
  }
}
