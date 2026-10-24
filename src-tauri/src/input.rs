// Talking to other applications: copying their selection, pasting into them,
// bringing their window back, and noticing that the user selected something.
//
// Everything here calls Win32 directly — no helper process, no PowerShell. The
// clipboard is never polluted: a capture only looks at the clipboard sequence
// number to know whether the copy really happened, and the user's own clipboard
// (an image, else copied files, else text) is put back afterwards, and only if
// something changed it.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicIsize, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use arboard::{Clipboard, ImageData};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::System::DataExchange::{CountClipboardFormats, GetClipboardSequenceNumber};
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentProcessId, GetCurrentThreadId};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, MapVirtualKeyW, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT,
    KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, MAPVK_VK_TO_VSC, VIRTUAL_KEY, VK_A, VK_C, VK_CONTROL,
    VK_INSERT, VK_LCONTROL, VK_LMENU, VK_LSHIFT, VK_LWIN, VK_MENU, VK_RCONTROL, VK_RMENU,
    VK_RSHIFT, VK_RWIN, VK_SHIFT, VK_V,
};
use windows::Win32::UI::WindowsAndMessaging::{
    AllowSetForegroundWindow, BringWindowToTop, CallNextHookEx, GetClassNameW, GetForegroundWindow,
    GetGUIThreadInfo, GetMessageW, GetWindow, GetWindowLongPtrW, GetWindowTextW,
    GetWindowThreadProcessId, IsWindow, IsWindowVisible, PostThreadMessageW, SendMessageTimeoutW,
    SetForegroundWindow, SetWindowsHookExW, UnhookWindowsHookEx, WindowFromPoint, GUITHREADINFO,
    GWL_EXSTYLE, GW_HWNDNEXT, MSG, MSLLHOOKSTRUCT, SMTO_ABORTIFHUNG, WH_MOUSE_LL, WM_COPY,
    WM_LBUTTONDOWN, WM_LBUTTONUP, WM_PASTE, WM_QUIT, WM_RBUTTONDOWN, WM_RBUTTONUP,
    WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
};

fn sleep(ms: u64) {
    thread::sleep(Duration::from_millis(ms));
}

// ── Keys ──────────────────────────────────────────────────────────────────────

fn key_event(vk: VIRTUAL_KEY, up: bool) -> INPUT {
    let scan = unsafe { MapVirtualKeyW(vk.0 as u32, MAPVK_VK_TO_VSC) } as u16;
    // Insert, like the arrows, is an "extended" key: without the flag Windows reads it as keypad 0.
    let mut flags = if up { KEYEVENTF_KEYUP } else { Default::default() };
    if vk == VK_INSERT {
        flags |= KEYEVENTF_EXTENDEDKEY;
    }
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT { wVk: vk, wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 },
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

/// `modifier` + `key`, pressed one after the other with pauses: some engines (Chromium,
/// Qt, Electron) drop a combination whose keys arrive in the same instant.
fn chord(modifier: VIRTUAL_KEY, key: VIRTUAL_KEY) {
    release_held_modifiers();
    send(&[key_event(modifier, false)]);
    sleep(25);
    send(&[key_event(key, false)]);
    sleep(45);
    send(&[key_event(key, true)]);
    sleep(25);
    send(&[key_event(modifier, true)]);
}

fn ctrl_combo(vk: VIRTUAL_KEY) {
    chord(VK_CONTROL, vk);
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

/// Ctrl+Insert copies in nearly every Windows program, including the ones that
/// ignore a synthetic Ctrl+C.
fn send_copy_alt() {
    chord(VK_CONTROL, VK_INSERT);
}

/// The control that has the keyboard focus inside the window `hwnd` (a text box, an
/// edit field), or the window itself when it cannot be told. Classic Win32 and many
/// toolkits answer; Chromium and Qt draw their own fields and answer with the window.
fn focused_control(hwnd: HWND) -> HWND {
    unsafe {
        let thread = GetWindowThreadProcessId(hwnd, None);
        let mut info = GUITHREADINFO { cbSize: std::mem::size_of::<GUITHREADINFO>() as u32, ..Default::default() };
        if thread != 0 && GetGUIThreadInfo(thread, &mut info).is_ok() && !info.hwndFocus.0.is_null() {
            return info.hwndFocus;
        }
    }
    hwnd
}

/// Asks the focused control directly to copy or paste, with no keyboard involved.
/// Works for standard edit boxes and rich edits; harmless where it is not understood.
fn send_clipboard_message(hwnd: HWND, msg: u32) {
    let target = focused_control(hwnd);
    let mut out = 0usize;
    unsafe {
        let _ = SendMessageTimeoutW(target, msg, WPARAM(0), LPARAM(0), SMTO_ABORTIFHUNG, 400, Some(&mut out));
    }
}

// ── Windows ───────────────────────────────────────────────────────────────────

static TARGET: AtomicIsize = AtomicIsize::new(0);

/// Remember the window the user is working in, so the result can go back to it.
pub fn save_target_window() {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            crate::log("target: no foreground window when the shortcut was pressed");
            return;
        }
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let mut buf = [0u16; 128];
        let n = GetClassNameW(hwnd, &mut buf);
        let class = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
        let own = pid == GetCurrentProcessId();
        crate::log(&format!(
            "target: foreground={:#x} class={class} own_window={own} (kept {:#x})",
            hwnd.0 as isize,
            TARGET.load(Ordering::Relaxed)
        ));
        if pid != 0 && !own {
            TARGET.store(hwnd.0 as isize, Ordering::Relaxed);
        }
    }
}

/// Forget it: when the island is opened from the tray no app is "the target", and a
/// stale one must never receive a paste.
pub fn clear_target_window() {
    TARGET.store(0, Ordering::Relaxed);
}

/// The window the user was working in before Arizo came up: walking the windows from the
/// top of the stack down, the first normal, visible one that belongs to another program.
/// Used when no target was saved (the island was opened from the tray or its button, which
/// is itself the foreground window), so a replace still has somewhere to go.
fn previous_app_window() -> Option<HWND> {
    let own_pid = unsafe { GetCurrentProcessId() };
    let mut hwnd = unsafe { GetForegroundWindow() };
    // When Windows has already handed the focus to another program, that is the one.
    if !hwnd.0.is_null() {
        let mut pid = 0;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if pid != 0 && pid != own_pid {
            return Some(hwnd);
        }
    }
    let mut guard = 0;
    while !hwnd.0.is_null() && guard < 400 {
        guard += 1;
        hwnd = unsafe { GetWindow(hwnd, GW_HWNDNEXT) }.unwrap_or_default();
        if hwnd.0.is_null() {
            break;
        }
        let mut pid = 0;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if pid == 0 || pid == own_pid || !unsafe { IsWindowVisible(hwnd) }.as_bool() {
            continue;
        }
        // Skip tool windows, tooltips and the taskbar: only a window one would work in.
        let ex = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } as u32;
        if ex & WS_EX_TOOLWINDOW.0 != 0 && ex & WS_EX_APPWINDOW.0 == 0 {
            continue;
        }
        let mut title = [0u16; 8];
        if unsafe { GetWindowTextW(hwnd, &mut title) } == 0 {
            continue;
        }
        let mut class = [0u16; 64];
        let n = unsafe { GetClassNameW(hwnd, &mut class) };
        let class = String::from_utf16_lossy(&class[..n.max(0) as usize]);
        if matches!(class.as_str(), "Shell_TrayWnd" | "Shell_SecondaryTrayWnd" | "Progman" | "WorkerW" | "Windows.UI.Core.CoreWindow") {
            continue;
        }
        return Some(hwnd);
    }
    None
}

pub fn restore_target_window() {
    let raw = TARGET.load(Ordering::Relaxed);
    let saved = HWND(raw as *mut _);
    let target = if raw != 0 && unsafe { IsWindow(Some(saved)).as_bool() } {
        saved
    } else {
        // No target was saved, or it has closed: the app the user came from.
        match previous_app_window() {
            Some(prev) => {
                crate::log(&format!("target: none saved, using the previous app window {:#x}", prev.0 as isize));
                TARGET.store(prev.0 as isize, Ordering::Relaxed);
                prev
            }
            None => {
                crate::log("target: none saved and no previous app window found");
                return;
            }
        }
    };

    unsafe {
        let fg = GetForegroundWindow();
        if fg == target {
            return;
        }

        let cur_thread = GetCurrentThreadId();
        let fg_thread = if !fg.0.is_null() {
            GetWindowThreadProcessId(fg, None)
        } else {
            0
        };
        let target_thread = GetWindowThreadProcessId(target, None);

        if fg_thread != 0 && fg_thread != cur_thread {
            let _ = AttachThreadInput(cur_thread, fg_thread, true);
        }
        if target_thread != 0 && target_thread != cur_thread {
            let _ = AttachThreadInput(cur_thread, target_thread, true);
        }

        let _ = AllowSetForegroundWindow(0xFFFF_FFFF);
        let _ = BringWindowToTop(target);
        let _ = SetForegroundWindow(target);

        if target_thread != 0 && target_thread != cur_thread {
            let _ = AttachThreadInput(cur_thread, target_thread, false);
        }
        if fg_thread != 0 && fg_thread != cur_thread {
            let _ = AttachThreadInput(cur_thread, fg_thread, false);
        }
    }
    sleep(100);
}

// ── Clipboard ─────────────────────────────────────────────────────────────────

/// What the user had on the clipboard: a picture, copied files, or text. (Rich HTML /
/// RTF is not kept — the clipboard crate does not expose it — so a copied web snippet
/// comes back as its plain text, and an image copied together with its text comes
/// back as the image only.) `seq` is the clipboard sequence number at that moment.
#[derive(Default)]
pub struct Snapshot {
    text: String,
    image: Option<ImageData<'static>>,
    files: Vec<PathBuf>,
    seq: u32,
    /// The clipboard really held nothing, as opposed to a format we cannot keep.
    empty: bool,
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
    Snapshot {
        text: c.get_text().unwrap_or_default(),
        image: c.get_image().ok().map(|i| i.to_owned_img()),
        files: c.get().file_list().unwrap_or_default(),
        seq: sequence(),
        empty: unsafe { CountClipboardFormats() } == 0,
    }
}

/// Puts the snapshot back and checks that it really replaced what we wrote. Does
/// nothing when the clipboard never changed, and leaves it alone when the snapshot
/// holds only a format we could not keep.
pub fn restore(snap: &Snapshot) -> bool {
    if sequence() == snap.seq {
        return true;
    }
    // The program we copied from needs a moment to finish with the clipboard.
    sleep(70);
    for _ in 0..8 {
        if let Some(mut c) = clipboard() {
            let done = if let Some(img) = &snap.image {
                c.set_image(img.clone()).is_ok()
            } else if !snap.files.is_empty() {
                c.set().file_list(&snap.files).is_ok()
            } else if !snap.text.is_empty() {
                c.set_text(snap.text.clone()).is_ok()
            } else if snap.empty {
                c.clear().is_ok()
            } else {
                return false;
            };
            if done && (snap.image.is_some() || !snap.files.is_empty() || c.get_text().unwrap_or_default() == snap.text) {
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

/// Waits until the clipboard changes (its sequence number moves) or the time is up.
fn clipboard_changed_since(before: u32, timeout_ms: u64) -> bool {
    let start = Instant::now();
    while start.elapsed() < Duration::from_millis(timeout_ms) {
        if sequence() != before {
            return true;
        }
        sleep(25);
    }
    sequence() != before
}

/// The classic console host, Windows Terminal, mintty and ConEmu. The VS Code integrated
/// terminal is a Chromium window (Chrome_WidgetWin_1) and cannot be told apart from the
/// editor, so Ctrl+C is still sent there.
fn is_terminal_class(class: &str) -> bool {
    matches!(
        class,
        "ConsoleWindowClass" | "CASCADIA_HOSTING_WINDOW_CLASS" | "mintty" | "VirtualConsoleClassMain" | "VirtualConsoleClass"
    )
}

fn is_terminal_window(hwnd: HWND) -> bool {
    if hwnd.0.is_null() {
        return false;
    }
    let mut buf = [0u16; 64];
    let n = unsafe { GetClassNameW(hwnd, &mut buf) };
    is_terminal_class(&String::from_utf16_lossy(&buf[..n.max(0) as usize]))
}

/// Copies the selection and reports whether the clipboard really changed: no marker
/// text is ever written, so nothing the user had is overwritten unless something was
/// selected. Not every program obeys a synthetic Ctrl+C, so three ways are tried in
/// turn, each given time to answer: Ctrl+C, Ctrl+Insert, then a direct WM_COPY.
fn copy_and_wait(timeout_ms: u64) -> bool {
    let before = sequence();
    let front = unsafe { GetForegroundWindow() };
    // In a terminal Ctrl+C is an interrupt that kills the running process when nothing
    // is selected, so only Ctrl+Insert and WM_COPY (which copy a selection and nothing
    // else) are tried there.
    if is_terminal_window(front) {
        send_copy_alt();
        if clipboard_changed_since(before, timeout_ms / 2) {
            return true;
        }
    } else {
        send_copy();
        if clipboard_changed_since(before, timeout_ms) {
            return true;
        }
        send_copy_alt();
        if clipboard_changed_since(before, timeout_ms / 2) {
            crate::log("capture: Ctrl+C was ignored, Ctrl+Insert worked");
            return true;
        }
    }
    if !front.0.is_null() {
        send_clipboard_message(front, WM_COPY);
        if clipboard_changed_since(before, timeout_ms / 2) {
            crate::log("capture: Ctrl+C and Ctrl+Insert were ignored, WM_COPY worked");
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
    crate::log(&format!("capture: selection copy gave {} chars", selected.chars().count()));
    if !selected.is_empty() {
        return selected;
    }
    // Ctrl+A in a terminal is "start of line", not select-all: there is no field to take.
    if is_terminal_window(unsafe { GetForegroundWindow() }) {
        return String::new();
    }
    if CAPTURING.swap(true, Ordering::AcqRel) {
        crate::log("capture: another capture is already running");
        return String::new();
    }
    let backup = snapshot();
    send_select_all();
    sleep(75);
    let copied = copy_and_wait(450);
    let text = if copied { read_text().trim().to_string() } else { String::new() };
    crate::log(&format!("capture: select-all + copy changed the clipboard={copied}, {} chars", text.chars().count()));
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
    // Wait until the target really is in front: Ctrl+V goes to whoever has the focus,
    // and a fixed pause is not enough for every app (Chrome, Electron, UWP).
    let wanted = TARGET.load(Ordering::Relaxed);
    let mut front = unsafe { GetForegroundWindow() }.0 as isize;
    let mut waited = 0;
    while wanted != 0 && front != wanted && waited < 600 {
        sleep(40);
        waited += 40;
        if waited % 200 == 0 {
            restore_target_window();
        }
        front = unsafe { GetForegroundWindow() }.0 as isize;
    }
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(GetForegroundWindow(), Some(&mut pid)) };
    let own = pid == unsafe { GetCurrentProcessId() };
    crate::log(&format!(
        "paste: target={wanted:#x} front={front:#x} same={} own_window={own} waited={waited}ms chars={}",
        front == wanted,
        text.chars().count()
    ));
    if own {
        // Pasting into our own island would do nothing useful: leave the text on the clipboard.
        write_text(text);
        crate::log("paste: the front window is Arizo itself, text left on the clipboard");
        return false;
    }
    sleep(60);
    if !write_text(text) {
        crate::log("paste: could not write the clipboard");
        return false;
    }
    sleep(80);
    let front = unsafe { GetForegroundWindow() };
    // One way is used, never two: a second paste after a first that worked would
    // insert the text twice, and Windows cannot tell whether a keystroke was obeyed.
    // A classic edit control is asked directly (WM_PASTE); everything else, Chrome,
    // Telegram, Electron, Office, gets the keyboard paste.
    let standard_edit = {
        let ctl = focused_control(front);
        let mut buf = [0u16; 64];
        let n = unsafe { GetClassNameW(ctl, &mut buf) };
        let class = String::from_utf16_lossy(&buf[..n.max(0) as usize]).to_lowercase();
        class.starts_with("edit") || class.contains("richedit") || class.contains("textbox")
    };
    if standard_edit {
        // A classic Win32 edit control: ask it directly, which needs no keyboard focus
        // tricks and cannot be swallowed by a shortcut handler.
        send_clipboard_message(front, WM_PASTE);
        crate::log("paste: standard edit control, WM_PASTE sent");
    } else {
        send_paste();
        crate::log("paste: Ctrl+V sent");
    }
    if restore_clipboard {
        // Slow targets (Word, Electron apps, Telegram, Chrome) read the clipboard after Ctrl+V.
        thread::spawn(move || {
            sleep(1800);
            restore(&backup);
        });
    }
    true
}

/// The same as `paste_text`, but when nothing is going to receive the paste the text
/// stays on the clipboard and the caller is told, so the user can press Ctrl+V.
pub fn paste_or_keep(text: &str, backup: Option<Snapshot>, restore_clipboard: bool) -> PasteOutcome {
    if paste_text(text, backup, restore_clipboard) {
        PasteOutcome::Pasted
    } else {
        // Whatever stopped the paste, the translation is on the clipboard.
        write_text(text);
        PasteOutcome::KeptOnClipboard
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PasteOutcome {
    Pasted,
    KeptOnClipboard,
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

    #[test]
    fn terminals_are_told_by_their_window_class() {
        for c in ["ConsoleWindowClass", "CASCADIA_HOSTING_WINDOW_CLASS", "mintty", "VirtualConsoleClassMain", "VirtualConsoleClass"] {
            assert!(is_terminal_class(c));
        }
        assert!(!is_terminal_class("Notepad"));
        assert!(!is_terminal_class("Chrome_WidgetWin_1"));
        assert!(!is_terminal_class(""));
    }
}
