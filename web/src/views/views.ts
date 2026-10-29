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
import { buildCrypto } from "./crypto";
import { buildMuse, MUSE_COLOR, MUSE_ID, type MuseHost } from "./muse";
import { createMiniBot, type MiniTask } from "../ari/minibots";
import { Spotify, SPOTIFY_GREEN, SPOTIFY_ID, musicPlaying } from "../core/spotify";
import { FOOTBALL_COLOR, FOOTBALL_ID } from "../core/football";
import { CRYPTO_COLOR, CRYPTO_ID } from "../core/crypto";
import type { HistoryItem } from "../core/history-logic";
import type { Outfit, OutfitSelection } from "../ari/wardrobe";
import { isRtl, tl } from "../i18n/i18n";
import { normalizeOrder, sameOrder, type FeatureId } from "../core/feature-order";
import type { Look } from "../core/appearance";
import type { SoundName } from "../core/sound";
import { enableTabDrag } from "./tab-drag";

export interface ViewActions {
  setView(v: IslandViewName): void;
  /** A look slider is being dragged: show it at once without saving (null ends the preview). */
  previewLook(patch: Partial<Look> | null): void;
  /** A look setting was let go (or reset): save it and show it. */
  setLook(patch: Partial<Look>): void;
  /** The header's tabs were dragged into a new order: remember it. */
  setFeatureOrder(order: FeatureId[]): void;
  playSound(name: SoundName): void;
  collapse(): void;
  toggleSound(): void;
  setVolume(v: number): void;
  /** Live feedback while a volume slider is dragged: no state change, no save. */
  previewVolume(v: number): void;
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
    const task: MiniTask = { id: view === "spotify" ? SPOTIFY_ID : view === "football" ? FOOTBALL_ID : view === "crypto" ? CRYPTO_ID : view === "muse" ? MUSE_ID : `feature_${view}`, name: label, color, state: "idle", miniEye: eye };
    return h("button", {
      class: "tab feature-tab", type: "button", title: tl(label), "aria-label": tl(label),
      "data-view": view, onclick: () => go(view),
    }, createMiniBot(task, 18, view === "spotify" ? () => musicPlaying(Spotify.state) : undefined),
    h("span", { class: "feature-label", text: tl(label) }));
  }

  const tabTranslate = feature("translate", "Translate", "#4285F4");
  const tabSpotify = feature("spotify", "Spotify", SPOTIFY_GREEN);
  const tabFootball = feature("football", "Football", FOOTBALL_COLOR);
  const tabCrypto = feature("crypto", "Crypto", CRYPTO_COLOR);
  const tabMuse = feature("muse", "Muse", MUSE_COLOR);
  const gearBtn = h("button", { class: "tab-action feature-settings", type: "button", title: tl("Settings"), "aria-label": tl("Settings"), onclick: () => go("settings") },
    createMiniBot({ id: "feature_settings", name: "Settings", color: "#C0C4CC", state: "idle", miniEye: "line" }, 18));
  const soundBtn = h("button", { class: "tab-action", title: tl("Mute"), onclick: () => actions.toggleSound() }, svg(ICONS.speakerOn, 15));

  function go(v: IslandViewName) {
    actions.blip();
    actions.setView(v);
  }

  const tabsEl = h("div", { class: "tabs", "aria-label": tl("Features") }, tabTranslate, tabSpotify, tabFootball, tabCrypto, tabMuse);
  const el = h(
    "div",
    { id: "header" },
    tabsEl,
    h("div", { class: "header-actions" }, gearBtn, soundBtn),
  );

  // The tabs can be dragged into any order (and moved with Alt+arrows); the order is a setting.
  const byId: Record<FeatureId, HTMLElement> = {
    translate: tabTranslate, spotify: tabSpotify, football: tabFootball, crypto: tabCrypto, muse: tabMuse,
  };
  enableTabDrag({
    container: tabsEl,
    rtl: () => isRtl(),
    onReorder: (order) => actions.setFeatureOrder(normalizeOrder(order)),
    onCue: (cue) => actions.playSound(cue === "pickup" ? "pop" : cue === "swap" ? "tick" : "blip"),
  });

  /**
   * The tabs never run past the island: when they do not fit (a narrow island such as Muse's,
   * more tabs, bigger text, a longer language), the other tabs drop their labels first and keep
   * their Ari; only if that is still too wide does the open one drop its label too.
   */
  let fitKey = "";
  function fitTabs() {
    const overflows = () => el.scrollWidth > el.clientWidth + 1;
    el.classList.remove("tight", "tighter");
    if (el.clientWidth === 0 || !overflows()) return;
    el.classList.add("tight");
    if (overflows()) el.classList.add("tighter");
  }
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => fitTabs()).observe(el);

  /** Puts the tab buttons in the saved order (never while one is being dragged or settling). */
  function applyOrder() {
    if (tabsEl.classList.contains("sorting")) return;
    const wanted = normalizeOrder(State.settings.featureOrder);
    const have = Array.from(tabsEl.children).map((c) => (c as HTMLElement).dataset.view ?? "");
    if (sameOrder(have, wanted)) return;
    for (const id of wanted) tabsEl.append(byId[id]);
  }

  return {
    el,
    sync() {
      applyOrder();
      const v = State.view;
      tabTranslate.classList.toggle("on", v === "translate");
      tabSpotify.classList.toggle("on", v === "spotify");
      tabSpotify.style.display = State.settings.spotifyEnabled || v === "spotify" ? "" : "none";
      tabFootball.classList.toggle("on", v === "football");
      tabFootball.style.display = State.settings.footballEnabled || v === "football" ? "" : "none";
      tabCrypto.classList.toggle("on", v === "crypto");
      tabCrypto.style.display = State.settings.cryptoEnabled || v === "crypto" ? "" : "none";
      tabMuse.classList.toggle("on", v === "muse");
      tabMuse.style.display = State.settings.museEnabled || v === "muse" ? "" : "none";
      for (const button of [tabTranslate, tabSpotify, tabFootball, tabCrypto, tabMuse]) {
        button.setAttribute("aria-pressed", String(button.dataset.view === v));
      }
      gearBtn.classList.toggle("on", v === "settings");
      gearBtn.setAttribute("aria-pressed", String(v === "settings"));
      clear(soundBtn);
      soundBtn.append(svg(State.settings.soundEnabled ? ICONS.speakerOn : ICONS.speakerOff, 15));
      // Measured again only when what is in the row changed (sync runs often).
      const key = [v, document.documentElement.lang, State.settings.uiFontScale, State.settings.uiWidth, ...[tabSpotify, tabFootball, tabCrypto, tabMuse].map((b) => b.style.display)].join("|");
      if (key !== fitKey) {
        fitKey = key;
        fitTabs();
      }
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
  muse: MuseHost;
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
  map.set("crypto", buildCrypto());
  const muse = buildMuse();
  map.set("muse", muse);
  return { map, translate, muse };
}
