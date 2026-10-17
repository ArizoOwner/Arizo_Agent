// The football page, in the spirit of FotMob: the live score on top, then what
// is next and what just happened. Before anything it asks for a favourite team.
// Dates follow the interface language: Solar Hijri in Persian, Gregorian in
// English (core/football.ts).

import { h, clear } from "./dom";
import { card } from "./parts";
import { ICONS } from "./icons";
import { svg } from "./dom";
import { Bridge } from "../core/bridge";
import { State, mergeSettings } from "../core/state";
import {
  FOOTBALL_ERROR_TEXT, Football, POPULAR_TEAMS, formatDay, kickoffParts, opponentOf, ownSide, resultFor, setFootballState,
  startsIn, teamScore, type FootballMatch, type FootballSide, type FootballTeam, type FootballTeamHit,
} from "../core/football";
import { language, t, tl } from "../i18n/i18n";
import type { ViewHost } from "./views";

export function footballErrorText(code: string): string {
  const text = FOOTBALL_ERROR_TEXT[code];
  if (text) return t(text);
  if (/^http_\d+$/.test(code)) return t("The football service answered with an error ({code}).", { code: code.slice(5) });
  return t("The football service answered with something unexpected.");
}

export function buildFootball(): ViewHost {
  let searchTimer: number | null = null;
  let searchSeq = 0;
  let hits: FootballTeamHit[] = [];
  let searching = false;
  let choosing = false;
  let refreshInFlight: Promise<void> | null = null;
  let error = "";
  let shownKey = "";

  // ── Picker ─────────────────────────────────────────────────────────────────
  const input = h("input", {
    class: "fb-search", type: "text", dir: "auto", spellcheck: false, autocomplete: "off",
    placeholder: tl("Search a team or a national side"), "aria-label": tl("Search a team or a national side"),
    onfocus: () => void Bridge.focusWindow(true),
  });
  const chips = h("div", { class: "fb-chips" });
  const pickerNote = h("div", { class: "fb-note" });
  const picker = h("div", { class: "fb-picker" },
    h("div", { class: "fb-picker-title", text: tl("Choose your favourite team") }),
    h("div", { class: "fb-picker-hint", text: tl("Live scores and the next matches of that team appear here. When it scores, the island celebrates.") }),
    input, chips, pickerNote);

  // ── Team page ──────────────────────────────────────────────────────────────
  const teamName = h("span", { class: "fb-team-name", dir: "auto" });
  const teamCrest = h("span", { class: "fb-crest fb-crest-lg", "aria-hidden": "true" });
  const changeBtn = h("button", { class: "fb-link", type: "button", onclick: () => { choosing = true; sync(); input.focus(); } }, tl("Change team"));
  const refreshBtn = h("button", { class: "fb-icon", type: "button", title: tl("Refresh"), "aria-label": tl("Refresh"), onclick: () => void refresh(true) }, svg(ICONS.arrowClockwise, 14, { stroke: 1.8 }));
  const liveBox = h("div", { class: "fb-live" });
  const nextBox = h("div", { class: "fb-col" });
  const lastBox = h("div", { class: "fb-col" });
  const status = h("span", { class: "fb-status" });
  const notice = h("div", { class: "fb-error", role: "alert" });
  const page = h("div", { class: "fb-page" },
    h("div", { class: "fb-team" }, teamCrest, teamName, status),
    liveBox,
    h("div", { class: "fb-lists" }, nextBox, lastBox));

  const emptyTitle = h("div", { class: "fb-empty-title" });
  const emptyHint = h("div", { class: "fb-empty-hint" });
  const empty = h("div", { class: "fb-empty" }, emptyTitle, emptyHint);
  const el = h("div", { class: "view football-view" }, card("green",
    h("div", { class: "fb-shell" },
      h("div", { class: "fb-heading" },
        h("span", { class: "fb-brand", text: tl("Football") }),
        h("div", { class: "fb-heading-actions" }, changeBtn, refreshBtn)),
      picker, page, empty, notice)));

  // ── Data ───────────────────────────────────────────────────────────────────
  async function refresh(showError = false): Promise<void> {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      const state = await Bridge.footballRefresh();
      if (state && State.settings.footballEnabled) {
        setFootballState(state);
        State.notify();
      } else if (showError && !state) {
        error = "network";
      }
      sync();
    })().finally(() => { refreshInFlight = null; });
    return refreshInFlight;
  }

  async function crest(id: string, name: string, el: HTMLElement) {
    el.dataset.id = id;
    const initial = Array.from(name.trim())[0]?.toUpperCase() ?? "";
    setCrest(el, "", initial);
    if (!id) return;
    const known = Football.logos.get(id);
    if (known !== undefined) { setCrest(el, known, initial); return; }
    const data = await Bridge.footballLogo(id);
    Football.logos.set(id, data ?? "");
    if (el.dataset.id === id) setCrest(el, data ?? "", initial);
  }
  function setCrest(el: HTMLElement, data: string, initial: string) {
    if (data.startsWith("data:image/")) {
      el.style.backgroundImage = "url(" + data + ")";
      el.textContent = "";
      el.classList.remove("plain");
    } else {
      el.style.backgroundImage = "";
      el.textContent = initial;
      el.classList.add("plain");
    }
  }
  function crestImg(id: string, name: string, large = false): HTMLElement {
    const el = h("span", { class: large ? "fb-crest fb-crest-lg" : "fb-crest", "aria-hidden": "true" });
    void crest(id, name, el);
    return el;
  }

  async function choose(team: FootballTeam) {
    if (!team.id) return;
    const saved = await Bridge.saveSettings({ footballTeamId: team.id, footballTeamName: team.name, footballEnabled: true });
    if (saved?.ok) {
      State.settings = mergeSettings(State.settings, saved.settings);
      choosing = false;
      error = "";
      input.value = "";
      hits = [];
      sync();
      State.notify();
      void refresh();
    }
  }

  function runSearch(query: string) {
    const seq = ++searchSeq;
    if (query.trim().length < 2) { hits = []; searching = false; error = ""; paintChips(); return; }
    searching = true;
    paintChips();
    Bridge.footballSearch(query.trim()).then((found) => {
      if (seq !== searchSeq) return;
      hits = found;
      error = "";
    }).catch((e) => {
      if (seq !== searchSeq) return;
      hits = [];
      error = String(e instanceof Error ? e.message : e).replace(/^Error:\s*/, "");
    }).finally(() => {
      if (seq !== searchSeq) return;
      searching = false;
      paintChips();
      sync();
    });
  }

  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape" && State.settings.footballTeamId) { choosing = false; sync(); }
  });
  input.addEventListener("input", () => {
    if (searchTimer != null) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => { searchTimer = null; runSearch(input.value); }, 280);
  });

  function paintChips() {
    clear(chips);
    const list: FootballTeam[] = (input.value ?? "").trim().length >= 2 ? hits : [...POPULAR_TEAMS];
    for (const team of list) {
      chips.append(h("button", { class: "fb-chip", type: "button", onclick: () => void choose(team) },
        crestImg(team.id, team.name), h("span", { text: team.name, dir: "auto" })));
    }
    pickerNote.textContent = searching ? t("Searching…")
      : (input.value ?? "").trim().length >= 2 && hits.length === 0 && !error ? t("No team found.") : "";
  }

  // ── Rows ───────────────────────────────────────────────────────────────────
  const lang = () => (language() === "fa" ? "fa" : "en") as "fa" | "en";
  const digits = (n: number | string) => new Intl.NumberFormat(lang() === "fa" ? "fa-IR" : "en-GB", { useGrouping: false }).format(Number(n));

  function sideBlock(side: FootballSide, mine: boolean, reverse = false): HTMLElement {
    return h("div", { class: `fb-side${mine ? " mine" : ""}${reverse ? " rev" : ""}` },
      crestImg(side.id, side.short, true), h("span", { class: "fb-side-name", text: side.short, dir: "auto" }));
  }

  function liveCard(m: FootballMatch, teamId: string): HTMLElement {
    const score = (s: number | null) => (s == null ? "–" : digits(s));
    const goals = m.goals.slice(-3).map((g) => h("span", { class: "fb-goal" },
      `${digits(g.minute.replace(/\D+$/, "") || g.minute)}′ ${g.player}${g.ownGoal ? ` (${t("own goal")})` : g.penalty ? ` (${t("pen.")})` : ""}`));
    return h("div", { class: "fb-live-card", dir: "ltr" },
      h("div", { class: "fb-live-top" },
        h("span", { class: "fb-live-badge" }, h("i", {}), t("LIVE")),
        h("span", { class: "fb-live-clock", text: m.clock }),
        h("span", { class: "fb-league", text: m.leagueName, dir: "auto" })),
      h("div", { class: "fb-score-row" },
        sideBlock(m.home, ownSide(m, teamId) === "home"),
        h("div", { class: "fb-score" }, h("b", { text: score(m.home.score) }), h("em", { text: "–" }), h("b", { text: score(m.away.score) })),
        sideBlock(m.away, ownSide(m, teamId) === "away", true)),
      h("div", { class: "fb-goals", dir: "auto" }, ...goals));
  }

  /** The next match in a frame of its own (when no game is on): both crests, the day, the time and how long to wait. */
  function nextCard(m: FootballMatch, teamId: string): HTMLElement {
    const parts = kickoffParts(m.date, lang());
    const left = startsIn(m.date, Date.now());
    const eta = left ? (left.unit === "d" ? t("in {n} d", { n: digits(left.n) })
      : left.unit === "h" ? t("in {n} h", { n: digits(left.n) }) : t("in {n} min", { n: digits(left.n) })) : "";
    return h("div", { class: "fb-next-card", dir: "ltr" },
      h("div", { class: "fb-next-top" },
        h("span", { class: "fb-next-badge", text: t("Next match") }),
        h("span", { class: "fb-league", text: m.leagueName, dir: "auto" })),
      h("div", { class: "fb-score-row" },
        sideBlock(m.home, ownSide(m, teamId) === "home"),
        h("div", { class: "fb-next-when", dir: lang() === "fa" ? "rtl" : "ltr" },
          h("span", { class: "fb-next-day", text: parts.day }),
          h("bdi", { class: "fb-next-time", dir: "ltr", text: parts.time }),
          eta ? h("span", { class: "fb-next-eta", text: eta }) : null),
        sideBlock(m.away, ownSide(m, teamId) === "away", true)));
  }

  function fixtureRow(m: FootballMatch, teamId: string, past: boolean): HTMLElement {
    const opp = opponentOf(m, teamId);
    const home = ownSide(m, teamId) === "home";
    const res = past ? resultFor(m, teamId) : null;
    const mine = teamScore(m, teamId), theirs = opp.score;
    const parts = kickoffParts(m.date, lang());
    const dayText = past ? formatDay(m.date, lang()) : parts.day;
    const left = startsIn(m.date, Date.now());
    const eta = !past && left ? ` · ${left.unit === "d" ? t("in {n} d", { n: digits(left.n) })
      : left.unit === "h" ? t("in {n} h", { n: digits(left.n) }) : t("in {n} min", { n: digits(left.n) })}` : "";
    return h("div", { class: "fb-row" },
      h("div", { class: "fb-row-when" },
        h("span", { text: dayText, dir: "auto" }),
        h("small", {}, past ? m.leagueName : h("bdi", { class: "fb-time", dir: "ltr", text: parts.time }), eta ? eta : "")),
      h("div", { class: "fb-row-opp" }, crestImg(opp.id, opp.short), h("span", { text: `${home ? "" : "@ "}${opp.short}`, dir: "auto" })),
      past
        ? h("div", { class: `fb-row-res ${res ? res.toLowerCase() : ""}`, dir: "ltr" },
            h("b", { text: res ? t(res === "W" ? "W" : res === "L" ? "L" : "D") : "" }),
            h("span", { text: mine != null && theirs != null ? `${digits(mine)}–${digits(theirs)}` : "" }))
        : h("div", { class: "fb-row-res pre", dir: "ltr" }, h("span", { text: home ? t("H") : t("A") })));
  }

  function column(title: string, rows: HTMLElement[], none: string): HTMLElement[] {
    return [h("div", { class: "fb-col-title", text: title }), ...(rows.length ? rows : [h("div", { class: "fb-none", text: none })])];
  }

  // ── Sync ───────────────────────────────────────────────────────────────────
  function sync() {
    const s = Football.state;
    const enabled = State.settings.footballEnabled;
    const teamId = State.settings.footballTeamId;
    const needPick = enabled && (!teamId || choosing);
    const hasTeam = enabled && !!teamId && !choosing;

    picker.style.display = needPick ? "" : "none";
    page.style.display = hasTeam && s.enabled && s.configured ? "" : "none";
    empty.style.display = !enabled || (hasTeam && !(s.enabled && s.configured)) ? "" : "none";
    changeBtn.style.display = enabled && teamId && !choosing ? "" : "none";
    refreshBtn.style.display = hasTeam ? "" : "none";
    emptyTitle.textContent = !enabled ? t("Football is turned off") : t("Loading…");
    emptyHint.textContent = !enabled ? t("Turn it on in Settings to follow your team.") : "";
    el.classList.toggle("fb-live-now", !!s.live);

    if (needPick) {
      const key = `picker|${input.value}|${hits.length}|${choosing}`;
      if (key !== shownKey) { shownKey = key; paintChips(); }
    }
    if (hasTeam && s.enabled && s.configured && s.team) {
      teamName.textContent = s.team.name;
      void crest(s.team.id, s.team.name, teamCrest);
      status.textContent = s.live ? t("Playing now") : s.upcoming[0] ? t("Next match") : t("No match scheduled");
      const key = [
        lang(), s.team.id, s.live ? `${s.live.id}:${s.live.home.score}:${s.live.away.score}:${s.live.clock}` : "-",
        s.upcoming.map((m) => m.id).join(","), s.recent.map((m) => m.id + m.home.score + m.away.score).join(","),
      ].join("|");
      if (key !== shownKey) {
        shownKey = key;
        clear(liveBox);
        const hero = s.live ?? null;
        if (hero) liveBox.append(liveCard(hero, s.team.id));
        else if (s.upcoming[0]) liveBox.append(nextCard(s.upcoming[0], s.team.id));
        liveBox.style.display = hero || s.upcoming[0] ? "" : "none";
        // the framed next match is not repeated in the list below it
        const rest = hero ? s.upcoming : s.upcoming.slice(1);
        clear(nextBox);
        nextBox.append(...column(t("Next matches"), rest.slice(0, 3).map((m) => fixtureRow(m, s.team!.id, false)), t("Nothing scheduled yet.")));
        clear(lastBox);
        lastBox.append(...column(t("Recent results"), s.recent.slice(0, 3).map((m) => fixtureRow(m, s.team!.id, true)), t("No results yet.")));
      }
    }
    const problem = error || (s.error ? s.error : "");
    notice.textContent = problem ? footballErrorText(problem) : "";
    notice.style.display = problem ? "block" : "none";
  }

  sync();
  return {
    el, sync,
    focus() {
      if (State.settings.footballTeamId && !choosing) void refresh();
      else window.setTimeout(() => input.focus(), 60);
    },
  };
}
