// How the island looks, as the user sets it in Settings → Island look: its width and
// height, how see-through it is, the size of every text, how round its corners are, and
// whether it floats a little below the top edge instead of touching it. Every number is a
// percentage of the design (100 = as it ships; transparency 0 = solid), kept in the
// settings, and every one can be put back to its default.
//
// Pure helpers only. The island applies them (island/island.ts), and the stylesheets
// read the CSS variables written by applyLookVars().

export type NumKey =
  | "uiWidth" | "uiHeight" | "uiTransparency" | "uiFontScale" | "uiCorner" | "uiFloatGap"
  | "uiCompactWidth" | "uiCompactHeight" | "uiCompactScale";
export type LookKey = NumKey | "uiFloating";

export interface LookSetting {
  key: NumKey;
  min: number;
  max: number;
  step: number;
  /** What "put back" restores. */
  def: number;
}

/** The same ranges as store.rs (UI_*): a web test reads them from there, so they cannot drift apart. */
export const LOOK: Record<NumKey, LookSetting> = {
  uiWidth: { key: "uiWidth", min: 80, max: 130, step: 1, def: 100 },
  uiHeight: { key: "uiHeight", min: 90, max: 130, step: 1, def: 100 },
  uiTransparency: { key: "uiTransparency", min: 0, max: 70, step: 1, def: 0 },
  uiFontScale: { key: "uiFontScale", min: 80, max: 140, step: 1, def: 100 },
  uiCorner: { key: "uiCorner", min: 0, max: 150, step: 1, def: 100 },
  uiFloatGap: { key: "uiFloatGap", min: 4, max: 60, step: 1, def: 14 },
  // The folded island (the capsule): its width and height as a percentage of the design, and the zoom of the whole of it.
  uiCompactWidth: { key: "uiCompactWidth", min: 60, max: 160, step: 1, def: 100 },
  uiCompactHeight: { key: "uiCompactHeight", min: 90, max: 180, step: 1, def: 100 },
  uiCompactScale: { key: "uiCompactScale", min: 70, max: 180, step: 1, def: 100 },
};

export const NUM_KEYS = Object.keys(LOOK) as NumKey[];

export interface Look extends Record<NumKey, number> {
  /** Floating: the island hangs `uiFloatGap` px below the top edge instead of touching it. */
  uiFloating: boolean;
}

export const LOOK_KEYS: readonly LookKey[] = [...NUM_KEYS, "uiFloating"];

export const DEFAULT_LOOK: Look = {
  uiWidth: LOOK.uiWidth.def,
  uiHeight: LOOK.uiHeight.def,
  uiTransparency: LOOK.uiTransparency.def,
  uiFontScale: LOOK.uiFontScale.def,
  uiCorner: LOOK.uiCorner.def,
  uiFloatGap: LOOK.uiFloatGap.def,
  uiCompactWidth: LOOK.uiCompactWidth.def,
  uiCompactHeight: LOOK.uiCompactHeight.def,
  uiCompactScale: LOOK.uiCompactScale.def,
  uiFloating: false,
};

/** A value from anywhere (a stored setting, a slider, a typed number) as a whole number inside the range. */
export function clampLook(key: NumKey, raw: unknown): number {
  const s = LOOK[key];
  const n = typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isFinite(n)) return s.def;
  return Math.min(s.max, Math.max(s.min, Math.round(n)));
}

/** Reads the look out of a settings object, repairing whatever is missing or out of range. */
export function lookOf(settings: Partial<Look>): Look {
  const out = { ...DEFAULT_LOOK };
  for (const key of NUM_KEYS) out[key] = clampLook(key, settings[key]);
  out.uiFloating = settings.uiFloating === true;
  return out;
}

export const isDefault = (key: LookKey, value: number | boolean): boolean => value === DEFAULT_LOOK[key];

/** True when every look setting is at its default (the "reset all" button has nothing to do). */
export function allDefault(look: Look): boolean {
  return LOOK_KEYS.every((key) => isDefault(key, look[key]));
}

/** The patch that puts one setting, or all of them, back to the default. */
export function resetPatch(key?: LookKey): Partial<Look> {
  if (key) return { [key]: DEFAULT_LOOK[key] };
  return { ...DEFAULT_LOOK };
}

// ── What the numbers mean ────────────────────────────────────────────────────

export const fontScale = (look: Look): number => look.uiFontScale / 100;

/** Corner radius in px: the designed radius times the setting (0 = square corners). */
export function cornerRadius(designed: number, look: Look): number {
  return Math.max(0, Math.round((designed * look.uiCorner) / 100));
}

/** The alpha of the island's body and cards (1 = solid): the text and the controls stay fully visible. */
export function bodyAlpha(look: Look): number {
  return Math.min(1, Math.max(0, 1 - look.uiTransparency / 100));
}

/** How far the open or folded island hangs below the top edge (0 when it is not floating, or hidden). */
export function floatOffset(look: Look, hidden: boolean): number {
  return look.uiFloating && !hidden ? look.uiFloatGap : 0;
}

/** How much taller than designed a fixed-height view must be for text at this size to fit. */
export const textGrowth = (look: Look): number => Math.max(1, fontScale(look));

/**
 * The island's size with the look applied. `base` is the designed size; a view whose
 * height already follows its content (the translator) is scaled by the height setting but
 * never below `floorH`, the least its cards need; every other view also grows with the
 * text, so bigger text still fits. Never larger than `limit` (the screen).
 */
export function scaledIsland(
  base: { w: number; h: number },
  fitsContent: boolean,
  look: Look,
  limit: { w: number; h: number },
  floorH = 0,
): { w: number; h: number } {
  const w = base.w * (look.uiWidth / 100);
  const scaled = base.h * (look.uiHeight / 100);
  const h = fitsContent ? Math.max(floorH, scaled) : scaled * textGrowth(look);
  return {
    w: Math.round(Math.min(Math.max(w, 1), Math.max(limit.w, 1))),
    h: Math.round(Math.min(Math.max(h, 1), Math.max(limit.h, 1))),
  };
}

/** Window sizes move in steps, so dragging a slider does not resize the window on every pixel. */
export const PANEL_STEP = 40;
const stepUp = (v: number) => Math.ceil(v / PANEL_STEP) * PANEL_STEP;

export interface IslandExtent {
  w: number;
  h: number;
  /** Its height follows its content (the translator) instead of growing with the text size. */
  fitsContent: boolean;
}

/**
 * The window the island needs: the default panel, or bigger when the island at its largest
 * (with room for its shadow at the sides, and for the gap it floats at) would not fit. At
 * the default look this is exactly the default panel.
 */
export function panelFor(
  look: Look,
  panel: { w: number; h: number },
  largest: readonly IslandExtent[],
  sideShadow: number,
  limit: { w: number; h: number },
): { w: number; h: number } {
  let w = panel.w;
  let h = panel.h;
  const float = floatOffset(look, false);
  for (const extent of largest) {
    const size = scaledIsland(extent, extent.fitsContent, look, limit);
    w = Math.max(w, stepUp(size.w + sideShadow * 2));
    h = Math.max(h, stepUp(size.h + float + (float > 0 ? sideShadow : 0)));
  }
  return { w, h };
}

/** "112%" for a slider's readout, with the digits and the percent sign of the interface language. */
export function readout(value: number, persian: boolean, unit: "%" | "px" = "%"): string {
  const n = new Intl.NumberFormat(persian ? "fa-IR" : "en-US", { useGrouping: false }).format(value);
  if (unit === "px") return persian ? `${n} پیکسل` : `${n} px`;
  return persian ? `${n}٪` : `${n}%`;
}

/** Writes what the stylesheets read: the text scale, the surface alpha and the corner scale. */
export function applyLookVars(root: HTMLElement, look: Look): void {
  const s = root.style;
  s.setProperty("--fs", String(fontScale(look)));
  s.setProperty("--surface-a", String(bodyAlpha(look)));
  s.setProperty("--cr", String(look.uiCorner / 100));
  // Only a narrower island shrinks the translator's cards; a wider one lets them grow on their own.
  s.setProperty("--wf", String(Math.min(1, look.uiWidth / 100)));
}
