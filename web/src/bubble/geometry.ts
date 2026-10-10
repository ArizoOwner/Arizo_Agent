// The bubble's window sizes, in logical pixels. The window is transparent and
// takes the mouse everywhere, so it must be exactly as big as what it shows:
// anything more is an invisible patch that eats clicks meant for other apps.

/** Room around the drawing for its shadow (the page's body padding). */
export const PAD = 12;
/** The collapsed button: 44px squircle plus its room. */
export const BUTTON_WINDOW = 44 + PAD * 2;
export const CARD_WIDTH = 322;
export const CARD_WINDOW_W = CARD_WIDTH + PAD * 2;

const MIN_H = 96;
const MAX_H = 440;

/** The window's height for a card that measures `cardPx`. */
export function cardWindowHeight(cardPx: number): number {
  if (!Number.isFinite(cardPx) || cardPx <= 0) return MIN_H;
  return Math.min(MAX_H, Math.max(MIN_H, Math.ceil(cardPx) + PAD * 2));
}
