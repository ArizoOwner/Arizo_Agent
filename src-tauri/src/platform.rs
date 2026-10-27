// What differs from one OS to the next, behind one set of names. Arizo-Agent
// targets Windows 10/11, so this is the Windows half of Coucou's `platform`
// module: Win32 for the island window and the cursor.

use std::os::windows::process::CommandExt;
use std::process::Command;

use tauri::WebviewWindow;
use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, SWP_NOACTIVATE, SWP_NOZORDER,
    WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

/// Keeps spawned helpers from flashing a console window.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// The 60 Hz poll reads the cursor and flips click-through from it.
pub const CURSOR_POLL: bool = true;

/// Cursor position in physical screen pixels.
pub fn cursor_physical() -> Option<(f64, f64)> {
    let mut p = POINT::default();
    unsafe { GetCursorPos(&mut p).ok()? };
    Some((p.x as f64, p.y as f64))
}

fn hwnd_of(win: &WebviewWindow) -> Option<HWND> {
    let raw = win.hwnd().ok()?.0 as isize;
    if raw == 0 {
        return None;
    }
    Some(HWND(raw as *mut _))
}

/// WS_EX_NOACTIVATE keeps clicks from stealing focus; WS_EX_TOOLWINDOW keeps the
/// window out of Alt-Tab.
pub fn make_non_activating(win: &WebviewWindow) {
    let Some(hwnd) = hwnd_of(win) else { return };
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let want = ex | WS_EX_NOACTIVATE.0 as isize | WS_EX_TOOLWINDOW.0 as isize;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, want);
    }
}

/// Temporarily allow activation so a text field inside the island can be typed in.
pub fn set_activating(win: &WebviewWindow, activating: bool) {
    let Some(hwnd) = hwnd_of(win) else { return };
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let want = if activating {
            ex & !(WS_EX_NOACTIVATE.0 as isize)
        } else {
            ex | WS_EX_NOACTIVATE.0 as isize
        };
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, want);
    }
}

/// Moves and resizes the window in one call. Two calls (size, then position) leave the island
/// for a moment at the wrong place on screen, which shows while its width is being dragged.
/// False when there is no window handle yet: the caller then does it in two steps.
pub fn place_window(win: &WebviewWindow, x: i32, y: i32, w: u32, h: u32) -> bool {
    let Some(hwnd) = hwnd_of(win) else { return false };
    unsafe { SetWindowPos(hwnd, None, x, y, w as i32, h as i32, SWP_NOZORDER | SWP_NOACTIVATE).is_ok() }
}

/// Windows 11 rounds the corners of a borderless window when asked (Windows 10 ignores
/// it), so a webview laid over a rounded frame does not stick out at the corners.
pub fn round_corners(win: &WebviewWindow) {
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND};
    let Some(hwnd) = hwnd_of(win) else { return };
    let pref = DWMWCP_ROUND;
    unsafe {
        let _ = DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, &pref as *const _ as *const _, std::mem::size_of_val(&pref) as u32);
    }
}

/// The cursor poll already parks itself with the island (island.rs): nothing to do.
pub fn set_pointer_watch(_active: bool) {}

/// `set_position` already places a Win32 window on the right display.
pub fn pin_to_monitor(_win: &WebviewWindow, _x: i32, _y: i32) {}

/// Opens a web address in the default browser. The caller has already checked
/// that it is http(s); no shell is involved.
pub fn open_url(url: &str) {
    let _ = Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", url])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}
