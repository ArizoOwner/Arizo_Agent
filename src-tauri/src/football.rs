// The favourite football team: its live score, the next fixtures and the recent
// results, read from ESPN's public JSON (no key, no account). Nothing about the
// user is sent: only a team id and, for live games, the league and the day.
//
// One task polls while the feature is on and a team is chosen: every 3 s while
// the team is playing (only the live game is re-read, from its league's
// scoreboard; the whole schedule every 45 s), every 10 s around a kick-off,
// every 30 s in the 20 minutes before, every 5 minutes the rest of the time.
// The page turns what changed (goals, cards, kick-off, half-time, full-time)
// into the island's reactions.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;

const API: &str = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const SEARCH: &str = "https://site.web.api.espn.com/apis/common/v3/search";
const LOGO: &str = "https://a.espncdn.com/combiner/i";
const LOGO_LIMIT: usize = 200 * 1024;
const LIVE_EVERY: Duration = Duration::from_secs(3);
/// Around the kick-off (3 min before to 4 h after, while ESPN still says "not started").
const KICKOFF_EVERY: Duration = Duration::from_secs(10);
const SOON_EVERY: Duration = Duration::from_secs(30);
const IDLE_EVERY: Duration = Duration::from_secs(300);
const RETRY_EVERY: Duration = Duration::from_secs(60);
/// A failed read while a game is on is tried again quickly: a goal must not wait a minute.
const LIVE_RETRY_EVERY: Duration = Duration::from_secs(8);
/// While a game is on, the full schedule is read this often; in between only the live game is.
const FULL_EVERY: Duration = Duration::from_secs(45);
/// How many upcoming games and recent results the page shows.
const UPCOMING: usize = 5;
const RECENT: usize = 5;

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Side {
    pub id: String,
    pub name: String,
    pub short: String,
    pub score: Option<u32>,
    /// Hex colour without "#", as ESPN gives it ("" when unknown).
    pub color: String,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Goal {
    pub minute: String,
    pub player: String,
    pub team_id: String,
    pub own_goal: bool,
    pub penalty: bool,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub minute: String,
    pub player: String,
    pub team_id: String,
    /// A red card (a second yellow is reported as red by ESPN); false for a yellow.
    pub red: bool,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Match {
    pub id: String,
    /// ESPN's league slug ("esp.1").
    pub league: String,
    pub league_name: String,
    /// Kick-off, ISO 8601 in UTC: the page shows it in the user's own calendar and time zone.
    pub date: String,
    /// "pre", "in" or "post".
    pub state: String,
    /// "67'", "HT", "FT"; empty before the game.
    pub clock: String,
    pub home: Side,
    pub away: Side,
    pub goals: Vec<Goal>,
    pub cards: Vec<Card>,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Team {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FootballState {
    pub enabled: bool,
    pub configured: bool,
    pub team: Option<Team>,
    pub live: Option<Match>,
    pub upcoming: Vec<Match>,
    pub recent: Vec<Match>,
    pub updated_at: f64,
    /// Short code of the last problem; the page turns it into a sentence.
    pub error: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeamHit {
    pub id: String,
    pub name: String,
    pub league: String,
}

// ── Parsing (pure) ────────────────────────────────────────────────────────────

fn score_of(v: &Value) -> Option<u32> {
    match v {
        Value::String(s) => s.trim().parse().ok(),
        Value::Number(n) => n.as_f64().filter(|n| n.is_finite()).map(|n| n.max(0.0) as u32),
        Value::Object(_) => v["value"]
            .as_f64()
            .filter(|n| n.is_finite())
            .map(|n| n.max(0.0) as u32)
            .or_else(|| v["displayValue"].as_str().and_then(|s| s.trim().parse().ok())),
        _ => None,
    }
}

fn text(v: &Value, max: usize) -> String {
    v.as_str().unwrap_or("").trim().chars().take(max).collect()
}

fn digits(v: &Value) -> String {
    let s = text(v, 12);
    if !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()) { s } else { String::new() }
}

fn parse_side(c: &Value) -> Side {
    let t = &c["team"];
    let name = text(&t["displayName"], 60);
    let color = text(&t["color"], 6);
    Side {
        id: digits(&t["id"]),
        short: { let s = text(&t["shortDisplayName"], 30); if s.is_empty() { name.clone() } else { s } },
        name,
        score: score_of(&c["score"]),
        color: if color.chars().all(|c| c.is_ascii_hexdigit()) { color } else { String::new() },
    }
}

/// One ESPN event (from a team schedule or a league scoreboard) → a match.
/// `league` is the slug to use when the event does not carry its own.
pub fn parse_event(e: &Value, league: &str) -> Option<Match> {
    let comp = &e["competitions"][0];
    let competitors = comp["competitors"].as_array()?;
    let side = |home: &str| competitors.iter().find(|c| c["homeAway"].as_str() == Some(home)).map(parse_side);
    let (home, away) = (side("home")?, side("away")?);
    if home.id.is_empty() || away.id.is_empty() {
        return None;
    }
    let status = &comp["status"];
    let state = match status["type"]["state"].as_str() {
        Some("in") => "in",
        Some("post") => "post",
        _ => "pre",
    };
    let clock = match state {
        "in" => {
            let short = text(&status["type"]["shortDetail"], 12);
            if short.is_empty() { text(&status["displayClock"], 12) } else { short }
        }
        "post" => "FT".to_string(),
        _ => String::new(),
    };
    let goals = comp["details"]
        .as_array()
        .map(|list| {
            list.iter()
                .filter(|d| d["scoringPlay"].as_bool() == Some(true))
                .map(|d| Goal {
                    minute: text(&d["clock"]["displayValue"], 12),
                    player: text(&d["athletesInvolved"][0]["displayName"], 60),
                    team_id: digits(&d["team"]["id"]),
                    own_goal: d["ownGoal"].as_bool() == Some(true),
                    penalty: d["penaltyKick"].as_bool() == Some(true),
                })
                .collect()
        })
        .unwrap_or_default();
    let cards = comp["details"]
        .as_array()
        .map(|list| {
            list.iter()
                .filter(|d| d["yellowCard"].as_bool() == Some(true) || d["redCard"].as_bool() == Some(true))
                .map(|d| Card {
                    minute: text(&d["clock"]["displayValue"], 12),
                    player: text(&d["athletesInvolved"][0]["displayName"], 60),
                    team_id: digits(&d["team"]["id"]),
                    red: d["redCard"].as_bool() == Some(true),
                })
                .collect()
        })
        .unwrap_or_default();
    let slug = text(&e["league"]["slug"], 40);
    Some(Match {
        id: digits(&e["id"]),
        league: if slug.is_empty() { league.chars().take(40).collect() } else { slug },
        league_name: {
            let n = text(&e["league"]["shortName"], 40);
            if n.is_empty() { text(&e["league"]["name"], 40) } else { n }
        },
        date: text(&e["date"], 32),
        state: state.into(),
        clock,
        home,
        away,
        goals,
        cards,
    })
    .filter(|m| !m.id.is_empty() && !m.date.is_empty())
}

fn events(j: &Value, league: &str) -> Vec<Match> {
    j["events"].as_array().map(|l| l.iter().filter_map(|e| parse_event(e, league)).collect()).unwrap_or_default()
}

/// The team page's `nextEvent`: the next game, for teams whose schedule has no fixtures.
pub fn next_events(team: &Value) -> Vec<Match> {
    team["team"]["nextEvent"].as_array().map(|l| l.iter().filter_map(|e| parse_event(e, "")).collect()).unwrap_or_default()
}

/// Seconds since the Unix epoch of "2026-10-25T20:00Z" (seconds optional).
pub fn parse_iso(s: &str) -> Option<f64> {
    let b = s.as_bytes();
    if b.len() < 16 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' {
        return None;
    }
    let n = |a: usize, z: usize| s.get(a..z)?.parse::<i64>().ok();
    let (y, m, d, hh, mm) = (n(0, 4)?, n(5, 7)?, n(8, 10)?, n(11, 13)?, n(14, 16)?);
    let ss = if b.len() >= 19 && b[16] == b':' { n(17, 19)? } else { 0 };
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) || hh > 23 || mm > 59 || ss > 60 {
        return None;
    }
    // Days from civil (Howard Hinnant's algorithm).
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some((days * 86_400 + hh * 3600 + mm * 60 + ss) as f64)
}

fn rank(state: &str) -> u8 {
    match state { "in" => 2, "post" => 1, _ => 0 }
}

/// A game that is, or probably is, being played: ESPN's schedule can lag behind the kick-off.
pub fn is_live_candidate(m: &Match, now: f64) -> bool {
    m.state == "in"
        || (m.state == "pre" && parse_iso(&m.date).is_some_and(|t| now >= t - 120.0 && now <= t + 4.0 * 3600.0))
}

/// Results and fixtures → the live game, the next ones (soonest first) and the
/// last ones (latest first). A game listed twice keeps its most advanced state.
pub fn assemble(all: Vec<Match>) -> (Option<Match>, Vec<Match>, Vec<Match>) {
    let mut by_id: HashMap<String, Match> = HashMap::new();
    for m in all {
        match by_id.get(&m.id) {
            Some(old) if rank(&old.state) >= rank(&m.state) => {}
            _ => { by_id.insert(m.id.clone(), m); }
        }
    }
    let mut list: Vec<Match> = by_id.into_values().collect();
    list.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.id.cmp(&b.id)));
    let live = list.iter().find(|m| m.state == "in").cloned();
    let upcoming = list.iter().filter(|m| m.state == "pre").take(UPCOMING).cloned().collect();
    let recent = list.iter().rev().filter(|m| m.state == "post").take(RECENT).cloned().collect();
    (live, upcoming, recent)
}

/// How long to wait before the next read.
pub fn next_delay(state: &FootballState, now: f64) -> Duration {
    if state.live.is_some() {
        return LIVE_EVERY;
    }
    match state.upcoming.first().and_then(|m| parse_iso(&m.date)).map(|t| t - now) {
        Some(d) if d < 180.0 && d > -4.0 * 3600.0 => KICKOFF_EVERY,
        Some(d) if d < 20.0 * 60.0 && d > -4.0 * 3600.0 => SOON_EVERY,
        _ => IDLE_EVERY,
    }
}

/// The live game re-read alone (cheap and fresh); None when it is over, unknown or unreachable,
/// and the whole schedule should be read instead.
async fn refresh_live(prev: &FootballState) -> Option<FootballState> {
    let fresh = fetch_live(prev.live.as_ref()?).await?;
    if fresh.state != "in" {
        return None;
    }
    let mut next = prev.clone();
    next.live = Some(fresh);
    next.updated_at = now_secs() * 1000.0;
    next.error.clear();
    Some(next)
}

// ── Network ───────────────────────────────────────────────────────────────────

fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .user_agent("Arizo-Agent")
            .build()
            .expect("http client")
    })
}

async fn get_json(url: &str) -> Result<Value, String> {
    let res = http().get(url).send().await.map_err(|_| "network".to_string())?;
    let status = res.status();
    if status.as_u16() == 429 {
        return Err("rate_limited".into());
    }
    if !status.is_success() {
        return Err(format!("http_{}", status.as_u16()));
    }
    res.json().await.map_err(|_| "bad_response".to_string())
}

fn now_secs() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs_f64()
}

/// The live game, read from its league's scoreboard for that day (fresher than the schedule).
async fn fetch_live(m: &Match) -> Option<Match> {
    if m.league.is_empty() || !m.league.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-') {
        return None;
    }
    let day: String = m.date.get(..10)?.chars().filter(|c| c.is_ascii_digit()).collect();
    let j = get_json(&format!("{API}/{}/scoreboard?dates={day}", m.league)).await.ok()?;
    let e = j["events"].as_array()?.iter().find(|e| e["id"].as_str() == Some(m.id.as_str()))?;
    let mut fresh = parse_event(e, &m.league)?;
    if fresh.league_name.is_empty() {
        fresh.league_name = m.league_name.clone();
    }
    Some(fresh)
}

async fn poll(team_id: &str, fallback_name: &str) -> Result<FootballState, String> {
    let base = format!("{API}/all/teams/{team_id}/schedule");
    let upcoming_url = format!("{base}?fixture=true");
    let team_url = format!("{API}/all/teams/{team_id}");
    let (results, fixtures, team) = tokio::join!(get_json(&base), get_json(&upcoming_url), get_json(&team_url));
    let results = results?;
    let fixtures = fixtures.unwrap_or(Value::Null);
    let team = team.unwrap_or(Value::Null);
    let name = { let n = text(&results["team"]["displayName"], 60); if n.is_empty() { fallback_name.to_string() } else { n } };
    let mut all = events(&fixtures, "");
    all.extend(events(&results, ""));
    // Teams whose schedule lists no future games (Persepolis, for one) still have a next game here.
    all.extend(next_events(&team));
    let now = now_secs();
    for m in all.iter_mut() {
        if is_live_candidate(m, now) {
            if let Some(fresh) = fetch_live(m).await {
                *m = fresh;
            }
        }
    }
    let (live, upcoming, recent) = assemble(all);
    Ok(FootballState {
        enabled: true,
        configured: true,
        team: Some(Team { id: team_id.to_string(), name }),
        live,
        upcoming,
        recent,
        updated_at: now * 1000.0,
        error: String::new(),
    })
}

// ── The poller ────────────────────────────────────────────────────────────────

struct Shared {
    generation: u64,
    enabled: bool,
    running: bool,
    team_id: String,
    team_name: String,
    wake: Arc<Notify>,
    state: FootballState,
    logos: HashMap<String, String>,
}

static SHARED: LazyLock<Mutex<Shared>> = LazyLock::new(|| {
    Mutex::new(Shared {
        generation: 0, enabled: false, running: false, team_id: String::new(), team_name: String::new(),
        wake: Arc::new(Notify::new()), state: FootballState::default(), logos: HashMap::new(),
    })
});

fn current(generation: u64) -> bool {
    let s = SHARED.lock().unwrap();
    s.enabled && s.generation == generation
}

fn publish(app: &AppHandle, generation: u64, state: FootballState) -> FootballState {
    let mut shared = SHARED.lock().unwrap();
    if shared.generation != generation || !shared.enabled {
        return shared.state.clone();
    }
    if shared.state != state {
        shared.state = state.clone();
        // Emitted while the generation is held: a stopped task cannot publish late.
        let _ = app.emit_to("island", "football", &state);
    }
    state
}

fn idle_state(enabled: bool, team_id: &str, team_name: &str) -> FootballState {
    FootballState {
        enabled,
        configured: enabled && !team_id.is_empty(),
        team: (enabled && !team_id.is_empty()).then(|| Team { id: team_id.into(), name: team_name.into() }),
        ..FootballState::default()
    }
}

/// Starts, restarts or stops the poller to match the settings.
pub fn sync(app: &AppHandle, enabled: bool, team_id: &str, team_name: &str) {
    let team_id = if team_id.chars().all(|c| c.is_ascii_digit()) { team_id } else { "" };
    let (generation, wake) = {
        let mut s = SHARED.lock().unwrap();
        if s.enabled == enabled && s.team_id == team_id && s.team_name == team_name && (!enabled || s.running) {
            return;
        }
        s.generation = s.generation.wrapping_add(1);
        s.enabled = enabled;
        s.team_id = team_id.to_string();
        s.team_name = team_name.to_string();
        s.running = enabled;
        s.wake.notify_waiters();
        s.wake = Arc::new(Notify::new());
        s.state = idle_state(enabled, team_id, team_name);
        let _ = app.emit_to("island", "football", &s.state);
        (s.generation, s.wake.clone())
    };
    if !enabled || team_id.is_empty() {
        return;
    }
    let (app, team_id, team_name) = (app.clone(), team_id.to_string(), team_name.to_string());
    tauri::async_runtime::spawn(async move {
        let mut last_full: Option<Instant> = None;
        while current(generation) {
            // While a game is on, only the live game is re-read, except once in a while.
            let kept = SHARED.lock().unwrap().state.clone();
            let quick = kept.live.is_some() && last_full.is_some_and(|t| t.elapsed() < FULL_EVERY);
            let quick_state = if quick { refresh_live(&kept).await } else { None };
            let result = match quick_state {
                Some(state) => Ok(state),
                None => {
                    let r = poll(&team_id, &team_name).await;
                    if r.is_ok() {
                        last_full = Some(Instant::now());
                    }
                    r
                }
            };
            let delay = match result {
                Ok(state) => {
                    let delay = next_delay(&state, now_secs());
                    publish(&app, generation, state);
                    delay
                }
                Err(code) => {
                    // Keep what was showing: a hiccup must not blank the page.
                    let mut kept = SHARED.lock().unwrap().state.clone();
                    let was_live = kept.live.is_some();
                    kept.error = code;
                    publish(&app, generation, kept);
                    if was_live { LIVE_RETRY_EVERY } else { RETRY_EVERY }
                }
            };
            tokio::select! {
                _ = wake.notified() => {}
                _ = tokio::time::sleep(delay) => {}
            }
        }
    });
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn football_refresh(app: AppHandle) -> Result<FootballState, String> {
    let (enabled, generation, team_id, team_name) = {
        let s = SHARED.lock().unwrap();
        (s.enabled, s.generation, s.team_id.clone(), s.team_name.clone())
    };
    if !enabled || team_id.is_empty() {
        return Ok(SHARED.lock().unwrap().state.clone());
    }
    match poll(&team_id, &team_name).await {
        Ok(state) => Ok(publish(&app, generation, state)),
        Err(code) => {
            let mut kept = SHARED.lock().unwrap().state.clone();
            kept.error = code;
            Ok(kept)
        }
    }
}

/// Teams matching a name, for the picker.
#[tauri::command]
pub async fn football_search(query: String) -> Result<Vec<TeamHit>, String> {
    let q = query.trim();
    if q.chars().count() < 2 || q.chars().count() > 40 {
        return Ok(Vec::new());
    }
    let url = reqwest::Url::parse_with_params(SEARCH, &[("query", q), ("limit", "10"), ("type", "team")])
        .map_err(|_| "bad_query".to_string())?;
    let j = get_json(url.as_str()).await?;
    let mut seen = Vec::new();
    Ok(j["items"]
        .as_array()
        .map(|list| {
            list.iter()
                .filter(|i| i["type"].as_str() == Some("team") && i["sport"].as_str() == Some("soccer"))
                .filter_map(|i| {
                    let id = digits(&i["id"]);
                    let name = text(&i["displayName"], 60);
                    if id.is_empty() || name.is_empty() || seen.contains(&id) {
                        return None;
                    }
                    seen.push(id.clone());
                    Some(TeamHit { id, name, league: text(&i["defaultLeagueSlug"], 40) })
                })
                .take(8)
                .collect()
        })
        .unwrap_or_default())
}

/// A club or national-team crest as a data URL: the page may not load anything remote.
#[tauri::command]
pub async fn football_logo(id: String) -> Option<String> {
    if id.is_empty() || id.len() > 9 || !id.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    if let Some(hit) = SHARED.lock().unwrap().logos.get(&id) {
        return (!hit.is_empty()).then(|| hit.clone());
    }
    let url = format!("{LOGO}?img=/i/teamlogos/soccer/500/{id}.png&w=72&h=72");
    let data = async {
        let res = http().get(&url).send().await.ok()?;
        if !res.status().is_success() || res.content_length().is_some_and(|n| n as usize > LOGO_LIMIT) {
            return None;
        }
        let bytes = res.bytes().await.ok()?;
        if bytes.len() > LOGO_LIMIT { None } else { crate::spotify::data_url(&bytes) }
    }
    .await;
    let mut s = SHARED.lock().unwrap();
    if s.logos.len() >= 80 {
        s.logos.clear();
    }
    // A missing crest is remembered too, so it is not asked for again.
    s.logos.insert(id, data.clone().unwrap_or_default());
    data
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A schedule entry: scores are objects, the league is on the event.
    fn schedule_event() -> Value {
        json!({
            "id": "401882853", "date": "2026-10-10T16:30Z",
            "league": { "slug": "esp.1", "shortName": "LALIGA", "name": "Spanish LALIGA" },
            "competitions": [{
                "status": { "type": { "state": "post", "shortDetail": "FT" }, "displayClock": "90'+5'" },
                "competitors": [
                    { "homeAway": "home", "score": { "value": 3.0, "displayValue": "3" },
                      "team": { "id": "83", "displayName": "Barcelona", "shortDisplayName": "Barcelona", "color": "990000" } },
                    { "homeAway": "away", "score": { "value": 0.0, "displayValue": "0" },
                      "team": { "id": "2922", "displayName": "Getafe", "shortDisplayName": "Getafe", "color": "zzz" } }
                ]
            }]
        })
    }

    /// A scoreboard entry: scores are strings, goals are in `details`, no league.
    fn live_event() -> Value {
        json!({
            "id": "401878771", "date": "2026-10-17T11:30Z",
            "competitions": [{
                "status": { "type": { "state": "in", "shortDetail": "67'" }, "displayClock": "67'" },
                "competitors": [
                    { "homeAway": "home", "score": "0", "team": { "id": "368", "displayName": "Everton" } },
                    { "homeAway": "away", "score": "2", "team": { "id": "363", "displayName": "Chelsea" } }
                ],
                "details": [
                    { "scoringPlay": false, "yellowCard": true, "clock": { "displayValue": "23'" }, "team": { "id": "368" } },
                    { "scoringPlay": true, "penaltyKick": true, "clock": { "displayValue": "46'" }, "team": { "id": "363" },
                      "athletesInvolved": [{ "displayName": "Pedro Neto" }] },
                    { "scoringPlay": true, "ownGoal": true, "clock": { "displayValue": "60'" }, "team": { "id": "363" },
                      "athletesInvolved": [{ "displayName": "A. Defender" }] }
                ]
            }]
        })
    }

    fn m(id: &str, date: &str, state: &str) -> Match {
        Match { id: id.into(), date: date.into(), state: state.into(), ..Match::default() }
    }

    #[test]
    fn a_schedule_entry_becomes_a_finished_match() {
        let g = parse_event(&schedule_event(), "").unwrap();
        assert_eq!((g.state.as_str(), g.clock.as_str(), g.league.as_str(), g.league_name.as_str()), ("post", "FT", "esp.1", "LALIGA"));
        assert_eq!((g.home.score, g.away.score), (Some(3), Some(0)));
        assert_eq!(g.home.color, "990000");
        assert_eq!(g.away.color, "", "a colour that is not hex is dropped");
        assert!(g.goals.is_empty());
    }

    #[test]
    fn a_scoreboard_entry_gives_the_score_the_clock_and_the_goals() {
        let g = parse_event(&live_event(), "eng.1").unwrap();
        assert_eq!((g.state.as_str(), g.clock.as_str(), g.league.as_str()), ("in", "67'", "eng.1"));
        assert_eq!((g.home.score, g.away.score), (Some(0), Some(2)));
        assert_eq!(g.goals.len(), 2, "cards are not goals");
        assert_eq!(g.cards.len(), 1);
        assert_eq!((g.cards[0].team_id.as_str(), g.cards[0].minute.as_str(), g.cards[0].red), ("368", "23'", false));
        assert_eq!((g.goals[0].player.as_str(), g.goals[0].minute.as_str(), g.goals[0].penalty), ("Pedro Neto", "46'", true));
        assert!(g.goals[1].own_goal);
        assert_eq!(g.goals[1].team_id, "363");
    }

    #[test]
    fn the_next_game_is_read_from_the_team_page_when_the_schedule_has_none() {
        let page = json!({ "team": { "nextEvent": [{
            "id": "401912634", "date": "2026-10-27T16:00Z",
            "league": { "slug": "afc.champions", "shortName": "AFC Champions League Elite" },
            "competitions": [{
                "status": { "type": { "state": "pre", "shortDetail": "10/27 - 12:00 PM EDT" } },
                "competitors": [
                    { "homeAway": "home", "id": "790", "team": { "id": "790", "displayName": "Shabab Al-Ahli" } },
                    { "homeAway": "away", "id": "7525", "team": { "id": "7525", "displayName": "Esteghlal" } }
                ]
            }]
        }] } });
        let next = next_events(&page);
        assert_eq!(next.len(), 1);
        assert_eq!((next[0].state.as_str(), next[0].league.as_str(), next[0].away.id.as_str()), ("pre", "afc.champions", "7525"));
        assert_eq!(next[0].home.score, None);
        let (_, upcoming, _) = assemble(next);
        assert_eq!(upcoming.len(), 1);
        assert!(next_events(&json!({})).is_empty());
    }

    #[test]
    fn red_cards_are_told_from_yellow_ones() {
        let mut e = live_event();
        e["competitions"][0]["details"].as_array_mut().unwrap().push(
            json!({ "scoringPlay": false, "redCard": true, "clock": { "displayValue": "71'" }, "team": { "id": "363" },
                    "athletesInvolved": [{ "displayName": "R. Back" }] }));
        let g = parse_event(&e, "eng.1").unwrap();
        assert_eq!(g.cards.len(), 2);
        assert!(g.cards[1].red && g.cards[1].player == "R. Back" && !g.cards[0].red);
    }

    #[test]
    fn broken_events_are_dropped_not_guessed() {
        assert!(parse_event(&json!({}), "").is_none());
        assert!(parse_event(&json!({ "id": "1", "date": "2026-01-01T00:00Z", "competitions": [{ "competitors": [] }] }), "").is_none());
        let mut e = live_event();
        e["id"] = json!("not-a-number");
        assert!(parse_event(&e, "x").is_none());
        let mut e = schedule_event();
        e["competitions"][0]["competitors"][0]["team"]["id"] = json!("");
        assert!(parse_event(&e, "").is_none());
    }

    #[test]
    fn a_game_before_kick_off_has_no_score_and_no_clock() {
        let mut e = schedule_event();
        e["competitions"][0]["status"]["type"]["state"] = json!("pre");
        e["competitions"][0]["competitors"][0].as_object_mut().unwrap().remove("score");
        let g = parse_event(&e, "").unwrap();
        assert_eq!((g.state.as_str(), g.clock.as_str(), g.home.score), ("pre", "", None));
    }

    #[test]
    fn kick_off_times_are_read_as_utc() {
        assert_eq!(parse_iso("1970-01-01T00:00Z"), Some(0.0));
        assert_eq!(parse_iso("2026-10-25T20:00Z"), Some(1_792_958_400.0));
        assert_eq!(parse_iso("2026-10-25T20:00:30Z"), Some(1_792_958_430.0));
        assert_eq!(parse_iso("2024-02-29T12:00Z"), Some(1_709_208_000.0));
        for bad in ["", "tomorrow", "2026-13-01T00:00Z", "2026-10-25 20:00", "2026-10-25T25:00Z"] {
            assert_eq!(parse_iso(bad), None, "{bad}");
        }
    }

    #[test]
    fn the_live_game_the_next_ones_and_the_last_ones_are_told_apart() {
        let mut live = m("3", "2026-10-17T16:30Z", "in");
        live.home.score = Some(1);
        let all = vec![
            m("1", "2026-10-01T16:00Z", "post"), m("2", "2026-10-10T16:00Z", "post"), live,
            m("5", "2026-10-31T16:00Z", "pre"), m("4", "2026-10-25T16:00Z", "pre"),
            // The same game twice: the fixture list is stale, the result is right.
            m("2", "2026-10-10T16:00Z", "pre"),
        ];
        let (live, upcoming, recent) = assemble(all);
        assert_eq!(live.unwrap().id, "3");
        assert_eq!(upcoming.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), ["4", "5"], "soonest first");
        assert_eq!(recent.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), ["2", "1"], "latest first, no duplicates");
    }

    #[test]
    fn the_lists_are_bounded() {
        let all: Vec<Match> = (0..30).map(|i| m(&i.to_string(), &format!("2027-01-{:02}T10:00Z", i + 1), "pre")).collect();
        assert_eq!(assemble(all).1.len(), UPCOMING);
    }

    #[test]
    fn a_game_that_should_have_started_is_checked_live() {
        let t = parse_iso("2026-10-17T16:30Z").unwrap();
        let g = m("1", "2026-10-17T16:30Z", "pre");
        assert!(!is_live_candidate(&g, t - 3600.0));
        assert!(is_live_candidate(&g, t - 60.0));
        assert!(is_live_candidate(&g, t + 3600.0));
        assert!(!is_live_candidate(&g, t + 5.0 * 3600.0));
        assert!(is_live_candidate(&m("1", "2026-10-17T16:30Z", "in"), t + 99.0 * 3600.0));
        assert!(!is_live_candidate(&m("1", "2026-10-17T16:30Z", "post"), t + 60.0));
    }

    #[test]
    fn the_poller_speeds_up_for_live_games_and_kick_offs() {
        let now = parse_iso("2026-10-17T12:00Z").unwrap();
        let mut s = FootballState { upcoming: vec![m("1", "2026-10-18T12:00Z", "pre")], ..FootballState::default() };
        assert_eq!(next_delay(&s, now), IDLE_EVERY);
        s.upcoming = vec![m("1", "2026-10-17T12:10Z", "pre")];
        assert_eq!(next_delay(&s, now), SOON_EVERY);
        s.upcoming = vec![m("1", "2026-10-17T12:02Z", "pre")];
        assert_eq!(next_delay(&s, now), KICKOFF_EVERY, "two minutes to go");
        s.upcoming = vec![m("1", "2026-10-17T11:40Z", "pre")];
        assert_eq!(next_delay(&s, now), KICKOFF_EVERY, "should have started already");
        s.upcoming = vec![m("1", "2026-10-17T07:00Z", "pre")];
        assert_eq!(next_delay(&s, now), IDLE_EVERY, "never started: stop hammering");
        s.live = Some(m("2", "2026-10-17T11:00Z", "in"));
        assert_eq!(next_delay(&s, now), LIVE_EVERY);
    }

    #[test]
    fn an_idle_state_has_no_team_unless_one_is_chosen_and_the_feature_is_on() {
        assert!(!idle_state(true, "", "").configured);
        assert!(idle_state(true, "83", "Barcelona").configured);
        assert_eq!(idle_state(true, "83", "Barcelona").team, Some(Team { id: "83".into(), name: "Barcelona".into() }));
        assert!(idle_state(false, "83", "Barcelona").team.is_none());
    }

    #[test]
    fn the_state_the_page_receives_has_the_agreed_names() {
        let v = serde_json::to_value(FootballState::default()).unwrap();
        for k in ["enabled", "configured", "team", "live", "upcoming", "recent", "updatedAt", "error"] {
            assert!(v.get(k).is_some(), "{k}");
        }
        let g = serde_json::to_value(parse_event(&live_event(), "eng.1").unwrap()).unwrap();
        assert!(g["goals"][0]["teamId"].is_string() && g["goals"][1]["ownGoal"].is_boolean());
        assert!(g["cards"][0]["red"].is_boolean() && g["cards"][0]["teamId"].is_string());
        assert!(g["home"]["short"].is_string() && g["leagueName"].is_string());
    }
}

#[cfg(test)]
mod live_smoke {
    use super::*;

    /// Reads ESPN for real (Barcelona). Run on purpose: `cargo test --lib -- --ignored football_live`.
    #[test]
    #[ignore = "talks to ESPN over the network"]
    fn football_live_smoke_readonly() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        rt.block_on(async {
            let hits = football_search("barcelona".into()).await.expect("search");
            assert!(hits.iter().any(|h| h.id == "83"), "{hits:?}");
            let id = std::env::var("FOOTBALL_TEAM").unwrap_or_else(|_| "83".into());
            let s = poll(&id, "Team").await.expect("poll");
            for m in s.upcoming.iter() { println!("UP {} {} {} v {} [{}]", m.id, m.date, m.home.short, m.away.short, m.state); }
            println!("team={:?} live={} upcoming={} recent={}", s.team, s.live.is_some(), s.upcoming.len(), s.recent.len());
            assert!(!s.upcoming.is_empty() || !s.recent.is_empty());
            if let Some(m) = s.upcoming.first() { println!("next: {} {} v {}", m.date, m.home.short, m.away.short); }
            let logo = football_logo("83".into()).await;
            println!("logo={}", logo.as_deref().map(|l| &l[..22]).unwrap_or("none"));
            assert!(logo.is_some_and(|l| l.starts_with("data:image/")));
        });
    }
}
