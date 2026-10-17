// The favourite team's matches, and the pure rules the island follows: how a
// kick-off is written in each language's own calendar, when a goal has been
// scored, and what the goal celebration looks like over time.

import type { IslandMode, IslandViewName } from "./layout";
import { N_ } from "../i18n/i18n";

export const FOOTBALL_ID = "integration_football";
export const FOOTBALL_COLOR = "#2DD4BF";

export interface FootballSide {
  id: string;
  name: string;
  short: string;
  score: number | null;
  /** Hex without "#", or "". */
  color: string;
}

export interface FootballGoal {
  minute: string;
  player: string;
  teamId: string;
  ownGoal: boolean;
  penalty: boolean;
}

export interface FootballCard {
  minute: string;
  player: string;
  teamId: string;
  red: boolean;
}

export interface FootballMatch {
  id: string;
  league: string;
  leagueName: string;
  /** ISO 8601 in UTC. */
  date: string;
  state: "pre" | "in" | "post";
  clock: string;
  home: FootballSide;
  away: FootballSide;
  goals: FootballGoal[];
  /** Yellow and red cards in the order they were shown (older builds sent none). */
  cards?: FootballCard[];
}

export interface FootballTeam {
  id: string;
  name: string;
}

export interface FootballTeamHit extends FootballTeam {
  league: string;
}

export interface FootballState {
  enabled: boolean;
  configured: boolean;
  team: FootballTeam | null;
  live: FootballMatch | null;
  upcoming: FootballMatch[];
  recent: FootballMatch[];
  updatedAt: number;
  error: string;
}

export const IDLE_FOOTBALL: FootballState = {
  enabled: false, configured: false, team: null, live: null, upcoming: [], recent: [], updatedAt: 0, error: "",
};

export const Football = {
  state: { ...IDLE_FOOTBALL } as FootballState,
  /** Team id → crest data URL, filled as the page asks for them. */
  logos: new Map<string, string>(),
};

/** English sentences for the short codes the backend reports (the view translates them). */
export const FOOTBALL_ERROR_TEXT: Record<string, string> = {
  network: N_("Could not reach the football service. Check the internet connection."),
  rate_limited: N_("The football service is busy. Trying again soon."),
  bad_response: N_("The football service answered with something unexpected."),
  bad_query: N_("That search is not valid."),
};

// ── Dates: the calendar follows the interface language ────────────────────────

/** "Sun 25 Oct, 20:00" in English; "یکشنبه ۳ آبان، ۲۳:۳۰" (Solar Hijri) in Persian. */
export function formatKickoff(iso: string, lang: "fa" | "en", timeZone?: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    ...(timeZone ? { timeZone } : {}),
  };
  const locale = lang === "fa" ? "fa-IR-u-ca-persian-nu-arabext" : "en-GB-u-ca-gregory";
  return new Intl.DateTimeFormat(locale, opts).format(new Date(t));
}

/** Day and time apart, so the page can keep the clock left-to-right inside Persian text. */
export function kickoffParts(iso: string, lang: "fa" | "en", timeZone?: string): { day: string; time: string } {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return { day: "", time: "" };
  const zone = timeZone ? { timeZone } : {};
  const locale = lang === "fa" ? "fa-IR-u-ca-persian-nu-arabext" : "en-GB-u-ca-gregory";
  const day = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", ...zone }).format(new Date(t));
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false, ...zone }).format(new Date(t));
  return { day, time };
}

/** The same, with the year (for results long past). */
export function formatDay(iso: string, lang: "fa" | "en", timeZone?: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", ...(timeZone ? { timeZone } : {}) };
  const locale = lang === "fa" ? "fa-IR-u-ca-persian-nu-arabext" : "en-GB-u-ca-gregory";
  return new Intl.DateTimeFormat(locale, opts).format(new Date(t));
}

/** "in 2 d", "in 3 h", "in 20 min" — or "" once it is time. */
export function startsIn(iso: string, nowMs: number): { unit: "d" | "h" | "min"; n: number } | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || t <= nowMs) return null;
  const min = Math.ceil((t - nowMs) / 60_000);
  if (min >= 24 * 60) return { unit: "d", n: Math.floor(min / (24 * 60)) };
  if (min >= 60) return { unit: "h", n: Math.floor(min / 60) };
  return { unit: "min", n: Math.max(1, min) };
}

// ── The team's side of a match ────────────────────────────────────────────────

export function ownSide(m: FootballMatch, teamId: string): "home" | "away" | null {
  return m.home.id === teamId ? "home" : m.away.id === teamId ? "away" : null;
}

export function opponentOf(m: FootballMatch, teamId: string): FootballSide {
  return ownSide(m, teamId) === "home" ? m.away : m.home;
}

/** W / D / L for a finished match, from the team's point of view. */
export function resultFor(m: FootballMatch, teamId: string): "W" | "D" | "L" | null {
  const side = ownSide(m, teamId);
  if (!side || m.state !== "post" || m.home.score == null || m.away.score == null) return null;
  const mine = side === "home" ? m.home.score : m.away.score;
  const theirs = side === "home" ? m.away.score : m.home.score;
  return mine > theirs ? "W" : mine < theirs ? "L" : "D";
}

export function teamScore(m: FootballMatch, teamId: string): number | null {
  const side = ownSide(m, teamId);
  return side ? m[side].score : null;
}

// ── Goals ─────────────────────────────────────────────────────────────────────

/**
 * Did the favourite team just score? True only when the same match is in play
 * in both reads and the team's own score went up, so opening the app in the
 * middle of a game, a correction, or the other side scoring never celebrates.
 */
export function teamScored(prev: FootballState, next: FootballState): boolean {
  const teamId = next.team?.id;
  if (!teamId || prev.team?.id !== teamId) return false;
  const a = prev.live, b = next.live;
  if (!a || !b || a.id !== b.id || b.state !== "in") return false;
  const before = teamScore(a, teamId), after = teamScore(b, teamId);
  return before != null && after != null && after > before;
}

/** The latest goal for the team (the player's name for the banner), if known. */
export function lastTeamGoal(m: FootballMatch, teamId: string): FootballGoal | null {
  for (let i = m.goals.length - 1; i >= 0; i--) {
    const g = m.goals[i];
    // An own goal is listed under the team it was credited to; it counts for the team as listed.
    if (g.teamId === teamId) return g;
  }
  return null;
}

// ── The celebration: one timeline the island and its rain both follow ─────────

export const CELEBRATION_MS = 7000;
/** Every other event plays shorter than a goal. */
/** The island grows over the first moments and shrinks over the last. */
const GROW_MS = 450;
const SHRINK_MS = 700;

export interface Celebration {
  startedAt: number;
  /** What happened (a goal when absent) and how long its show lasts. */
  kind?: EventKind;
  ms?: number;
  teamName: string;
  player: string;
  /** "2 – 1" style score line, from the team's point of view first. */
  score: string;
  opponent: string;
}

/** 0…1: how far the island is into its celebration size. */
export function celebrationLevel(c: Celebration | null, nowMs: number): number {
  if (!c) return 0;
  const t = nowMs - c.startedAt;
  const total = c.ms ?? CELEBRATION_MS;
  if (t < 0 || t >= total) return 0;
  if (t < GROW_MS) return easeOut(t / GROW_MS);
  if (t > total - SHRINK_MS) return easeOut((total - t) / SHRINK_MS);
  return 1;
}

export function celebrating(c: Celebration | null, nowMs: number): boolean {
  return c != null && nowMs - c.startedAt < (c.ms ?? CELEBRATION_MS) && nowMs >= c.startedAt;
}

function easeOut(x: number): number {
  const k = Math.min(1, Math.max(0, x));
  return 1 - (1 - k) ** 3;
}

/** Ari cheers whichever view is open, as long as the island is showing. */
export function ariCheers(c: Celebration | null, nowMs: number, mode: IslandMode, view: IslandViewName): boolean {
  return celebrating(c, nowMs) && mode !== "hidden" && view !== "greeting" && styleOf(c).mood === "cheer";
}

/** Ari droops (tired eyes, sweat) for bad news, under the same conditions. */
export function ariGloomy(c: Celebration | null, nowMs: number, mode: IslandMode, view: IslandViewName): boolean {
  return celebrating(c, nowMs) && mode !== "hidden" && view !== "greeting" && styleOf(c).mood === "gloom";
}

/** The island's size while celebrating: from what it was toward the stage, by `level`. */
export function celebrationSize(
  base: { w: number; h: number }, level: number, panel: { w: number; h: number },
  stage: { w: number; h: number } = { w: 720, h: 380 },
) {
  const target = { w: Math.min(panel.w, Math.max(base.w, stage.w)), h: Math.min(panel.h, Math.max(base.h, stage.h)) };
  return {
    w: Math.round(base.w + (target.w - base.w) * level),
    h: Math.round(base.h + (target.h - base.h) * level),
  };
}

// ── Goal rain ────────────────────────────────────────────────────────────────

export interface RainDrop {
  x: number;
  delay: number;
  fall: number;
  size: number;
  spin: number;
  kind: "ball" | "confetti" | "star";
  hue: number;
}

/** A deterministic shower for `count` drops across `width` px, so it can be tested. */
export function makeRain(count: number, width: number, seed = 20261017, ms = CELEBRATION_MS): RainDrop[] {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const kinds: RainDrop["kind"][] = ["ball", "confetti", "confetti", "star"];
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, i) => ({
    x: rnd() * width,
    delay: rnd() * Math.max(0, ms - 2600) * 0.7,
    fall: 1100 + rnd() * 1200,
    size: 9 + rnd() * 13,
    spin: (rnd() - 0.5) * 720,
    kind: i % 6 === 0 ? "ball" : kinds[Math.floor(rnd() * kinds.length)],
    hue: Math.floor(rnd() * 360),
  }));
}

/** Teams offered before anything is typed (ESPN ids, checked against ESPN's own team pages). */
export const POPULAR_TEAMS: readonly FootballTeam[] = [
  { id: "83", name: "Barcelona" }, { id: "86", name: "Real Madrid" }, { id: "382", name: "Manchester City" },
  { id: "364", name: "Liverpool" }, { id: "359", name: "Arsenal" }, { id: "360", name: "Manchester United" },
  { id: "132", name: "Bayern Munich" }, { id: "160", name: "Paris Saint-Germain" }, { id: "111", name: "Juventus" },
  { id: "110", name: "Internazionale" }, { id: "103", name: "AC Milan" }, { id: "124", name: "Borussia Dortmund" },
  { id: "1068", name: "Atlético Madrid" }, { id: "18461", name: "Persepolis" }, { id: "7525", name: "Esteghlal" },
  { id: "469", name: "Iran" },
];

// ── State updates and the goal notice ─────────────────────────────────────────

export interface GoalInfo {
  teamName: string;
  player: string;
  /** The team's score first: "2 – 1". */
  score: string;
  opponent: string;
}

/** What the banner says about the goal the team just scored; null if the page has no such match. */
export function goalInfo(state: FootballState): GoalInfo | null {
  const team = state.team, m = state.live;
  if (!team || !m) return null;
  const mine = teamScore(m, team.id);
  const opp = opponentOf(m, team.id);
  if (mine == null) return null;
  return {
    teamName: team.name,
    player: lastTeamGoal(m, team.id)?.player ?? "",
    score: `${mine} – ${opp.score ?? 0}`,
    opponent: opp.short,
  };
}

// ── Everything that happens in the game ──────────────────────────────────────

export type EventKind =
  | "goal" | "concede" | "yellow" | "red" | "oppYellow" | "oppRed"
  | "kickoff" | "halftime" | "secondHalf" | "fulltimeWin" | "fulltimeDraw" | "fulltimeLoss";

export interface FootballEvent {
  kind: EventKind;
  teamName: string;
  opponent: string;
  /** The player involved, when the feed names one. */
  player: string;
  minute: string;
  /** The team's score first: "2 – 1"; empty before the game has a score. */
  score: string;
  /** Goals scored since the last read (two goals between two reads count 2). */
  count: number;
}

export type Tone = "gold" | "red" | "amber" | "green" | "blue" | "teal";
export type Rain = "party" | "balls" | "cardY" | "cardR" | "drip" | "none";

export interface EventStyle {
  /** The headline on the island (an English key; the island translates it). */
  word: string;
  ms: number;
  /** The size the island grows toward. */
  stage: { w: number; h: number };
  tone: Tone;
  rain: Rain;
  sound: "goal" | "whistle" | "card" | "groan";
  emote: "love" | "surprised" | "proud" | "wink" | "yawn" | "happy" | "annoyed";
  mood: "cheer" | "gloom" | null;
  /** Higher interrupts lower. */
  priority: number;
}

export const EVENT_STYLE: Record<EventKind, EventStyle> = {
  goal: { word: N_("GOAL!"), ms: CELEBRATION_MS, stage: { w: 720, h: 380 }, tone: "gold", rain: "party", sound: "goal", emote: "proud", mood: "cheer", priority: 4 },
  concede: { word: N_("GOAL CONCEDED"), ms: 5000, stage: { w: 640, h: 320 }, tone: "blue", rain: "drip", sound: "groan", emote: "annoyed", mood: "gloom", priority: 2 },
  yellow: { word: N_("YELLOW CARD"), ms: 4200, stage: { w: 600, h: 290 }, tone: "amber", rain: "cardY", sound: "card", emote: "surprised", mood: null, priority: 1 },
  red: { word: N_("RED CARD!"), ms: 5500, stage: { w: 660, h: 340 }, tone: "red", rain: "cardR", sound: "card", emote: "surprised", mood: "gloom", priority: 3 },
  oppYellow: { word: N_("YELLOW CARD FOR THE OPPONENT"), ms: 4200, stage: { w: 600, h: 290 }, tone: "amber", rain: "cardY", sound: "card", emote: "wink", mood: null, priority: 1 },
  oppRed: { word: N_("OPPONENT SENT OFF!"), ms: 5500, stage: { w: 680, h: 340 }, tone: "red", rain: "cardR", sound: "card", emote: "happy", mood: "cheer", priority: 3 },
  kickoff: { word: N_("KICK-OFF!"), ms: 5000, stage: { w: 680, h: 340 }, tone: "green", rain: "balls", sound: "whistle", emote: "happy", mood: "cheer", priority: 2 },
  halftime: { word: N_("HALF-TIME"), ms: 4200, stage: { w: 600, h: 290 }, tone: "teal", rain: "none", sound: "whistle", emote: "wink", mood: null, priority: 1 },
  secondHalf: { word: N_("SECOND HALF"), ms: 4200, stage: { w: 600, h: 290 }, tone: "green", rain: "balls", sound: "whistle", emote: "happy", mood: null, priority: 1 },
  fulltimeWin: { word: N_("FULL TIME: WIN!"), ms: CELEBRATION_MS, stage: { w: 720, h: 380 }, tone: "gold", rain: "party", sound: "goal", emote: "proud", mood: "cheer", priority: 3 },
  fulltimeDraw: { word: N_("FULL TIME: DRAW"), ms: 4800, stage: { w: 640, h: 320 }, tone: "teal", rain: "none", sound: "whistle", emote: "wink", mood: null, priority: 2 },
  fulltimeLoss: { word: N_("FULL TIME: LOSS"), ms: 5200, stage: { w: 640, h: 320 }, tone: "blue", rain: "drip", sound: "groan", emote: "annoyed", mood: "gloom", priority: 2 },
};

/** A team's shirt: broad stripes of `a` and `b`, or a solid `a`; collar, badge and number in `trim`. */
export interface Kit {
  pattern: "stripes" | "solid";
  a: string;
  b: string;
  trim: string;
}

/** The real home shirts of the teams on offer (ESPN ids), so each looks like itself. */
export const TEAM_KITS: Readonly<Record<string, Kit>> = {
  "83": { pattern: "stripes", a: "#A50044", b: "#004D98", trim: "#EDBB00" },     // Barcelona: blue and garnet
  "86": { pattern: "solid", a: "#FFFFFF", b: "#F1F1F1", trim: "#111111" },        // Real Madrid: white, black detail
  "382": { pattern: "solid", a: "#6CABDD", b: "#5E9CCB", trim: "#FFFFFF" },       // Manchester City
  "364": { pattern: "solid", a: "#D00027", b: "#BB0022", trim: "#FFFFFF" },       // Liverpool
  "359": { pattern: "solid", a: "#EF0107", b: "#D6000A", trim: "#FFFFFF" },       // Arsenal
  "360": { pattern: "solid", a: "#DA020E", b: "#C4010C", trim: "#FBE122" },       // Manchester United
  "132": { pattern: "solid", a: "#DC052D", b: "#C70428", trim: "#FFFFFF" },       // Bayern Munich
  "160": { pattern: "solid", a: "#0A1F5C", b: "#081A4E", trim: "#DA291C" },       // Paris Saint-Germain
  "111": { pattern: "stripes", a: "#111111", b: "#FFFFFF", trim: "#D4AF37" },     // Juventus
  "110": { pattern: "stripes", a: "#0068A8", b: "#101820", trim: "#D4AF37" },     // Internazionale
  "103": { pattern: "stripes", a: "#D3122B", b: "#101010", trim: "#FFFFFF" },     // AC Milan
  "124": { pattern: "solid", a: "#FDE100", b: "#EBCF00", trim: "#111111" },       // Borussia Dortmund
  "1068": { pattern: "stripes", a: "#CB3524", b: "#FFFFFF", trim: "#1B3D8F" },    // Atlético Madrid
  "7525": { pattern: "solid", a: "#1D5FD8", b: "#1A54C2", trim: "#FFFFFF" },      // Esteghlal
  "18461": { pattern: "solid", a: "#E51243", b: "#CC0F3B", trim: "#111111" },     // Persepolis
  "469": { pattern: "solid", a: "#FFFFFF", b: "#F1F1F1", trim: "#DA0000" },       // Iran
};

const lumOf = (hex: string) => {
  const v = parseInt(hex.slice(1), 16);
  return (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
};

/** The favourite team's kit: its real shirt when known, else a solid shirt in the colour ESPN gives it. */
export function kitFor(m: FootballMatch, teamId: string): Kit {
  const known = TEAM_KITS[teamId];
  if (known) return known;
  const side = ownSide(m, teamId);
  const c = side ? m[side].color : "";
  const a = /^[0-9a-fA-F]{6}$/.test(c) ? "#" + c : "#2DD4BF";
  return { pattern: "solid", a, b: a, trim: lumOf(a) > 0.78 ? "#1E293B" : "#F8FAFC" };
}

/**
 * The kit Ari wears in the Football section, game or no game: the favourite team's
 * known kit, else the colour its matches carry (live, next, last), else teal.
 */
export function kitForState(s: FootballState): Kit | null {
  if (!s.enabled || !s.team) return null;
  const m = s.live ?? s.upcoming.find((x) => ownSide(x, s.team!.id)) ?? s.recent.find((x) => ownSide(x, s.team!.id));
  if (m) return kitFor(m, s.team.id);
  return TEAM_KITS[s.team.id] ?? kitFor({ home: { id: "", color: "" }, away: { id: "", color: "" } } as unknown as FootballMatch, s.team.id);
}

/** The style of a running show (a goal's when it carries no kind). */
export function styleOf(c: Celebration | null): EventStyle {
  return EVENT_STYLE[c?.kind ?? "goal"];
}

const isHalfTime = (clock: string) => /^(ht|half)/i.test(clock.trim());

/**
 * What happened between two reads of the favourite team's game: goals for and
 * against (several between reads count together), new cards, kick-off,
 * half-time, the second half and the final whistle. Opening the app in the
 * middle of a game, a different game or a correction never reports anything.
 */
export function detectEvents(prev: FootballState, next: FootballState): FootballEvent[] {
  const team = next.team;
  if (!team || prev.team?.id !== team.id) return [];
  const a = prev.live, b = next.live;
  const out: FootballEvent[] = [];
  const make = (kind: EventKind, m: FootballMatch, extra: Partial<FootballEvent> = {}): FootballEvent => {
    const mine = teamScore(m, team.id), opp = opponentOf(m, team.id);
    return {
      kind, teamName: team.name, opponent: opp.short, player: "", minute: "", count: 1,
      score: mine == null || opp.score == null ? "" : `${mine} – ${opp.score}`, ...extra,
    };
  };

  if (b && b.state === "in" && a && a.id === b.id) {
    const mineBefore = teamScore(a, team.id), mineAfter = teamScore(b, team.id);
    const oppBefore = opponentOf(a, team.id).score, oppAfter = opponentOf(b, team.id).score;
    if (mineBefore != null && mineAfter != null && mineAfter > mineBefore) {
      const g = lastTeamGoal(b, team.id);
      out.push(make("goal", b, { player: g?.player ?? "", minute: g?.minute ?? "", count: mineAfter - mineBefore }));
    }
    if (oppBefore != null && oppAfter != null && oppAfter > oppBefore) {
      const g = [...b.goals].reverse().find((x) => x.teamId === opponentOf(b, team.id).id);
      out.push(make("concede", b, { player: g?.player ?? "", minute: g?.minute ?? "", count: oppAfter - oppBefore }));
    }
    const oldCards = (a.cards ?? []).length;
    for (const c of (b.cards ?? []).slice(oldCards, oldCards + 4)) {
      const mine = c.teamId === team.id;
      out.push(make(mine ? (c.red ? "red" : "yellow") : (c.red ? "oppRed" : "oppYellow"), b, { player: c.player, minute: c.minute }));
    }
    if (!isHalfTime(a.clock) && isHalfTime(b.clock)) out.push(make("halftime", b));
    if (isHalfTime(a.clock) && !isHalfTime(b.clock)) out.push(make("secondHalf", b));
  } else if (b && b.state === "in" && !a && prev.configured && prev.upcoming.some((m) => m.id === b.id)) {
    out.push(make("kickoff", b));
  }

  if (a && (!b || b.id !== a.id || b.state !== "in")) {
    const done = next.recent.find((m) => m.id === a.id && m.state === "post");
    const result = done ? resultFor(done, team.id) : null;
    if (done && result) out.push(make(result === "W" ? "fulltimeWin" : result === "L" ? "fulltimeLoss" : "fulltimeDraw", done));
  }
  return out;
}

let eventListener: ((e: FootballEvent) => void) | null = null;

/** The island registers here to react; returns the unsubscribe. */
export function onFootballEvent(listener: (e: FootballEvent) => void): () => void {
  eventListener = listener;
  return () => { if (eventListener === listener) eventListener = null; };
}

/** Every new state goes through here, so an event is noticed whichever path brought it. */
export function setFootballState(next: FootballState): boolean {
  const prev = Football.state;
  Football.state = next;
  const events = detectEvents(prev, next);
  for (const e of events) eventListener?.(e);
  return events.length > 0;
}
