// AI provider presets and engine pills.

import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom } from "./fakedom.mjs";

installFakeDom();

const P = await import("../src/core/providers.ts");
const Pills = await import("../src/core/pills.ts");

test("the presets carry the documented base URLs and models", () => {
  const by = Object.fromEntries(P.PROVIDERS.map((p) => [p.id, p]));
  assert.deepEqual([by.openrouter.baseUrl, by.openrouter.model], ["https://openrouter.ai/api/v1", "deepseek/deepseek-chat"]);
  assert.deepEqual([by.gemini.baseUrl, by.gemini.model], ["https://generativelanguage.googleapis.com/v1beta/openai", "gemini-3.8-flash"]);
  assert.deepEqual([by.deepseek.baseUrl, by.deepseek.model], ["https://api.deepseek.com/v1", "deepseek-chat"]);
  assert.deepEqual([by.groq.baseUrl, by.groq.model], ["https://api.groq.com/openai/v1", "llama-3.3-70b-versatile"]);
  assert.deepEqual([by.openai.baseUrl, by.openai.model], ["https://api.openai.com/v1", "gpt-4o-mini"]);
  assert.deepEqual([by.ollama.baseUrl, by.ollama.model], ["http://localhost:11434/v1", "qwen2.5:7b"]);
  assert.equal(P.PROVIDERS.length, 7);
});

test("a base URL is matched to its preset, ignoring a trailing slash and case", () => {
  assert.equal(P.providerForUrl("https://api.groq.com/openai/v1/"), "groq");
  assert.equal(P.providerForUrl("HTTPS://API.OPENAI.COM/V1"), "openai");
  assert.equal(P.providerForUrl("https://example.org/v1"), "custom");
  assert.equal(P.providerForUrl(""), "custom");
});

test("picking a preset fills the address and model, Custom keeps them", () => {
  assert.deepEqual(P.applyPreset("ollama", { baseUrl: "x", model: "y" }), { baseUrl: "http://localhost:11434/v1", model: "qwen2.5:7b" });
  assert.deepEqual(P.applyPreset("custom", { baseUrl: "https://my/v1", model: "m" }), { baseUrl: "https://my/v1", model: "m" });
});

test("a local server needs no key", () => {
  assert.equal(P.needsKey("http://localhost:11434/v1"), false);
  assert.equal(P.needsKey("http://127.0.0.1:8080/v1"), false);
  assert.equal(P.needsKey("https://api.openai.com/v1"), true);
});

test("the two engine pills keep their stable IDs and colours", () => {
  assert.deepEqual(Pills.PILLS.map((p) => p.id), ["engine_google", "engine_aphra"]);
  assert.equal(Pills.pillForEngine("google").color, "#4285F4");
  assert.equal(Pills.pillForEngine("aphra").color, "#A78BFA");
  assert.equal(Pills.parseEngine("nonsense"), "google");
  assert.equal(Pills.parseEngine("aphra"), "aphra");
  assert.equal(Pills.otherEngine("google"), "aphra");
  assert.equal(Pills.pillState("aphra", "aphra"), "thinking");
  assert.equal(Pills.pillState("google", "aphra"), "idle");
});

test("preset models are returned for known providers", () => {
  const geminiModels = P.getAvailableModels("https://generativelanguage.googleapis.com/v1beta/openai");
  assert.ok(geminiModels.length > 0);
  assert.ok(geminiModels.some((m) => m.id === "gemini-2.5-flash"));
  assert.ok(geminiModels.some((m) => m.id === "gemini-2.0-flash"));

  const groqModels = P.getAvailableModels("https://api.groq.com/openai/v1");
  assert.ok(groqModels.some((m) => m.id === "llama-3.3-70b-versatile"));

  const openrouterModels = P.getAvailableModels("https://openrouter.ai/api/v1");
  assert.ok(openrouterModels.some((m) => m.id === "deepseek/deepseek-chat"));
});

test("custom or current model is included in available models", () => {
  const list = P.getAvailableModels("https://generativelanguage.googleapis.com/v1beta/openai", "my-custom-model");
  assert.ok(list.some((m) => m.id === "my-custom-model"));
});

test("saving and retrieving cached models works", () => {
  const url = "https://custom-api.example.com/v1";
  P.saveCachedModels(url, [
    { id: "mod-1", displayName: "Model One" },
    { id: "mod-2" },
  ]);
  const cached = P.getCachedModels(url);
  assert.equal(cached?.length, 2);
  assert.equal(cached?.[0].id, "mod-1");
  assert.equal(cached?.[0].name, "Model One (mod-1)");
  assert.equal(cached?.[1].name, "mod-2");

  const available = P.getAvailableModels(url);
  assert.equal(available.length, 2);
  assert.equal(available[0].id, "mod-1");
});
