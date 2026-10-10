// Settings merge (aphra is nested) and the island state machine.

import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom } from "./fakedom.mjs";

installFakeDom();

const S = await import("../src/core/state.ts");
const { IslandStateMachine } = await import("../src/island/fsm.ts");

test("mergeSettings keeps the nested AI settings whole", () => {
  const next = S.mergeSettings(S.DEFAULT_SETTINGS, { autoCopy: true, aphra: { model: "gpt-4o-mini" } });
  assert.equal(next.autoCopy, true);
  assert.equal(next.aphra.model, "gpt-4o-mini");
  assert.equal(next.aphra.baseUrl, S.DEFAULT_SETTINGS.aphra.baseUrl);
  assert.equal(S.DEFAULT_SETTINGS.aphra.model, "deepseek/deepseek-chat");
  assert.equal(S.mergeSettings(S.DEFAULT_SETTINGS, null), S.DEFAULT_SETTINGS);
});

test("the settings keys are exactly the contract's", () => {
  assert.deepEqual(Object.keys(S.DEFAULT_SETTINGS).sort(), [
    "ariOutfit", "aphra", "appLanguage", "autoCloseInterval", "autoCopy", "defaultEngine", "historyLimit",
    "hotkey", "hideHotkey", "hideOnBlur", "inlineHotkey", "language", "launchAtStartup", "nativeLang", "restoreClipboard",
    "saveHistory", "screen", "secondLang", "showFloatingBubble", "soundEnabled", "soundVolume", "theme",
  ].sort());
  assert.deepEqual(Object.keys(S.DEFAULT_SETTINGS.aphra).sort(), ["baseUrl", "hasApiKey", "model", "showBreakdown", "tone"]);
});

test("choosing an engine focuses its pill and the mini Aris follow the work", () => {
  S.State.setEngine("aphra");
  assert.equal(S.State.focusId, "engine_aphra");
  S.State.working = "aphra";
  S.State.syncPills();
  assert.equal(S.State.tasks.find((t) => t.id === "engine_aphra").state, "thinking");
  assert.equal(S.State.tasks.find((t) => t.id === "engine_google").state, "idle");
  S.State.working = null;
  S.State.setEngine("nonsense");
  assert.equal(S.State.engine, "google");
});

test("the island opens from the greeting to compact, and a click expands it", () => {
  const fsm = new IslandStateMachine();
  const seen = [];
  fsm.onTransition = (from, to) => seen.push(`${from}>${to}`);
  fsm.launch();
  fsm.mouseLeft();
  assert.deepEqual(seen, ["hidden>greet", "greet>petit"]);
  fsm.click();
  assert.equal(fsm.state, "home");
  fsm.forcePetit();
  assert.equal(fsm.state, "petit");
  fsm.forceHidden();
  assert.equal(fsm.state, "hidden");
  fsm.cancelTimers();
});
