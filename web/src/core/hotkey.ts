// Turns a KeyboardEvent into the accelerator string the backend registers
// ("Ctrl+Alt+D", "Alt+Shift+F5"), for the recorder in Settings.

const NAMED: Record<string, string> = {
  Space: "Space", Enter: "Enter", Tab: "Tab", Backspace: "Backspace", Delete: "Delete", Insert: "Insert",
  Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
  ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
  Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/",
};

/** The key name of a `KeyboardEvent.code`, or null when it can't be a shortcut. */
export function keyName(code: string): string | null {
  let m: RegExpExecArray | null;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit(\d)$/.exec(code))) return m[1];
  if ((m = /^Numpad(\d)$/.exec(code))) return `num${m[1]}`;
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  return NAMED[code] ?? null;
}

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export function modifiers(e: Pick<KeyLike, "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): string[] {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Super");
  return parts;
}

export type HotkeyResult =
  | { kind: "ok"; accelerator: string }
  | { kind: "cancel" }
  | { kind: "wait" }
  | { kind: "invalid"; reason: "unsupportedKey" | "needsModifier" };

const MODIFIER_KEYS = ["Control", "Alt", "Shift", "Meta"];

/** What one key press means to the recorder. */
export function recordKey(e: KeyLike): HotkeyResult {
  if (e.key === "Escape") return { kind: "cancel" };
  if (MODIFIER_KEYS.includes(e.key)) return { kind: "wait" };
  const key = keyName(e.code);
  if (!key) return { kind: "invalid", reason: "unsupportedKey" };
  const mods = modifiers(e);
  if (!mods.length && !/^F\d/.test(key)) return { kind: "invalid", reason: "needsModifier" };
  return { kind: "ok", accelerator: [...mods, key].join("+") };
}

/** "Ctrl+Alt+D" becomes ["Ctrl", "Alt", "D"], for drawing keycaps. */
export function accelParts(accelerator: string): string[] {
  return accelerator.split("+").filter(Boolean);
}
