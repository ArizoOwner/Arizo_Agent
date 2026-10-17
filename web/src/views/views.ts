// Island views: the header with its tabs, and the registry of the views the
// island can show. Paddings, font sizes and colours follow the island's own.

import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { card } from "./parts";
import { State } from "../core/state";
import type { IslandViewName } from "../core/layout";
import { buildTranslate, type TranslateHost } from "./translate";
import { buildWardrobe } from "./wardrobe";
import { buildSettingsView } from "./settings";
import { buildSpotify } from "./spotify";
import { buildFootball } from "./football";
import { createMiniBot, type MiniTask } from "../ari/minibots";
import { Spotify, SPOTIFY_GREEN, SPOTIFY_ID, musicPlaying } from "../core/spotify";
import { FOOTBALL_COLOR, FOOTBALL_ID } from "../core/football";
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
  function feature(view: IslandViewName, label: string, color: string, eye: MiniTask["miniEye"] = "pill") {
    const task: MiniTask = { id: view === "spotify" ? SPOTIFY_ID : view === "football" ? FOOTBALL_ID : `feature_${view}`, name: label, color, state: "idle", miniEye: eye };
    return h("button", {
      class: "tab feature-tab", type: "button", title: tl(label), "aria-label": tl(label),
      "data-view": view, onclick: () => go(view),
    }, createMiniBot(task, 18, view === "spotify" ? () => musicPlaying(Spotify.state) : undefined),
    h("span", { class: "feature-label", text: tl(label) }));
  }

  const tabTranslate = feature("translate", "Translate", "#4285F4");
  const tabSpotify = feature("spotify", "Spotify", SPOTIFY_GREEN);
  const tabFootball = feature("football", "Football", FOOTBALL_COLOR);
  const gearBtn = h("button", { class: "tab-action feature-settings", type: "button", title: tl("Settings"), "aria-label": tl("Settings"), onclick: () => go("settings") },
    createMiniBot({ id: "feature_settings", name: "Settings", color: "#C0C4CC", state: "idle", miniEye: "line" }, 18));
  const soundBtn = h("button", { class: "tab-action", title: tl("Mute"), onclick: () => actions.toggleSound() }, svg(ICONS.speakerOn, 15));

  function go(v: IslandViewName) {
    actions.blip();
    actions.setView(v);
  }

  const el = h(
    "div",
    { id: "header" },
    h("div", { class: "tabs", "aria-label": tl("Features") }, tabTranslate, tabSpotify, tabFootball),
    h("div", { class: "header-actions" }, gearBtn, soundBtn),
  );

  return {
    el,
    sync() {
      const v = State.view;
      tabTranslate.classList.toggle("on", v === "translate");
      tabSpotify.classList.toggle("on", v === "spotify");
      tabSpotify.style.display = State.settings.spotifyEnabled || v === "spotify" ? "" : "none";
      tabFootball.classList.toggle("on", v === "football");
      tabFootball.style.display = State.settings.footballEnabled || v === "football" ? "" : "none";
      for (const button of [tabTranslate, tabSpotify, tabFootball]) {
        button.setAttribute("aria-pressed", String(button.dataset.view === v));
      }
      gearBtn.classList.toggle("on", v === "settings");
      gearBtn.setAttribute("aria-pressed", String(v === "settings"));
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
  map.set("note", buildNote());
  map.set("settings", buildSettingsView(actions));
  map.set("wardrobe", buildWardrobe(actions));
  map.set("spotify", buildSpotify());
  map.set("football", buildFootball());
  return { map, translate };
}
