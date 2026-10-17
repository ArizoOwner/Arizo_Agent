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
    /// Seconds before an open island folds back to its compact size.
    pub auto_close_interval: f64,
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
            auto_close_interval: 15.0,
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

fn pick_bool(v: Option<&Value>, fallback: bool) -> bool {
    v.and_then(Value::as_bool).unwrap_or(fallback)
}

/// Merge `incoming` into `base`, accepting only known keys of the right type.
pub fn merge(base: &Settings, incoming: &Value) -> Settings {
    let a = incoming.get("aphra");
    let limit = incoming.get("historyLimit").and_then(Value::as_f64);
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
        auto_close_interval: pick_num(incoming.get("autoCloseInterval"), base.auto_close_interval, 0.0, 3600.0),
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
            h.truncate(settings.history_limit);
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
