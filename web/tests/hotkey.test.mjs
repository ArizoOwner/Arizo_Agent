// The shortcut recorder: a KeyboardEvent becomes an accelerator string.

import { test } from "node:test";
import assert from "node:assert/strict";

const { accelParts, keyName, modifiers, recordKey } = await import("../src/core/hotkey.ts");

const ev = (code, key, mods = {}) => ({
  code, key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods,
});

test("letters, digits, function keys and named keys have names", () => {
  assert.equal(keyName("KeyD"), "D");
  assert.equal(keyName("Digit7"), "7");
  assert.equal(keyName("Numpad3"), "num3");
  assert.equal(keyName("F5"), "F5");
  assert.equal(keyName("F24"), "F24");
  assert.equal(keyName("F25"), null);
  assert.equal(keyName("ArrowLeft"), "Left");
  assert.equal(keyName("Slash"), "/");
  assert.equal(keyName("IntlBackslash"), null);
});

test("modifiers come in a fixed order", () => {
  assert.deepEqual(modifiers({ ctrlKey: true, altKey: true, shiftKey: true, metaKey: true }), ["Ctrl", "Alt", "Shift", "Super"]);
  assert.deepEqual(modifiers({ ctrlKey: false, altKey: true, shiftKey: true, metaKey: false }), ["Alt", "Shift"]);
});

test("a combination is recorded as Mod+Mod+Key", () => {
  assert.deepEqual(recordKey(ev("KeyD", "d", { altKey: true })), { kind: "ok", accelerator: "Alt+D" });
  assert.deepEqual(recordKey(ev("KeyD", "D", { altKey: true, shiftKey: true })), { kind: "ok", accelerator: "Alt+Shift+D" });
  assert.deepEqual(recordKey(ev("Space", " ", { ctrlKey: true, altKey: true })), { kind: "ok", accelerator: "Ctrl+Alt+Space" });
});

test("a function key needs no modifier, a letter does", () => {
  assert.deepEqual(recordKey(ev("F9", "F9")), { kind: "ok", accelerator: "F9" });
  assert.deepEqual(recordKey(ev("KeyD", "d")), { kind: "invalid", reason: "needsModifier" });
  assert.deepEqual(recordKey(ev("KeyD", "D", { shiftKey: true })), { kind: "invalid", reason: "needsModifier" }, "Shift alone is not a shortcut");
  assert.deepEqual(recordKey(ev("F5", "F5", { shiftKey: true })), { kind: "ok", accelerator: "Shift+F5" });
});

test("Esc cancels, a modifier alone waits, an odd key is refused", () => {
  assert.deepEqual(recordKey(ev("Escape", "Escape")), { kind: "cancel" });
  assert.deepEqual(recordKey(ev("ControlLeft", "Control", { ctrlKey: true })), { kind: "wait" });
  assert.deepEqual(recordKey(ev("ShiftRight", "Shift", { shiftKey: true })), { kind: "wait" });
  assert.deepEqual(recordKey(ev("IntlBackslash", "<", { altKey: true })), { kind: "invalid", reason: "unsupportedKey" });
});

test("accelParts splits for keycaps", () => {
  assert.deepEqual(accelParts("Ctrl+Alt+D"), ["Ctrl", "Alt", "D"]);
  assert.deepEqual(accelParts(""), []);
});
