// Entry point: boot the bridge, wire the island, start the greeting.

import "./style.css";
import "./translate.css";
import "./views/select.css";
import "./views/spotify.css";
import "./views/football.css";
import "./views/crypto.css";
import { Bridge, IS_MOCK, IS_TAURI, onEvent } from "./core/bridge";
import { Sound } from "./core/sound";
import { State, mergeSettings, type Settings } from "./core/state";
import { parseEngine } from "./core/pills";
import { IDLE_SPOTIFY, Spotify, type SpotifyState } from "./core/spotify";
import { setCryptoState, type CryptoState } from "./core/crypto";
import { Football, IDLE_FOOTBALL, setFootballState, type FootballState } from "./core/football";
import { toast } from "./core/toast";
import { Island } from "./island/island";
import { onLanguageChange, resolveLanguage, setLanguage } from "./i18n/i18n";
import { installDevHooks } from "./core/dev";
import { applyTheme as applyThemeTo, watchSystemTheme } from "./core/theme";

/** Shows the language Settings asks for. */
function applyLanguage() {
  setLanguage(resolveLanguage(State.settings.appLanguage));
}

/** Dark is the island's own look; light and system follow the theme tokens in style.css. */
function applyTheme() {
  applyThemeTo(State.settings.theme);
}

async function main() {
  const root = document.getElementById("root");
  if (!root) return;

  void Sound.preload();

  const island = new Island(root);

  const boot = await Bridge.boot();
  if (boot) {
    State.settings = mergeSettings(State.settings, boot.settings);
    State.setEngine(parseEngine(State.settings.defaultEngine));
  }
  // A language change redraws the island in place: the texts given as tl(…)
  // relabel themselves (views/dom.ts) and the views redraw the rest on this sync.
  onLanguageChange(() => State.notify());
  applyLanguage();
  applyTheme();
  watchSystemTheme(() => State.settings.theme);
  void Bridge.setSystemLanguages(navigator.languages ? [...navigator.languages] : []);
  island.applySettings();
  if (boot && !boot.cursorPoll) island.followPageCursor();

  await onEvent<{ x: number; y: number }>("cursor", ({ x, y }) => island.onCursor(x, y));

  await onEvent<string>("tray", (what) => {
    if (what === "settings") island.alert("settings");
    else if (what === "collapse") island.collapse();
    else if (what === "close") island.close();
    else island.alert(State.defaultView());
  });

  await onEvent<null>("screen-changed", () => void Bridge.reposition());

  // The settings window writes preferences; apply them here without a restart.
  // Spotify and football are re-read only when something they show has changed.
  const spotifyKey = (c: Settings) => `${c.spotifyEnabled}|${c.spotifyClientId}`;
  const footballKey = (c: Settings) => `${c.footballEnabled}|${c.footballTeamId}|${c.footballTeamName}`;
  let spotifySeen = spotifyKey(State.settings);
  let footballSeen = footballKey(State.settings);
  await onEvent<Settings>("settings-changed", (s) => {
    State.settings = mergeSettings(State.settings, s);
    const spotifyNow = spotifyKey(State.settings);
    if (!State.settings.spotifyEnabled) {
      Spotify.state = { ...IDLE_SPOTIFY };
      Spotify.artwork = null;
    } else if (spotifyNow !== spotifySeen) {
      void Bridge.spotifyRefresh().then((state) => {
        if (state && State.settings.spotifyEnabled) { Spotify.state = state; State.notify(); }
      });
    }
    spotifySeen = spotifyNow;
    const footballNow = footballKey(State.settings);
    if (!State.settings.footballEnabled) {
      Football.state = { ...IDLE_FOOTBALL };
    } else if (footballNow !== footballSeen) {
      void Bridge.footballRefresh().then((state) => {
        if (state && State.settings.footballEnabled) { setFootballState(state); State.notify(); }
      });
    }
    footballSeen = footballNow;
    applyLanguage();
    applyTheme();
    island.applySettings();
  });

  // The hotkey or the tray opened the island over some selected text.
  await onEvent<string>("captured-text", (text) => island.openWithText(text));

  await onEvent<string>("toast", (m) => toast(m, 4500));
  await onEvent<{ requestId: number; text: string }>("translate-partial", (p) =>
    island.translate.partial(p.requestId, p.text));

  await onEvent<SpotifyState>("spotify", (state) => {
    Spotify.state = State.settings.spotifyEnabled ? state : { ...IDLE_SPOTIFY };
    if (!Spotify.state.track) Spotify.artwork = null;
    State.notify();
  });
  void Bridge.spotifyRefresh().then((spotify) => {
    if (spotify && State.settings.spotifyEnabled) Spotify.state = spotify;
    State.notify();
  });

  await onEvent<FootballState>("football", (state) => {
    setFootballState(State.settings.footballEnabled ? state : { ...IDLE_FOOTBALL });
    State.notify();
  });
  void Bridge.footballRefresh().then((state) => {
    if (state && State.settings.footballEnabled) Football.state = state;
    State.notify();
  });

  await onEvent<CryptoState>("crypto", (state) => {
    if (setCryptoState(state)) State.notify();
  });
  void Bridge.cryptoState().then((state) => {
    if (state && setCryptoState(state)) State.notify();
  });

  island.launch();

  // In a plain browser there is no wake strip behind the cursor: the whole page
  // wakes the island, so the visuals can be checked with `npm run dev`.
  if (!IS_TAURI) {
    document.addEventListener("click", () => Sound.resume(), { once: true });
    if (IS_MOCK) installDevHooks(island);
  }
}

void main();
