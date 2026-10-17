// The Spotify player has two sources.
//  - "local": Spotify on this PC, read from the Windows media controls and
//    controlled the same way (spotify_local.rs). No account needed.
//  - "account": the user's own Spotify account through the Web API
//    (spotify_account.rs). It also sees and controls the phone or another
//    computer.
// When both have something, the account wins unless only this PC is playing.
//
// One task polls while the integration is on: every 4 s while music plays,
// slower when paused or idle (Windows wakes it at once on a change). The page
// runs the clock forward between polls.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;
use windows::core::{w, PCWSTR};
use windows::Win32::System::Registry::{RegCloseKey, RegOpenKeyExW, HKEY, HKEY_CLASSES_ROOT, KEY_READ};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

use crate::spotify_account as account;
use crate::spotify_account::ApiError;
use crate::spotify_local::{self as local, Req};

const POLL_PLAYING: Duration = Duration::from_secs(4);
const POLL_PAUSED: Duration = Duration::from_secs(10);
const POLL_IDLE: Duration = Duration::from_secs(20);

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: f64,
    pub art_url: Option<String>,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub play_pause: bool,
    pub next: bool,
    pub previous: bool,
    pub seek: bool,
    pub shuffle: bool,
    pub repeat: bool,
    pub volume: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayerState {
    pub enabled: bool,
    /// A Client ID has been entered.
    pub configured: bool,
    /// The account is connected (a refresh token exists).
    pub connected: bool,
    pub account_name: String,
    pub premium: bool,
    /// A device is playing or paused with something loaded.
    pub running: bool,
    pub installed: bool,
    /// Where the track comes from: "local" (this PC), "account", or "" (nothing).
    pub source: String,
    pub device: String,
    pub track: Option<Track>,
    pub playing: bool,
    pub position: f64,
    pub position_at: f64,
    pub shuffle: bool,
    pub repeat: bool,
    pub volume: i32,
    pub artwork_data_url: Option<String>,
    pub capabilities: Capabilities,
    /// Short code of the last problem; the page turns it into a sentence.
    pub error: String,
}

impl Default for PlayerState {
    fn default() -> Self {
        Self {
            enabled: false, configured: false, connected: false, account_name: String::new(), premium: false,
            running: false, installed: false, source: String::new(), device: String::new(), track: None, playing: false,
            position: 0.0, position_at: 0.0, shuffle: false, repeat: false, volume: 50,
            artwork_data_url: None, capabilities: Capabilities::default(), error: String::new(),
        }
    }
}

struct Shared {
    generation: u64,
    enabled: bool,
    client_id: String,
    running: bool,
    wake: Arc<Notify>,
    local: Option<Sender<Req>>,
    state: PlayerState,
    covers: VecDeque<(String, String)>,
}

static SHARED: LazyLock<Mutex<Shared>> = LazyLock::new(|| {
    Mutex::new(Shared {
        generation: 0, enabled: false, client_id: String::new(), running: false,
        wake: Arc::new(Notify::new()), local: None, state: PlayerState::default(), covers: VecDeque::new(),
    })
});
static POLLS: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs_f64() * 1000.0
}

fn current(generation: u64) -> bool {
    let s = SHARED.lock().unwrap();
    s.enabled && s.generation == generation
}

fn publish(app: &AppHandle, generation: u64, state: PlayerState) -> PlayerState {
    let mut shared = SHARED.lock().unwrap();
    if shared.generation != generation || !shared.enabled {
        return shared.state.clone();
    }
    if shared.state != state {
        shared.state = state.clone();
        // Emitted while the generation is held: a stopped task cannot publish late.
        let _ = app.emit_to("island", "spotify", &state);
    }
    state
}

/// Starts, restarts or stops the poller to match the settings.
pub fn sync(app: &AppHandle, enabled: bool, client_id: &str) {
    let (generation, wake) = {
        let mut s = SHARED.lock().unwrap();
        if s.enabled == enabled && s.client_id == client_id && (!enabled || s.running) {
            return;
        }
        s.generation = s.generation.wrapping_add(1);
        s.enabled = enabled;
        s.client_id = client_id.to_string();
        s.running = enabled;
        s.wake.notify_waiters();
        s.wake = Arc::new(Notify::new());
        s.local = if enabled { local::start(s.wake.clone()) } else { None };
        s.covers.clear();
        let acc = if enabled { account::account_state(client_id) } else { Default::default() };
        s.state = PlayerState {
            enabled, configured: acc.configured, connected: acc.connected, account_name: acc.name,
            premium: acc.premium, installed: installed(), position_at: now_ms(), ..PlayerState::default()
        };
        let _ = app.emit_to("island", "spotify", &s.state);
        (s.generation, s.wake.clone())
    };
    if !enabled {
        return;
    }
    let (app, client_id) = (app.clone(), client_id.to_string());
    tauri::async_runtime::spawn(async move {
        while current(generation) {
            let (s, floor) = poll(&client_id, generation).await;
            let normal = if s.playing { POLL_PLAYING } else if s.running { POLL_PAUSED } else { POLL_IDLE };
            publish(&app, generation, s);
            // Rate limited: wait at least as long as Spotify asks.
            let delay = normal.max(floor);
            tokio::select! {
                _ = wake.notified() => {}
                _ = tokio::time::sleep(delay) => {}
            }
        }
    });
}

/// One read of the player and the least time to wait before the next one.
async fn poll(client_id: &str, generation: u64) -> (PlayerState, Duration) {
    POLLS.fetch_add(1, Ordering::Relaxed);
    let local_tx = SHARED.lock().unwrap().local.clone();
    let acc = account::account_state(client_id);
    let mut base = PlayerState {
        enabled: true, configured: acc.configured, connected: acc.connected, account_name: acc.name.clone(),
        premium: acc.premium, installed: installed(), position_at: now_ms(), error: acc.error.clone(),
        ..PlayerState::default()
    };
    let mut floor = Duration::ZERO;
    let mut from_account: Option<PlayerState> = None;
    if acc.connected {
        match account::player(client_id).await {
            Ok(None) => base = PlayerState { error: String::new(), ..with_account(base, client_id) },
            Ok(Some(v)) => {
                let mut state = parse_player(&v, now_ms(), with_account(base.clone(), client_id));
                if let Some(url) = state.track.as_ref().and_then(|t| t.art_url.clone()) {
                    state.artwork_data_url = cover(&url, generation).await;
                }
                if state.running {
                    from_account = Some(state);
                } else {
                    base = PlayerState { error: String::new(), ..with_account(base, client_id) };
                }
            }
            Err(e) => {
                if let ApiError::Rate(secs) = &e {
                    floor = Duration::from_secs((*secs).clamp(2, 120));
                }
                if matches!(e, ApiError::Auth | ApiError::NotConnected) {
                    base = PlayerState { connected: false, error: "auth".into(), ..with_account(base, client_id) };
                } else {
                    // Keep what was showing: a hiccup must not blank the player.
                    let mut kept = SHARED.lock().unwrap().state.clone();
                    kept.error = e.code();
                    if kept.source == "account" {
                        from_account = Some(kept);
                    } else {
                        base.error = e.code();
                    }
                }
            }
        }
    }
    let from_pc = match &local_tx {
        Some(tx) => local::read(tx).await,
        None => None,
    };
    let state = match (from_account, from_pc) {
        (Some(a), Some(l)) if !a.playing && l.playing => on_this_pc(base, l),
        (Some(a), _) => a,
        (None, Some(l)) => on_this_pc(base, l),
        (None, None) => base,
    };
    (state, floor)
}

/// Spotify on this PC, with the account facts the page still shows.
fn on_this_pc(base: PlayerState, local: PlayerState) -> PlayerState {
    PlayerState {
        enabled: true, configured: base.configured, connected: base.connected,
        account_name: base.account_name, premium: base.premium, error: base.error, ..local
    }
}

/// The account may have loaded its profile during the call.
fn with_account(mut s: PlayerState, client_id: &str) -> PlayerState {
    let acc = account::account_state(client_id);
    s.connected = acc.connected;
    s.account_name = acc.name;
    s.premium = acc.premium;
    s
}

async fn cover(url: &str, generation: u64) -> Option<String> {
    if let Some((_, data)) = SHARED.lock().unwrap().covers.iter().find(|(k, _)| k == url) {
        return Some(data.clone());
    }
    let bytes = account::fetch_image(url).await?;
    let data = data_url(&bytes)?;
    let mut s = SHARED.lock().unwrap();
    if s.generation == generation {
        s.covers.push_back((url.to_string(), data.clone()));
        while s.covers.len() > 4 {
            s.covers.pop_front();
        }
    }
    Some(data)
}

pub fn data_url(bytes: &[u8]) -> Option<String> {
    let mime = if bytes.starts_with(&[0xff, 0xd8, 0xff]) { "image/jpeg" }
        else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") { "image/png" }
        else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" { "image/webp" }
        else { return None };
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// A `/me/player` answer → the state the island shows. Pure.
pub fn parse_player(v: &Value, now: f64, base: PlayerState) -> PlayerState {
    let item = &v["item"];
    let is_ad = v["currently_playing_type"].as_str() == Some("ad");
    let uri = item["uri"].as_str().unwrap_or("");
    let title = item["name"].as_str().unwrap_or("").trim();
    let track = (!title.is_empty() || is_ad).then(|| {
        let artist = item["artists"].as_array().map(|a| {
            a.iter().filter_map(|x| x["name"].as_str()).collect::<Vec<_>>().join(", ")
        }).filter(|s| !s.is_empty()).or_else(|| item["show"]["publisher"].as_str().map(str::to_string)).unwrap_or_default();
        let album = item["album"]["name"].as_str().or_else(|| item["show"]["name"].as_str()).unwrap_or("");
        let images = item["album"]["images"].as_array().or_else(|| item["images"].as_array());
        let art = images.and_then(|list| {
            // The smallest one that is still sharp at the player's size.
            list.iter().filter_map(|i| Some((i["width"].as_u64().unwrap_or(0), i["url"].as_str()?)))
                .filter(|(w, _)| *w >= 300).min_by_key(|(w, _)| *w)
                .or_else(|| list.iter().filter_map(|i| Some((i["width"].as_u64().unwrap_or(0), i["url"].as_str()?))).max_by_key(|(w, _)| *w))
                .map(|(_, u)| u.to_string())
        });
        Track {
            id: if is_ad { format!("spotify:ad:{}", if uri.is_empty() { "current" } else { uri }) } else { uri.to_string() },
            title: if is_ad && title.is_empty() { "Advertisement".to_string() } else { title.chars().take(500).collect() },
            artist: artist.chars().take(500).collect(),
            album: album.chars().take(500).collect(),
            duration: item["duration_ms"].as_f64().filter(|d| d.is_finite()).map(|d| (d / 1000.0).max(0.0)).unwrap_or(0.0),
            art_url: art,
        }
    });
    let device = &v["device"];
    let volume = device["volume_percent"].as_i64().map(|n| n.clamp(0, 100) as i32);
    let dis = &v["actions"]["disallows"];
    let allowed = |k: &str| dis[k].as_bool() != Some(true);
    // Controls need Premium; the profile may not be known yet, then they are tried.
    let usable = track.is_some() && (base.premium || base.account_name.is_empty());
    let is_playing = track.is_some() && v["is_playing"].as_bool() == Some(true);
    // Spotify forbids "resuming" while it plays and "pausing" while it is paused,
    // so only the one that the button would actually do counts.
    let toggle = allowed(if is_playing { "pausing" } else { "resuming" });
    let capabilities = Capabilities {
        play_pause: usable && toggle,
        next: usable && allowed("skipping_next"),
        previous: usable && allowed("skipping_prev"),
        seek: usable && allowed("seeking") && !is_ad,
        shuffle: usable && allowed("toggling_shuffle"),
        repeat: usable && allowed("toggling_repeat_context"),
        volume: usable && volume.is_some() && device["supports_volume"].as_bool() != Some(false),
    };
    PlayerState {
        running: track.is_some(),
        source: "account".into(),
        device: device["name"].as_str().unwrap_or("").chars().take(80).collect(),
        playing: is_playing,
        position: v["progress_ms"].as_f64().filter(|p| p.is_finite()).map(|p| (p / 1000.0).max(0.0)).unwrap_or(0.0),
        position_at: now,
        shuffle: v["shuffle_state"].as_bool().unwrap_or(false),
        repeat: v["repeat_state"].as_str().is_some_and(|s| s != "off"),
        volume: volume.unwrap_or(50),
        track,
        capabilities,
        error: String::new(),
        ..base
    }
}

// ── Commands ──────────────────────────────────────────────────────────────────

fn settings_client_id(app: &AppHandle) -> String {
    crate::state(app).store.settings().spotify_client_id
}

fn wake_poller() {
    SHARED.lock().unwrap().wake.notify_waiters();
}

#[tauri::command]
pub async fn spotify_refresh(app: AppHandle) -> Result<PlayerState, String> {
    let (enabled, generation) = {
        let s = SHARED.lock().unwrap();
        (s.enabled, s.generation)
    };
    if !enabled {
        return Ok(SHARED.lock().unwrap().state.clone());
    }
    let id = settings_client_id(&app);
    let (state, _) = poll(&id, generation).await;
    Ok(publish(&app, generation, state))
}

#[tauri::command]
pub async fn spotify_control(app: AppHandle, action: String, value: Option<f64>) -> Result<bool, String> {
    let (enabled, playing, connected, source, local_tx) = {
        let s = SHARED.lock().unwrap();
        (s.enabled, s.state.playing, s.state.connected, s.state.source.clone(), s.local.clone())
    };
    if !enabled {
        return Err("disabled".into());
    }
    // What is showing is what is controlled.
    if source == "local" {
        let tx = local_tx.ok_or_else(|| "no_device".to_string())?;
        let result = local::control(&tx, &action, value).await;
        wake_poller();
        return result.map_err(|e| match e.as_str() {
            "timeout" | "no_device" | "bad_action" => e,
            _ => "control_failed".to_string(),
        });
    }
    if !connected {
        return Err(ApiError::NotConnected.code());
    }
    let id = settings_client_id(&app);
    let result = account::command(&id, &action, value, playing).await;
    // Whatever the answer, the truth comes from the next read.
    wake_poller();
    result.map(|_| true).map_err(|e| e.code())
}

/// Connects the account: opens the browser, waits for the approval.
#[tauri::command]
pub async fn spotify_connect(app: AppHandle) -> Result<bool, String> {
    let id = settings_client_id(&app);
    let result = account::connect(&id).await;
    let enabled = SHARED.lock().unwrap().enabled;
    sync(&app, enabled, &id);
    wake_poller();
    match result {
        Ok(_) => Ok(true),
        Err(e) => Err(e.code()),
    }
}

#[tauri::command]
pub fn spotify_cancel_connect() {
    account::cancel_connect();
}

#[tauri::command]
pub fn spotify_disconnect(app: AppHandle) -> bool {
    let id = settings_client_id(&app);
    account::disconnect(&id);
    let enabled = SHARED.lock().unwrap().enabled;
    // A restart publishes the signed-out state at once.
    SHARED.lock().unwrap().running = false;
    sync(&app, enabled, &id);
    true
}

/// The redirect address to register in the Spotify developer dashboard.
#[tauri::command]
pub fn spotify_redirect_uri() -> &'static str {
    account::REDIRECT_URI
}

// ── The desktop app ───────────────────────────────────────────────────────────

fn installed() -> bool {
    let under = |var: &str, rest: &str| std::env::var_os(var).map(|base| PathBuf::from(base).join(rest));
    if under("APPDATA", r"Spotify\Spotify.exe").is_some_and(|p| p.is_file())
        || under("LOCALAPPDATA", r"Microsoft\WindowsApps\Spotify.exe").is_some_and(|p| std::fs::symlink_metadata(p).is_ok())
    {
        return true;
    }
    unsafe {
        let mut key = HKEY::default();
        if RegOpenKeyExW(HKEY_CLASSES_ROOT, w!("spotify\\shell\\open\\command"), None, KEY_READ, &mut key).is_ok() {
            let _ = RegCloseKey(key);
            return true;
        }
    }
    false
}

#[tauri::command]
pub fn spotify_installed() -> bool {
    installed()
}

#[tauri::command]
pub async fn spotify_open() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let uri = if installed() { "spotify:" } else { "https://www.spotify.com/download/windows/" };
        let wide: Vec<u16> = uri.encode_utf16().chain(Some(0)).collect();
        let result = unsafe { ShellExecuteW(None, w!("open"), PCWSTR(wide.as_ptr()), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) };
        if result.0 as isize > 32 { Ok(true) } else { Err("open_failed".to_string()) }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn premium_base() -> PlayerState {
        PlayerState { enabled: true, configured: true, connected: true, account_name: "A".into(), premium: true, ..PlayerState::default() }
    }

    fn sample() -> Value {
        json!({
            "is_playing": true, "progress_ms": 61_500, "shuffle_state": true, "repeat_state": "context",
            "currently_playing_type": "track",
            "device": { "name": "Phone", "volume_percent": 35, "supports_volume": true },
            "item": {
                "uri": "spotify:track:abc", "name": " Song ", "duration_ms": 240_000,
                "artists": [ { "name": "One" }, { "name": "Two" } ],
                "album": { "name": "Album", "images": [
                    { "url": "https://i.scdn.co/image/640", "width": 640 },
                    { "url": "https://i.scdn.co/image/300", "width": 300 },
                    { "url": "https://i.scdn.co/image/64", "width": 64 } ] }
            },
            "actions": { "disallows": { "skipping_prev": true } }
        })
    }

    #[test]
    fn a_player_answer_becomes_the_island_state() {
        let s = parse_player(&sample(), 1000.0, premium_base());
        let t = s.track.clone().unwrap();
        assert_eq!((t.id.as_str(), t.title.as_str(), t.artist.as_str(), t.album.as_str()), ("spotify:track:abc", "Song", "One, Two", "Album"));
        assert_eq!(t.duration, 240.0);
        assert_eq!(t.art_url.as_deref(), Some("https://i.scdn.co/image/300"), "the smallest sharp cover");
        assert!(s.running && s.playing && s.shuffle && s.repeat);
        assert_eq!((s.position, s.position_at, s.volume, s.device.as_str()), (61.5, 1000.0, 35, "Phone"));
        assert!(s.capabilities.play_pause && s.capabilities.next && s.capabilities.seek && s.capabilities.volume);
        assert!(!s.capabilities.previous, "disallowed actions are off");
        assert!(s.connected && s.premium, "the account stays as it was");
    }

    #[test]
    fn without_premium_nothing_pretends_to_work() {
        let free = PlayerState { premium: false, ..premium_base() };
        let c = parse_player(&sample(), 0.0, free).capabilities;
        assert_eq!(c, Capabilities::default());
    }

    #[test]
    fn a_device_without_volume_control_and_podcasts_are_handled() {
        let mut v = sample();
        v["device"] = json!({ "name": "TV", "volume_percent": null, "supports_volume": false });
        assert!(!parse_player(&v, 0.0, premium_base()).capabilities.volume);
        let ep = json!({ "is_playing": false, "item": { "uri": "spotify:episode:e", "name": "Ep", "duration_ms": 1000,
            "show": { "publisher": "Pub", "name": "Show" }, "images": [ { "url": "https://i.scdn.co/i", "width": 640 } ] } });
        let s = parse_player(&ep, 0.0, premium_base());
        let t = s.track.unwrap();
        assert_eq!((t.artist.as_str(), t.album.as_str(), t.art_url.as_deref()), ("Pub", "Show", Some("https://i.scdn.co/i")));
        assert!(!s.playing);
    }

    #[test]
    fn play_pause_works_both_ways_although_spotify_forbids_one_of_them() {
        let mut v = sample();
        v["is_playing"] = json!(true);
        v["actions"] = json!({ "disallows": { "resuming": true } });
        assert!(parse_player(&v, 0.0, premium_base()).capabilities.play_pause, "playing: pause is allowed");
        v["is_playing"] = json!(false);
        v["actions"] = json!({ "disallows": { "pausing": true } });
        assert!(parse_player(&v, 0.0, premium_base()).capabilities.play_pause, "paused: resume is allowed");
        v["actions"] = json!({ "disallows": { "resuming": true, "pausing": true } });
        assert!(!parse_player(&v, 0.0, premium_base()).capabilities.play_pause);
    }

    #[test]
    fn ads_are_ads_and_cannot_be_seeked() {
        let ad = json!({ "is_playing": true, "currently_playing_type": "ad", "item": null });
        let s = parse_player(&ad, 0.0, premium_base());
        assert!(s.track.as_ref().unwrap().id.starts_with("spotify:ad:"));
        assert!(!s.capabilities.seek);
        let mut with_item = sample();
        with_item["currently_playing_type"] = json!("ad");
        assert!(!parse_player(&with_item, 0.0, premium_base()).capabilities.seek);
    }

    #[test]
    fn empty_or_broken_answers_do_not_invent_a_track() {
        for v in [json!({}), json!({ "item": null, "is_playing": true }), json!({ "item": { "name": "  " } })] {
            let s = parse_player(&v, 0.0, premium_base());
            assert!(s.track.is_none() && !s.running && !s.playing, "{v}");
            assert_eq!(s.capabilities, Capabilities::default());
        }
        let weird = json!({ "progress_ms": -5, "item": { "name": "X", "duration_ms": -1 } });
        let s = parse_player(&weird, 0.0, premium_base());
        assert_eq!((s.position, s.track.unwrap().duration), (0.0, 0.0));
    }

    #[test]
    fn artwork_is_only_embedded_for_raster_images() {
        assert!(data_url(b"<svg></svg>").is_none());
        assert!(data_url(b"\x89PNG\r\n\x1a\n").unwrap().starts_with("data:image/png;base64,"));
    }

    #[test]
    fn the_idle_payload_has_no_controls_and_no_secrets() {
        let s = serde_json::to_value(PlayerState::default()).unwrap();
        assert_eq!((s["connected"].clone(), s["capabilities"]["playPause"].clone()), (json!(false), json!(false)));
        assert!(s["track"].is_null() && s["artworkDataUrl"].is_null());
        assert!(!s.to_string().to_lowercase().contains("token"));
    }
}
