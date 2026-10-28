// Muse (https://muse.ai) inside the island: the real site, live, in its own webview laid
// exactly over the Muse view's frame. The page owns the geometry and tells us where the
// frame is; we only create, place, show and hide the webview, and follow the island
// when it is placed again.
//
// The webview is a window owned by the island rather than a second webview inside it:
// owned windows always sit above their owner and go away with it, and the island window
// keeps a single webview, which the rest of the app relies on (`get_webview_window`).
//
// Remote content never gets privileges: the webview has its own label, which no
// capability lists, so muse.ai cannot reach a single app command. Pop-ups go to the
// system browser, and permission requests (microphone, camera…) are left to WebView2's
// own prompt, so the user decides each time.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Url, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "muse";
pub const HOME: &str = "https://muse.ai/";

/// Where the page last put the frame (island-window logical px), so the webview can
/// follow the island when it moves. None until the Muse tab is first opened.
static PLACE: Mutex<Option<(f64, f64, f64, f64)>> = Mutex::new(None);
/// The Muse view is on screen (the page said so last).
static SHOWN: AtomicBool = AtomicBool::new(false);
/// The first page has loaded. Until then the webview stays hidden and the frame's
/// spinner shows, instead of a blank white rectangle.
static LOADED: AtomicBool = AtomicBool::new(false);
/// Creating the webview takes a moment, and the page asks again while the island grows:
/// one call at a time, or the second finds the name taken and reports a failure.
static SHOWING: Mutex<()> = Mutex::new(());

/// The island's own fonts, Inter for Latin and Vazirmatn for Persian, carried into muse.ai so
/// its chat reads well in both.
const INTER: &[u8] = include_bytes!("../../web/src/assets/fonts/Inter-Variable.woff2");
const VAZIRMATN: &[u8] = include_bytes!("../../web/src/assets/fonts/Vazirmatn-Variable.woff2");

/// Runs at the start of every muse.ai page: the fonts, one step smaller than the site draws its
/// text, and every paragraph and text field in its own direction (src-tauri/src/muse_page.js).
const PAGE_SCRIPT: &str = include_str!("muse_page.js");

fn page_script() -> String {
    use base64::Engine;
    let b64 = |b: &[u8]| base64::engine::general_purpose::STANDARD.encode(b);
    PAGE_SCRIPT.replace("__INTER__", &b64(INTER)).replace("__VAZIRMATN__", &b64(VAZIRMATN))
}

/// What the island hears about the page: a load starting or ending, or a new title.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MuseEvent {
    pub phase: Option<&'static str>, // "loading" | "ready"
    pub title: Option<String>,
}

/// A webview rectangle in window-logical px; anything absurd is refused.
pub(crate) fn valid_rect(x: f64, y: f64, w: f64, h: f64) -> bool {
    [x, y, w, h].iter().all(|v| v.is_finite())
        && w >= 120.0
        && h >= 120.0
        && w <= crate::island::PANEL_MAX_W
        && h <= crate::island::PANEL_MAX_H
        && x >= 0.0
        && y >= 0.0
}

/// Only web pages may load at the top: no `file:`, no app or OS protocols.
pub(crate) fn allowed_navigation(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
}

fn emit(app: &AppHandle, phase: Option<&'static str>, title: Option<String>) {
    let _ = app.emit_to(crate::island::WINDOW_LABEL, "muse", MuseEvent { phase, title });
}

/// Lays the webview over the frame, from the island's place on screen now.
fn place(app: &AppHandle) {
    let Some((x, y, w, h)) = *PLACE.lock().unwrap() else { return };
    let (Some(island), Some(view)) = (crate::island::window(app), app.get_webview_window(LABEL)) else { return };
    // The frame is measured in the island page's px, which are zoomed out on a small screen;
    // muse.ai itself keeps its own size (the display scale only: no Windows text size on top).
    let scale = island.scale_factor().unwrap_or(1.0) * crate::ui_zoom(app);
    let Ok(origin) = island.inner_position() else { return };
    let _ = view.set_position(PhysicalPosition::new(origin.x + (x * scale).round() as i32, origin.y + (y * scale).round() as i32));
    let _ = view.set_size(PhysicalSize::new((w * scale).round() as u32, (h * scale).round() as u32));
    crate::platform::match_display_scale(&view, 1.0);
}

/// Shows the webview if the view wants it and the page is ready.
fn reveal(app: &AppHandle) {
    if !SHOWN.load(Ordering::Relaxed) || !LOADED.load(Ordering::Relaxed) {
        return;
    }
    let Some(view) = app.get_webview_window(LABEL) else { return };
    place(app);
    let _ = view.show();
    let _ = view.set_focus();
}

/// The island was placed again (another display, a new size, the floating gap):
/// muse.ai goes with it.
pub fn follow(app: &AppHandle) {
    if SHOWN.load(Ordering::Relaxed) {
        place(app);
    }
}

/// Shows muse.ai over the frame at the given place in the island window, creating it on
/// first use. Async: on Windows, creating a window from a synchronous command deadlocks.
#[tauri::command]
pub async fn muse_show(app: AppHandle, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    if !valid_rect(x, y, width, height) {
        return Err("bad-rect".into());
    }
    // Held to the end (there is no await in here, so it never blocks the runtime).
    let _one_at_a_time = SHOWING.lock().unwrap_or_else(|e| e.into_inner());
    *PLACE.lock().unwrap() = Some((x, y, width, height));
    SHOWN.store(true, Ordering::Relaxed);
    if app.get_webview_window(LABEL).is_some() {
        reveal(&app);
        return Ok(());
    }
    let Some(island) = crate::island::window(&app) else { return Err("no-window".into()) };
    let url = HOME.parse().map_err(|_| "bad-url".to_string())?;
    let loads = app.clone();
    let titles = app.clone();
    LOADED.store(false, Ordering::Relaxed);
    let view = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(url))
        // One WebView2 environment per app: the same arguments as the island, or the page
        // comes up blank. It also keeps muse.ai's login in the app's profile.
        .additional_browser_args(crate::BROWSER_ARGS)
        .owner(&island)
        .map_err(|e| e.to_string())?
        .title("Muse")
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .shadow(false)
        .visible(false)
        .initialization_script(page_script())
        .on_navigation(allowed_navigation)
        .on_new_window(|url, _| {
            if allowed_navigation(&url) {
                crate::platform::open_url(url.as_str());
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |_, payload| match payload.event() {
            PageLoadEvent::Started => emit(&loads, Some("loading"), None),
            PageLoadEvent::Finished => {
                emit(&loads, Some("ready"), None);
                if !LOADED.swap(true, Ordering::Relaxed) {
                    reveal(&loads);
                }
            }
        })
        .on_document_title_changed(move |_, title| emit(&titles, None, Some(title)))
        .build()
        .map_err(|e| {
            crate::log(&format!("muse: window failed: {e}"));
            "webview-failed".to_string()
        })?;
    // Switched off while it was being made: it must not stay behind, hidden but running.
    if !SHOWN.load(Ordering::Relaxed) && PLACE.lock().unwrap().is_none() {
        let _ = view.destroy();
        return Ok(());
    }
    crate::platform::round_corners(&view);
    place(&app);
    Ok(())
}

/// Hides muse.ai (it keeps running, so a task in progress goes on).
#[tauri::command]
pub fn muse_hide(app: AppHandle) {
    SHOWN.store(false, Ordering::Relaxed);
    if let Some(view) = app.get_webview_window(LABEL) {
        let _ = view.hide();
    }
}

/// Gives the keyboard to muse.ai, so typing in its chat works.
#[tauri::command]
pub fn muse_focus(app: AppHandle) {
    if let Some(view) = app.get_webview_window(LABEL) {
        if view.is_visible().unwrap_or(false) {
            let _ = view.set_focus();
        }
    }
}

/// Back to muse.ai's home page (the Home button).
#[tauri::command]
pub fn muse_reload(app: AppHandle) {
    if let Some(view) = app.get_webview_window(LABEL) {
        if let Ok(url) = HOME.parse() {
            let _ = view.navigate(url);
        }
    }
}

/// The power button in the Muse toolbar: the page goes away and stops using memory, the
/// processor and the network. The login stays: it lives in the WebView2 profile on disk.
#[tauri::command]
pub fn muse_power_off(app: AppHandle) {
    close(&app);
}

/// Muse was turned off (the power button, or the feature in Settings): the page goes away
/// and frees its memory.
pub fn close(app: &AppHandle) {
    SHOWN.store(false, Ordering::Relaxed);
    LOADED.store(false, Ordering::Relaxed);
    *PLACE.lock().unwrap() = None;
    if let Some(view) = app.get_webview_window(LABEL) {
        let _ = view.destroy();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_sane_rects_are_accepted() {
        assert!(valid_rect(230.0, 42.0, 460.0, 540.0));
        assert!(!valid_rect(f64::NAN, 0.0, 400.0, 400.0));
        assert!(!valid_rect(0.0, 0.0, 10.0, 400.0), "too small");
        assert!(!valid_rect(-5.0, 0.0, 400.0, 400.0), "off the window");
        assert!(!valid_rect(0.0, 0.0, 99999.0, 400.0), "too large");
    }

    #[test]
    fn the_page_script_carries_both_fonts() {
        let s = page_script();
        assert!(!s.contains("__INTER__") && !s.contains("__VAZIRMATN__"), "every font is filled in");
        assert!(s.len() > (INTER.len() + VAZIRMATN.len()) * 4 / 3, "the fonts are whole");
        assert!(s.contains("\"Arizo Text\""));
    }

    #[test]
    fn only_web_pages_load() {
        let ok = |s: &str| allowed_navigation(&s.parse().unwrap());
        assert!(ok("https://muse.ai/chat"));
        assert!(ok("https://accounts.google.com/o/oauth2"));
        assert!(!ok("file:///C:/Windows/win.ini"));
        assert!(!ok("ms-settings:privacy"));
        assert!(!ok("javascript:alert(1)"));
    }
}
