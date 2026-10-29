// Settings → Island look: the size, see-through level, text size, corners and floating
// position of the island, each with its own "default" button, plus one button that puts
// all of them back. Dragging a slider moves its readout (and the capsule preview) at once;
// letting go applies and saves it. Only the see-through level and the corners are also
// shown on the real island mid-drag: every other one resizes the window, and doing that on
// each step makes the island flicker.

import { h, svg } from "./dom";
import { ICONS } from "./icons";
import { State } from "../core/state";
import {
  LOOK, allDefault, isDefault, lookOf, readout, resetPatch,
  type Look, type LookKey, type NumKey,
} from "../core/appearance";
import { compactLayout } from "../core/layout";
import { language, t } from "../i18n/i18n";
import type { ViewActions } from "./views";

interface Row {
  key: NumKey;
  label: string;
  hint: string;
  unit?: "%" | "px";
}

/** The slider rows, in the order they appear. Labels are looked up when drawn, so the language can change. */
function rows(): Row[] {
  return [
    { key: "uiWidth", label: t("Island width"), hint: t("How wide the island opens") },
    { key: "uiHeight", label: t("Island height"), hint: t("How tall the island opens") },
    { key: "uiTransparency", label: t("Transparency"), hint: t("How see-through the island is; text stays clear") },
    { key: "uiFontScale", label: t("Text size"), hint: t("The size of every text in the island") },
    { key: "uiCorner", label: t("Corner roundness"), hint: t("From square corners to extra round") },
    { key: "uiCompactWidth", label: t("Capsule width"), hint: t("How wide the folded island is") },
    { key: "uiCompactHeight", label: t("Capsule height"), hint: t("How tall the folded island is") },
    { key: "uiCompactScale", label: t("Capsule zoom"), hint: t("Makes the whole folded island, with Ari, the clock and the small icons in it, bigger or smaller") },
  ];
}

/** The preview is drawn at this fraction of the real size, so the widest capsule still fits the settings page. */
const PREVIEW_SCALE = 0.6;
const PREVIEW_MINIS = ["#4285F4", "#A78BFA", "#1DB954", "#2DD4BF"];

/** Shown on the island while their slider moves: they change its surface and corners, never its size or the window's. */
const LIVE_KEYS: ReadonlySet<NumKey> = new Set<NumKey>(["uiTransparency", "uiCorner"]);

export function buildLookSettings(
  actions: ViewActions,
  parts: {
    section: (title: string, icon: string, ...rows: (Node | null)[]) => HTMLElement;
    settingRow: (label: string, hint: string, control: Node, extra?: Node) => HTMLElement;
    toggle: (on: boolean, onChange: (v: boolean) => void) => HTMLElement;
  },
): HTMLElement {
  const persian = language() === "fa";
  const look = lookOf(State.settings);
  const content = h("div", { class: "set-content-scroll" });

  const resetAll = h("button", {
    class: "look-reset-all", type: "button", title: t("Put every look setting back to its default"),
    onclick: () => actions.setLook(resetPatch()),
  }, svg(ICONS.arrowClockwise, 12, { stroke: 2 }), h("span", { text: t("Reset all to default") }));
  resetAll.toggleAttribute("disabled", allDefault(look));

  // The folded island is not on screen while Settings is open: this shows what the three sliders do to it.
  const capsule = h("div", { class: "look-capsule" });
  const preview = h("div", { class: "look-preview", role: "img", "aria-label": t("Preview of the folded island") }, capsule);
  const paintPreview = (shown: Look) => {
    const c = compactLayout(shown);
    const s = PREVIEW_SCALE;
    const ari = h("span", { class: "look-capsule-ari" }, h("i"), h("i"));
    const clock = h("span", { class: "look-capsule-clock", text: persian ? "۱۴:۳۰" : "14:30" });
    const minis = h("span", { class: "look-capsule-minis" }, ...PREVIEW_MINIS.map((color) => h("i", { style: `background:${color}` })));
    capsule.replaceChildren(ari, clock, minis);
    capsule.style.width = `${c.w * s}px`;
    capsule.style.height = `${c.h * s}px`;
    capsule.style.borderRadius = `0 0 ${14 * s * (shown.uiCorner / 100)}px ${14 * s * (shown.uiCorner / 100)}px`;
    ari.style.cssText = `width:${c.ariD * s}px;height:${c.ariD * s}px;left:${(c.ariCx - c.ariD / 2) * s}px;top:${(c.ariCy - c.ariD / 2) * s}px`;
    clock.style.fontSize = `${12.5 * c.k * s}px`;
    const mini = 13 * c.k * s;
    minis.style.cssText = `width:${c.gridW * s}px;height:${c.gridH * s}px;right:${(c.inset - c.gridW / 2) * s}px;top:${(c.h / 2 - c.gridH / 2) * s}px;grid-template-columns:${mini}px ${mini}px;grid-auto-rows:${mini}px;gap:${3 * c.k * s}px`;
  };
  paintPreview(look);

  const resetButton = (key: LookKey, label: string, value: number | boolean): HTMLElement => {
    const b = h("button", {
      class: "look-reset", type: "button", title: t("Back to default"), "aria-label": `${label}: ${t("Back to default")}`,
      onclick: () => actions.setLook(resetPatch(key)),
    }, svg(ICONS.arrowClockwise, 12, { stroke: 2 }));
    b.toggleAttribute("disabled", isDefault(key, value));
    return b;
  };

  /** A slider row: live readout, its own reset, preview while dragging (LIVE_KEYS only), apply and save on release. */
  const sliderRow = (row: Row, dimmed = false): HTMLElement => {
    const s = LOOK[row.key];
    const value = look[row.key];
    const out = h("span", { class: "look-readout", text: readout(value, persian, row.unit) });
    const input = h("input", {
      type: "range", class: "set-range look-range",
      min: String(s.min), max: String(s.max), step: String(s.step), value: String(value),
      "aria-label": row.label,
    }) as HTMLInputElement;
    const reset = resetButton(row.key, row.label, value);

    // The drag only previews: saving rebuilds the view, which would drop the slider under the pointer.
    // Whichever way it ends (release, the change event, losing focus) it is saved exactly once.
    let live = false;
    const commit = () => {
      if (!live) return;
      live = false;
      actions.setLook({ [row.key]: Number(input.value) });
    };
    input.addEventListener("input", () => {
      live = true;
      const next = Number(input.value);
      out.textContent = readout(next, persian, row.unit);
      reset.toggleAttribute("disabled", isDefault(row.key, next));
      const shown = { ...look, ...(State.lookPreview ?? {}), [row.key]: next } as Look;
      resetAll.toggleAttribute("disabled", allDefault(shown));
      paintPreview(shown);
      if (LIVE_KEYS.has(row.key)) actions.previewLook({ ...(State.lookPreview ?? {}), [row.key]: next });
    });
    for (const type of ["change", "pointerup", "pointercancel", "blur"]) input.addEventListener(type, commit);

    const el = parts.settingRow(row.label, row.hint, h("div", { class: "look-control" }, input, out, reset));
    el.classList.toggle("set-row-off", dimmed);
    return el;
  };

  const floatRow = parts.settingRow(
    t("Floating island"),
    t("Hang the island a little below the top edge instead of touching it"),
    h("div", { class: "look-control" },
      parts.toggle(look.uiFloating, (on) => actions.setLook({ uiFloating: on })),
      resetButton("uiFloating", t("Floating island"), look.uiFloating)),
  );
  const gapRow = sliderRow({
    key: "uiFloatGap", unit: "px",
    label: t("Distance from the top"),
    hint: t("How far below the edge the floating island hangs"),
  }, !look.uiFloating);

  const built = new Map(rows().map((row) => [row.key, sliderRow(row)] as const));
  const row = (key: NumKey): HTMLElement => built.get(key)!;

  content.append(
    parts.section(t("Size and shape"), ICONS.eye, row("uiWidth"), row("uiHeight"), row("uiCorner")),
    parts.section(t("Surface and text"), ICONS.pen, row("uiTransparency"), row("uiFontScale")),
    parts.section(t("Position"), ICONS.pull, floatRow, gapRow),
    parts.section(t("Folded island"), ICONS.eyeOff, preview, row("uiCompactWidth"), row("uiCompactHeight"), row("uiCompactScale")),
    h("div", { class: "look-footer" }, resetAll),
  );
  return content;
}
