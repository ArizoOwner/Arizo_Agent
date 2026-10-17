// The player clock, artwork identity, dance rules and real command outcomes.

import test from "node:test";
import assert from "node:assert/strict";
import { installFakeDom } from "./fakedom.mjs";

installFakeDom();
const S = await import("../src/core/spotify.ts");
const { State } = await import("../src/core/state.ts");
const { Bridge } = await import("../src/core/bridge.ts");
const { buildSpotify } = await import("../src/views/spotify.ts");
const { stepDanceLevel, danceTransform } = await import("../src/ari/engine.ts");
const { setLanguage } = await import("../src/i18n/i18n.ts");
const { errorText } = await import("../src/views/spotify.ts");
setLanguage("en");

const track = { id: "spotify:track:sample", title: "Example song", artist: "Example artist", album: "Example album", duration: 240, artUrl: "smtc:sample" };
const capabilities = { playPause: true, next: true, previous: true, seek: true, shuffle: true, repeat: true, volume: true };
const playing = () => ({ ...S.IDLE_SPOTIFY, enabled: true, configured: true, connected: true, source: "account", accountName: "Demo", premium: true, device: "Phone", installed: true, running: true, track: { ...track }, playing: true, position: 20, positionAt: 1_000_000, volume: 45, capabilities: { ...capabilities } });

function reset(state = playing()) {
  State.settings.spotifyEnabled = true;
  State.mode = "expanded";
  State.view = "spotify";
  S.Spotify.state = state;
  S.Spotify.artwork = null;
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

function button(view, label) {
  const b = view.el.find("button").find((e) => e.getAttribute("aria-label") === label || e.getAttribute("title") === label);
  assert.ok(b, `missing ${label} control`);
  return b;
}

function bridgeMethods(t, overrides) {
  const before = {};
  for (const [key, value] of Object.entries(overrides)) {
    before[key] = Bridge[key];
    Bridge[key] = value;
  }
  t.after(() => { Object.assign(Bridge, before); });
}

test("Spotify clock extrapolates only while playing, freezes on pause and caps at the end", () => {
  const s = playing();
  assert.equal(S.spotifyPosition(s, 1_005_000), 25);
  assert.equal(S.spotifyPosition(s, 999_000), 20);
  assert.equal(S.spotifyPosition(s, 2_000_000), 240);
  const paused = S.withPlaying(s, false, 1_005_000);
  assert.equal(paused.position, 25);
  assert.equal(S.spotifyPosition(paused, 1_010_000), 25);
  assert.equal(S.withPlaying(paused, false, 1_010_000), paused);
  const resumed = S.withPlaying(paused, true, 1_010_000);
  assert.equal(S.spotifyPosition(resumed, 1_012_000), 27);
  assert.equal(S.spotifyPosition({ ...s, position: -10, positionAt: 0 }, 10), 0);
});

test("time and volume labels handle edge values", () => {
  assert.equal(S.formatTime(0), "0:00");
  assert.equal(S.formatTime(65.9), "1:05");
  assert.equal(S.formatTime(3661), "1:01:01");
  assert.equal(S.formatTime(NaN), "0:00");
  assert.equal(S.formatTime(-3), "0:00");
  assert.deepEqual([0, 1, 33, 34, 66, 67, 100].map(S.volumeLevel), [0, 1, 1, 2, 2, 3, 3]);
  assert.equal(S.isAd({ ...track, id: "spotify:ad:sample" }), true);
  assert.equal(S.isAd(track), false);
  assert.equal(S.isAd(null), false);
});

test("a cover never leaks across tracks or disabled sessions", () => {
  reset();
  S.Spotify.artwork = { artUrl: "smtc:other", dataUrl: "data:image/png;base64,old" };
  assert.equal(S.currentArtwork(), null);
  S.Spotify.artwork.artUrl = "smtc:sample";
  assert.equal(S.currentArtwork(), "data:image/png;base64,old");
  assert.equal(S.currentArtwork({ ...S.Spotify.state, enabled: false }), null);
  assert.equal(S.currentArtwork({ ...S.Spotify.state, track: null }), null);
  S.Spotify.artwork = null;
  assert.equal(S.currentArtwork({ ...S.Spotify.state, artworkDataUrl: "https://untrusted.invalid/cover" }), null);
  assert.equal(S.currentArtwork({ ...S.Spotify.state, artworkDataUrl: "data:image/jpeg;base64,new" }), "data:image/jpeg;base64,new");
});

test("music and the main mascot dance only in eligible states and views", () => {
  const s = playing();
  assert.equal(S.musicPlaying(s), true);
  for (const patch of [{ enabled: false }, { running: false }, { playing: false }, { track: null }]) {
    assert.equal(S.musicPlaying({ ...s, ...patch }), false);
  }
  const o = { music: true, state: "idle", mode: "compact", view: "translate" };
  assert.equal(S.islandDances(o), true);
  assert.equal(S.islandDances({ ...o, mode: "hidden" }), false);
  assert.equal(S.islandDances({ ...o, mode: "expanded" }), false);
  assert.equal(S.islandDances({ ...o, mode: "expanded", view: "spotify" }), true);
  for (const state of ["error", "sleeping", "question", "approval", "ratelimit", "dizzy"]) {
    assert.equal(S.islandDances({ ...o, state }), false);
  }
  assert.equal(S.desktopDances(true, "thinking"), true);
  assert.equal(S.desktopDances(false, "idle"), false);
});

test("the Coucou 0.4.0 dance fades smoothly and keeps its exact 112 BPM geometry", () => {
  assert.equal(stepDanceLevel(0, true, .15), .5);
  assert.equal(stepDanceLevel(.5, true, 1), 1);
  assert.equal(stepDanceLevel(1, false, .25), .5);
  assert.equal(stepDanceLevel(.5, false, 1), 0);
  assert.equal(stepDanceLevel(.5, false, -.1), .5);
  const still = danceTransform(.2, 0, 30);
  assert.equal(still.dx, 0);
  assert.ok(still.dy === 0);
  assert.equal(still.sx, 1);
  assert.equal(still.sy, 1);
  const hop = danceTransform(30 / 112, 1, 30);
  assert.ok(Math.abs(hop.dy + 6) < 1e-9);
  assert.ok(Math.abs(hop.dx - 2.4) < 1e-9);
});

test("the player renders untrusted metadata as text and disables unsupported controls", () => {
  reset({ ...playing(), track: { ...track, title: "<img src=x onerror=alert(1)>" }, capabilities: { ...capabilities, next: false, volume: false } });
  const view = buildSpotify();
  assert.equal(view.el.querySelector(".spotify-title").textContent, "<img src=x onerror=alert(1)>");
  assert.equal(button(view, "Next track").disabled, true);
  assert.equal(button(view, "Previous track").disabled, false);
  assert.equal(view.el.querySelector(".spotify-volume").disabled, true);
  assert.equal(button(view, "Pause").disabled, false);
  State.mode = "hidden";
  assert.equal(view.tick(), false, "a hidden player never keeps drawing");
  State.mode = "expanded";
  assert.equal(view.tick(), true);
});

test("a refused command shows Spotify's own reason and never pretends it paused", async (t) => {
  reset();
  bridgeMethods(t, { spotifyControl: async () => { throw new Error("premium_required"); }, spotifyRefresh: async () => S.Spotify.state });
  const view = buildSpotify();
  button(view, "Pause").fire("click");
  await settle();
  assert.equal(S.Spotify.state.playing, true);
  assert.match(view.el.querySelector(".spotify-error").textContent, /Premium/);
  assert.equal(button(view, "Pause").disabled, false);
});

test("accepted controls use the real refreshed state and the exact backend action", async (t) => {
  reset();
  const calls = [];
  bridgeMethods(t, {
    spotifyControl: async (...args) => { calls.push(args); return true; },
    spotifyRefresh: async () => ({ ...S.Spotify.state, playing: false }),
  });
  const view = buildSpotify();
  button(view, "Pause").fire("click");
  await settle();
  assert.deepEqual(calls, [["playPause", undefined]]);
  assert.equal(S.Spotify.state.playing, false);
  assert.equal(view.el.querySelector(".spotify-error").textContent, "");
  assert.equal(button(view, "Play").disabled, false);
});

test("seek and volume send seconds and mixer percent, never change playback optimistically", async (t) => {
  reset();
  const calls = [];
  bridgeMethods(t, {
    spotifyControl: async (...args) => { calls.push(args); return true; },
    spotifyRefresh: async () => S.Spotify.state,
  });
  const view = buildSpotify();
  const seek = view.el.querySelector(".spotify-seek");
  seek.value = "75";
  seek.fire("input");
  seek.fire("change");
  await settle();
  const volume = view.el.querySelector(".spotify-volume");
  volume.value = "28";
  volume.fire("input");
  volume.fire("change");
  await settle();
  assert.deepEqual(calls, [["seek", 75], ["volume", 28]]);
  assert.equal(S.Spotify.state.position, 20);
  assert.equal(S.Spotify.state.volume, 45);
});

test("disabling the integration hides stale metadata and leaves an enable action", () => {
  reset();
  State.settings.spotifyEnabled = false;
  const view = buildSpotify();
  assert.equal(view.el.querySelector(".spotify-player").style.display, "none");
  assert.equal(view.el.querySelector(".spotify-empty-title").textContent, "Spotify is disabled");
  assert.equal(view.el.querySelector(".spotify-empty").querySelector(".spotify-empty-action").textContent, "Enable Spotify");
  for (const label of ["Previous track", "Next track", "Pause", "Shuffle", "Repeat"]) {
    assert.equal(button(view, label).disabled, true);
  }
  reset();
});

test("error codes from the backend become sentences, in the interface language", () => {
  assert.match(errorText(new Error("premium_required")), /Premium/);
  assert.match(errorText("no_device"), /No active Spotify device/);
  assert.match(errorText("http_502"), /502/);
  assert.match(errorText("???"), /did not accept/);
  setLanguage("fa");
  try {
    assert.match(errorText("premium_required"), /Premium/);
    assert.match(errorText("timeout"), /[آ-ی]/);
  } finally {
    setLanguage("en");
  }
});

test("without an account the setup is one click away and the player stays hidden", () => {
  reset({ ...S.IDLE_SPOTIFY, enabled: true, installed: true, configured: false, connected: false });
  const view = buildSpotify();
  assert.equal(view.el.querySelector(".spotify-setup").style.display, "none");
  assert.equal(view.el.querySelector(".spotify-player").style.display, "none");
  assert.equal(view.el.querySelector(".spotify-status").textContent, "Ready for music");
  view.el.querySelector(".spotify-heading-actions").find("button").find((b) => b.textContent === "Connect account").fire("click");
  assert.equal(view.el.querySelector(".spotify-setup").style.display, "");
  assert.ok(S.validClientId("0123456789abcdef0123456789abcdef"));
  for (const bad of ["", "short", "has space 0123456789abcdef0123", "x".repeat(65)]) assert.equal(S.validClientId(bad), false);
});

test("connecting saves a valid Client ID, then asks the backend to connect", async (t) => {
  reset({ ...S.IDLE_SPOTIFY, enabled: true, installed: true });
  const id = "0123456789abcdef0123456789abcdef";
  const calls = [];
  bridgeMethods(t, {
    saveSettings: async (patch) => { calls.push(["save", patch]); return { ok: true, settings: { ...State.settings, ...patch } }; },
    spotifyConnect: async () => { calls.push(["connect"]); return true; },
    spotifyRefresh: async () => ({ ...playing() }),
  });
  const view = buildSpotify();
  const input = view.el.querySelector(".spotify-client");
  input.value = "nope";
  view.el.querySelector(".spotify-setup").find("button").find((b) => b.className.includes("empty-action")).fire("click");
  await settle();
  assert.deepEqual(calls, [], "an invalid id never reaches the backend");
  assert.match(view.el.querySelector(".spotify-error").textContent, /Client ID/);
  input.value = id;
  view.el.querySelector(".spotify-setup").find("button").find((b) => b.className.includes("empty-action")).fire("click");
  await settle();
  assert.deepEqual(calls, [["save", { spotifyClientId: id }], ["connect"]]);
  assert.equal(S.Spotify.state.connected, true);
  State.settings.spotifyClientId = "";
});

test("a failed connection explains why instead of staying silent", async (t) => {
  reset({ ...S.IDLE_SPOTIFY, enabled: true, installed: true });
  State.settings.spotifyClientId = "0123456789abcdef0123456789abcdef";
  bridgeMethods(t, {
    spotifyConnect: async () => { throw new Error("port_busy"); },
    spotifyRefresh: async () => ({ ...S.IDLE_SPOTIFY, enabled: true }),
  });
  const view = buildSpotify();
  view.el.querySelector(".spotify-client").value = State.settings.spotifyClientId;
  view.el.querySelector(".spotify-setup").find("button").find((b) => b.className.includes("empty-action")).fire("click");
  await settle();
  assert.match(view.el.querySelector(".spotify-error").textContent, /43821/);
  State.settings.spotifyClientId = "";
});

test("a free account sees what plays but every control is off, with the reason", () => {
  reset({ ...playing(), premium: false, capabilities: { ...capabilities, playPause: false, next: false, previous: false, seek: false, shuffle: false, repeat: false, volume: false } });
  const view = buildSpotify();
  assert.equal(button(view, "Pause").disabled, true);
  assert.match(view.el.querySelector(".spotify-error").textContent, /Premium/);
  assert.equal(view.el.querySelector(".spotify-title").textContent, "Example song");
});

test("music dances for the account and for this PC, but not for nothing", () => {
  assert.equal(S.musicPlaying({ ...playing(), connected: false }), false);
  assert.equal(S.musicPlaying({ ...playing(), connected: false, source: "local" }), true);
  assert.equal(S.musicPlaying(playing()), true);
});

test("playback on this PC shows the full player without any account", () => {
  reset({ ...playing(), connected: false, premium: false, accountName: "", device: "", source: "local" });
  const view = buildSpotify();
  assert.equal(view.el.querySelector(".spotify-player").style.display, "");
  assert.equal(view.el.querySelector(".spotify-title").textContent, "Example song");
  assert.equal(view.el.querySelector(".spotify-account").textContent, "This PC");
  assert.equal(button(view, "Pause").disabled, false);
  assert.equal(view.el.querySelector(".spotify-error").style.display, "none", "no Premium warning for this PC");
});

test("opening the account setup replaces the local player instead of overlapping it", () => {
  reset({ ...playing(), connected: false, premium: false, accountName: "", device: "", source: "local" });
  const view = buildSpotify();
  const link = () => view.el.querySelector(".spotify-heading-actions").find("button").find((b) => b.textContent === "Connect account" || b.textContent === "Hide");
  assert.equal(view.el.querySelector(".spotify-setup").style.display, "none");
  assert.equal(view.el.querySelector(".spotify-player").style.display, "");
  link().fire("click");
  assert.equal(view.el.querySelector(".spotify-setup").style.display, "");
  assert.equal(view.el.querySelector(".spotify-player").style.display, "none");
  link().fire("click");
  assert.equal(view.el.querySelector(".spotify-setup").style.display, "none");
  assert.equal(view.el.querySelector(".spotify-player").style.display, "");
});
