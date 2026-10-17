// Spotify's local Windows media session and the pure rules shared by the island.

import type { BotStateName, IslandMode, IslandViewName } from "./layout";
import { N_ } from "../i18n/i18n";

export const SPOTIFY_ID = "integration_spotify";
export const SPOTIFY_GREEN = "#1DB954";

export interface SpotifyTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  artUrl: string | null;
}

export interface SpotifyCapabilities {
  playPause: boolean;
  next: boolean;
  previous: boolean;
  seek: boolean;
  shuffle: boolean;
  repeat: boolean;
  volume: boolean;
}

export interface SpotifyState {
  enabled: boolean;
  /** A Client ID has been entered in Settings or in the player. */
  configured: boolean;
  /** The Spotify account is connected. */
  connected: boolean;
  accountName: string;
  /** Controls need Premium; a free account can only watch. */
  premium: boolean;
  /** Something is loaded on one of the account's devices. */
  running: boolean;
  /** The desktop app is installed on this PC (only for the "open" button). */
  installed: boolean;
  /** Where the track comes from: this PC's Windows media controls, the account, or nothing. */
  source: "" | "local" | "account";
  /** The device playing, e.g. "Phone" or this PC. */
  device: string;
  /** Short code of the last problem; see spotifyErrorText in the view. */
  error: string;
  track: SpotifyTrack | null;
  playing: boolean;
  /** Seconds at positionAt (Unix milliseconds). */
  position: number;
  positionAt: number;
  shuffle: boolean;
  repeat: boolean;
  /** Spotify's Windows mixer volume, not the system's master volume. */
  volume: number;
  artworkDataUrl: string | null;
  capabilities: SpotifyCapabilities;
}

export const IDLE_SPOTIFY: SpotifyState = {
  enabled: false, configured: false, connected: false, accountName: "", premium: false,
  running: false, installed: false, source: "", device: "", error: "", track: null, playing: false,
  position: 0, positionAt: 0, shuffle: false, repeat: false, volume: 50,
  artworkDataUrl: null,
  capabilities: { playPause: false, next: false, previous: false, seek: false, shuffle: false, repeat: false, volume: false },
};

export const Spotify = {
  state: { ...IDLE_SPOTIFY } as SpotifyState,
  artwork: null as { artUrl: string; dataUrl: string } | null,
};

export function currentArtwork(s: SpotifyState = Spotify.state): string | null {
  if (!s.enabled || !s.track?.artUrl) return null;
  if (s.artworkDataUrl?.startsWith("data:image/")) return s.artworkDataUrl;
  const art = Spotify.artwork;
  return art?.artUrl === s.track.artUrl && art.dataUrl.startsWith("data:image/") ? art.dataUrl : null;
}

export function spotifyPosition(s: SpotifyState, nowMs: number): number {
  const base = Number.isFinite(s.position) ? Math.max(0, s.position) : 0;
  const elapsed = s.playing && s.positionAt > 0 && Number.isFinite(nowMs)
    ? Math.max(0, (nowMs - s.positionAt) / 1000) : 0;
  const duration = s.track?.duration ?? 0;
  return duration > 0 ? Math.min(base + elapsed, duration) : base + elapsed;
}

export function withPlaying(s: SpotifyState, playing: boolean, nowMs: number): SpotifyState {
  return s.playing === playing ? s : { ...s, position: spotifyPosition(s, nowMs), positionAt: nowMs, playing };
}

export function isAd(track: SpotifyTrack | null | undefined): boolean {
  return track?.id.startsWith("spotify:ad:") ?? false;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const pad = (n: number) => String(n).padStart(2, "0");
  return s >= 3600
    ? `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
    : `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

export function volumeLevel(volume: number): 0 | 1 | 2 | 3 {
  return volume <= 0 ? 0 : volume < 34 ? 1 : volume < 67 ? 2 : 3;
}

export function musicPlaying(s: SpotifyState): boolean {
  return s.enabled && (s.connected || s.source === "local") && s.running && s.playing && s.track != null;
}

/** The Client ID of a Spotify developer app: letters and digits only. */
export function validClientId(id: string): boolean {
  return /^[A-Za-z0-9]{20,64}$/.test(id.trim());
}

/** Where a Spotify developer app is created. */
export const DASHBOARD_URL = "https://developer.spotify.com/dashboard";

/** English sentences for the short codes the backend reports (the view translates them). */
export const ERROR_TEXT: Record<string, string> = {
  not_connected: N_("Connect your Spotify account first."),
  auth: N_("Spotify asked you to sign in again."),
  premium_required: N_("Spotify needs a Premium account to control playback."),
  forbidden: N_("Spotify refused this request."),
  not_registered: N_("Add this account under User Management in your Spotify app (development mode)."),
  no_device: N_("No active Spotify device. Start playing on any device first."),
  rate_limited: N_("Spotify is busy. Try again in a moment."),
  network: N_("Could not reach Spotify. Check the internet connection."),
  port_busy: N_("Port 43821 is in use by another program. Close it and try again."),
  timeout: N_("The connection was not approved in time. Try again."),
  denied: N_("Access was not granted."),
  cancelled: N_("Connection cancelled."),
  busy: N_("Already connecting."),
  bad_client_id: N_("That Client ID does not look right."),
  bad_action: N_("That control is not available."),
  disabled: N_("Spotify is turned off in Settings."),
  open_failed: N_("Could not open Spotify."),
};

const DANCE_STATES: ReadonlySet<BotStateName> = new Set(["idle", "working", "thinking", "searching", "finished"]);

export function islandDances(o: { music: boolean; state: BotStateName; mode: IslandMode; view: IslandViewName }): boolean {
  return o.music && DANCE_STATES.has(o.state) && (o.mode === "compact" || (o.mode === "expanded" && o.view === "spotify"));
}

export function desktopDances(music: boolean, state: BotStateName): boolean {
  return music && DANCE_STATES.has(state);
}
