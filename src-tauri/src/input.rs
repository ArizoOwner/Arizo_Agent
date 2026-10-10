// Talking to other applications: copying their selection, pasting into them,
// bringing their window back, and noticing that the user selected something.
//
// Everything here calls Win32 directly — no helper process, no PowerShell. The
// clipboard is never polluted: a capture only looks at the clipboard sequence
// number to know whether the copy really happened, and the user's own clipboard
// (text and image) is put back afterwards.

use std::sync::atomic::{AtomicBool, AtomicI32, AtomicIsize, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use arboard::{Clipboard, ImageData};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
    VIRTUAL_KEY, VK_A, VK_C, VK_CONTROL, VK_LCONTROL, VK_LMENU, VK_LSHIFT, VK_LWIN, VK_MENU, VK_RCONTROL, VK_RMENU,
    VK_RSHIFT, VK_RWIN, VK_SHIFT, VK_V,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetClassNameW, GetForegroundWindow, GetMessageW, GetWindowThreadProcessId,
    PostThreadMessageW, SetForegroundWindow, SetWindowsHookExW, UnhookWindowsHookEx, WindowFromPoint, MSG,
    MSLLHOOKSTRUCT, WH_MOUSE_LL, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_QUIT, WM_RBUTTONDOWN, WM_RBUTTONUP,
};

fn sleep(ms: u64) {
    thread::sleep(Duration::from_millis(ms));
}

// ── Keys ──────────────────────────────────────────────────────────────────────

fn key_event(vk: VIRTUAL_KEY, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: if up { KEYEVENTF_KEYUP } else { Default::default() },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

fn send(events: &[INPUT]) {
    unsafe {
        SendInput(events, std::mem::size_of::<INPUT>() as i32);
    }
}

fn is_down(vk: VIRTUAL_KEY) -> bool {
    unsafe { (GetAsyncKeyState(vk.0 as i32) as u16 & 0x8000) != 0 }
}

const MODIFIERS: [VIRTUAL_KEY; 11] = [
    VK_SHIFT, VK_CONTROL, VK_MENU, VK_LSHIFT, VK_RSHIFT, VK_LCONTROL, VK_RCONTROL, VK_LMENU, VK_RMENU, VK_LWIN, VK_RWIN,
];

/// When a global shortcut like Alt+Shift+D fires, the keys are still under the
/// user's fingers for a couple of hundred milliseconds. Injected Ctrl+C would
/// collide with them (Ctrl+Alt+Shift+C), so wait until they are let go.
pub fn wait_modifiers_released(timeout_ms: u64) {
    let start = Instant::now();
    while start.elapsed() < Duration::from_millis(timeout_ms) {
        if !MODIFIERS.iter().any(|vk| is_down(*vk)) {
            break;
        }
        sleep(25);
    }
    release_held_modifiers();
}

/// Anything still held after the wait is released synthetically.
fn release_held_modifiers() {
    let mut had_alt = false;
    let mut ups = Vec::new();
    for vk in MODIFIERS.iter().copied().chain((0x41u16..=0x5A).map(VIRTUAL_KEY)) {
        if is_down(vk) {
            if matches!(vk, VK_MENU | VK_LMENU | VK_RMENU) {
                had_alt = true;
            }
            ups.push(key_event(vk, true));
        }
    }
    if !ups.is_empty() {
        send(&ups);
    }
    // Letting go of Alt on its own can open the application's menu bar and steal the
    // focus from the text field; a quick Shift tap dismisses menu mode harmlessly.
    if had_alt {
        send(&[key_event(VK_SHIFT, false), key_event(VK_SHIFT, true)]);
    }
}

fn ctrl_combo(vk: VIRTUAL_KEY) {
    release_held_modifiers();
    send(&[key_event(VK_CONTROL, false), key_event(vk, false)]);
    sleep(30);
    send(&[key_event(vk, true), key_event(VK_CONTROL, true)]);
}

pub fn send_copy() {
    ctrl_combo(VK_C);
}

pub fn send_paste() {
    ctrl_combo(VK_V);
}

pub fn send_select_all() {
    ctrl_combo(VK_A);
}

// ── Windows ───────────────────────────────────────────────────────────────────

static TARGET: AtomicIsize = AtomicIsize::new(0);

/// Remember the window the user is working in, so the result can go back to it.
pub fn save_target_window() {
    let hwnd = unsafe { GetForegroundWindow() };
    TARGET.store(hwnd.0 as isize, Ordering::Relaxed);
}

/// Forget it: when the island is opened from the tray no app is "the target", and a
/// stale one must never receive a paste.
pub fn clear_target_window() {
    TARGET.store(0, Ordering::Relaxed);
}

pub fn restore_target_window() {
    let raw = TARGET.load(Ordering::Relaxed);
    if raw == 0 {
        return;
    }
    let target = HWND(raw as *mut _);
    unsafe {
        if GetForegroundWindow() == target {
            return;
        }
        let me = GetCurrentThreadId();
        let theirs = GetWindowThreadProcessId(target, None);
        let _ = AttachThreadInput(me, theirs, true);
        let _ = SetForegroundWindow(target);
        let _ = AttachThreadInput(me, theirs, false);
    }
    sleep(40);
}

// ── Clipboard ─────────────────────────────────────────────────────────────────

/// What the user had on the clipboard: text and a picture. (Rich HTML / RTF is not
/// kept — the clipboard crate does not expose it — so a copied web snippet comes
/// back as its plain text.)
#[derive(Default)]
pub struct Snapshot {
    text: String,
    image: Option<ImageData<'static>>,
}

fn clipboard() -> Option<Clipboard> {
    // Another program may hold the clipboard for a moment.
    for _ in 0..6 {
        if let Ok(c) = Clipboard::new() {
            return Some(c);
        }
        sleep(20);
    }
    None
}

pub fn read_text() -> String {
    clipboard().and_then(|mut c| c.get_text().ok()).unwrap_or_default()
}

pub fn write_text(text: &str) -> bool {
    for _ in 0..6 {
        if let Some(mut c) = clipboard() {
            if c.set_text(text.to_string()).is_ok() {
                return true;
            }
        }
        sleep(20);
    }
    false
}

pub fn snapshot() -> Snapshot {
    let Some(mut c) = clipboard() else { return Snapshot::default() };
    Snapshot { text: c.get_text().unwrap_or_default(), image: c.get_image().ok().map(|i| i.to_owned_img()) }
}

/// Puts the snapshot back and checks that it really replaced what we wrote.
pub fn restore(snap: &Snapshot) -> bool {
    // The program we copied from needs a moment to finish with the clipboard.
    sleep(70);
    for _ in 0..8 {
        if let Some(mut c) = clipboard() {
            let done = if let Some(img) = &snap.image {
                c.set_image(img.clone()).is_ok()
            } else if !snap.text.is_empty() {
                c.set_text(snap.text.clone()).is_ok()
            } else {
                c.clear().is_ok()
            };
            if done && (snap.image.is_some() || c.get_text().unwrap_or_default() == snap.text) {
                return true;
            }
        }
        sleep(40);
    }
    false
}

fn sequence() -> u32 {
    unsafe { GetClipboardSequenceNumber() }
}

/// Sends Ctrl+C and reports whether the clipboard really changed: no marker text is
/// ever written, so nothing the user had is overwritten unless something was selected.
fn copy_and_wait(timeout_ms: u64) -> bool {
    let before = sequence();
    send_copy();
    let start = Instant::now();
    while start.elapsed() < Duration::from_millis(timeout_ms) {
        sleep(25);
        if sequence() != before {
            return true;
        }
    }
    false
}

static CAPTURING: AtomicBool = AtomicBool::new(false);

/// The text currently selected in whatever application has the focus.
pub fn capture_selected(restore_clipboard: bool) -> String {
    if CAPTURING.swap(true, Ordering::AcqRel) {
        return String::new();
    }
    let backup = snapshot();
    let text = if copy_and_wait(400) {
        let t = read_text();
        if restore_clipboard {
            restore(&backup);
        }
        t.trim().to_string()
    } else {
        // Nothing was selected, and the clipboard was never touched.
        String::new()
    };
    CAPTURING.store(false, Ordering::Release);
    text
}

/// The selection, or — when nothing is highlighted — the whole text of the active
/// field (Ctrl+A), so a message typed in a chat box can be translated in place.
pub fn capture_text_or_field() -> String {
    let selected = capture_selected(false);
    if !selected.is_empty() {
        return selected;
    }
    if CAPTURING.swap(true, Ordering::AcqRel) {
        return String::new();
    }
    let backup = snapshot();
    send_select_all();
    sleep(75);
    let text = if copy_and_wait(450) { read_text().trim().to_string() } else { String::new() };
    if text.is_empty() {
        restore(&backup);
    }
    CAPTURING.store(false, Ordering::Release);
    text
}

/// Replaces the selection in the active application: put the text on the clipboard,
/// press Ctrl+V, then give the user's clipboard back once the target has read it.
pub fn paste_text(text: &str, backup: Option<Snapshot>, restore_clipboard: bool) -> bool {
    if text.is_empty() {
        return false;
    }
    let backup = backup.unwrap_or_else(snapshot);
    restore_target_window();
    sleep(40);
    if !write_text(text) {
        return false;
    }
    sleep(70);
    send_paste();
    if restore_clipboard {
        // Slow targets (Word, Electron apps) read the clipboard a little after Ctrl+V.
        thread::spawn(move || {
            sleep(900);
            restore(&backup);
        });
    }
    true
}

// ── Mouse: "the user selected something" ──────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MouseEvent {
    /// A deliberate drag across text.
    Selection,
    /// A click that selected nothing.
    Click,
    /// A right button press or release.
    RightClick,
}

/// Classifies a left-button gesture. Normal clicks and double clicks never count as a
/// selection; a real one holds the button and drags across words.
pub fn is_drag_selection(dx: i32, dy: i32, hold_ms: u64) -> bool {
    let (dx, dy) = (dx.abs() as f64, dy.abs() as f64);
    let dist = (dx * dx + dy * dy).sqrt();
    if hold_ms < 180 {
        return false;
    }
    // One line of text: a mostly horizontal drag. Several lines: a longer, slower one.
    (dx >= 32.0 && dx >= dy * 1.3) || (dist >= 55.0 && dx >= 20.0 && hold_ms >= 300)
}

fn window_class_at(x: i32, y: i32) -> String {
    unsafe {
        let hwnd = WindowFromPoint(POINT { x, y });
        if hwnd.0.is_null() {
            return String::new();
        }
        let mut buf = [0u16; 128];
        let n = GetClassNameW(hwnd, &mut buf);
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }
}

/// The desktop, the taskbar and the Start menu: dragging there selects no text.
pub fn is_system_ui(class: &str) -> bool {
    matches!(
        class,
        "WorkerW" | "Progman" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd" | "Windows.UI.Core.CoreWindow"
    )
}

static EVENTS: OnceLock<Mutex<Option<Sender<(MouseEvent, i32, i32)>>>> = OnceLock::new();
static DOWN_AT: AtomicU64 = AtomicU64::new(0);
static DOWN_X: AtomicI32 = AtomicI32::new(0);
static DOWN_Y: AtomicI32 = AtomicI32::new(0);
static HOOK_THREAD: AtomicU32 = AtomicU32::new(0);

fn now_ms() -> u64 {
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_millis() as u64 + 1
}

fn emit(event: MouseEvent, x: i32, y: i32) {
    if let Some(slot) = EVENTS.get() {
        if let Some(tx) = slot.lock().unwrap().as_ref() {
            let _ = tx.send((event, x, y));
        }
    }
}

unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    // A hook runs inside every other program's input path: do almost nothing here.
    if code >= 0 {
        let info = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
        let (x, y) = (info.pt.x, info.pt.y);
        match wparam.0 as u32 {
            WM_LBUTTONDOWN => {
                DOWN_AT.store(now_ms(), Ordering::Relaxed);
                DOWN_X.store(x, Ordering::Relaxed);
                DOWN_Y.store(y, Ordering::Relaxed);
            }
            WM_LBUTTONUP => {
                let held = now_ms().saturating_sub(DOWN_AT.load(Ordering::Relaxed));
                let dx = x - DOWN_X.load(Ordering::Relaxed);
                let dy = y - DOWN_Y.load(Ordering::Relaxed);
                let event = if is_drag_selection(dx, dy, held) { MouseEvent::Selection } else { MouseEvent::Click };
                emit(event, x, y);
            }
            WM_RBUTTONDOWN | WM_RBUTTONUP => emit(MouseEvent::RightClick, x, y),
            _ => {}
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

/// Starts watching the mouse. `on_event` runs on its own thread, never inside the
/// hook. Does nothing if already running.
pub fn start_mouse_monitor(on_event: impl Fn(MouseEvent, i32, i32) + Send + 'static) {
    if HOOK_THREAD.load(Ordering::Acquire) != 0 {
        return;
    }
    let (tx, rx) = channel();
    *EVENTS.get_or_init(|| Mutex::new(None)).lock().unwrap() = Some(tx);

    thread::spawn(move || {
        while let Ok((event, x, y)) = rx.recv() {
            let event = match event {
                MouseEvent::Selection if is_system_ui(&window_class_at(x, y)) => MouseEvent::Click,
                e => e,
            };
            on_event(event, x, y);
        }
    });

    thread::spawn(|| unsafe {
        let Ok(hook) = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), None, 0) else { return };
        HOOK_THREAD.store(GetCurrentThreadId(), Ordering::Release);
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
        let _ = UnhookWindowsHookEx(hook);
        HOOK_THREAD.store(0, Ordering::Release);
    });
}

pub fn stop_mouse_monitor() {
    let id = HOOK_THREAD.load(Ordering::Acquire);
    if id != 0 {
        unsafe {
            let _ = PostThreadMessageW(id, WM_QUIT, WPARAM(0), LPARAM(0));
        }
    }
    if let Some(slot) = EVENTS.get() {
        *slot.lock().unwrap() = None; // closes the channel; the consumer thread ends
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_horizontal_drag_across_a_line_is_a_selection() {
        assert!(is_drag_selection(120, 4, 400));
        assert!(is_drag_selection(-90, 10, 250), "right to left too");
    }

    #[test]
    fn clicks_and_short_flicks_are_not() {
        assert!(!is_drag_selection(0, 0, 90), "a click");
        assert!(!is_drag_selection(0, 0, 600), "a long press without moving");
        assert!(!is_drag_selection(120, 4, 100), "too quick: a window drag or a flick");
        assert!(!is_drag_selection(20, 2, 400), "too short to span a word");
        assert!(!is_drag_selection(10, 80, 400), "a vertical drag is a scrollbar or a window");
    }

    #[test]
    fn a_slow_multi_line_drag_is_a_selection() {
        assert!(is_drag_selection(40, 60, 500));
        assert!(!is_drag_selection(40, 60, 250), "a quick diagonal is not");
    }

    #[test]
    fn the_shell_is_not_text() {
        for c in ["WorkerW", "Progman", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Windows.UI.Core.CoreWindow"] {
            assert!(is_system_ui(c));
        }
        assert!(!is_system_ui("Chrome_RenderWidgetHostHWND"));
        assert!(!is_system_ui("Notepad"));
    }
}
