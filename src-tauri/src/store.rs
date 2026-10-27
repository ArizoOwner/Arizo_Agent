// Settings and history on disk, the API key in the Windows Credential Manager.
//
//   %APPDATA%\Arizo Translate\settings.json   preferences (never the API key)
//   %APPDATA%\Arizo Translate\history.json    past translations
//
// The key is never written to a file and never sent to the front end: the page
// can only ask whether one exists.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const KEY_SERVICE: &str = "com.arizo.translate";
const KEY_NAME: &str = "ai-api-key";

pub const DEFAULT_BASE_URL: &str = "https://openrouter.ai/api/v1";
pub const DEFAULT_MODEL: &str = "deepseek/deepseek-chat";

pub const CRYPTO_PROVIDERS: &[&str] = &["nobitex", "binance", "toobit"];
const CRYPTO_QUOTES: &[&str] = &["USDT", "IRT"];
pub const CRYPTO_TIMEFRAMES: &[&str] = &["1m", "5m", "15m", "1h", "4h", "1d"];
/// How many favourite coins are kept.
const MAX_FAVORITES: usize = 40;

/// The feature tabs of the island's header, in their default order.
const FEATURE_TABS: &[&str] = &["translate", "spotify", "football", "crypto", "muse"];

/// How far each look setting may go, in percent (web/src/core/appearance.ts has the same
/// numbers: a web test reads them from here, so the two cannot drift apart).
pub const UI_WIDTH: (f64, f64) = (80.0, 130.0);
pub const UI_HEIGHT: (f64, f64) = (90.0, 130.0);
pub const UI_TRANSPARENCY: (f64, f64) = (0.0, 70.0);
pub const UI_FONT_SCALE: (f64, f64) = (80.0, 140.0);
pub const UI_CORNER: (f64, f64) = (0.0, 150.0);
/// How far a floating island hangs below the top edge, in px.
pub const UI_FLOAT_GAP: (f64, f64) = (4.0, 60.0);
/// The folded (compact) island: its width and height as a percentage of the design, and the
/// zoom of what is drawn in it (Ari, the clock, the mini icons).
pub const UI_COMPACT_WIDTH: (f64, f64) = (60.0, 160.0);
pub const UI_COMPACT_HEIGHT: (f64, f64) = (90.0, 180.0);
pub const UI_COMPACT_SCALE: (f64, f64) = (70.0, 180.0);

/// A coin ticker as the exchanges write it: capital letters, digits and the odd underscore
/// ("1K_SHIB"), never empty, never starting with an underscore.
pub fn valid_asset(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 16
        && !s.starts_with('_')
        && s.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
}

const ENGINES: &[&str] = &["google", "aphra"];
const TONES: &[&str] = &["auto", "formal", "colloquial", "technical", "literary"];
const THEMES: &[&str] = &["dark", "light", "system"];
const APP_LANGS: &[&str] = &["fa", "en"];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AiSettings {
    pub base_url: String,
    pub model: String,
    pub tone: String,
    pub show_breakdown: bool,
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            base_url: DEFAULT_BASE_URL.into(),
            model: DEFAULT_MODEL.into(),
            tone: "auto".into(),
            show_breakdown: true,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub theme: String,
    pub app_language: String,
    pub hotkey: String,
    pub inline_hotkey: String,
    /// Hides the island completely (even the compact capsule); the same keys bring it back.
    pub hide_hotkey: String,
    pub show_floating_bubble: bool,
    pub default_engine: String,
    pub auto_copy: bool,
    pub restore_clipboard: bool,
    pub hide_on_blur: bool,
    pub launch_at_startup: bool,
    pub save_history: bool,
    pub history_limit: usize,
    pub native_lang: String,
    pub second_lang: String,
    /// "primary", "cursor", or `at:<x>,<y>` for one display.
    pub screen: String,
    pub sound_enabled: bool,
    pub sound_volume: f64,
    /// Observe Spotify's local Windows media session (no account or API key).
    pub spotify_enabled: bool,
    /// Public OAuth client id of the user's own Spotify developer app (PKCE: no secret).
    pub spotify_client_id: String,
    /// The football page: live score, fixtures and the goal celebration.
    pub football_enabled: bool,
    /// Ari wears the favourite team's kit while it plays.
    pub football_kit: bool,
    /// ESPN id of the favourite team ("" = none chosen yet) and its name for display.
    pub football_team_id: String,
    pub football_team_name: String,
    /// Live prices read through the user's own exchange account (crypto.rs). The
    /// token itself is never a setting: it lives in the Credential Manager.
    pub crypto_enabled: bool,
    /// The Muse tab (muse.ai in the island, muse.rs).
    pub muse_enabled: bool,
    /// "nobitex" or "binance": the exchange whose API the user entered.
    pub crypto_provider: String,
    /// The coin on screen ("BTC") and the market it is read in ("USDT" or "IRT").
    pub crypto_asset: String,
    pub crypto_quote: String,
    /// The coins the user starred, and the one of them shown when the app starts ("" = none).
    pub crypto_favorites: Vec<String>,
    pub crypto_default_asset: String,
    /// Chart timeframe: "1m", "5m", "15m", "1h", "4h", "1d".
    pub crypto_timeframe: String,
    /// Seconds before an open island folds back to its compact size.
    pub auto_close_interval: f64,
    /// The order of the header's feature tabs, rearranged by dragging them.
    pub feature_order: Vec<String>,
    /// How the island looks, as a percentage of its default (100 = as designed; the
    /// transparency is 0 = solid). Each one has its own reset in Settings → Look.
    pub ui_width: f64,
    pub ui_height: f64,
    pub ui_transparency: f64,
    pub ui_font_scale: f64,
    pub ui_corner: f64,
    /// Floating: the island hangs `ui_float_gap` px below the top edge instead of touching it.
    pub ui_floating: bool,
    pub ui_float_gap: f64,
    pub ui_compact_width: f64,
    pub ui_compact_height: f64,
    pub ui_compact_scale: f64,
    /// Ari's outfit: "auto", "none" or an outfit id.
    pub ari_outfit: String,
    /// Interface language of the island: "" follows appLanguage.
    pub language: String,
    pub aphra: AiSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "dark".into(),
            app_language: "fa".into(),
            hotkey: "Alt+D".into(),
            inline_hotkey: "Alt+Shift+D".into(),
            hide_hotkey: "Alt+Shift+H".into(),
            show_floating_bubble: true,
            default_engine: "google".into(),
            auto_copy: false,
            restore_clipboard: true,
            hide_on_blur: false,
            launch_at_startup: false,
            save_history: true,
            history_limit: 100,
            native_lang: "fa".into(),
            second_lang: "en".into(),
            screen: "primary".into(),
            sound_enabled: true,
            sound_volume: 0.5,
            spotify_enabled: true,
            spotify_client_id: String::new(),
            football_enabled: true,
            football_kit: true,
            football_team_id: String::new(),
            football_team_name: String::new(),
            crypto_enabled: true,
            muse_enabled: true,
            crypto_provider: "nobitex".into(),
            crypto_asset: "BTC".into(),
            crypto_quote: "USDT".into(),
            crypto_favorites: Vec::new(),
            crypto_default_asset: String::new(),
            crypto_timeframe: "1m".into(),
            auto_close_interval: 15.0,
            feature_order: FEATURE_TABS.iter().map(|s| s.to_string()).collect(),
            ui_width: 100.0,
            ui_height: 100.0,
            ui_transparency: 0.0,
            ui_font_scale: 100.0,
            ui_corner: 100.0,
            ui_floating: false,
            ui_float_gap: 14.0,
            ui_compact_width: 100.0,
            ui_compact_height: 100.0,
            ui_compact_scale: 100.0,
            ari_outfit: "auto".into(),
            language: String::new(),
            aphra: AiSettings::default(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct HistoryItem {
    pub id: String,
    pub timestamp: String,
    pub query: String,
    pub translation: String,
    pub detected_lang: String,
    pub target_lang: String,
    pub engine: String,
    pub favorite: bool,
}

// ── Merging what the page sends ───────────────────────────────────────────────

fn pick_str(v: Option<&Value>, fallback: &str, max: usize) -> String {
    match v.and_then(Value::as_str) {
        Some(s) => s.trim().chars().take(max).collect(),
        None => fallback.to_string(),
    }
}

fn non_empty(s: String, fallback: &str) -> String {
    if s.is_empty() {
        fallback.to_string()
    } else {
        s
    }
}

fn pick_num(v: Option<&Value>, fallback: f64, lo: f64, hi: f64) -> f64 {
    match v.and_then(Value::as_f64) {
        Some(n) if n.is_finite() && (lo..=hi).contains(&n) => n,
        _ => fallback,
    }
}

fn pick_enum(v: Option<&Value>, allowed: &[&str], fallback: &str) -> String {
    match v.and_then(Value::as_str) {
        Some(s) if allowed.contains(&s) => s.to_string(),
        _ => fallback.to_string(),
    }
}

/// A list of coin tickers: each cleaned, valid, once, in the order given.
fn pick_assets(v: Option<&Value>, fallback: &[String], max: usize) -> Vec<String> {
    let Some(list) = v.and_then(Value::as_array) else { return fallback.to_vec() };
    let mut out: Vec<String> = Vec::new();
    for item in list {
        let Some(s) = item.as_str() else { continue };
        let a = s.trim().to_ascii_uppercase();
        if valid_asset(&a) && !out.contains(&a) && out.len() < max {
            out.push(a);
        }
    }
    out
}

/// The tab order: known names only, once each, in the order given; tabs that are missing
/// come back in their default places. Anything that is not a list keeps the old order.
fn pick_feature_order(v: Option<&Value>, fallback: &[String]) -> Vec<String> {
    let Some(list) = v.and_then(Value::as_array) else { return fallback.to_vec() };
    let mut out: Vec<String> = Vec::new();
    for item in list {
        let Some(s) = item.as_str() else { continue };
        if FEATURE_TABS.contains(&s) && !out.iter().any(|o| o == s) {
            out.push(s.to_string());
        }
    }
    for tab in FEATURE_TABS {
        if !out.iter().any(|o| o == tab) {
            out.push((*tab).to_string());
        }
    }
    out
}

/// The default coin must be one of the favourites; "" clears it, and it goes when its star does.
fn pick_default_asset(v: Option<&Value>, favorites: &[String], base: &str) -> String {
    let kept = if favorites.iter().any(|f| f == base) { base.to_string() } else { String::new() };
    match v.and_then(Value::as_str) {
        Some(s) => {
            let a = s.trim().to_ascii_uppercase();
            if a.is_empty() {
                String::new()
            } else if favorites.contains(&a) {
                a
            } else {
                kept
            }
        }
        None => kept,
    }
}

/// A look setting: a whole number, brought into its range. Anything that is not a number keeps the old value.
fn pick_whole(v: Option<&Value>, fallback: f64, range: (f64, f64)) -> f64 {
    match v.and_then(Value::as_f64) {
        Some(n) if n.is_finite() => n.round().clamp(range.0, range.1),
        _ => fallback,
    }
}

fn pick_bool(v: Option<&Value>, fallback: bool) -> bool {
    v.and_then(Value::as_bool).unwrap_or(fallback)
}

/// Merge `incoming` into `base`, accepting only known keys of the right type.
pub fn merge(base: &Settings, incoming: &Value) -> Settings {
    let a = incoming.get("aphra");
    let limit = incoming.get("historyLimit").and_then(Value::as_f64);
    let favorites = pick_assets(incoming.get("cryptoFavorites"), &base.crypto_favorites, MAX_FAVORITES);
    let default_asset = pick_default_asset(incoming.get("cryptoDefaultAsset"), &favorites, &base.crypto_default_asset);
    Settings {
        theme: pick_enum(incoming.get("theme"), THEMES, &base.theme),
        app_language: pick_enum(incoming.get("appLanguage"), APP_LANGS, &base.app_language),
        hotkey: non_empty(pick_str(incoming.get("hotkey"), &base.hotkey, 60), &base.hotkey),
        inline_hotkey: non_empty(
            pick_str(incoming.get("inlineHotkey"), &base.inline_hotkey, 60),
            &base.inline_hotkey,
        ),
        hide_hotkey: non_empty(pick_str(incoming.get("hideHotkey"), &base.hide_hotkey, 60), &base.hide_hotkey),
        show_floating_bubble: pick_bool(incoming.get("showFloatingBubble"), base.show_floating_bubble),
        default_engine: pick_enum(incoming.get("defaultEngine"), ENGINES, &base.default_engine),
        auto_copy: pick_bool(incoming.get("autoCopy"), base.auto_copy),
        restore_clipboard: pick_bool(incoming.get("restoreClipboard"), base.restore_clipboard),
        hide_on_blur: pick_bool(incoming.get("hideOnBlur"), base.hide_on_blur),
        launch_at_startup: pick_bool(incoming.get("launchAtStartup"), base.launch_at_startup),
        save_history: pick_bool(incoming.get("saveHistory"), base.save_history),
        history_limit: match limit {
            Some(n) if n.is_finite() && (10.0..=1000.0).contains(&n) => n.round() as usize,
            _ => base.history_limit,
        },
        native_lang: non_empty(pick_str(incoming.get("nativeLang"), &base.native_lang, 12), &base.native_lang),
        second_lang: non_empty(pick_str(incoming.get("secondLang"), &base.second_lang, 12), &base.second_lang),
        screen: non_empty(pick_str(incoming.get("screen"), &base.screen, 200), &base.screen),
        sound_enabled: pick_bool(incoming.get("soundEnabled"), base.sound_enabled),
        sound_volume: pick_num(incoming.get("soundVolume"), base.sound_volume, 0.0, 1.0),
        spotify_enabled: pick_bool(incoming.get("spotifyEnabled"), base.spotify_enabled),
        // Empty is a real value (not connected yet); anything else must look like a client id.
        spotify_client_id: {
            let id = pick_str(incoming.get("spotifyClientId"), &base.spotify_client_id, 64);
            if id.chars().all(|c| c.is_ascii_alphanumeric()) { id } else { base.spotify_client_id.clone() }
        },
        football_enabled: pick_bool(incoming.get("footballEnabled"), base.football_enabled),
        football_kit: pick_bool(incoming.get("footballKit"), base.football_kit),
        // Empty is a real value (no team chosen); anything else must be an ESPN numeric id.
        football_team_id: {
            let id = pick_str(incoming.get("footballTeamId"), &base.football_team_id, 9);
            if id.chars().all(|c| c.is_ascii_digit()) { id } else { base.football_team_id.clone() }
        },
        football_team_name: pick_str(incoming.get("footballTeamName"), &base.football_team_name, 60),
        crypto_enabled: pick_bool(incoming.get("cryptoEnabled"), base.crypto_enabled),
        muse_enabled: pick_bool(incoming.get("museEnabled"), base.muse_enabled),
        crypto_provider: pick_enum(incoming.get("cryptoProvider"), CRYPTO_PROVIDERS, &base.crypto_provider),
        crypto_asset: {
            let a = pick_str(incoming.get("cryptoAsset"), &base.crypto_asset, 16).to_ascii_uppercase();
            if valid_asset(&a) { a } else { base.crypto_asset.clone() }
        },
        crypto_quote: pick_enum(incoming.get("cryptoQuote"), CRYPTO_QUOTES, &base.crypto_quote),
        crypto_favorites: favorites,
        crypto_default_asset: default_asset,
        crypto_timeframe: pick_enum(incoming.get("cryptoTimeframe"), CRYPTO_TIMEFRAMES, &base.crypto_timeframe),
        auto_close_interval: pick_num(incoming.get("autoCloseInterval"), base.auto_close_interval, 0.0, 3600.0),
        feature_order: pick_feature_order(incoming.get("featureOrder"), &base.feature_order),
        ui_width: pick_whole(incoming.get("uiWidth"), base.ui_width, UI_WIDTH),
        ui_height: pick_whole(incoming.get("uiHeight"), base.ui_height, UI_HEIGHT),
        ui_transparency: pick_whole(incoming.get("uiTransparency"), base.ui_transparency, UI_TRANSPARENCY),
        ui_font_scale: pick_whole(incoming.get("uiFontScale"), base.ui_font_scale, UI_FONT_SCALE),
        ui_corner: pick_whole(incoming.get("uiCorner"), base.ui_corner, UI_CORNER),
        ui_floating: pick_bool(incoming.get("uiFloating"), base.ui_floating),
        ui_float_gap: pick_whole(incoming.get("uiFloatGap"), base.ui_float_gap, UI_FLOAT_GAP),
        ui_compact_width: pick_whole(incoming.get("uiCompactWidth"), base.ui_compact_width, UI_COMPACT_WIDTH),
        ui_compact_height: pick_whole(incoming.get("uiCompactHeight"), base.ui_compact_height, UI_COMPACT_HEIGHT),
        ui_compact_scale: pick_whole(incoming.get("uiCompactScale"), base.ui_compact_scale, UI_COMPACT_SCALE),
        ari_outfit: non_empty(pick_str(incoming.get("ariOutfit"), &base.ari_outfit, 40), &base.ari_outfit),
        // Empty is a real value here: it means "follow the system".
        language: pick_str(incoming.get("language"), &base.language, 20),
        aphra: AiSettings {
            base_url: non_empty(
                pick_str(a.and_then(|a| a.get("baseUrl")), &base.aphra.base_url, 300),
                DEFAULT_BASE_URL,
            ),
            model: non_empty(pick_str(a.and_then(|a| a.get("model")), &base.aphra.model, 200), DEFAULT_MODEL),
            tone: pick_enum(a.and_then(|a| a.get("tone")), TONES, &base.aphra.tone),
            show_breakdown: pick_bool(a.and_then(|a| a.get("showBreakdown")), base.aphra.show_breakdown),
        },
    }
}

// ── API key ───────────────────────────────────────────────────────────────────

fn key_entry() -> Option<keyring::Entry> {
    keyring::Entry::new(KEY_SERVICE, KEY_NAME).ok()
}

pub fn api_key() -> String {
    key_entry().and_then(|e| e.get_password().ok()).unwrap_or_default()
}

pub fn has_api_key() -> bool {
    !api_key().is_empty()
}

pub fn set_api_key(value: &str) -> Result<(), String> {
    let entry = key_entry().ok_or("credential store unavailable")?;
    if value.is_empty() {
        return clear_api_key();
    }
    entry.set_password(value).map_err(|e| e.to_string())
}

pub fn clear_api_key() -> Result<(), String> {
    let Some(entry) = key_entry() else { return Ok(()) };
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ── Exchange credentials (Windows Credential Manager, one entry per exchange) ──
//
// The page can only ask the backend to connect or to forget: no command hands a
// token back, and none of it is ever written to settings.json.

/// `part` is "token" (Nobitex, Binance key) or "secret" (Binance signing secret).
fn crypto_entry(provider: &str, part: &str) -> Option<keyring::Entry> {
    if !CRYPTO_PROVIDERS.contains(&provider) || !matches!(part, "token" | "secret") {
        return None;
    }
    keyring::Entry::new(KEY_SERVICE, &format!("crypto-{provider}-{part}")).ok()
}

pub fn crypto_credential(provider: &str, part: &str) -> String {
    crypto_entry(provider, part).and_then(|e| e.get_password().ok()).unwrap_or_default()
}

pub fn set_crypto_credential(provider: &str, part: &str, value: &str) -> Result<(), String> {
    let entry = crypto_entry(provider, part).ok_or("credential store unavailable")?;
    if value.is_empty() {
        return clear_crypto_credential(provider, part);
    }
    entry.set_password(value).map_err(|e| e.to_string())
}

pub fn clear_crypto_credential(provider: &str, part: &str) -> Result<(), String> {
    let Some(entry) = crypto_entry(provider, part) else { return Ok(()) };
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Forgets the single shared entry an earlier build used for every exchange.
fn forget_legacy_crypto_entry() {
    if let Ok(entry) = keyring::Entry::new(KEY_SERVICE, "crypto_api_key") {
        let _ = entry.delete_credential();
    }
}

// ── Files ─────────────────────────────────────────────────────────────────────

pub fn config_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
    // Keep the 3.x location and credential service stable across the product rename.
    base.join("Arizo Translate")
}

/// Write via a temp file and a rename so a crash never leaves half a JSON file.
fn write_atomic(file: &Path, data: &Value) -> std::io::Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let text = serde_json::to_string_pretty(data).unwrap_or_else(|_| "null".into());
    let tmp = file.with_extension(format!("{}.tmp", std::process::id()));
    std::fs::write(&tmp, &text)?;
    if std::fs::rename(&tmp, file).is_err() {
        // Explorer or an antivirus may hold the target; write through instead.
        std::fs::write(file, &text)?;
        let _ = std::fs::remove_file(&tmp);
    }
    Ok(())
}

fn read_json(file: &Path) -> Option<Value> {
    let text = std::fs::read_to_string(file).ok()?;
    match serde_json::from_str(&text) {
        Ok(v) => Some(v),
        Err(_) => {
            let _ = std::fs::rename(file, file.with_extension("json.corrupt"));
            None
        }
    }
}

// ── Time and ids ──────────────────────────────────────────────────────────────

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

pub fn iso_now() -> String {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = now.as_secs() as i64;
    let (y, mo, d) = civil_from_days(secs.div_euclid(86_400));
    let rem = secs.rem_euclid(86_400);
    format!(
        "{y:04}-{mo:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60,
        now.subsec_millis()
    )
}

fn base36(mut n: u128) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n == 0 {
        return "0".into();
    }
    let mut out = Vec::new();
    while n > 0 {
        out.push(DIGITS[(n % 36) as usize]);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

fn new_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
    format!("{}{}", base36(ms), base36((COUNTER.fetch_add(1, Ordering::Relaxed) % 1296) as u128))
}

// ── The store ─────────────────────────────────────────────────────────────────

pub struct Store {
    dir: PathBuf,
    settings: Mutex<Settings>,
    history: Mutex<Vec<HistoryItem>>,
}

impl Store {
    pub fn load() -> Self {
        forget_legacy_crypto_entry();
        Self::load_from(config_dir(), legacy_dir())
    }

    pub fn load_from(dir: PathBuf, legacy: Option<PathBuf>) -> Self {
        let settings_file = dir.join("settings.json");
        let history_file = dir.join("history.json");

        let mut settings = match read_json(&settings_file) {
            Some(v) => merge(&Settings::default(), &v),
            None => Settings::default(),
        };
        let mut history: Vec<HistoryItem> = read_json(&history_file)
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();

        // First run after the Electron version: bring over its history and preferences
        // (its encrypted API key can't be read by another app, so that one is re-entered).
        if let Some(old) = legacy {
            if !settings_file.exists() {
                if let Some(v) = read_json(&old.join("config.json")) {
                    settings = merge(&settings, &v);
                }
            }
            if !history_file.exists() {
                if let Some(v) = read_json(&old.join("history.json")) {
                    history = serde_json::from_value(v).unwrap_or_default();
                }
            }
        }

        let store = Self { dir, settings: Mutex::new(settings), history: Mutex::new(history) };
        let _ = store.persist_settings();
        let _ = store.persist_history();
        store
    }

    fn persist_settings(&self) -> std::io::Result<()> {
        let s = self.settings.lock().unwrap().clone();
        write_atomic(&self.dir.join("settings.json"), &serde_json::to_value(s).unwrap_or(Value::Null))
    }

    fn persist_history(&self) -> std::io::Result<()> {
        let h = self.history.lock().unwrap().clone();
        write_atomic(&self.dir.join("history.json"), &serde_json::to_value(h).unwrap_or(Value::Null))
    }

    pub fn settings(&self) -> Settings {
        self.settings.lock().unwrap().clone()
    }

    /// Settings as the page sees them: no key, only whether one is stored.
    pub fn public_settings(&self) -> Value {
        let mut v = serde_json::to_value(self.settings()).unwrap_or(Value::Null);
        if let Some(a) = v.get_mut("aphra").and_then(Value::as_object_mut) {
            a.insert("hasApiKey".into(), json!(has_api_key()));
        }
        v
    }

    /// At start the coin on screen is the user's default one, when they chose one.
    pub fn use_default_crypto_asset(&self) {
        let default = self.settings().crypto_default_asset;
        if !default.is_empty() {
            let _ = self.save_settings(&json!({ "cryptoAsset": default }));
        }
    }

    pub fn save_settings(&self, incoming: &Value) -> Option<Settings> {
        let merged = {
            let mut guard = self.settings.lock().unwrap();
            let merged = merge(&guard, incoming);
            *guard = merged.clone();
            merged
        };
        self.persist_settings().ok()?;
        Some(merged)
    }

    pub fn history(&self) -> Vec<HistoryItem> {
        self.history.lock().unwrap().clone()
    }

    pub fn add_history(&self, mut item: HistoryItem) {
        let settings = self.settings();
        if !settings.save_history {
            return;
        }
        {
            let mut h = self.history.lock().unwrap();
            // Identical consecutive lookups collapse, keeping the newest fresh.
            let same = h.first().is_some_and(|n| {
                n.query == item.query && n.engine == item.engine && n.target_lang == item.target_lang
            });
            if same {
                let first = &mut h[0];
                first.translation = item.translation;
                first.detected_lang = item.detected_lang;
                first.timestamp = iso_now();
            } else {
                item.id = new_id();
                item.timestamp = iso_now();
                h.insert(0, item);
            }
            // Newest first: the cap drops the oldest entry that is not starred,
            // and never the lookup that was just added.
            while h.len() > settings.history_limit {
                match h.iter().rposition(|x| !x.favorite).filter(|&i| i > 0) {
                    Some(i) => {
                        h.remove(i);
                    }
                    None => break,
                }
            }
        }
        let _ = self.persist_history();
    }

    pub fn clear_history(&self) -> bool {
        self.history.lock().unwrap().clear();
        self.persist_history().is_ok()
    }

    pub fn delete_history_item(&self, id: &str) -> Vec<HistoryItem> {
        self.history.lock().unwrap().retain(|h| h.id != id);
        let _ = self.persist_history();
        self.history()
    }

    pub fn toggle_favorite(&self, id: &str) -> Vec<HistoryItem> {
        if let Some(item) = self.history.lock().unwrap().iter_mut().find(|h| h.id == id) {
            item.favorite = !item.favorite;
        }
        let _ = self.persist_history();
        self.history()
    }
}

fn legacy_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join(".aphra-translate"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("arizo-store-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn merge_accepts_only_known_keys_of_the_right_type() {
        let base = Settings::default();
        let m = merge(
            &base,
            &json!({
                "theme": "neon", "appLanguage": "en", "hotkey": "  Ctrl+Alt+K ", "historyLimit": 5,
                "autoCopy": "yes", "defaultEngine": "aphra",
                "aphra": { "tone": "formal", "model": "gpt-4o-mini", "showBreakdown": false, "baseUrl": "" },
                "unknown": 1
            }),
        );
        assert_eq!(m.theme, "dark", "unknown theme is refused");
        assert_eq!(m.app_language, "en");
        assert_eq!(m.hotkey, "Ctrl+Alt+K");
        assert_eq!(m.hide_hotkey, "Alt+Shift+H", "the hide shortcut keeps its default");
        let m2 = merge(&base, &json!({ "hideHotkey": " Ctrl+Alt+H " }));
        assert_eq!(m2.hide_hotkey, "Ctrl+Alt+H");
        assert_eq!(m.history_limit, 100, "out-of-range limit is refused");
        assert!(!m.auto_copy, "a string is not a bool");
        assert_eq!(m.default_engine, "aphra");
        assert_eq!(m.aphra.tone, "formal");
        assert_eq!(m.aphra.model, "gpt-4o-mini");
        assert!(!m.aphra.show_breakdown);
        assert_eq!(m.aphra.base_url, DEFAULT_BASE_URL, "an empty URL falls back");
    }

    #[test]
    fn a_partial_update_keeps_everything_else() {
        let mut base = Settings::default();
        base.aphra.model = "custom".into();
        let m = merge(&base, &json!({ "aphra": { "tone": "literary" } }));
        assert_eq!(m.aphra.model, "custom");
        assert_eq!(m.aphra.tone, "literary");
    }

    #[test]
    fn the_football_team_is_a_plain_id_and_old_preferences_have_none() {
        let old = merge(&Settings::default(), &json!({}));
        assert!(old.football_enabled);
        assert_eq!((old.football_team_id.as_str(), old.football_team_name.as_str()), ("", ""));
        let set = merge(&old, &json!({ "footballTeamId": " 83 ", "footballTeamName": "Barcelona" }));
        assert_eq!((set.football_team_id.as_str(), set.football_team_name.as_str()), ("83", "Barcelona"));
        assert_eq!(merge(&set, &json!({ "footballTeamId": "83; drop" })).football_team_id, "83");
        assert_eq!(merge(&set, &json!({ "footballTeamId": 83 })).football_team_id, "83", "a number is not accepted: the id stays");
        assert_eq!(merge(&set, &json!({ "footballTeamId": "" })).football_team_id, "");
        assert!(!merge(&old, &json!({ "footballEnabled": false })).football_enabled);
        assert!(merge(&old, &json!({ "footballEnabled": "no" })).football_enabled);
        assert!(old.football_kit);
        assert!(!merge(&old, &json!({ "footballKit": false })).football_kit);
        assert_eq!(serde_json::to_value(set).unwrap()["footballTeamId"], "83");
    }

    #[test]
    fn spotify_setting_is_typed_and_old_preferences_keep_the_default() {
        let old: Settings = serde_json::from_value(json!({ "theme": "light", "hotkey": "Ctrl+Alt+D" })).unwrap();
        assert!(old.spotify_enabled);
        assert_eq!(old.hotkey, "Ctrl+Alt+D");
        assert!(!merge(&old, &json!({ "spotifyEnabled": false })).spotify_enabled);
        assert!(merge(&old, &json!({ "spotifyEnabled": "false" })).spotify_enabled);
        assert_eq!(serde_json::to_value(old.clone()).unwrap()["spotifyEnabled"], true);
        assert_eq!(old.spotify_client_id, "");
        assert_eq!(merge(&old, &json!({ "spotifyClientId": " 0123abcDEF " })).spotify_client_id, "0123abcDEF");
        let set = merge(&old, &json!({ "spotifyClientId": "abc123" }));
        assert_eq!(merge(&set, &json!({ "spotifyClientId": "bad id!?" })).spotify_client_id, "abc123");
        assert_eq!(merge(&set, &json!({ "spotifyClientId": "" })).spotify_client_id, "");
        assert_eq!(KEY_SERVICE, "com.arizo.translate", "renaming must not orphan stored API keys");
    }

    #[test]
    fn an_exchange_token_is_never_a_setting() {
        let m = merge(&Settings::default(), &json!({ "cryptoApiKey": "do-not-keep-this", "cryptoToken": "nor-this" }));
        let text = serde_json::to_string(&m).unwrap();
        assert!(!text.contains("do-not-keep-this") && !text.contains("nor-this"));
        assert!(!text.contains("cryptoApiKey") && !text.contains("cryptoToken"));
        // A settings.json written by the earlier build loses the field the next time it is saved.
        let dir = temp("crypto-legacy");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("settings.json"), r#"{"hotkey":"Alt+Q","cryptoApiKey":"old-secret"}"#).unwrap();
        let store = Store::load_from(dir.clone(), None);
        assert_eq!(store.settings().hotkey, "Alt+Q");
        let on_disk = std::fs::read_to_string(dir.join("settings.json")).unwrap();
        assert!(!on_disk.contains("old-secret") && !on_disk.contains("cryptoApiKey"));
        assert!(!store.public_settings().to_string().contains("old-secret"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_crypto_choice_is_validated() {
        let base = Settings::default();
        assert_eq!((base.crypto_provider.as_str(), base.crypto_asset.as_str(), base.crypto_quote.as_str()), ("nobitex", "BTC", "USDT"));
        let m = merge(&base, &json!({ "cryptoProvider": "binance", "cryptoAsset": " eth ", "cryptoQuote": "IRT" }));
        assert_eq!((m.crypto_provider.as_str(), m.crypto_asset.as_str(), m.crypto_quote.as_str()), ("binance", "ETH", "IRT"));
        assert_eq!(merge(&m, &json!({ "cryptoProvider": "evil" })).crypto_provider, "binance", "an unknown exchange is refused");
        assert_eq!(merge(&m, &json!({ "cryptoAsset": "E T H!" })).crypto_asset, "ETH", "a malformed ticker is refused");
        assert_eq!(merge(&m, &json!({ "cryptoAsset": "" })).crypto_asset, "ETH");
        assert_eq!(merge(&m, &json!({ "cryptoQuote": "EUR" })).crypto_quote, "IRT");
        assert_eq!(merge(&m, &json!({ "cryptoAsset": 5 })).crypto_asset, "ETH", "a number is not a ticker");
        assert_eq!(merge(&m, &json!({ "cryptoAsset": "ABCDEFGHIJKLMNOP" })).crypto_asset, "ABCDEFGHIJKLMNOP", "a 16-char ticker is kept whole");
        assert!(valid_asset("1INCH") && valid_asset("BTC") && valid_asset("1K_SHIB") && valid_asset("1M_PEPE"));
        assert!(!valid_asset("btc") && !valid_asset("") && !valid_asset("A-B") && !valid_asset("_X") && !valid_asset(&"A".repeat(17)));
    }

    #[test]
    fn favourites_are_clean_and_the_default_is_always_one_of_them() {
        let base = Settings::default();
        assert!(base.crypto_favorites.is_empty() && base.crypto_default_asset.is_empty());
        let m = merge(&base, &json!({ "cryptoFavorites": [" btc ", "ETH", "eth", "bad coin", 7, "SOL"], "cryptoDefaultAsset": "eth" }));
        assert_eq!(m.crypto_favorites, ["BTC", "ETH", "SOL"], "cleaned, once each, in order");
        assert_eq!(m.crypto_default_asset, "ETH");
        // A default that is not starred is refused; the old one stays.
        assert_eq!(merge(&m, &json!({ "cryptoDefaultAsset": "DOGE" })).crypto_default_asset, "ETH");
        // "" clears it.
        assert_eq!(merge(&m, &json!({ "cryptoDefaultAsset": "" })).crypto_default_asset, "");
        // Taking the star off the default takes the default with it.
        let less = merge(&m, &json!({ "cryptoFavorites": ["BTC", "SOL"] }));
        assert_eq!((less.crypto_favorites.len(), less.crypto_default_asset.as_str()), (2, ""));
        // Not a list: nothing changes. The list is capped.
        assert_eq!(merge(&m, &json!({ "cryptoFavorites": "BTC" })).crypto_favorites, m.crypto_favorites);
        let many: Vec<String> = (0..100).map(|i| format!("C{i}")).collect();
        assert_eq!(merge(&base, &json!({ "cryptoFavorites": many })).crypto_favorites.len(), MAX_FAVORITES);
        // Toobit is a known exchange.
        assert_eq!(merge(&base, &json!({ "cryptoProvider": "toobit" })).crypto_provider, "toobit");
    }

    #[test]
    fn the_tab_order_is_always_a_full_permutation_of_the_known_tabs() {
        let base = Settings::default();
        assert_eq!(base.feature_order, ["translate", "spotify", "football", "crypto", "muse"]);
        let m = merge(&base, &json!({ "featureOrder": ["crypto", "translate", "bogus", "crypto", 7] }));
        assert_eq!(m.feature_order, ["crypto", "translate", "spotify", "football", "muse"], "unknown and repeated names go, missing ones come back");
        // Not a list: nothing changes. An empty list restores the default order.
        assert_eq!(merge(&m, &json!({ "featureOrder": "crypto" })).feature_order, m.feature_order);
        assert_eq!(merge(&m, &json!({ "featureOrder": [] })).feature_order, base.feature_order);
        // Settings saved before the tabs could be moved read back in the default order.
        let old: Settings = serde_json::from_value(json!({ "hotkey": "Alt+Q" })).unwrap();
        assert_eq!(old.feature_order, base.feature_order);
    }

    #[test]
    fn the_look_settings_are_whole_percentages_inside_their_range() {
        let base = Settings::default();
        assert_eq!((base.ui_width, base.ui_height, base.ui_transparency, base.ui_font_scale, base.ui_corner), (100.0, 100.0, 0.0, 100.0, 100.0));
        let m = merge(&base, &json!({ "uiWidth": 112.4, "uiHeight": 118, "uiTransparency": 35.6, "uiFontScale": 125, "uiCorner": 0 }));
        assert_eq!((m.ui_width, m.ui_height, m.ui_transparency, m.ui_font_scale, m.ui_corner), (112.0, 118.0, 36.0, 125.0, 0.0));
        // Out of range is brought to the nearest end, never refused.
        let wild = merge(&m, &json!({ "uiWidth": 5000, "uiHeight": -3, "uiTransparency": 100, "uiFontScale": 1, "uiCorner": 9999 }));
        assert_eq!((wild.ui_width, wild.ui_height, wild.ui_transparency, wild.ui_font_scale, wild.ui_corner), (UI_WIDTH.1, UI_HEIGHT.0, UI_TRANSPARENCY.1, UI_FONT_SCALE.0, UI_CORNER.1));
        // Not a number: nothing changes. Other settings are left alone.
        let same = merge(&m, &json!({ "uiWidth": "wide", "uiHeight": null, "uiCorner": [1] }));
        assert_eq!((same.ui_width, same.ui_height, same.ui_corner), (m.ui_width, m.ui_height, m.ui_corner));
        // Settings saved before the look could be changed read back as the defaults.
        let old: Settings = serde_json::from_value(json!({ "hotkey": "Alt+Q" })).unwrap();
        assert_eq!((old.ui_width, old.ui_transparency, old.ui_font_scale), (100.0, 0.0, 100.0));
        // The defaults are inside their own ranges, so "reset" is always a valid value.
        for (v, r) in [(100.0, UI_WIDTH), (100.0, UI_HEIGHT), (0.0, UI_TRANSPARENCY), (100.0, UI_FONT_SCALE), (100.0, UI_CORNER), (14.0, UI_FLOAT_GAP)] {
            assert!(v >= r.0 && v <= r.1);
        }
        // Floating: off by default, a gap inside its range, and a stray value changes nothing.
        assert!(!base.ui_floating && base.ui_float_gap == 14.0);
        let fl = merge(&base, &json!({ "uiFloating": true, "uiFloatGap": 2000 }));
        assert!(fl.ui_floating && fl.ui_float_gap == UI_FLOAT_GAP.1);
        assert_eq!(merge(&fl, &json!({ "uiFloatGap": 1 })).ui_float_gap, UI_FLOAT_GAP.0);
        assert!(merge(&fl, &json!({ "uiFloating": "yes" })).ui_floating, "not a bool: unchanged");
        assert!(!merge(&fl, &json!({ "uiFloating": false })).ui_floating);
        // The folded island: defaults are the design, values are brought into range, junk changes nothing.
        assert_eq!((base.ui_compact_width, base.ui_compact_height, base.ui_compact_scale), (100.0, 100.0, 100.0));
        let c = merge(&base, &json!({ "uiCompactWidth": 130.4, "uiCompactHeight": 150, "uiCompactScale": 120 }));
        assert_eq!((c.ui_compact_width, c.ui_compact_height, c.ui_compact_scale), (130.0, 150.0, 120.0));
        let cw = merge(&c, &json!({ "uiCompactWidth": 1, "uiCompactHeight": 9999, "uiCompactScale": -4 }));
        assert_eq!((cw.ui_compact_width, cw.ui_compact_height, cw.ui_compact_scale), (UI_COMPACT_WIDTH.0, UI_COMPACT_HEIGHT.1, UI_COMPACT_SCALE.0));
        let cj = merge(&c, &json!({ "uiCompactWidth": "wide", "uiCompactScale": null }));
        assert_eq!((cj.ui_compact_width, cj.ui_compact_scale), (c.ui_compact_width, c.ui_compact_scale));
        for (v, r) in [(100.0, UI_COMPACT_WIDTH), (100.0, UI_COMPACT_HEIGHT), (100.0, UI_COMPACT_SCALE)] {
            assert!(v >= r.0 && v <= r.1, "the default is inside its range");
        }
    }

    #[test]
    fn credentials_have_one_slot_per_exchange_and_never_for_strangers() {
        assert!(crypto_entry("nobitex", "token").is_some());
        assert!(crypto_entry("binance", "secret").is_some());
        assert!(crypto_entry("evil", "token").is_none(), "only known exchanges get a slot");
        assert!(crypto_entry("nobitex", "../x").is_none(), "only known parts get a slot");
        assert_eq!(crypto_credential("evil", "token"), "");
        assert!(clear_crypto_credential("evil", "token").is_ok());
    }

    #[test]
    fn iso_timestamps_are_well_formed() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_723), (2024, 1, 1));
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
        let s = iso_now();
        assert_eq!(s.len(), 24);
        assert!(s.ends_with('Z') && s.as_bytes()[10] == b'T');
    }

    #[test]
    fn history_collapses_repeats_trims_and_toggles() {
        let dir = temp("history");
        let store = Store::load_from(dir.clone(), None);
        let item = |q: &str, e: &str| HistoryItem {
            query: q.into(),
            translation: format!("{q}!"),
            engine: e.into(),
            target_lang: "fa".into(),
            ..Default::default()
        };
        store.add_history(item("a", "google"));
        store.add_history(item("a", "google"));
        assert_eq!(store.history().len(), 1, "same lookup collapses");
        store.add_history(item("a", "aphra"));
        assert_eq!(store.history().len(), 2, "another engine is another entry");

        let id = store.history()[0].id.clone();
        assert!(!id.is_empty());
        assert!(store.toggle_favorite(&id)[0].favorite);
        assert_eq!(store.delete_history_item(&id).len(), 1);

        store.save_settings(&json!({ "saveHistory": false }));
        store.add_history(item("b", "google"));
        assert_eq!(store.history().len(), 1, "history off stores nothing");

        // Survives a restart.
        let again = Store::load_from(dir.clone(), None);
        assert_eq!(again.history().len(), 1);
        assert!(!again.settings().save_history);
        assert!(again.clear_history());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_history_cap_keeps_starred_items() {
        let dir = temp("history-cap");
        let store = Store::load_from(dir.clone(), None);
        store.save_settings(&json!({ "historyLimit": 10 }));
        let item = |q: &str| HistoryItem { query: q.into(), engine: "google".into(), ..Default::default() };
        store.add_history(item("starred"));
        let id = store.history()[0].id.clone();
        store.toggle_favorite(&id);
        for i in 0..15 {
            store.add_history(item(&format!("q{i}")));
        }
        let h = store.history();
        assert_eq!(h.len(), 10);
        assert!(h.iter().any(|x| x.query == "starred" && x.favorite), "the starred lookup survives the cap");
        assert_eq!(h[0].query, "q14", "the newest stays first");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_history_full_of_stars_still_records_the_new_lookup() {
        let dir = temp("history-stars");
        let store = Store::load_from(dir.clone(), None);
        store.save_settings(&json!({ "historyLimit": 10 }));
        let item = |q: &str| HistoryItem { query: q.into(), engine: "google".into(), ..Default::default() };
        for i in 0..10 {
            store.add_history(item(&format!("s{i}")));
            let id = store.history()[0].id.clone();
            store.toggle_favorite(&id);
        }
        store.add_history(item("new1"));
        assert_eq!(store.history()[0].query, "new1", "the lookup just made is kept");
        assert_eq!(store.history().len(), 11, "starred items are never dropped by the cap");
        store.add_history(item("new2"));
        let h = store.history();
        assert_eq!(h[0].query, "new2");
        assert_eq!(h.len(), 11, "the older unstarred lookup makes room");
        assert_eq!(h.iter().filter(|x| x.favorite).count(), 10);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_electron_version_history_is_imported_once() {
        let dir = temp("new");
        let old = temp("old");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(
            old.join("history.json"),
            r#"[{"id":"x1","timestamp":"2026-01-01T00:00:00.000Z","query":"hi","translation":"سلام","detectedLang":"en","targetLang":"fa","engine":"google","favorite":true}]"#,
        )
        .unwrap();
        std::fs::write(old.join("config.json"), r#"{"hotkey":"Alt+Q","aphra":{"apiKeyEnc":"enc:zzz","tone":"formal"}}"#).unwrap();
        let store = Store::load_from(dir.clone(), Some(old.clone()));
        assert_eq!(store.history()[0].translation, "سلام");
        assert!(store.history()[0].favorite);
        assert_eq!(store.settings().hotkey, "Alt+Q");
        assert_eq!(store.settings().aphra.tone, "formal");
        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::remove_dir_all(old);
    }
}
