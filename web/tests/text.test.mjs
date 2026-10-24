// Pure text helpers: PDF clean-up, client-side language detection, labels.

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  autoTarget, cleanPdfText, detectLanguageClient, ellipsize, formatDuration, hasPdfLineBreaks,
  isRtlLang, langLabel,
} = await import("../src/core/text.ts");

test("cleanPdfText joins hard-wrapped lines and re-glues hyphenated words", () => {
  assert.equal(cleanPdfText("The quick brown\nfox jumps over\nthe lazy dog."), "The quick brown fox jumps over the lazy dog.");
  assert.equal(cleanPdfText("a trans-\nlation engine"), "a translation engine");
  assert.equal(cleanPdfText("Line one\r\nline two"), "Line one line two");
  assert.equal(cleanPdfText("pages 10-\n12"), "pages 10- 12", "a number range is not a word");
  assert.equal(cleanPdfText("COVID-\n19"), "COVID- 19");
  assert.equal(cleanPdfText("one-\n\nPart two"), "one-\n\nPart two", "a paragraph break is kept, nothing is glued across it");
});

test("cleanPdfText keeps paragraphs and tidies spaces before punctuation", () => {
  assert.equal(cleanPdfText("First para\nstill first.\n\nSecond para ."), "First para still first.\n\nSecond para.");
  assert.equal(cleanPdfText("سلام \n\n  دنیا ،"), "سلام\n\nدنیا،");
  assert.equal(cleanPdfText(""), "");
});

test("hasPdfLineBreaks needs a long enough text with hard breaks or hyphenation", () => {
  assert.equal(hasPdfLineBreaks("short\ntext"), false);
  assert.equal(hasPdfLineBreaks("this line is long enough\nand has a hard break"), true);
  assert.equal(hasPdfLineBreaks("a single long line without any break in it at all"), false);
  assert.equal(hasPdfLineBreaks("an interna-\ntional word in a long enough text"), true);
  // Paragraph spacing alone (three newlines) is not a PDF artefact.
  assert.equal(hasPdfLineBreaks("a long enough first paragraph\n\n\nanother one"), false);
});

test("detectLanguageClient tells Persian, Arabic, Urdu and Latin text apart", () => {
  assert.equal(detectLanguageClient(""), "en");
  assert.equal(detectLanguageClient("   "), "en");
  assert.equal(detectLanguageClient("Hello, how are you?"), "en");
  assert.equal(detectLanguageClient("سلام، حال شما چطور است؟"), "fa");
  assert.equal(detectLanguageClient("می‌خوام یه قرار بذارم"), "fa");
  assert.equal(detectLanguageClient("مرحبا بكم في هذا الموقع الجميل"), "ar");
  assert.equal(detectLanguageClient("یہ ایک ٹیسٹ ہے"), "ur");
});

test("detectLanguageClient: Persian with English jargon stays Persian", () => {
  assert.equal(detectLanguageClient("این پروژه رو deploy کن"), "fa");
  // A text that is only Latin is English, however technical.
  assert.equal(detectLanguageClient("git commit -m fix"), "en");
});

test("langLabel and isRtlLang read the base of the code", () => {
  assert.equal(langLabel("zh-CN"), "ZH");
  assert.equal(langLabel("fa"), "FA");
  assert.equal(langLabel(""), "");
  assert.equal(langLabel(null), "");
  assert.equal(isRtlLang("fa"), true);
  assert.equal(isRtlLang("ar-SA"), true);
  assert.equal(isRtlLang("en"), false);
});

test("autoTarget goes to the second language from the first, and to the first otherwise", () => {
  assert.equal(autoTarget("fa", "fa", "en"), "en");
  assert.equal(autoTarget("en", "fa", "en"), "fa");
  assert.equal(autoTarget("de", "fa", "en"), "fa");
});

test("ellipsize cuts to one line and formatDuration picks ms or s", () => {
  assert.equal(ellipsize("a\n b   c", 20), "a b c");
  assert.equal(ellipsize("abcdefghij", 5), "abcd…");
  assert.equal(formatDuration(420), "420 ms");
  assert.equal(formatDuration(1300), "1.3 s");
});
