// Arizo-Agent — app wiring and the commands the island calls.
//
// Three windows:
//   island    the translator: a transparent, always-on-top window whose island is
//             glued to the top centre of the screen (Coucou's own island window)
//   bubble    a tiny button (and a small result card) that follows a text selection
//   settings  an ordinary window, created hidden, shown on demand
//
// The pages never touch the OS or the network: they call the commands below.

mod aphra;
mod crypto;
mod football;
mod google;
mod idioms;
mod input;
mod island;
mod langs;
mod model;
mod muse;
mod platform;
mod setup;
mod spotify;
mod spotify_account;
mod spotify_local;
mod store;
mod textutil;
mod translator;
mod tts;

use std::collections::HashMap;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use aphra::AiConfig;
use island::{IslandRect, PollGate};
use langs::Lang;
use model::Reply;
use store::{HistoryItem, Store};
use translator::{Request, Translator};

use island::WINDOW_LABEL as ISLAND;
const BUBBLE: &str = "bubble";
/// The longest text translated, in characters: a long article. Both engines translate long
/// text in pieces, so this only keeps a mistaken paste of a whole book from running for minutes.
const MAX_TEXT: usize = 30_000;

/// The bubble's translator numbers its requests from 1_000_000 (web/src/bubble/main.ts),
/// the island's from 0: that tells the two windows' translations apart.
fn is_bubble_request(request_id: u64) -> bool {
    request_id >= 1_000_000
}

pub struct AppState {
    store: Store,
    translator: Translator,
    client: reqwest::Client,
    /// The translation in flight per window (see `is_bubble_request`); a new one
    /// in the same window cancels it, one in the other window leaves it alone.
    active: Mutex<HashMap<bool, tokio::task::AbortHandle>>,
    hotkey: Mutex<Option<Shortcut>>,
    inline_hotkey: Mutex<Option<Shortcut>>,
    hide_hotkey: Mutex<Option<Shortcut>>,
    /// The island window is hidden on purpose (the hide shortcut), capsule included.
    hidden: AtomicBool,
    /// Click-through and the cursor poll, as in Coucou's island window.
    gate: Arc<PollGate>,
}

pub(crate) fn log(line: &str) {
    use std::io::Write;
    let dir = store::config_dir();
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("arizo.log");
    // Keep one previous generation so the log cannot grow without bound.
    if std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0) > 1_000_000 {
        let _ = std::fs::rename(&path, dir.join("arizo.log.1"));
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{} {line}", store::iso_now());
    }
}

fn tr(lang: &str, fa: &'static str, en: &'static str) -> &'static str {
    if lang == "en" { en } else { fa }
}

fn state(app: &AppHandle) -> Arc<AppState> {
    app.state::<Arc<AppState>>().inner().clone()
}

fn island(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(ISLAND)
}

fn bubble(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(BUBBLE)
}

// ── The island ────────────────────────────────────────────────────────────────

/// The display preference stored in settings ("primary", "cursor", "at:x,y").
pub fn screen_pref(app: &AppHandle) -> String {
    state(app).store.settings().screen
}

/// Opens the island on the translate view. The window is always full size and
/// always visible: the page draws the island inside it and Rust makes it
/// click-through (island.rs), so showing the island is the page's doing.
fn show_island(app: &AppHandle, text: &str) {
    let st = state(app);
    let was_hidden = st.hidden.swap(false, Ordering::Relaxed);
    if let Some(win) = island(app) {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_always_on_top(true);
    }
    st.gate.collapsed.store(false, Ordering::Relaxed);
    island::apply_geometry(app, &st.store.settings().screen, false);
    island::refresh_click_through(app, &st.gate);
    st.gate.set_active(true);
    if text.is_empty() {
        let _ = app.emit("tray", "open".to_string());
    } else {
        let _ = app.emit("captured-text", text.to_string());
    }
    if was_hidden {
        refresh_tray(app);
    }
}

fn hide_island(app: &AppHandle) {
    if let Some(win) = island(app) {
        platform::set_activating(&win, false);
    }
    let _ = app.emit("tray", "close".to_string());
}

fn hide_bubble(app: &AppHandle) {
    if let Some(b) = bubble(app) {
        if b.is_visible().unwrap_or(false) {
            // The page stops its audio, its timers and any translation in flight.
            let _ = app.emit("bubble-hide", ());
            let _ = b.hide();
        }
    }
}


// ── Hotkeys ───────────────────────────────────────────────────────────────────

/// A global shortcut needs Ctrl, Alt or the Windows key (or an F-key), or it would
/// take a plain key away from every other app.
fn parse_hotkey(keys: &str) -> Option<Shortcut> {
    use tauri_plugin_global_shortcut::Modifiers;
    let shortcut = Shortcut::from_str(keys.trim()).ok()?;
    let strong = shortcut.mods.intersects(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER | Modifiers::META);
    let key = format!("{:?}", shortcut.key);
    let f_key = key.len() >= 2 && key.starts_with('F') && key[1..].chars().all(|c| c.is_ascii_digit());
    (strong || f_key).then_some(shortcut)
}

/// Registers `keys` in `slot`. On failure the previous shortcut is put back, so the
/// user is never left without one. `others` are the other actions' keys: no clashes.
fn set_hotkey(app: &AppHandle, slot: &Mutex<Option<Shortcut>>, others: &[&Mutex<Option<Shortcut>>], keys: &str) -> bool {
    let gs = app.global_shortcut();
    let prev = *slot.lock().unwrap();
    if keys.trim().is_empty() {
        if let Some(p) = prev {
            let _ = gs.unregister(p);
        }
        *slot.lock().unwrap() = None;
        return true;
    }
    let Some(new) = parse_hotkey(keys) else { return false };
    if others.iter().any(|o| o.lock().unwrap().is_some_and(|o| o.id() == new.id())) {
        return false;
    }
    if prev.is_some_and(|p| p.id() == new.id()) {
        return true;
    }
    if let Some(p) = prev {
        let _ = gs.unregister(p);
    }
    match gs.register(new) {
        Ok(()) => {
            *slot.lock().unwrap() = Some(new);
            true
        }
        Err(err) => {
            log(&format!("hotkey {keys} not registered: {err}"));
            if let Some(p) = prev {
                let _ = gs.register(p);
            }
            false
        }
    }
}

/// Hides the island window altogether (the capsule too), or brings it back as it was.
/// While hidden nothing runs: the cursor poll parks and the bubble goes away.
fn toggle_island_hidden(app: &AppHandle) {
    let st = state(app);
    let hide = !st.hidden.load(Ordering::Relaxed);
    st.hidden.store(hide, Ordering::Relaxed);
    let Some(win) = island(app) else { return };
    if hide {
        st.gate.set_active(false);
        hide_bubble(app);
        let _ = win.hide();
        let _ = app.emit("tray", "close".to_string());
    } else {
        let collapsed = st.gate.collapsed.load(Ordering::Relaxed);
        island::apply_geometry(app, &st.store.settings().screen, collapsed);
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_always_on_top(true);
        island::refresh_click_through(app, &st.gate);
        st.gate.set_active(!collapsed);
        let _ = app.emit("tray", "open".to_string());
    }
    refresh_tray(app);
}

/// The island shortcut: open it on the selected text.
fn on_hotkey(app: &AppHandle) {
    let st = state(app);
    let settings = st.store.settings();
    input::save_target_window();
    input::wait_modifiers_released(400);
    let text = input::capture_selected(settings.restore_clipboard);
    hide_bubble(app);
    show_island(app, &text);
}

/// The in-place shortcut: translate the selection (or the whole field) and write it
/// back where it came from, without opening anything.
fn on_inline(app: &AppHandle) {
    let st = state(app);
    let settings = st.store.settings();
    let lang = settings.app_language.clone();
    input::save_target_window();
    let original = input::snapshot();
    input::wait_modifiers_released(600);
    thread::sleep(Duration::from_millis(50));

    let text = input::capture_text_or_field();
    if text.is_empty() {
        let _ = app.emit_to(ISLAND, "toast", tr(&lang, "متنی برای ترجمه درجا یافت نشد", "No text to translate in place"));
        if settings.restore_clipboard {
            input::restore(&original);
        }
        return;
    }

    let reply = tauri::async_runtime::block_on(st.translator.translate(
        &st.client,
        &st.store,
        Request {
            request_id: 0,
            text: text.chars().take(MAX_TEXT).collect(),
            engine: settings.default_engine.clone(),
            tone: None,
            target_lang: "auto".into(),
        },
        |_| {},
    ));
    let translated = reply.data.map(|d| d.translation).unwrap_or_default();
    if translated.is_empty() {
        let _ = app.emit_to(ISLAND, "toast", tr(&lang, "خطا در دریافت ترجمه درجا", "In-place translation failed"));
        if settings.restore_clipboard {
            input::restore(&original);
        }
        return;
    }
    input::restore_target_window();
    thread::sleep(Duration::from_millis(40));
    if input::paste_or_keep(&translated, Some(original), settings.restore_clipboard) == input::PasteOutcome::KeptOnClipboard {
        notify_kept_on_clipboard(app, &lang);
    }
}

/// The paste could not be delivered: say where the translation is, instead of failing in silence.
fn notify_kept_on_clipboard(app: &AppHandle, lang: &str) {
    let _ = app.emit(
        "toast",
        tr(lang, "جایگزینی نشد؛ ترجمه کپی شد، با Ctrl+V بچسبانید", "Could not replace here; the translation is copied, press Ctrl+V"),
    );
}

// ── The floating bubble ───────────────────────────────────────────────────────

fn cursor_inside(win: &WebviewWindow, x: i32, y: i32) -> bool {
    if !win.is_visible().unwrap_or(false) {
        return false;
    }
    match (win.outer_position(), win.outer_size()) {
        (Ok(p), Ok(s)) => x >= p.x && x <= p.x + s.width as i32 && y >= p.y && y <= p.y + s.height as i32,
        _ => false,
    }
}

/// The bubble's button window, in logical pixels: the 44px squircle and room for
/// its shadow (web/src/bubble/geometry.ts says the same).
const BUBBLE_WINDOW: f64 = 68.0;

/// Where the bubble's window goes for a selection that ended at the cursor
/// `(x, y)`, on a monitor at `(mx, my)` of size `(mw, mh)` (all physical pixels).
/// Beside the cursor, above it when there is room (never on top of the text), and
/// always fully inside the monitor.
fn bubble_position(x: i32, y: i32, size: i32, scale: f64, (mx, my, mw, mh): (i32, i32, i32, i32)) -> (i32, i32) {
    let pad = (8.0 * scale) as i32;
    let mut px = x + (14.0 * scale) as i32;
    let mut py = y - size - (6.0 * scale) as i32;
    if py < my + pad {
        py = y + (22.0 * scale) as i32;
    }
    px = px.clamp(mx + pad, (mx + mw - size - pad).max(mx + pad));
    py = py.clamp(my + pad, (my + mh - size - pad).max(my + pad));
    (px, py)
}

fn show_bubble(app: &AppHandle, b: &WebviewWindow, x: i32, y: i32) {
    let Ok(monitors) = app.available_monitors() else { return };
    let Some(m) = monitors.iter().find(|m| island::monitor_contains(m, x as f64, y as f64)).or(monitors.first()) else { return };
    let scale = m.scale_factor();
    let size = (BUBBLE_WINDOW * scale).round() as i32;
    let (mp, ms) = (m.position(), m.size());
    let (px, py) = bubble_position(x, y, size, scale, (mp.x, mp.y, ms.width as i32, ms.height as i32));

    // Order matters: the page is told to start over BEFORE the window shows, so
    // the previous card is never flashed at the new place.
    let _ = app.emit_to(BUBBLE, "bubble-init", json!({ "text": "" }));
    // Position first: moving across displays can rescale the window, so the
    // size is set after the move and once more after the show.
    let _ = b.set_position(PhysicalPosition::new(px, py));
    let _ = b.set_size(PhysicalSize::new(size as u32, size as u32));
    let _ = b.set_always_on_top(true);
    let _ = b.show(); // the window never takes the focus
    let _ = b.set_size(PhysicalSize::new(size as u32, size as u32));
}

fn handle_mouse(app: &AppHandle, event: input::MouseEvent, x: i32, y: i32) {
    let st = state(app);
    let inside_island = island(app).is_some_and(|i| island::cursor_on_island(&i, &st.gate, x, y));
    let inside_bubble = bubble(app).is_some_and(|b| cursor_inside(&b, x, y));

    // When clicking outside with the mouse while the island is expanded, smoothly collapse it to compact
    if matches!(event, input::MouseEvent::Click | input::MouseEvent::RightClick) {
        if !inside_island && !inside_bubble {
            let _ = app.emit_to(ISLAND, "tray", "collapse".to_string());
        }
    }

    let Some(b) = bubble(app) else { return };
    match event {
        input::MouseEvent::RightClick => hide_bubble(app),
        input::MouseEvent::Click => {
            if b.is_visible().unwrap_or(false) && !inside_bubble {
                let _ = app.emit_to(BUBBLE, "bubble-hide", ());
                let _ = b.hide();
            }
        }
        input::MouseEvent::Selection => {
            if inside_island || inside_bubble {
                return;
            }
            input::save_target_window();
            if st.store.settings().show_floating_bubble {
                show_bubble(app, &b, x, y);
            }
        }
    }
}

fn apply_mouse_monitor(app: &AppHandle, on: bool) {
    if on {
        let app = app.clone();
        input::start_mouse_monitor(move |event, x, y| handle_mouse(&app, event, x, y));
    } else {
        input::stop_mouse_monitor();
    }
}

// ── Tray ──────────────────────────────────────────────────────────────────────

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let st = state(app);
    let s = st.store.settings();
    let is_fa = s.app_language == "fa";
    let hidden = st.hidden.load(Ordering::Relaxed);

    let header = MenuItem::with_id(
        app,
        "header",
        if is_fa { "✦ آریزو ایجنت | Arizo-Agent" } else { "✦ Arizo-Agent" },
        false,
        None::<&str>,
    )?;

    let open_text = if is_fa {
        format!("🏝️  باز کردن جزیره\t{}", s.hotkey)
    } else {
        format!("🏝️  Open Island\t{}", s.hotkey)
    };
    let open = MenuItem::with_id(app, "open", open_text, true, None::<&str>)?;

    let clip_text = if is_fa {
        "📋  ترجمه متن کلیپ‌بورد"
    } else {
        "📋  Translate Clipboard"
    };
    let clip = MenuItem::with_id(app, "clipboard", clip_text, true, None::<&str>)?;

    let toggle_text = if is_fa {
        if hidden {
            format!("👁️  نمایش جزیره\t{}", s.hide_hotkey)
        } else {
            format!("👁️  پنهان کردن جزیره\t{}", s.hide_hotkey)
        }
    } else {
        if hidden {
            format!("👁️  Show Island\t{}", s.hide_hotkey)
        } else {
            format!("👁️  Hide Island\t{}", s.hide_hotkey)
        }
    };
    let toggle = MenuItem::with_id(app, "toggle", toggle_text, true, None::<&str>)?;

    let quit_text = if is_fa { "✕  خروج" } else { "✕  Quit" };
    let quit = MenuItem::with_id(app, "quit", quit_text, true, None::<&str>)?;

    let sep_top = PredefinedMenuItem::separator(app)?;
    let sep_bottom = PredefinedMenuItem::separator(app)?;

    Menu::with_items(app, &[&header, &sep_top, &open, &clip, &toggle, &sep_bottom, &quit])
}

fn refresh_tray(app: &AppHandle) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id("main"), build_menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Arizo-Agent")
        .menu(&build_menu(app)?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                input::clear_target_window();
                show_island(app, "");
            }
            "clipboard" => {
                input::clear_target_window();
                let text: String = input::read_text().trim().chars().take(MAX_TEXT).collect();
                if text.is_empty() {
                    let lang = state(app).store.settings().app_language;
                    let msg = if lang == "fa" { "کلیپ‌بورد خالی است" } else { "Clipboard is empty" };
                    let _ = app.emit("toast", msg.to_string());
                    show_island(app, "");
                } else {
                    show_island(app, &text);
                }
            }
            "toggle" => toggle_island_hidden(app),
            "autostart" => {
                let st = state(app);
                let on = !st.store.settings().launch_at_startup;
                st.store.save_settings(&json!({ "launchAtStartup": on }));
                apply_autostart(app, on);
                refresh_tray(app);
                let _ = app.emit("settings-changed", st.store.public_settings());
            }
            "settings" => {
                input::clear_target_window();
                let st = state(app);
                st.hidden.store(false, Ordering::Relaxed);
                if let Some(win) = island(app) {
                    let _ = win.unminimize();
                    let _ = win.show();
                    let _ = win.set_always_on_top(true);
                }
                st.gate.collapsed.store(false, Ordering::Relaxed);
                island::apply_geometry(app, &st.store.settings().screen, false);
                island::refresh_click_through(app, &st.gate);
                st.gate.set_active(true);
                let _ = app.emit("tray", "settings".to_string());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                input::clear_target_window();
                show_island(tray.app_handle(), "");
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

fn apply_autostart(app: &AppHandle, on: bool) {
    let manager = app.autolaunch();
    let result = if on { manager.enable() } else { manager.disable() };
    if let Err(err) = result {
        log(&format!("autostart: {err}"));
    }
}

// ── Commands: settings and history ────────────────────────────────────────────

#[tauri::command]
fn get_settings(st: State<'_, Arc<AppState>>) -> Value {
    st.store.public_settings()
}

#[tauri::command]
fn get_languages() -> Vec<Lang> {
    langs::LANGUAGES.to_vec()
}

#[tauri::command]
fn save_settings(
    app: AppHandle,
    st: State<'_, Arc<AppState>>,
    settings: Value,
    api_key: Option<String>,
    clear_api_key: Option<bool>,
) -> Value {
    let before = st.store.settings();
    if clear_api_key.unwrap_or(false) {
        let _ = store::clear_api_key();
    }
    if let Some(key) = api_key.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
        if let Err(err) = store::set_api_key(key) {
            log(&format!("could not store the API key: {err}"));
            return json!({ "ok": false });
        }
    }
    let Some(saved) = st.store.save_settings(&settings) else { return json!({ "ok": false }) };

    let mut hotkey_ok = true;
    if saved.hotkey != before.hotkey {
        hotkey_ok = set_hotkey(&app, &st.hotkey, &[&st.inline_hotkey, &st.hide_hotkey], &saved.hotkey);
        if !hotkey_ok {
            st.store.save_settings(&json!({ "hotkey": before.hotkey }));
        }
    }
    let mut inline_ok = true;
    if saved.inline_hotkey != before.inline_hotkey {
        inline_ok = set_hotkey(&app, &st.inline_hotkey, &[&st.hotkey, &st.hide_hotkey], &saved.inline_hotkey);
        if !inline_ok {
            st.store.save_settings(&json!({ "inlineHotkey": before.inline_hotkey }));
        }
    }
    let mut hide_ok = true;
    if saved.hide_hotkey != before.hide_hotkey {
        hide_ok = set_hotkey(&app, &st.hide_hotkey, &[&st.hotkey, &st.inline_hotkey], &saved.hide_hotkey);
        if !hide_ok {
            st.store.save_settings(&json!({ "hideHotkey": before.hide_hotkey }));
        }
    }
    if saved.launch_at_startup != before.launch_at_startup {
        apply_autostart(&app, saved.launch_at_startup);
    }
    if saved.show_floating_bubble != before.show_floating_bubble && !saved.show_floating_bubble {
        hide_bubble(&app);
    }
    if before.muse_enabled && !saved.muse_enabled {
        muse::close(&app);
    }
    spotify::sync(&app, saved.spotify_enabled, &saved.spotify_client_id);
    football::sync(&app, saved.football_enabled, &saved.football_team_id, &saved.football_team_name);
    crypto::sync(&app);
    refresh_tray(&app);
    let public = st.store.public_settings();
    let _ = app.emit("settings-changed", public.clone());
    json!({ "ok": true, "hotkeyOk": hotkey_ok, "inlineHotkeyOk": inline_ok, "hideHotkeyOk": hide_ok, "settings": public })
}

#[tauri::command]
fn get_history(st: State<'_, Arc<AppState>>) -> Vec<HistoryItem> {
    st.store.history()
}

#[tauri::command]
fn clear_history(st: State<'_, Arc<AppState>>) -> bool {
    st.store.clear_history()
}

#[tauri::command]
fn delete_history_item(st: State<'_, Arc<AppState>>, id: String) -> Vec<HistoryItem> {
    st.store.delete_history_item(&id)
}

#[tauri::command]
fn toggle_favorite_item(st: State<'_, Arc<AppState>>, id: String) -> Vec<HistoryItem> {
    st.store.toggle_favorite(&id)
}

// ── Commands: translating ─────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranslateParams {
    /// The quick-translate bubble sends none: 0 is "not the island's request".
    #[serde(default)]
    request_id: u64,
    text: String,
    #[serde(default)]
    engine: String,
    #[serde(default)]
    tone: Option<String>,
    #[serde(default)]
    target_lang: String,
}

#[tauri::command]
async fn translate(app: AppHandle, st: State<'_, Arc<AppState>>, params: TranslateParams) -> Result<Reply, String> {
    let state = st.inner().clone();
    let request_id = params.request_id;
    let request = Request {
        request_id,
        text: params.text.chars().take(MAX_TEXT).collect(),
        engine: params.engine,
        tone: params.tone,
        target_lang: params.target_lang,
    };

    // The model streams: show the text as it is written, but never flood the page.
    let started = Instant::now();
    let last_sent = AtomicU64::new(0);
    let on_partial = move |partial: String| {
        let now = started.elapsed().as_millis() as u64 + 1;
        // An empty update wipes what was shown (the smart engine gave up): it is never dropped.
        if partial.is_empty() || now.saturating_sub(last_sent.load(Ordering::Relaxed)) >= 50 {
            last_sent.store(now, Ordering::Relaxed);
            let _ = app.emit("translate-partial", json!({ "requestId": request_id, "text": partial }));
        }
    };

    let task_state = state.clone();
    let handle = tokio::spawn(async move {
        task_state.translator.translate(&task_state.client, &task_state.store, request, on_partial).await
    });
    {
        let mut active = state.active.lock().unwrap();
        if let Some(previous) = active.insert(is_bubble_request(request_id), handle.abort_handle()) {
            previous.abort();
        }
    }
    // An aborted task is a newer request taking over, not a failure.
    Ok(match handle.await {
        Ok(reply) => reply,
        Err(_) => Reply { request_id, aborted: true, ..Default::default() },
    })
}

#[tauri::command]
fn translate_cancel(st: State<'_, Arc<AppState>>, request_id: u64) {
    if let Some(active) = st.active.lock().unwrap().remove(&is_bubble_request(request_id)) {
        active.abort();
    }
}

#[tauri::command]
async fn tts(st: State<'_, Arc<AppState>>, text: String, lang: String) -> Result<Value, String> {
    if text.trim().is_empty() {
        return Ok(json!({ "ok": false }));
    }
    let text: String = text.chars().take(700).collect();
    Ok(match tts::synthesize(&st.client, &text, &lang).await {
        Ok(audio) => json!({ "ok": true, "audio": audio }),
        Err(err) => {
            log(&format!("tts: {err}"));
            json!({ "ok": false })
        }
    })
}

fn ai_config(st: &AppState, cfg: &Value) -> AiConfig {
    let s = st.store.settings();
    let pick = |key: &str, stored: &str| -> String {
        cfg.get(key).and_then(Value::as_str).map(str::trim).filter(|v| !v.is_empty()).unwrap_or(stored).to_string()
    };
    AiConfig {
        base_url: pick("baseUrl", &s.aphra.base_url),
        api_key: pick("apiKey", &store::api_key()),
        model: pick("model", &s.aphra.model),
        tone: s.aphra.tone.clone(),
        show_breakdown: s.aphra.show_breakdown,
        target_lang: "auto".into(),
        native_lang: s.native_lang.clone(),
        second_lang: s.second_lang.clone(),
    }
}

#[tauri::command]
async fn test_ai(st: State<'_, Arc<AppState>>, cfg: Value) -> Result<Value, String> {
    let lang = st.store.settings().app_language;
    let config = ai_config(&st, &cfg);
    Ok(match aphra::test_connection(&st.client, &config).await {
        Ok((ms, model)) => json!({ "ok": true, "ms": ms, "model": model }),
        Err(err) => json!({ "ok": false, "error": translator::ai_message(&err, &lang) }),
    })
}

#[tauri::command]
async fn fetch_models(st: State<'_, Arc<AppState>>, cfg: Value) -> Result<Value, String> {
    let lang = st.store.settings().app_language;
    let config = ai_config(&st, &cfg);
    Ok(match aphra::fetch_models(&st.client, &config.base_url, &config.api_key).await {
        Ok(models) => {
            let list: Vec<Value> = models.into_iter().map(|(id, name)| json!({ "id": id, "displayName": name })).collect();
            json!({ "ok": true, "models": list })
        }
        Err(err) => json!({ "ok": false, "error": translator::ai_message(&err, &lang) }),
    })
}

// ── Commands: clipboard and other apps ────────────────────────────────────────

#[tauri::command]
fn copy_text(text: String) -> bool {
    !text.is_empty() && input::write_text(&text.chars().take(MAX_TEXT * 4).collect::<String>())
}

#[tauri::command]
fn read_clipboard_text() -> String {
    input::read_text().chars().take(MAX_TEXT).collect()
}

/// Close the island and paste the translation into the app the text came from.
#[tauri::command]
fn replace_text(app: AppHandle, st: State<'_, Arc<AppState>>, text: String) -> bool {
    if text.is_empty() {
        return false;
    }
    hide_island(&app);
    let settings = st.store.settings();
    let (restore, lang) = (settings.restore_clipboard, settings.app_language.clone());
    thread::spawn(move || {
        // Let the previous window take the focus back before pasting.
        thread::sleep(Duration::from_millis(220));
        if input::paste_or_keep(&text, None, restore) == input::PasteOutcome::KeptOnClipboard {
            notify_kept_on_clipboard(&app, &lang);
        }
    });
    true
}

#[tauri::command]
async fn capture_selected_text() -> String {
    // The bubble was clicked, and the click took the keyboard focus from the app the
    // text is selected in (its selection turns grey): Ctrl+C would go nowhere. Give
    // the focus back to that app first, then copy. A slow app gets a second try.
    // The clipboard is always given back: a selection must never replace it.
    tauri::async_runtime::spawn_blocking(|| {
        for attempt in 0..2u64 {
            input::restore_target_window();
            thread::sleep(Duration::from_millis(90 + attempt * 140));
            let text = input::capture_selected(true);
            if !text.is_empty() {
                return text;
            }
        }
        String::new()
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
fn replace_bubble_text(app: AppHandle, st: State<'_, Arc<AppState>>, text: String) -> bool {
    hide_bubble(&app);
    if text.is_empty() {
        return false;
    }
    let settings = st.store.settings();
    let (restore, lang) = (settings.restore_clipboard, settings.app_language.clone());
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(150));
        if input::paste_or_keep(&text, None, restore) == input::PasteOutcome::KeptOnClipboard {
            notify_kept_on_clipboard(&app, &lang);
        }
    });
    true
}

#[tauri::command]
fn open_island_with_text(app: AppHandle, text: String) {
    hide_bubble(&app);
    show_island(&app, &text);
}

// ── Commands: the island window (Coucou's own) ──────────────────────────────

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BootInfo {
    settings: Value,
    screen: island::ScreenInfo,
    version: String,
    /// The OS has a global cursor: the page need not report it itself.
    cursor_poll: bool,
}

#[tauri::command]
fn boot(app: AppHandle, st: State<'_, Arc<AppState>>) -> BootInfo {
    BootInfo {
        settings: st.store.public_settings(),
        screen: island::screen_info(&app, &st.store.settings().screen),
        version: env!("CARGO_PKG_VERSION").to_string(),
        cursor_poll: platform::CURSOR_POLL,
    }
}

/// Hidden island → shrink the window to the invisible wake strip and park the
/// cursor poll; anything else → full panel and 60 Hz polling.
#[tauri::command]
fn set_collapsed(app: AppHandle, st: State<'_, Arc<AppState>>, collapsed: bool) {
    let pref = st.store.settings().screen;
    {
        // The poll thread decides click-through under this lock: it cannot undo what follows.
        let _decide = st.gate.click_lock.lock().unwrap();
        st.gate.collapsed.store(collapsed, Ordering::Relaxed);
        island::apply_geometry(&app, &pref, collapsed);
        // The wake strip must always take the mouse, and a resize invalidates the flag.
        island::refresh_click_through(&app, &st.gate);
    }
    st.gate.set_active(!collapsed && !st.hidden.load(Ordering::Relaxed));
    platform::set_pointer_watch(!collapsed);
}

/// The front end pushes the island shape; Rust decides click-through from it.
#[tauri::command]
fn set_island_rect(st: State<'_, Arc<AppState>>, x: f64, y: f64, width: f64, height: f64) {
    st.gate.set_rect(IslandRect { x, y, w: width, h: height });
}

/// The size of the full window, in logical px: the page owns the island's geometry, so a
/// wider or taller island (Settings → Look) asks the window for the room it needs. The
/// shape the page pushes is relative to the window's top-left, so it is pushed again after.
#[tauri::command]
fn set_panel_size(app: AppHandle, st: State<'_, Arc<AppState>>, width: f64, height: f64) {
    if !st.gate.set_panel((width, height)) {
        return;
    }
    let collapsed = st.gate.collapsed.load(Ordering::Relaxed);
    if !collapsed {
        island::apply_geometry(&app, &st.store.settings().screen, false);
        island::refresh_click_through(&app, &st.gate);
    }
}

/// The full window's size now (the default, or what the page last asked for).
pub(crate) fn panel_size(app: &AppHandle) -> (f64, f64) {
    state(app).gate.panel_size()
}

/// How much the page is zoomed out to fit the screen (1 = as designed).
pub(crate) fn ui_zoom(app: &AppHandle) -> f64 {
    state(app).gate.zoom()
}

/// The page fitted the island to a screen too small for it: the whole page is drawn smaller,
/// and the window (panel × zoom) with it.
#[tauri::command]
fn set_ui_zoom(app: AppHandle, st: State<'_, Arc<AppState>>, zoom: f64) {
    if !st.gate.set_zoom(zoom) {
        return;
    }
    let collapsed = st.gate.collapsed.load(Ordering::Relaxed);
    if !collapsed {
        island::apply_geometry(&app, &st.store.settings().screen, false);
        island::refresh_click_through(&app, &st.gate);
    }
}

/// The display the island is on, as `boot` gives it: the page asks again after a display change.
#[tauri::command]
fn screen_info(app: AppHandle, st: State<'_, Arc<AppState>>) -> island::ScreenInfo {
    island::screen_info(&app, &st.store.settings().screen)
}

#[tauri::command]
fn focus_window(app: AppHandle, focused: bool) {
    let Some(win) = island(&app) else { return };
    platform::set_activating(&win, focused);
    if focused {
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn reposition(app: AppHandle, st: State<'_, Arc<AppState>>) {
    let collapsed = st.gate.collapsed.load(Ordering::Relaxed);
    island::apply_geometry(&app, &st.store.settings().screen, collapsed);
}

/// The displays the island can be pinned to, for Settings.
#[tauri::command]
fn list_monitors(app: AppHandle) -> Vec<island::MonitorChoice> {
    island::monitor_choices(&app)
}

#[tauri::command]
fn hide_island_cmd(app: AppHandle) {
    hide_island(&app);
}

#[tauri::command]
fn open_url(url: String) {
    if url.starts_with("http://") || url.starts_with("https://") {
        platform::open_url(&url);
    }
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn log_line(message: String) {
    let message: String = message.chars().take(500).collect();
    log(&format!("ui  {message}"));
}

/// The page reports the system's languages; the tray follows appLanguage, so there
/// is nothing to do with them here — the command exists so the call never fails.
#[tauri::command]
fn set_system_languages(_languages: Vec<String>) {}

/// Settings is recording a new combination: let go of ours meanwhile, so the keys
/// reach the recorder instead of running an action. `false` takes them back.
#[tauri::command]
fn shortcuts_suspend(app: AppHandle, st: State<'_, Arc<AppState>>, suspended: bool) {
    let gs = app.global_shortcut();
    if suspended {
        let _ = gs.unregister_all();
        return;
    }
    let s = st.store.settings();
    for (slot, keys) in [(&st.hotkey, s.hotkey), (&st.inline_hotkey, s.inline_hotkey), (&st.hide_hotkey, s.hide_hotkey)] {
        if let Some(sc) = parse_hotkey(&keys) {
            if gs.register(sc).is_ok() {
                *slot.lock().unwrap() = Some(sc);
            }
        }
    }
}

// ── The settings window and the bubble ────────────────────────────────────────

/// WebView2 allows exactly one browser environment per app, and its options are
/// fixed by whichever webview is created first. Every window must therefore ask
/// for the *same* arguments as the island (see `additionalBrowserArgs` in
/// tauri.conf.json) — a mismatch makes the second window come up blank.
pub(crate) const BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

/// In a dev build the pages are served by Vite, so the extra windows need the
/// absolute dev URL; a bundled build resolves it inside the app bundle.
fn page_url(app: &AppHandle, page: &str) -> WebviewUrl {
    #[cfg(dev)]
    if let Some(mut base) = app.config().build.dev_url.clone() {
        base.set_path(&format!("/{page}"));
        return WebviewUrl::External(base);
    }
    let _ = app;
    WebviewUrl::App(page.into())
}

fn create_bubble_window(app: &AppHandle) {
    match WebviewWindowBuilder::new(app, BUBBLE, page_url(app, "bubble.html"))
        .additional_browser_args(BROWSER_ARGS)
        .title("Arizo Quick Translate")
        .inner_size(54.0, 54.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .build()
    {
        Ok(win) => platform::make_non_activating(&win),
        Err(err) => log(&format!("bubble window failed: {err}")),
    }
}

#[tauri::command]
fn open_settings_window(app: AppHandle) {
    show_island(&app, "");
    let _ = app.emit_to(ISLAND, "tray", "settings".to_string());
}

#[tauri::command]
fn hide_bubble_window(app: AppHandle) {
    hide_bubble(&app);
}

#[tauri::command]
fn set_bubble_size(app: AppHandle, width: f64, height: f64) {
    let Some(b) = bubble(&app) else { return };
    let Ok(Some(m)) = b.current_monitor() else { return };
    let scale = m.scale_factor();
    let (mp, ms) = (m.position(), m.size());
    let pad = (8.0 * scale) as i32;
    let (w, h) = ((width.clamp(40.0, 600.0) * scale).round() as i32, (height.clamp(40.0, 700.0) * scale).round() as i32);
    let Ok(pos) = b.outer_position() else { return };
    // Grow into the screen, never off it.
    let x = pos.x.min(mp.x + ms.width as i32 - w - pad).max(mp.x + pad);
    let y = pos.y.min(mp.y + ms.height as i32 - h - pad).max(mp.y + pad);
    let _ = b.set_position(PhysicalPosition::new(x, y));
    let _ = b.set_size(PhysicalSize::new(w as u32, h as u32));
    platform::match_display_scale(&b, 1.0);
}

pub fn run() {
    // The installer and the uninstaller open this same exe in their own mode (setup.rs).
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--wipe") {
        setup::wipe_everything();
        return;
    }
    if let Some(mode) = setup::mode_from_args(&args) {
        setup::run(mode, tauri::generate_context!());
        return;
    }
    let loaded = Store::load();
    let settings = loaded.settings();
    let gate = Arc::new(PollGate::new());

    let app_state = Arc::new(AppState {
        store: loaded,
        translator: Translator::default(),
        client: reqwest::Client::builder().connect_timeout(Duration::from_secs(10)).build().unwrap_or_default(),
        active: Mutex::new(HashMap::new()),
        hotkey: Mutex::new(None),
        inline_hotkey: Mutex::new(None),
        hide_hotkey: Mutex::new(None),
        hidden: AtomicBool::new(false),
        gate: gate.clone(),
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // A second launch simply brings the island up.
            show_island(app, "");
        }))
        .plugin(tauri_plugin_autostart::Builder::new().app_name("arizo-translate").args(["--hidden"]).build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let st = state(app);
                    let id = shortcut.id();
                    let is_main = st.hotkey.lock().unwrap().is_some_and(|s| s.id() == id);
                    let is_inline = st.inline_hotkey.lock().unwrap().is_some_and(|s| s.id() == id);
                    let is_hide = st.hide_hotkey.lock().unwrap().is_some_and(|s| s.id() == id);
                    let app = app.clone();
                    if is_hide {
                        thread::spawn(move || toggle_island_hidden(&app));
                    } else if is_main {
                        thread::spawn(move || on_hotkey(&app));
                    } else if is_inline {
                        thread::spawn(move || on_inline(&app));
                    }
                })
                .build(),
        )
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            boot,
            get_settings,
            get_languages,
            save_settings,
            get_history,
            clear_history,
            delete_history_item,
            toggle_favorite_item,
            translate,
            translate_cancel,
            tts,
            test_ai,
            fetch_models,
            copy_text,
            read_clipboard_text,
            replace_text,
            capture_selected_text,
            replace_bubble_text,
            open_island_with_text,
            set_collapsed,
            set_island_rect,
            set_panel_size,
            set_ui_zoom,
            screen_info,
            focus_window,
            reposition,
            list_monitors,
            hide_island_cmd,
            open_url,
            quit_app,
            log_line,
            set_system_languages,
            shortcuts_suspend,
            open_settings_window,
            hide_bubble_window,
            set_bubble_size,
            football::football_refresh,
            football::football_search,
            football::football_logo,
            crypto::crypto_state,
            crypto::crypto_connect,
            crypto::crypto_disconnect,
            crypto::crypto_select,
            crypto::crypto_set_timeframe,
            crypto::crypto_active,
            muse::muse_show,
            muse::muse_hide,
            muse::muse_focus,
            muse::muse_reload,
            muse::muse_power_off,
            spotify::spotify_refresh,
            spotify::spotify_control,
            spotify::spotify_open,
            spotify::spotify_installed,
            spotify::spotify_connect,
            spotify::spotify_cancel_connect,
            spotify::spotify_disconnect,
            spotify::spotify_redirect_uri,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            let st = state(&handle);
            log("--- Arizo-Agent started ---");

            build_tray(&handle)?;
            create_bubble_window(&handle);
            spotify::sync(&handle, settings.spotify_enabled, &settings.spotify_client_id);
            football::sync(&handle, settings.football_enabled, &settings.football_team_id, &settings.football_team_name);
            st.store.use_default_crypto_asset();
            crypto::sync(&handle);
            // Reuse the legacy startup entry, updating its executable after an upgrade.
            apply_autostart(&handle, settings.launch_at_startup);

            if let Some(win) = island(&handle) {
                platform::make_non_activating(&win);
                island::apply_geometry(&handle, &settings.screen, false);
                let _ = win.show();
            } else {
                log("the island window is missing");
            }
            gate.collapsed.store(false, Ordering::Relaxed);
            gate.set_active(true);
            island::spawn_cursor_poll(handle.clone(), gate.clone());

            let main_ok = set_hotkey(&handle, &st.hotkey, &[&st.inline_hotkey, &st.hide_hotkey], &settings.hotkey);
            let inline_ok = set_hotkey(&handle, &st.inline_hotkey, &[&st.hotkey, &st.hide_hotkey], &settings.inline_hotkey);
            let hide_ok = set_hotkey(&handle, &st.hide_hotkey, &[&st.hotkey, &st.inline_hotkey], &settings.hide_hotkey);
            apply_mouse_monitor(&handle, true);
            if !(main_ok && inline_ok && hide_ok) {
                // Name the shortcut(s) that really failed, not always the main one.
                let failed: Vec<&str> = [(main_ok, &settings.hotkey), (inline_ok, &settings.inline_hotkey), (hide_ok, &settings.hide_hotkey)]
                    .into_iter()
                    .filter(|(ok, _)| !*ok)
                    .map(|(_, key)| key.as_str())
                    .collect();
                let (h, lang, keys) = (handle.clone(), settings.app_language.clone(), failed.join(", "));
                thread::spawn(move || {
                    thread::sleep(Duration::from_millis(1500));
                    let msg = if lang == "en" {
                        format!("The shortcut {keys} is unavailable; pick another one in Settings")
                    } else {
                        format!("کلید میانبر {keys} در دسترس نیست؛ از تنظیمات کلید دیگری انتخاب کنید")
                    };
                    let _ = h.emit_to(ISLAND, "toast", msg);
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Arizo-Agent")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                input::stop_mouse_monitor();
                spotify::sync(app, false, "");
                football::sync(app, false, "", "");
                crypto::shutdown();
                let _ = app.global_shortcut().unregister_all();
            }
        });
}

#[cfg(test)]
mod bubble_tests {
    use super::*;

    const SCREEN: (i32, i32, i32, i32) = (0, 0, 1920, 1080);

    #[test]
    fn the_two_windows_translations_have_separate_slots() {
        assert!(!is_bubble_request(0));
        assert!(!is_bubble_request(37));
        assert!(is_bubble_request(1_000_000));
        assert!(is_bubble_request(1_000_042));
    }

    #[test]
    fn the_bubble_sits_above_and_beside_the_cursor() {
        let (px, py) = bubble_position(800, 500, 68, 1.0, SCREEN);
        assert!(px > 800, "beside the cursor, not under it");
        assert!(py + 68 <= 500, "above the cursor, clear of the selected text");
    }

    #[test]
    fn near_the_top_it_goes_below_instead() {
        let (_, py) = bubble_position(800, 20, 68, 1.0, SCREEN);
        assert!(py > 20, "no room above: below the cursor");
    }

    #[test]
    fn it_never_leaves_the_monitor() {
        for (x, y) in [(1915, 5), (1915, 1075), (3, 1075), (3, 3), (960, 540)] {
            let (px, py) = bubble_position(x, y, 68, 1.0, SCREEN);
            assert!(px >= 8 && px + 68 <= 1920 - 8, "x inside for ({x},{y}): {px}");
            assert!(py >= 8 && py + 68 <= 1080 - 8, "y inside for ({x},{y}): {py}");
        }
    }

    #[test]
    fn it_works_on_a_monitor_that_is_not_at_the_origin_and_on_a_scaled_one() {
        // A second display to the left (negative coordinates), 150 % scaling.
        let screen = (-2560, 0, 2560, 1440);
        let (px, py) = bubble_position(-2500, 700, 102, 1.5, screen);
        assert!(px >= -2560 + 12 && px + 102 <= 0 - 12);
        assert!(py >= 12 && py + 102 <= 1440 - 12);
    }
}
