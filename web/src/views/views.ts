// Island views: the header with its tabs, and the registry of the views the
// island can show. Paddings, font sizes and colours follow the island's own.

import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { card } from "./parts";
import { State } from "../core/state";
import type { IslandViewName } from "../core/layout";
import { buildTranslate, type TranslateHost } from "./translate";
import { buildHistory } from "./history";
import { buildWardrobe } from "./wardrobe";
import { buildSettingsView } from "./settings";
import type { HistoryItem } from "../core/history-logic";
import type { Outfit, OutfitSelection } from "../ari/wardrobe";
import { tl } from "../i18n/i18n";

export interface ViewActions {
  setView(v: IslandViewName): void;
  collapse(): void;
  toggleSound(): void;
  setVolume(v: number): void;
  setAutoClose(seconds: number): void;
  openSettingsWindow(): void;
  blip(): void;
  /** Wardrobe click: keeps the outfit ("auto" and "none" included). */
  chooseOutfit(selection: OutfitSelection): void;
  /** Wardrobe hover: shows an outfit on Ari without keeping it; null ends it. */
  previewOutfit(outfit: Outfit | null): void;
  /** The input grew or shrank: the island follows. */
  heightChanged(): void;
  /** History → "Translate again". */
  retranslate(item: HistoryItem): void;
}

export interface ViewHost {
  el: HTMLElement;
  sync(): void;
  /** Called when the view becomes active, for views with a text field. */
  focus?(): void;
  /** Called every frame while the view is on screen. True = needs another frame. */
  tick?(nowMs: number): boolean | void;
}

// ── Header ────────────────────────────────────────────────────────────────────

export function buildHeader(actions: ViewActions): ViewHost {
  const tabTranslate = h("button", { class: "tab", title: tl("Translate"), onclick: () => go("translate") }, svg(ICONS.house, 14));
  const tabHistory = h("button", { class: "tab", title: tl("History"), onclick: () => go("history") }, svg(ICONS.clock, 14, { stroke: 2.2 }));
  const tabWardrobe = h("button", { class: "tab", title: tl("Wardrobe"), onclick: () => go("wardrobe") }, svg(ICONS.spark, 14));

  const gearBtn = h("button", { class: "tab-action", title: tl("Settings"), onclick: () => go("settings") }, svg(ICONS.gear, 15));
  const soundBtn = h("button", { class: "tab-action", title: tl("Mute"), onclick: () => actions.toggleSound() }, svg(ICONS.speakerOn, 15));

  function go(v: IslandViewName) {
    actions.blip();
    actions.setView(v);
  }

  const el = h(
    "div",
    { id: "header" },
    h("div", { class: "tabs" }, tabTranslate, tabHistory, tabWardrobe),
    h("div", { class: "header-actions" }, gearBtn, soundBtn),
  );

  return {
    el,
    sync() {
      const v = State.view;
      tabTranslate.classList.toggle("on", v === "translate");
      tabHistory.classList.toggle("on", v === "history");
      tabWardrobe.classList.toggle("on", v === "wardrobe");
      gearBtn.classList.toggle("on", v === "settings");
      clear(gearBtn);
      gearBtn.append(svg(v === "settings" ? ICONS.gearFill : ICONS.gear, 15));
      clear(soundBtn);
      soundBtn.append(svg(State.settings.soundEnabled ? ICONS.speakerOn : ICONS.speakerOff, 15));
    },
  };
}

// ── Note (a fatal bridge error, or any one-line message) ──────────────────────

function buildNote(): ViewHost {
  const title = h("div", { class: "title" });
  const el = h("div", { class: "view" }, card(null, h("div", { class: "stack", style: "padding:0 18px 0 98px" }, title)));
  return {
    el,
    sync() {
      title.textContent = State.noteMessage ?? "";
    },
  };
}

// ── Registry ──────────────────────────────────────────────────────────────────

export interface BuiltViews {
  map: Map<IslandViewName, ViewHost>;
  translate: TranslateHost;
}

export function buildViews(actions: ViewActions, closeIsland: () => void): BuiltViews {
  const map = new Map<IslandViewName, ViewHost>();
  const translate = buildTranslate({
    closeIsland,
    openSettingsWindow: () => actions.openSettingsWindow(),
    heightChanged: () => actions.heightChanged(),
    blip: () => actions.blip(),
  });
  map.set("translate", translate);
  map.set("history", buildHistory({ retranslate: (item) => actions.retranslate(item), blip: () => actions.blip() }));
  map.set("note", buildNote());
  map.set("settings", buildSettingsView(actions));
  map.set("wardrobe", buildWardrobe(actions));
  return { map, translate };
}
