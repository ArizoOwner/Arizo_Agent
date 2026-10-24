// Pure text helpers of the translator: no DOM, no bridge.

const RE_ARABIC_SCRIPT = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g;
const RE_PERSIAN_ONLY = /[پچژگکی۰-۹‌]/g;
const RE_ARABIC_ONLY = /[ةيكىءأإؤئ]/g;
const RE_URDU_ONLY = /[ٹڈڑںھہےۓ]/g;
const RE_LATIN = /[A-Za-zÀ-ɏ]/g;
const RE_PERSIAN_WORDS = /(?:^|\s|[.,!؟،؛:\-_()[\]{}"'])(سلام|درود|خوبی|در|به|از|که|رو|را|با|برای|این|آن|اینجا|آنجا|ها|های|کن|کنید|کرد|کردن|کردم|کردی|کردند|شد|شده|است|نیست|بود|می|نمی|یک|هم|چرا|چطور|چطوری|چگونه|کجا|چی|چیه|چیست|کی|اگر|اگه|ولی|اما|چون|تا|توی|تو|روی|داخل|زیر|بالا|داد|داده|میده|می‌ده|نده|نمیده|نمی‌ده|گرفت|بگیر|نگیر|زد|زدن|بزن|نزن|میزنه|می‌زنه|رفت|برو|نرو|اومد|آمد|بیا|نیا|هست|باشه|نباشه|میشه|می‌شه|نمیشه|نمی‌شه|لطفا|لطفاً|مرسی|ممنون|تشکر|دارد|دارم|داری|دارند|باید|نباید|شاید|بزار|بذار|چک|تست|حل|ارور|خطا|مشکل|باگ|میخوام|می‌خوام|میخواهم|می‌خواهم|میتونم|می‌تونم|میتونی|می‌تونی|میتونه|می‌تونه|بکنم|بررسی|پروژه|برنامه|کد|کامیت|مرج|پوش|پول|ریکوئست|برنچ|ریپو|کانفیگ|دیپلوی|بیلد|فیکس|اجرا|نصب|پکیج|ماژول|کامپوننت|تابع|متغیر|دیتابیس|سرور|کلاینت|لاگ|داکیومنت)(?:\s|[.,!؟،؛:\-_()[\]{}"']|$)/i;

function countMatches(str: string, re: RegExp): number {
  const m = str.match(re);
  return m ? m.length : 0;
}

/**
 * Script-based guess of the language of `text`, for the label above the input
 * while the user types (the backend does the real detection). One of
 * "fa" | "ar" | "ur" | "en".
 */
export function detectLanguageClient(text: string): "fa" | "ar" | "ur" | "en" {
  if (!text || !text.trim()) return "en";
  const clean = text.trim();
  const arabic = countMatches(clean, RE_ARABIC_SCRIPT);
  const latin = countMatches(clean, RE_LATIN);
  if (arabic > 0) {
    if (countMatches(clean, RE_URDU_ONLY) > 0) return "ur";
    const faLetters = countMatches(clean, RE_PERSIAN_ONLY);
    const arLetters = countMatches(clean, RE_ARABIC_ONLY);
    const hasFaWords = RE_PERSIAN_WORDS.test(clean);
    if (hasFaWords || faLetters > 0) return "fa";
    if (arabic >= 3 || (arabic + latin > 0 && arabic / (arabic + latin) >= 0.15)) {
      if (arLetters > faLetters && faLetters === 0 && !hasFaWords && arabic > latin) return "ar";
      return "fa";
    }
    if (arLetters > 0 && faLetters === 0) return "ar";
    return "fa";
  }
  return "en";
}

/** "zh-CN" becomes "ZH", "fa" becomes "FA": the short label of a language code. */
export function langLabel(code: string | null | undefined): string {
  return (code || "").split("-")[0].toUpperCase();
}

/** True for the languages that read right to left. */
export function isRtlLang(code: string | null | undefined): boolean {
  return ["fa", "ar", "ur", "he"].includes((code || "").split("-")[0].toLowerCase());
}

/**
 * Where "Auto" will translate to: the second language when the text is already
 * in the first one, the first otherwise.
 */
export function autoTarget(detected: string, nativeLang: string, secondLang: string): string {
  return detected === nativeLang ? secondLang : nativeLang;
}

/** True when the text looks like it was copied from a PDF (hard line breaks, hyphenation). */
export function hasPdfLineBreaks(text: string): boolean {
  if (!text || text.trim().length <= 25) return false;
  const t = text.replace(/\r\n?/g, "\n").trim();
  // A lone line break inside a paragraph (not a blank-line paragraph break).
  return /\S-[ \t]*\n[ \t]*\S/.test(t) || /[^\n][ \t]*\n(?![ \t]*\n)/.test(t);
}

/** Joins the hard-wrapped lines of PDF text and keeps the paragraphs. */
export function cleanPdfText(text: string): string {
  if (!text) return "";
  return text
    .replace(/\r\n?/g, "\n")
    // Only a word broken across lines is re-glued: lower-case letters on both sides, one line break
    // (never a number range like "10-\n12", never across a blank line).
    .replace(/(\p{Ll})-[ \t]*\n[ \t]*(\p{Ll})/gu, "$1$2")
    .replace(/\n\s*\n+/g, "<<<PARAGRAPH>>>")
    .replace(/\n+/g, " ")
    .replace(/<<<PARAGRAPH>>>/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n\n ?/g, "\n\n")
    .replace(/ ([.,!?;:،؛؟])/g, "$1")
    .trim();
}

/** One line of at most `max` characters, with an ellipsis when it was cut. */
export function ellipsize(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, Math.max(0, max - 1)).trimEnd()}…` : one;
}

/** "420 ms" or "1.3 s". */
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}
