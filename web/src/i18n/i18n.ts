// Interface language: English and Persian (فارسی).
//
// Strings are looked up by their English text: t(Copy) gives "کپی" in Persian.
// Two tables, both keyed by the English
// text and holding the Persian one:
// - strings.json, the words the island itself uses (wardrobe, tabs, sound…);
// - extra.json, the translator's own sentences.
// A string missing from both tables shows in English.
//
// Changing the language never reloads a window: `setLanguage` tells whoever
// listens (`onLanguageChange`), views/dom.ts relabels the text it was given
// as `tl(…)`, and the views redraw the rest on their next sync.

import SHARED from "./strings.json";
import EXTRA from "./extra.json";

export const LANGUAGE_CODES = ["en", "fa"] as const;
export type Language = (typeof LANGUAGE_CODES)[number];

/** The picker's entries, each in its own language. */
export const LANGUAGES: readonly { code: Language; name: string }[] = [
  { code: "fa", name: "فارسی" },
  { code: "en", name: "English" },
];

export type Vars = Record<string, string | number>;
type Entry = Partial<Record<Language, string>>;
type Table = Record<string, Entry>;

/** extra.json wins over strings.json where both have a string. */
const TABLE: Table = {
  ...((SHARED as { strings: Table }).strings),
  ...((EXTRA as { strings: Table }).strings),
};

let current: Language = "en";
const listeners = new Set<(lang: Language) => void>();

export function isLanguage(code: unknown): code is Language {
  return typeof code === "string" && (LANGUAGE_CODES as readonly string[]).includes(code);
}

/** The language to show: the one picked in Settings when it is ours, else English. */
export function resolveLanguage(picked: string | undefined | null): Language {
  return isLanguage(picked) ? picked : "en";
}

/** The system's languages, as the webview knows them. */
export function systemLanguages(): string[] {
  if (typeof navigator === "undefined") return [];
  const list = navigator.languages?.length ? [...navigator.languages] : [];
  if (navigator.language && !list.includes(navigator.language)) list.push(navigator.language);
  return list;
}

export function language(): Language {
  return current;
}

/** Persian reads right to left. */
export function isRtl(lang: Language = current): boolean {
  return lang === "fa";
}

/** Switches the language. Returns true when it changed (listeners were told). */
export function setLanguage(lang: Language): boolean {
  if (!isLanguage(lang) || lang === current) return false;
  current = lang;
  applyDocumentLanguage();
  for (const listener of [...listeners]) listener(lang);
  return true;
}

/** Called after every language change; returns the unsubscribe. */
export function onLanguageChange(listener: (lang: Language) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * <html lang> follows the language, so the webview picks fitting fonts, and
 * <html data-dir> says which way it reads: the island's CSS turns its text
 * containers right to left with it, leaving Ari, the pills and the header
 * where they are. (The settings window sets `dir` on the whole page.)
 */
export function applyDocumentLanguage() {
  if (typeof document === "undefined" || !document.documentElement) return;
  const root = document.documentElement;
  root.lang = current;
  if (root.dataset) root.dataset.dir = isRtl() ? "rtl" : "ltr";
}

function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** The raw translation of `key` in `lang`, or undefined. */
export function lookup(key: string, lang: Language = current): string | undefined {
  if (lang === "en") return undefined;
  return TABLE[key]?.[lang];
}

/**
 * `key` (English text) in the current language, its `{placeholders}` filled
 * from `vars`. Falls back to the English text.
 */
export function t(key: string, vars?: Vars): string {
  return interpolate(lookup(key) ?? key, vars);
}

/** A count with its words (one form, other form, count). Persian has one form. */
export function tn(one: string, other: string, count: number, vars?: Vars): string {
  const all = { ...vars, count };
  if (current === "fa") return interpolate(lookup(other) ?? other, all);
  return interpolate(count === 1 ? one : other, all);
}

/**
 * Marks a literal as a key without translating it, for tables built at load
 * time (outfit names, pill labels…): the code translates it with `t()` where
 * it is shown. The i18n test finds the keys through it.
 */
export function N_<T extends string>(key: T): T {
  return key;
}

/**
 * A table of labels whose every read is translated: `labels({ a: N_("Bow") }).a`
 * is "Bow" in English and the Persian word in Persian.
 */
export function labels<K extends string>(keys: Record<K, string>): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const k of Object.keys(keys) as K[]) {
    Object.defineProperty(out, k, { enumerable: true, get: () => t(keys[k]) });
  }
  return out;
}

/**
 * A string that follows the language by itself once it is on screen. Given to
 * `h()` (views/dom.ts) as a text, a title, a placeholder or a child, it is
 * redrawn in place when the language changes.
 */
export class Msg {
  readonly key: string;
  readonly vars?: Vars;
  constructor(key: string, vars?: Vars) {
    this.key = key;
    this.vars = vars;
  }
  toString(): string {
    return t(this.key, this.vars);
  }
}

/** `t()` for text built once: see `Msg`. */
export function tl(key: string, vars?: Vars): Msg {
  return new Msg(key, vars);
}

/** Every key of both tables, for the tests. */
export function allKeys(): string[] {
  return Object.keys(TABLE);
}

/** True when `key` has a Persian translation. */
export function isComplete(key: string): boolean {
  return TABLE[key]?.fa !== undefined;
}
