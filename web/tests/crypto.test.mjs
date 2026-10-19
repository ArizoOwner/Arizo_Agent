// Tests for the crypto section's pure rules: formatting, the state the backend
// sends, error texts, and the rule that nothing is shown before the exchange
// has accepted the user's credentials.

import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom } from "./fakedom.mjs";

installFakeDom();

const C = await import("../src/core/crypto.ts");
const I = await import("../src/i18n/i18n.ts");

const live = (over = {}) => ({
  ...C.IDLE_CRYPTO, enabled: true, hasCredential: true, phase: "live", seq: 1,
  ticker: { price: 68500, open: 67000, high: 69000, low: 66500, change: 2.2, volume: 1.2e9 },
  ...over,
});

test("formatPrice writes dollars for USDT and Toman for the Toman market", () => {
  assert.equal(C.formatPrice(68500.25, "USDT"), "$68,500.25");
  assert.equal(C.formatPrice(1234.5), "$1,234.50");
  assert.equal(C.formatPrice(165.4), "$165.40");
  assert.equal(C.formatPrice(5.2), "$5.20");
  assert.equal(C.formatPrice(0.05432), "$0.05432");
  assert.equal(C.formatPrice(0.0000105), "$0.00001050");
  // The Toman market already comes in Toman: no rate is applied on the page.
  assert.equal(C.formatPrice(4795000000, "IRT"), "4,795,000,000 T");
  assert.equal(C.formatPrice(2609430, "IRT"), "2,609,430 T", "Tether in Toman");
  inFa(() => assert.equal(C.formatPrice(4795000000, "IRT"), "4,795,000,000 T"));
});

test("formatPrice shows a dash for a price that is not there", () => {
  for (const bad of [0, -1, NaN, Infinity]) assert.equal(C.formatPrice(bad), "-");
});

test("the chart's price scale writes big Toman numbers in millions, each level distinct", () => {
  assert.equal(C.formatAxisPrice(7010000000, "IRT"), "7,010.0M");
  const levels = [4799000000, 4799900000, 4800800000].map((p) => C.formatAxisPrice(p, "IRT"));
  assert.equal(new Set(levels).size, 3);
  assert.equal(C.formatAxisPrice(68500, "USDT"), "$68,500.00");
});

test("withUnit: false drops the word Toman and keeps the dollar sign", () => {
  assert.equal(C.formatPrice(4795000000, "IRT", false), "4,795,000,000");
  assert.equal(C.formatPrice(68500, "USDT", false), "$68,500.00");
});

test("formatChange formats percentage with sign and polarity", () => {
  assert.deepEqual(C.formatChange(3.456), { text: "+3.46%", positive: true });
  assert.deepEqual(C.formatChange(-2.1), { text: "-2.10%", positive: false });
  assert.deepEqual(C.formatChange(0), { text: "0.00%", positive: true });
});

test("formatVolume scales with B, M, K suffixes", () => {
  assert.equal(C.formatVolume(2500000000), "2.50B");
  assert.equal(C.formatVolume(18400000), "18.40M");
  assert.equal(C.formatVolume(750000), "750.00K");
  assert.equal(C.formatVolume(450), "450");
});

test("formatClock is the time of the last good read, or dashes before any", () => {
  const d = new Date(2026, 9, 19, 14, 30, 45, 123);
  assert.equal(C.formatClock(d.getTime()), "14:30:45");
  assert.equal(C.formatClock(0), "--:--:--");
});

test("nothing is shown until the exchange has accepted the credentials", () => {
  assert.equal(C.visibleTicker(C.IDLE_CRYPTO), null);
  assert.equal(C.visibleTicker(live({ hasCredential: false })), null);
  assert.equal(C.visibleTicker(live({ enabled: false })), null);
  assert.equal(C.visibleTicker(live()).price, 68500);
});

test("a late state never replaces a newer one", () => {
  C.Crypto.state = { ...C.IDLE_CRYPTO };
  assert.equal(C.setCryptoState(live({ seq: 5 })), true);
  assert.equal(C.setCryptoState(live({ seq: 4, asset: "ETH" })), false);
  assert.equal(C.Crypto.state.asset, "BTC");
  assert.equal(C.setCryptoState(live({ seq: 5, asset: "SOL" })), true);
  assert.equal(C.Crypto.state.asset, "SOL");
  C.Crypto.state = { ...C.IDLE_CRYPTO };
});

test("every code the backend sends has a sentence, in both languages", () => {
  for (const code of Object.keys(C.CRYPTO_ERRORS)) {
    const en = C.cryptoErrorText(code);
    assert.ok(en.length > 0, code);
    inFa(() => assert.notEqual(C.cryptoErrorText(code), en, `no Persian for ${code}`));
  }
  assert.equal(C.cryptoErrorText(""), "");
  assert.equal(C.cryptoErrorText("http_503"), "The exchange answered with an error (503).");
  assert.equal(C.cryptoErrorText("something_new"), "The exchange answered with something unexpected.");
});

test("an error text never carries the exchange's own words", () => {
  assert.equal(C.cryptoErrorText("<script>alert(1)</script>"), "The exchange answered with something unexpected.");
});

test("popular coins have a Persian name and a logo", () => {
  for (const c of C.POPULAR_COINS) {
    assert.ok(c.baseAsset.length > 0 && c.name.length > 0 && c.faName.length > 0);
    assert.equal(c.quoteAsset, c.baseAsset === "USDT" ? "IRT" : "USDT", "Tether is read in Toman, the rest in USDT");
  }
  assert.equal(C.coinInfo("BTC").name, "Bitcoin");
  assert.equal(C.coinInfo("USDT").faName, "تتر");
  assert.equal(C.createOfficialCoinLogo("USDT", 22).tagName, "SVG");
  assert.equal(C.coinInfo("NOPE"), undefined);
});

test("official vector logos are made for known coins, a lettered disc for the rest", () => {
  assert.equal(C.createOfficialCoinLogo("BTC", 28).tagName, "SVG");
  assert.ok(C.createOfficialCoinLogo("ETH", 28));
  assert.ok(C.createOfficialCoinLogo("UNKNOWN", 28));
});

function inFa(fn) {
  I.setLanguage("fa");
  try {
    fn();
  } finally {
    I.setLanguage("en");
  }
}
