// Interface language: English fallback, Persian lookup, placeholders, RTL, and
// every key the code uses having a Persian string.

import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom } from "./fakedom.mjs";

installFakeDom();

const I = await import("../src/i18n/i18n.ts");
const { h, relabel } = await import("../src/views/dom.ts");
const { usedKeys } = await import("../scripts/keys.mjs");

function inLanguage(lang, fn) {
  I.setLanguage(lang);
  try {
    fn();
  } finally {
    I.setLanguage("en");
  }
}

test("English is the key itself", () => {
  assert.equal(I.language(), "en");
  assert.equal(I.t("Copy"), "Copy");
});

test("Persian comes from either table", () => {
  inLanguage("fa", () => {
    assert.equal(I.t("Copy"), "کپی");
    assert.equal(I.t("Wardrobe"), "کمد لباس");
  });
});

test("a missing key falls back to English, in Persian too", () => {
  inLanguage("fa", () => {
    assert.equal(I.t("A sentence nobody translated."), "A sentence nobody translated.");
    assert.equal(I.t("Hello {name}", { name: "Ari" }), "Hello Ari");
  });
});

test("placeholders are filled, unknown ones are left as they are", () => {
  assert.equal(I.t("{n} min ago", { n: 5 }), "5 min ago");
  assert.equal(I.t("{n} min ago"), "{n} min ago");
  inLanguage("fa", () => assert.equal(I.t("{n} min ago", { n: 5 }), "5 دقیقه پیش"));
});

test("tn picks the English plural form", () => {
  assert.equal(I.tn("{count} item", "{count} items", 1), "1 item");
  assert.equal(I.tn("{count} item", "{count} items", 3), "3 items");
});

test("only English and Persian exist, Persian reads right to left", () => {
  assert.deepEqual([...I.LANGUAGE_CODES], ["en", "fa"]);
  assert.equal(I.isRtl("fa"), true);
  assert.equal(I.isRtl("en"), false);
  assert.equal(I.resolveLanguage("fa"), "fa");
  assert.equal(I.resolveLanguage("fr"), "en");
  assert.equal(I.resolveLanguage(""), "en");
  assert.equal(I.setLanguage("fr"), false);
});

test("listeners hear about a language change once", () => {
  const seen = [];
  const off = I.onLanguageChange((l) => seen.push(l));
  I.setLanguage("fa");
  I.setLanguage("fa");
  I.setLanguage("en");
  off();
  assert.deepEqual(seen, ["fa", "en"]);
});

test("tl text redraws in place when the language changes", () => {
  const el = h("span", { text: I.tl("Copy") });
  assert.equal(el.textContent, "Copy");
  inLanguage("fa", () => {
    relabel();
    assert.equal(el.textContent, "کپی");
  });
  relabel();
  assert.equal(el.textContent, "Copy");
});

test("every key the code uses has a Persian string", () => {
  const missing = usedKeys().filter((k) => !I.isComplete(k));
  assert.deepEqual(missing, []);
});

test("no Persian string is empty, and placeholders survive the translation", () => {
  for (const k of I.allKeys()) {
    const fa = I.lookup(k, "fa");
    assert.ok(typeof fa === "string" && fa.length > 0, `empty Persian for "${k}"`);
    const wanted = (k.match(/\{\w+\}/g) ?? []).sort();
    const got = (fa.match(/\{\w+\}/g) ?? []).sort();
    assert.deepEqual(got, wanted, `placeholders differ in "${k}"`);
  }
});
