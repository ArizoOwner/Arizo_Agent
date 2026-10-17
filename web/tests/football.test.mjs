// The football page's rules: calendars, who scored, the celebration timeline, the view.

import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom } from "./fakedom.mjs";

installFakeDom();

const F = await import("../src/core/football.ts");
const { State } = await import("../src/core/state.ts");
const { setLanguage } = await import("../src/i18n/i18n.ts");
const { buildFootball } = await import("../src/views/football.ts");
const { Bridge } = await import("../src/core/bridge.ts");

const side = (id, score) => ({ id, name: id, short: id, score, color: "" });
const match = (over = {}) => ({
  id: "1", league: "esp.1", leagueName: "LALIGA", date: "2026-10-25T20:00Z", state: "in", clock: "67'",
  home: side("83", 1), away: side("86", 1), goals: [], ...over,
});
const state = (m, over = {}) => ({
  ...F.IDLE_FOOTBALL, enabled: true, configured: true, team: { id: "83", name: "Barcelona" }, live: m, ...over,
});

test("a kick-off is written in the calendar of the interface language", () => {
  const fa = F.formatKickoff("2026-10-25T20:00Z", "fa", "Asia/Tehran");
  const en = F.formatKickoff("2026-10-25T20:00Z", "en", "UTC");
  assert.match(fa, /آبان/, "Solar Hijri month name");
  assert.match(fa, /[۰-۹]/, "Persian digits");
  assert.doesNotMatch(fa, /Oct/);
  assert.match(en, /Oct/);
  assert.match(en, /20:00/);
  assert.doesNotMatch(en, /[۰-۹]/);
  assert.equal(F.formatKickoff("nonsense", "fa"), "");
  const p = F.kickoffParts("2026-10-25T20:00Z", "fa", "Asia/Tehran");
  assert.ok(p.day && p.time, "day and time come apart");
});

test("the time zone shifts the hour: Tehran is 3 h 30 min ahead of UTC", () => {
  assert.match(F.formatKickoff("2026-10-25T20:00Z", "en", "Asia/Tehran"), /23:30/);
});

test("how long until kick-off", () => {
  const now = Date.parse("2026-10-25T10:00:00Z");
  assert.deepEqual(F.startsIn("2026-10-27T10:00Z", now), { unit: "d", n: 2 });
  assert.deepEqual(F.startsIn("2026-10-25T13:00Z", now), { unit: "h", n: 3 });
  assert.deepEqual(F.startsIn("2026-10-25T10:20Z", now), { unit: "min", n: 20 });
  assert.equal(F.startsIn("2026-10-25T09:00Z", now), null, "already started");
  assert.equal(F.startsIn("x", now), null);
});

test("results are told from the favourite team's side", () => {
  const home = match({ state: "post", home: side("83", 3), away: side("2922", 0) });
  const away = match({ state: "post", home: side("243", 1), away: side("83", 3) });
  const draw = match({ state: "post", home: side("83", 1), away: side("86", 1) });
  const lost = match({ state: "post", home: side("83", 0), away: side("86", 2) });
  assert.deepEqual([home, away, draw, lost].map((m) => F.resultFor(m, "83")), ["W", "W", "D", "L"]);
  assert.equal(F.resultFor(match(), "83"), null, "a live game has no result yet");
  assert.equal(F.resultFor(home, "999"), null);
  assert.equal(F.teamScore(away, "83"), 3);
  assert.equal(F.opponentOf(away, "83").id, "243");
});

test("only the favourite team scoring in the same live game is a goal", () => {
  const before = state(match());
  assert.equal(F.teamScored(before, state(match({ home: side("83", 2) }))), true);
  assert.equal(F.teamScored(before, state(match({ away: side("86", 2) }))), false, "the other side scoring");
  assert.equal(F.teamScored(before, state(match())), false, "nothing changed");
  assert.equal(F.teamScored(F.IDLE_FOOTBALL, state(match({ home: side("83", 3) }))), false, "app opened mid-game");
  assert.equal(F.teamScored(state(null), state(match({ home: side("83", 1) }))), false, "game just started");
  assert.equal(F.teamScored(before, state(match({ id: "2", home: side("83", 5) }))), false, "a different game");
  assert.equal(F.teamScored(before, state(match({ state: "post", home: side("83", 2) }))), false, "the game is over");
  assert.equal(F.teamScored(before, state(match({ home: side("83", 0) }))), false, "a correction downwards");
  assert.equal(F.teamScored(before, state(match({ home: side("83", null) }))), false);
  // the away side counts too
  const away = state(match({ home: side("86", 0), away: side("83", 0) }));
  assert.equal(F.teamScored(away, state(match({ home: side("86", 0), away: side("83", 1) }))), true);
  // a different favourite team never celebrates for the old one
  assert.equal(F.teamScored(before, { ...state(match({ home: side("83", 2) })), team: { id: "86", name: "x" } }), false);
});

test("the goal banner names the scorer and the score from the team's side", () => {
  const m = match({
    home: side("86", 1), away: side("83", 2),
    goals: [
      { minute: "10'", player: "A. Other", teamId: "86", ownGoal: false, penalty: false },
      { minute: "67'", player: "L. Yamal", teamId: "83", ownGoal: false, penalty: false },
    ],
  });
  const info = F.goalInfo(state(m));
  assert.deepEqual(info, { teamName: "Barcelona", player: "L. Yamal", score: "2 – 1", opponent: "86" });
  assert.equal(F.goalInfo(state(null)), null);
});

test("setFootballState tells the island about a goal exactly once", () => {
  const heard = [];
  const off = F.onFootballEvent((e) => heard.push(e));
  F.Football.state = { ...F.IDLE_FOOTBALL };
  F.setFootballState(state(match()));
  assert.equal(heard.length, 0, "the first read never celebrates");
  assert.equal(F.setFootballState(state(match({ home: side("83", 2) }))), true);
  assert.equal(F.setFootballState(state(match({ home: side("83", 2) }))), false, "the same score again");
  assert.equal(heard.length, 1);
  assert.equal(heard[0].kind, "goal");
  off();
  assert.equal(F.setFootballState(state(match({ home: side("83", 3) }))), true);
  assert.equal(heard.length, 1, "unsubscribed");
  F.Football.state = { ...F.IDLE_FOOTBALL };
});

test("the celebration grows, holds, shrinks and ends", () => {
  const c = { startedAt: 1000, teamName: "x", player: "", score: "1 – 0", opponent: "y" };
  assert.equal(F.celebrationLevel(null, 1000), 0);
  assert.equal(F.celebrationLevel(c, 999), 0, "not started");
  assert.equal(F.celebrationLevel(c, 1000), 0);
  assert.ok(F.celebrationLevel(c, 1200) > 0 && F.celebrationLevel(c, 1200) < 1, "growing");
  assert.equal(F.celebrationLevel(c, 3500), 1, "holding");
  const late = F.celebrationLevel(c, 1000 + F.CELEBRATION_MS - 300);
  assert.ok(late > 0 && late < 1, "shrinking");
  assert.equal(F.celebrationLevel(c, 1000 + F.CELEBRATION_MS), 0, "over");
  assert.equal(F.celebrating(c, 3000), true);
  assert.equal(F.celebrating(c, 1000 + F.CELEBRATION_MS), false);
  assert.equal(F.celebrating(null, 3000), false);
});

test("Ari cheers on any view while the island shows, but not behind the greeting or when hidden", () => {
  const c = { startedAt: 0, teamName: "x", player: "", score: "", opponent: "" };
  assert.equal(F.ariCheers(c, 1000, "expanded", "translate"), true);
  assert.equal(F.ariCheers(c, 1000, "compact", "translate"), true);
  assert.equal(F.ariCheers(c, 1000, "hidden", "translate"), false);
  assert.equal(F.ariCheers(c, 1000, "expanded", "greeting"), false);
  assert.equal(F.ariCheers(c, F.CELEBRATION_MS + 1, "expanded", "translate"), false);
});

test("the island grows toward the stage and never past the window", () => {
  const panel = { w: 920, h: 520 };
  assert.deepEqual(F.celebrationSize({ w: 288, h: 32 }, 0, panel), { w: 288, h: 32 });
  const full = F.celebrationSize({ w: 288, h: 32 }, 1, panel);
  assert.ok(full.w >= 720 && full.h >= 380 && full.w <= 920 && full.h <= 520);
  assert.deepEqual(F.celebrationSize({ w: 860, h: 520 }, 1, panel), { w: 860, h: 520 }, "already big: stays");
});

test("the rain is deterministic, bounded and made of the three kinds", () => {
  const a = F.makeRain(40, 800), b = F.makeRain(40, 800);
  assert.deepEqual(a, b);
  assert.equal(a.length, 40);
  assert.ok(a.every((d) => d.x >= 0 && d.x <= 800 && d.delay >= 0 && d.delay < F.CELEBRATION_MS && d.fall > 0 && d.size > 0));
  assert.deepEqual([...new Set(a.map((d) => d.kind))].sort(), ["ball", "confetti", "star"]);
  assert.equal(F.makeRain(-3, 100).length, 0);
});

test("a team to choose from is offered before anything is typed", () => {
  assert.ok(F.POPULAR_TEAMS.length >= 10);
  assert.ok(F.POPULAR_TEAMS.every((t) => /^\d+$/.test(t.id) && t.name));
  assert.equal(new Set(F.POPULAR_TEAMS.map((t) => t.id)).size, F.POPULAR_TEAMS.length);
});

test("errors from the service become sentences, in both languages", async () => {
  const { footballErrorText } = await import("../src/views/football.ts");
  assert.match(footballErrorText("network"), /internet/);
  assert.match(footballErrorText("http_503"), /503/);
  assert.match(footballErrorText("???"), /unexpected/);
  setLanguage("fa");
  try {
    assert.match(footballErrorText("network"), /[آ-ی]/);
    assert.match(footballErrorText("http_503"), /۵۰۳|503/);
  } finally {
    setLanguage("en");
  }
});

test("with no team chosen the page asks for one, and choosing saves it", async (t) => {
  State.settings.footballEnabled = true;
  State.settings.footballTeamId = "";
  F.Football.state = { ...F.IDLE_FOOTBALL };
  const saved = [];
  t.mock.method(Bridge, "saveSettings", async (patch) => { saved.push(patch); return { ok: true, settings: { ...State.settings, ...patch } }; });
  t.mock.method(Bridge, "footballRefresh", async () => null);
  t.mock.method(Bridge, "footballLogo", async () => null);
  const view = buildFootball();
  assert.equal(view.el.querySelector(".fb-picker").style.display, "");
  assert.equal(view.el.querySelector(".fb-page").style.display, "none");
  const chips = view.el.querySelector(".fb-chips").children;
  assert.ok(chips.length >= 10, "popular teams are offered");
  chips[0].fire("click");
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(saved[0], { footballTeamId: F.POPULAR_TEAMS[0].id, footballTeamName: F.POPULAR_TEAMS[0].name, footballEnabled: true });
  assert.equal(State.settings.footballTeamId, F.POPULAR_TEAMS[0].id);
  State.settings.footballTeamId = "";
});

test("the page and the island stay in step with the settings", () => {
  F.Football.state = { ...F.IDLE_FOOTBALL };
  State.settings.footballEnabled = false;
  const view = buildFootball();
  assert.equal(view.el.querySelector(".fb-empty-title").textContent, "Football is turned off");
  assert.equal(view.el.querySelector(".fb-picker").style.display, "none");
  assert.equal(view.el.querySelector(".fb-page").style.display, "none");
  State.settings.footballEnabled = true;
});

const card = (teamId, red = false, minute = "30'") => ({ minute, player: "P. Player", teamId, red });
const kinds = (a, b) => F.detectEvents(a, b).map((e) => e.kind);

test("every kind of event in the favourite team's game is told apart", () => {
  const base = state(match());
  assert.deepEqual(kinds(base, state(match({ home: side("83", 2) }))), ["goal"]);
  assert.deepEqual(kinds(base, state(match({ away: side("86", 2) }))), ["concede"]);
  assert.deepEqual(kinds(base, state(match({ cards: [card("83")] }))), ["yellow"]);
  assert.deepEqual(kinds(base, state(match({ cards: [card("83", true)] }))), ["red"]);
  assert.deepEqual(kinds(base, state(match({ cards: [card("86")] }))), ["oppYellow"]);
  assert.deepEqual(kinds(base, state(match({ cards: [card("86", true)] }))), ["oppRed"]);
  assert.deepEqual(kinds(base, state(match({ clock: "HT" }))), ["halftime"]);
  assert.deepEqual(kinds(state(match({ clock: "HT" })), state(match({ clock: "46'" }))), ["secondHalf"]);
});

test("two goals between two reads are one event that counts both", () => {
  const e = F.detectEvents(state(match()), state(match({ home: side("83", 3) })));
  assert.equal(e.length, 1);
  assert.equal(e[0].count, 2);
  assert.equal(e[0].score, "3 – 1");
});

test("a goal and a card in the same read are both reported, and old cards are not", () => {
  const before = state(match({ cards: [card("83")] }));
  const after = state(match({ home: side("83", 2), cards: [card("83"), card("86", true, "66'")] }));
  assert.deepEqual(kinds(before, after), ["goal", "oppRed"]);
  assert.deepEqual(kinds(after, after), []);
});

test("kick-off is told when an upcoming game turns live, not when the app opens mid-game", () => {
  const upcoming = state(null, { upcoming: [match({ state: "pre", clock: "" })] });
  assert.deepEqual(kinds(upcoming, state(match({ clock: "1'" }))), ["kickoff"]);
  assert.deepEqual(kinds(F.IDLE_FOOTBALL, state(match())), []);
  assert.deepEqual(kinds(state(null), state(match())), [], "a game never seen coming");
});

test("the final whistle gives win, draw or loss from the team's side", () => {
  const live = state(match({ home: side("83", 2), away: side("86", 1) }));
  const done = (h, a) => state(null, { recent: [match({ state: "post", clock: "FT", home: side("83", h), away: side("86", a) })] });
  assert.deepEqual(kinds(live, done(2, 1)), ["fulltimeWin"]);
  assert.deepEqual(kinds(live, done(1, 1)), ["fulltimeDraw"]);
  assert.deepEqual(kinds(live, done(0, 1)), ["fulltimeLoss"]);
  assert.deepEqual(kinds(live, state(null)), [], "the game vanished from the feed: nothing is invented");
});

test("a different favourite team never reacts to the old team's game", () => {
  const before = state(match());
  assert.deepEqual(F.detectEvents(before, { ...state(match({ home: side("83", 2) })), team: { id: "86", name: "x" } }), []);
});

test("every event has a style, a Persian headline and shows no longer than a goal", async () => {
  const fa = JSON.parse((await import("node:fs")).readFileSync(new URL("../src/i18n/extra.json", import.meta.url), "utf8")).strings;
  for (const [kind, s] of Object.entries(F.EVENT_STYLE)) {
    assert.ok(fa[s.word]?.fa, kind + " has a Persian headline");
    assert.ok(s.ms > 2500 && s.ms <= F.CELEBRATION_MS, kind);
    assert.ok(s.stage.w <= 920 && s.stage.h <= 520, kind);
  }
});

test("a shorter show ends sooner and its mood follows the event", () => {
  const c = { startedAt: 0, kind: "yellow", ms: F.EVENT_STYLE.yellow.ms, teamName: "x", player: "", score: "", opponent: "" };
  assert.equal(F.celebrating(c, 4000), true);
  assert.equal(F.celebrating(c, 4300), false);
  assert.equal(F.ariCheers(c, 1000, "expanded", "translate"), false, "a yellow card is not a cheer");
  const loss = { ...c, kind: "concede", ms: 5000 };
  assert.equal(F.ariGloomy(loss, 1000, "expanded", "translate"), true);
  assert.equal(F.ariCheers(loss, 1000, "expanded", "translate"), false);
});

test("each known team wears its real shirt, any other the colour ESPN gives, else teal", () => {
  const barca = F.kitFor(match(), "83");
  assert.deepEqual([barca.pattern, barca.a, barca.b], ["stripes", "#A50044", "#004D98"], "garnet and blue stripes");
  const madrid = F.kitFor(match(), "86");
  assert.deepEqual([madrid.pattern, madrid.a, madrid.trim], ["solid", "#FFFFFF", "#111111"], "white with black detail");
  assert.equal(F.kitFor(match(), "111").pattern, "stripes", "Juventus");
  const other = F.kitFor(match({ home: { ...side("777", 0), color: "336699" } }), "777");
  assert.deepEqual([other.pattern, other.a, other.trim], ["solid", "#336699", "#F8FAFC"]);
  const pale = F.kitFor(match({ home: { ...side("777", 0), color: "f5f5f5" } }), "777");
  assert.equal(pale.trim, "#1E293B", "a pale shirt gets dark detail");
  assert.equal(F.kitFor(match(), "999").a, "#2DD4BF");
  for (const id of F.POPULAR_TEAMS.map((t) => t.id)) assert.ok(F.TEAM_KITS[id], id + " has a kit");
});

test("the Football section's kit is known without a game: from the team, else its matches, else nothing", () => {
  const base = { enabled: true, configured: true, team: { id: "83", name: "Barcelona" }, live: null, upcoming: [], recent: [], updatedAt: 0, error: "" };
  assert.equal(F.kitForState(base).pattern, "stripes", "no game, still Barça's shirt");
  assert.equal(F.kitForState({ ...base, enabled: false }), null, "feature off");
  assert.equal(F.kitForState({ ...base, team: null }), null, "no team");
  const other = F.kitForState({ ...base, team: { id: "777", name: "X" }, upcoming: [match({ home: { ...side("777", 0), color: "336699" } })] });
  assert.equal(other.a, "#336699", "an unknown team takes the colour its matches carry");
});

test("a show keeps the compact island up until it is over, then it hides after its usual delay", async () => {
  const { IslandStateMachine } = await import("../src/island/fsm.ts");
  const fsm = new IslandStateMachine();
  fsm.petitToHiddenDelay = 0.03;
  fsm.mouseEntered();
  assert.equal(fsm.state, "petit");
  fsm.holdPetit();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(fsm.state, "petit", "held: it did not hide");
  fsm.releasePetit();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(fsm.state, "hidden", "released: hides again");
  // from hidden, an event reveals it and holds it
  fsm.reveal();
  fsm.holdPetit();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(fsm.state, "petit");
  fsm.cancelTimers();
});
