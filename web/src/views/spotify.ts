// The Spotify player. It shows what plays on this PC (Windows media controls,
// no account) and, once the user connects their account, what plays on any of
// their devices. The page never sees a token: it knows only whether an account
// is connected. Every control is confirmed before the view believes it.

import { h, svg, clear } from "./dom";
import { card } from "./parts";
import { ICONS } from "./icons";
import { Bridge } from "../core/bridge";
import { State, mergeSettings } from "../core/state";
import {
  DASHBOARD_URL, ERROR_TEXT, Spotify, currentArtwork, formatTime, isAd, musicPlaying, spotifyPosition, validClientId,
} from "../core/spotify";
import { t, tl } from "../i18n/i18n";
import type { ViewHost } from "./views";

const GLYPHS = {
  play: "M8 4.5v15l12-7.5L8 4.5z",
  pause: "M6 4h4v16H6zM14 4h4v16h-4z",
  previous: "M5 4h2v16H5zM19 4v16L8 12 19 4z",
  next: "M17 4h2v16h-2zM5 4l11 8-11 8V4z",
  shuffle: "M3 6h3c5 0 7 12 12 12h3M17 14l4 4-4 4M3 18h3c2 0 4-3 5-6M14 8c1-1 2-2 4-2h3M17 2l4 4-4 4",
  repeat: "M17 2l4 4-4 4M21 6H7a4 4 0 0 0-4 4M7 22l-4-4 4-4M3 18h14a4 4 0 0 0 4-4",
  music: "M9 18V5l12-2v13M9 8l12-2M9 18c0 1.7-1.6 3-3.5 3S2 19.7 2 18s1.6-3 3.5-3S9 16.3 9 18zm12-2c0 1.7-1.6 3-3.5 3S14 17.7 14 16s1.6-3 3.5-3S21 14.3 21 16z",
};

const FALLBACK_REDIRECT = "http://127.0.0.1:43821/callback";

/** What a rejected call or a code from the backend says, in the interface language. */
export function errorText(err: unknown): string {
  const code = String(err instanceof Error ? err.message : err).replace(/^Error:\s*/, "").trim();
  const text = ERROR_TEXT[code];
  if (text) return t(text);
  if (/^http_\d+$/.test(code)) return t("Spotify answered with an error ({code}).", { code: code.slice(5) });
  return t("Spotify did not accept this control. Try again in the desktop app.");
}

export function buildSpotify(): ViewHost {
  let busy = false;
  let connecting = false;
  let setupOpen = false;
  let seeking = false;
  let changingVolume = false;
  let error = "";
  let refreshInFlight: Promise<void> | null = null;
  let lastArt = "";
  let redirectUri = FALLBACK_REDIRECT;

  const title = h("div", { class: "spotify-title", dir: "auto" });
  const artist = h("div", { class: "spotify-artist", dir: "auto" });
  const album = h("div", { class: "spotify-album", dir: "auto" });
  const status = h("span", { class: "spotify-status" });
  const artwork = h("img", { class: "spotify-art", alt: "", draggable: false });
  const artFallback = h("div", { class: "spotify-art-fallback" }, svg(GLYPHS.music, 46, { stroke: 1.4 }));
  const elapsed = h("span", { text: "0:00" });
  const duration = h("span", { text: "0:00" });
  const seek = h("input", {
    class: "spotify-range spotify-seek", type: "range", min: 0, max: 1, step: 0.1, value: 0,
    "aria-label": tl("Playback position"), onfocus: () => void Bridge.focusWindow(true),
  });
  const volumeValue = h("span", { class: "spotify-volume-value", dir: "ltr" });
  const volume = h("input", {
    class: "spotify-range spotify-volume", type: "range", min: 0, max: 100, step: 1, value: 50,
    "aria-label": tl("Spotify volume"), onfocus: () => void Bridge.focusWindow(true),
  });
  const notice = h("div", { class: "spotify-error", role: "alert" });
  const account = h("span", { class: "spotify-account", dir: "auto" });

  function iconButton(label: string, path: string, action: () => void, stroke = false) {
    return h("button", {
      type: "button", class: "spotify-control", title: tl(label), "aria-label": tl(label), onclick: action,
    }, svg(path, 20, stroke ? { stroke: 1.8 } : {}));
  }

  const previous = iconButton("Previous track", GLYPHS.previous, () => void run("previous"));
  const play = iconButton("Play", GLYPHS.play, () => void run("playPause"));
  play.classList.add("spotify-play");
  const next = iconButton("Next track", GLYPHS.next, () => void run("next"));
  const shuffle = iconButton("Shuffle", GLYPHS.shuffle, () => void run("shuffle", Spotify.state.shuffle ? 0 : 1), true);
  const repeat = iconButton("Repeat", GLYPHS.repeat, () => void run("repeat", Spotify.state.repeat ? 0 : 1), true);
  const open = h("button", { class: "spotify-link", type: "button", title: tl("Open Spotify"), onclick: () => void openSpotify() }, tl("Open Spotify"), svg(ICONS.arrowUpRight, 12));
  const disconnectBtn = h("button", { class: "spotify-link", type: "button", onclick: () => void disconnect() }, tl("Disconnect"));
  const accountBtn = h("button", { class: "spotify-link", type: "button", onclick: () => { setupOpen = !setupOpen; sync(); } });
  const refreshBtn = iconButton("Refresh Spotify", ICONS.arrowClockwise, () => void refresh(true), true);

  // ── Not connected: the one-time setup ──────────────────────────────────────
  const clientInput = h("input", {
    class: "spotify-client", type: "text", dir: "ltr", spellcheck: false, autocomplete: "off",
    placeholder: tl("Paste your Client ID"), "aria-label": tl("Spotify Client ID"),
    onfocus: () => void Bridge.focusWindow(true),
  });
  const redirectCode = h("code", { class: "spotify-redirect", dir: "ltr", text: redirectUri });
  const copyRedirect = h("button", { class: "spotify-link", type: "button", onclick: () => void copyUri() }, tl("Copy"));
  const dashboardBtn = h("button", { class: "spotify-link", type: "button", onclick: () => void Bridge.openUrl(DASHBOARD_URL) },
    tl("Open the Spotify dashboard"), svg(ICONS.arrowUpRight, 12));
  const connectBtn = h("button", { class: "spotify-empty-action", type: "button", onclick: () => void connect() });
  const cancelBtn = h("button", { class: "spotify-link", type: "button", onclick: () => void Bridge.spotifyCancelConnect() }, tl("Cancel"));
  const setup = h("div", { class: "spotify-setup" },
    h("div", { class: "spotify-setup-title", text: tl("Connect your Spotify account") }),
    h("ol", { class: "spotify-steps" },
      h("li", {}, tl("Create a free app in the Spotify dashboard."), dashboardBtn),
      h("li", {}, tl("Add this Redirect URI to it:"), redirectCode, copyRedirect),
      h("li", {}, tl("Paste the app's Client ID here, then connect:")),
    ),
    h("div", { class: "spotify-setup-row" }, clientInput, connectBtn, cancelBtn),
  );

  const emptyTitle = h("div", { class: "spotify-empty-title" });
  const emptyHint = h("div", { class: "spotify-empty-hint" });
  const emptyAction = h("button", { class: "spotify-empty-action", type: "button", onclick: () => void emptyClick() });
  const empty = h("div", { class: "spotify-empty" }, svg(GLYPHS.music, 38, { stroke: 1.3 }), emptyTitle, emptyHint, emptyAction);
  const player = h("div", { class: "spotify-player" },
    h("div", { class: "spotify-track" },
      h("div", { class: "spotify-cover" }, artFallback, artwork),
      h("div", { class: "spotify-details" }, title, artist, album,
        h("div", { class: "spotify-controls", dir: "ltr" }, shuffle, previous, play, next, repeat))),
    h("div", { class: "spotify-progress", dir: "ltr" }, elapsed, seek, duration),
    h("div", { class: "spotify-bottom" },
      account,
      h("div", { class: "spotify-volume-row", dir: "ltr", title: tl("Spotify volume") }, svg(ICONS.speakerOn, 14), volume, volumeValue)));
  const el = h("div", { class: "view spotify-view" }, card("green",
    h("div", { class: "spotify-shell" },
      h("div", { class: "spotify-heading" }, h("span", { class: "spotify-brand", text: "Spotify", dir: "ltr" }), status,
        h("div", { class: "spotify-heading-actions" }, accountBtn, disconnectBtn, open, refreshBtn)), setup, empty, player, notice)));

  void Bridge.spotifyRedirectUri().then((uri) => {
    if (uri) { redirectUri = uri; redirectCode.textContent = uri; }
  });

  async function refresh(showError = false): Promise<void> {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      const state = await Bridge.spotifyRefresh();
      if (state && State.settings.spotifyEnabled && state.enabled) {
        Spotify.state = state;
        State.notify();
      } else if (showError && !state) {
        error = t("Could not read Spotify. Try refreshing.");
      }
      sync();
    })().finally(() => { refreshInFlight = null; });
    return refreshInFlight;
  }

  async function run(action: string, value?: number) {
    if (busy || !State.settings.spotifyEnabled) return;
    busy = true;
    error = "";
    sync();
    try {
      const ok = await Bridge.spotifyControl(action, value);
      if (ok !== true) error = t("Spotify did not accept this control. Try again in the desktop app.");
    } catch (err) {
      error = errorText(err);
    }
    try { await refresh(); } finally {
      busy = false;
      sync();
      State.notify();
    }
  }

  async function connect() {
    if (connecting) return;
    const id = clientInput.value.trim();
    if (!validClientId(id)) { error = errorText("bad_client_id"); sync(); return; }
    connecting = true;
    error = "";
    sync();
    try {
      if (id !== State.settings.spotifyClientId) {
        const saved = await Bridge.saveSettings({ spotifyClientId: id });
        if (!saved?.ok) throw new Error("bad_client_id");
        State.settings = mergeSettings(State.settings, saved.settings);
      }
      await Bridge.spotifyConnect();
      setupOpen = false;
      await refresh();
    } catch (err) {
      error = errorText(err);
    } finally {
      connecting = false;
      sync();
      State.notify();
    }
  }

  async function disconnect() {
    await Bridge.spotifyDisconnect();
    error = "";
    await refresh();
    sync();
  }

  async function copyUri() {
    await Bridge.copyText(redirectUri);
  }

  async function openSpotify() {
    if (await Bridge.spotifyOpen() !== true) error = errorText("open_failed");
    sync();
  }

  async function emptyClick() {
    if (busy) return;
    if (!State.settings.spotifyEnabled) {
      busy = true;
      error = "";
      sync();
      try {
        const result = await Bridge.saveSettings({ spotifyEnabled: true });
        if (result?.ok && result.settings) {
          State.settings = mergeSettings(State.settings, result.settings);
          await refresh();
        } else {
          error = t("Could not enable Spotify.");
        }
      } finally {
        busy = false;
        sync();
        State.notify();
      }
    } else {
      await openSpotify();
    }
  }

  clientInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") void connect();
  });
  seek.addEventListener("input", () => {
    seeking = true;
    elapsed.textContent = formatTime(Number(seek.value));
  });
  seek.addEventListener("change", () => {
    const value = Number(seek.value);
    seeking = false;
    if (Number.isFinite(value)) void run("seek", value);
  });
  seek.addEventListener("blur", () => { seeking = false; });
  volume.addEventListener("input", () => {
    changingVolume = true;
    volumeValue.textContent = `${volume.value}%`;
  });
  volume.addEventListener("change", () => {
    const value = Number(volume.value);
    changingVolume = false;
    if (Number.isFinite(value)) void run("volume", value);
  });
  volume.addEventListener("blur", () => { changingVolume = false; });

  function paintTime() {
    const s = Spotify.state;
    if (!seeking) {
      const position = spotifyPosition(s, Date.now());
      seek.value = String(position);
      seek.setAttribute("aria-valuetext", `${formatTime(position)} / ${formatTime(s.track?.duration ?? 0)}`);
      elapsed.textContent = formatTime(position);
    }
  }

  function sync() {
    const s = Spotify.state;
    const enabled = State.settings.spotifyEnabled;
    const connected = enabled && s.enabled && s.connected;
    const local = s.source === "local";
    const showSetup = enabled && !connected && (setupOpen || connecting);
    // The account setup takes the player's place while it is open, never shares it.
    const hasTrack = !showSetup && enabled && s.enabled && (connected || local) && s.running && s.track != null;
    accountBtn.textContent = connected ? "" : t(showSetup ? "Hide" : "Connect account");
    accountBtn.style.display = enabled && !connected ? "" : "none";
    setup.style.display = showSetup ? "" : "none";
    player.style.display = hasTrack ? "" : "none";
    empty.style.display = hasTrack || showSetup ? "none" : "";
    open.style.display = enabled ? "" : "none";
    disconnectBtn.style.display = connected ? "" : "none";
    refreshBtn.style.display = enabled ? "" : "none";
    status.textContent = !enabled ? t("Disabled")
      : showSetup ? t("Not connected")
      : hasTrack ? t(s.playing ? "Now playing" : "Paused") : t("Ready for music");
    el.classList.toggle("spotify-playing", hasTrack && s.playing);
    el.classList.toggle("spotify-setting-up", showSetup);

    // The setup card
    if (showSetup && document.activeElement !== clientInput && !clientInput.value) {
      clientInput.value = State.settings.spotifyClientId;
    }
    connectBtn.textContent = connecting ? t("Waiting for Spotify…") : t("Connect Spotify");
    connectBtn.disabled = connecting;
    cancelBtn.style.display = connecting ? "" : "none";
    clientInput.disabled = connecting;

    // The empty card (disabled, or connected with nothing playing)
    emptyTitle.textContent = !enabled ? t("Spotify is disabled") : t("Ready for music");
    emptyHint.textContent = !enabled
      ? t("Turn Spotify on to see and control what you play.")
      : t(connected ? "No active Spotify device. Start playing on any device first." : "Play a song in Spotify on this PC, or connect your account to follow other devices.");
    emptyAction.textContent = !enabled ? t("Enable Spotify") : t(s.installed ? "Open Spotify" : "Get Spotify");
    emptyAction.disabled = busy;

    if (hasTrack && s.track) {
      title.textContent = s.track.title;
      title.title = s.track.title;
      artist.textContent = isAd(s.track) ? t("Advertisement") : s.track.artist;
      album.textContent = s.track.album;
      duration.textContent = formatTime(s.track.duration);
      seek.max = String(Math.max(1, s.track.duration));
    }
    const art = hasTrack ? currentArtwork(s) : null;
    if ((art ?? "") !== lastArt) {
      lastArt = art ?? "";
      if (art) artwork.src = art;
      else artwork.removeAttribute("src");
    }
    artwork.style.display = art ? "block" : "none";
    artFallback.style.display = art ? "none" : "grid";
    const caps = s.capabilities;
    for (const [button, capable] of [[play, caps.playPause], [previous, caps.previous], [next, caps.next], [shuffle, caps.shuffle], [repeat, caps.repeat]] as const) {
      button.disabled = busy || !hasTrack || !capable;
    }
    seek.disabled = busy || !hasTrack || !caps.seek;
    volume.disabled = busy || !hasTrack || !caps.volume;
    refreshBtn.disabled = busy || !enabled;
    shuffle.classList.toggle("on", s.shuffle);
    repeat.classList.toggle("on", s.repeat);
    shuffle.setAttribute("aria-pressed", String(s.shuffle));
    repeat.setAttribute("aria-pressed", String(s.repeat));
    play.title = t(s.playing ? "Pause" : "Play");
    play.setAttribute("aria-label", play.title);
    clear(play);
    play.append(svg(s.playing ? GLYPHS.pause : GLYPHS.play, 23));
    if (!changingVolume) {
      volume.value = String(s.volume);
      volumeValue.textContent = `${s.volume}%`;
    }
    const place = local ? t("This PC") : s.device;
    const who = connected && s.accountName ? `${s.accountName}${place ? ` · ${place}` : ""}` : place;
    account.textContent = who || t("Spotify account");

    const problem = error || (s.error ? errorText(s.error) : "")
      || (hasTrack && !local && !s.premium && s.accountName ? t(ERROR_TEXT.premium_required) : "");
    notice.textContent = problem;
    notice.style.display = problem ? "block" : "none";
    paintTime();
  }

  sync();
  return {
    el, sync,
    focus() { void refresh(); },
    tick() {
      if (State.mode !== "expanded" || State.view !== "spotify") return false;
      paintTime();
      return musicPlaying(Spotify.state);
    },
  };
}
