// The installer and the uninstaller with a face: the setup window is a page of
// the app itself (web/setup.html), with Ari alive in it, and the real work is
// done by the NSIS installer underneath, run silently.
//
// `Arizo-Agent-Setup.exe` (NSIS) unpacks the app and starts it as
// `arizo-agent.exe --setup "<path of the setup exe>"`; the page shows, and when
// the user says go it runs that same exe again with `/S` and waits. The
// uninstaller does the same with `--uninstall`, and wipes every trace of the
// app when the user asks for it (the default): settings, history, the log, the
// webview profile, the saved tokens in the Credential Manager, start-up and
// registry entries.
//
// `arizo-agent.exe --wipe` does only the wiping: the plain NSIS uninstaller
// (no WebView2, or run by hand) calls it when its "Delete the application
// data" box is ticked.

use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// Keeps spawned helpers from flashing a console window.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
pub const LABEL: &str = "setup";
const PRODUCT: &str = "Arizo-Agent";
const BUNDLE_ID: &str = "com.arizo.translate";
const CREDENTIAL_SERVICE: &str = "com.arizo.translate";

/// An install or an uninstall is running: the window does not close under it.
static BUSY: AtomicBool = AtomicBool::new(false);
/// Removed after this process exits (remove_after_exit).
static LEFTOVERS: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

#[derive(Clone, Debug, PartialEq)]
pub enum Mode {
    /// Install from the setup exe at this path.
    Install(PathBuf),
    /// Remove the app installed in this folder.
    Uninstall(PathBuf),
}

/// `--setup <exe>` or `--uninstall <dir>` on the command line, nothing otherwise.
pub fn mode_from_args(args: &[String]) -> Option<Mode> {
    let at = |flag: &str| args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).map(PathBuf::from);
    if let Some(exe) = at("--setup") {
        return Some(Mode::Install(exe));
    }
    at("--uninstall").map(Mode::Uninstall)
}

fn mode(app: &AppHandle) -> Mode {
    app.state::<Mode>().inner().clone()
}

fn local_app_data() -> PathBuf {
    std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir)
}

/// Where the app goes: the previous install's folder if there is one, otherwise %LOCALAPPDATA%\Arizo-Agent.
fn install_dir() -> PathBuf {
    reg_string(&format!("Software\\arizo\\{PRODUCT}"), "")
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| local_app_data().join(PRODUCT))
}

fn installed_version() -> Option<String> {
    reg_string(&format!("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{PRODUCT}"), "DisplayVersion")
        .filter(|v| !v.is_empty())
}

/// The webview's profile for these pages: in the temp folder, never in the app's own data.
fn webview_dir() -> PathBuf {
    std::env::temp_dir().join(format!("arizo-setup-{}", std::process::id()))
}

/// The page's first question: what it is, which version, what is already there, which language.
#[tauri::command]
pub fn setup_info(app: AppHandle) -> Value {
    let version = app.package_info().version.to_string();
    let lang = saved_language().unwrap_or_else(system_language);
    match mode(&app) {
        Mode::Install(_) => json!({
            "mode": "install", "version": version, "installed": installed_version(),
            "dir": install_dir().to_string_lossy(), "lang": lang,
        }),
        Mode::Uninstall(dir) => json!({
            "mode": "uninstall", "version": installed_version().unwrap_or(version),
            "dir": dir.to_string_lossy(), "lang": lang,
        }),
    }
}

/// The language of a previous install, read from its settings file without loading (or creating) the store.
fn saved_language() -> Option<String> {
    let file = crate::store::config_dir().join("settings.json");
    let v: Value = serde_json::from_str(&std::fs::read_to_string(file).ok()?).ok()?;
    let pick = |k: &str| v.get(k).and_then(Value::as_str).filter(|l| !l.is_empty()).map(str::to_string);
    let lang = pick("language").or_else(|| pick("appLanguage"))?;
    matches!(lang.as_str(), "en" | "fa").then_some(lang)
}

/// Persian when Windows speaks it, English otherwise.
fn system_language() -> String {
    use windows::Win32::Globalization::GetUserDefaultUILanguage;
    // LANG_PERSIAN is 0x29 in the primary language id.
    let id = unsafe { GetUserDefaultUILanguage() };
    if id & 0x3ff == 0x29 { "fa".into() } else { "en".into() }
}

/// Runs the silent NSIS install. The page hears `setup-progress` while it runs, then `setup-done`.
#[tauri::command]
pub fn setup_install(app: AppHandle, desktop: bool) -> Result<bool, String> {
    let Mode::Install(exe) = mode(&app) else { return Err("not an installer".into()) };
    let dir = install_dir();
    std::thread::spawn(move || {
        BUSY.store(true, Ordering::SeqCst);
        // NSIS wants /D last and unquoted. A silent install makes both shortcuts (/NS would drop
        // the Start menu one too), so an unwanted desktop shortcut is removed after.
        let args = vec!["/S".to_string(), format!("/D={}", dir.to_string_lossy())];
        let ok = run_and_watch(&app, &exe, &args);
        if ok && !desktop {
            if let Some(desktop) = desktop_dir() {
                let _ = std::fs::remove_file(desktop.join(format!("{PRODUCT}.lnk")));
            }
        }
        BUSY.store(false, Ordering::SeqCst);
        let _ = app.emit_to(LABEL, "setup-done", json!({ "ok": ok }));
    });
    // `true`, not `()`: the page reads a null answer as a failure.
    Ok(true)
}

/// Runs the silent NSIS uninstaller, then wipes the app's data if asked to.
#[tauri::command]
pub fn setup_uninstall(app: AppHandle, wipe: bool) -> Result<bool, String> {
    let Mode::Uninstall(dir) = mode(&app) else { return Err("not an uninstaller".into()) };
    std::thread::spawn(move || {
        BUSY.store(true, Ordering::SeqCst);
        let uninstaller = dir.join("uninstall.exe");
        // `_?=` keeps NSIS from copying itself to a temp folder, so the wait really waits. A running
        // app is closed by the uninstaller itself (Restart Manager, by path), not this window: it
        // runs from a copy in the temp folder.
        let args = vec!["/S".to_string(), format!("_?={}", dir.to_string_lossy())];
        let ok = run_and_watch(&app, &uninstaller, &args);
        if ok {
            if wipe {
                wipe_everything();
            }
            // With `_?=` the uninstaller cannot delete itself; the folder goes once this process has exited.
            let _ = std::fs::remove_file(&uninstaller);
            LEFTOVERS.lock().unwrap().push(dir.clone());
        }
        BUSY.store(false, Ordering::SeqCst);
        let _ = app.emit_to(LABEL, "setup-done", json!({ "ok": ok }));
    });
    Ok(true)
}

/// Starts the freshly installed app and closes the setup window.
#[tauri::command]
pub fn setup_launch(app: AppHandle) {
    let exe = install_dir().join("arizo-agent.exe");
    let _ = Command::new(exe).creation_flags(CREATE_NO_WINDOW).spawn();
    app.exit(0);
}

#[tauri::command]
pub fn setup_close(app: AppHandle) {
    if !BUSY.load(Ordering::SeqCst) {
        app.exit(0);
    }
}

#[tauri::command]
pub fn setup_minimize(app: AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.minimize();
    }
}

/// Runs `exe` and, while it works, reports a progress the page can draw: NSIS
/// says nothing when silent, so the estimate grows towards 0.95 and jumps to 1
/// at the end.
fn run_and_watch(app: &AppHandle, exe: &Path, args: &[String]) -> bool {
    let child = Command::new(exe).args(args).creation_flags(CREATE_NO_WINDOW).spawn();
    let Ok(mut child) = child else { return false };
    let started = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let _ = app.emit_to(LABEL, "setup-progress", 1.0);
                return status.success();
            }
            Ok(None) => {
                let s = started.elapsed().as_secs_f64();
                let p = 0.95 * (1.0 - (-s / 1.6).exp());
                let _ = app.emit_to(LABEL, "setup-progress", p);
                std::thread::sleep(std::time::Duration::from_millis(60));
            }
            Err(_) => return false,
        }
    }
}

/// Everything the app ever wrote, gone: its folders, the saved tokens and keys, the start-up entry.
pub fn wipe_everything() {
    let roaming = std::env::var_os("APPDATA").map(PathBuf::from);
    let local = Some(local_app_data());
    for (base, name) in [
        (&roaming, "Arizo Translate"),
        (&roaming, BUNDLE_ID),
        (&local, BUNDLE_ID),
        (&local, "arizo-translate-updater"),
    ] {
        if let Some(base) = base {
            let _ = std::fs::remove_dir_all(base.join(name));
        }
    }
    if let Some(home) = std::env::var_os("USERPROFILE") {
        let _ = std::fs::remove_dir_all(PathBuf::from(home).join(".aphra-translate"));
    }
    for name in ["ai-api-key", "spotify-refresh-token", "crypto_api_key"] {
        forget_credential(name);
    }
    for provider in crate::store::CRYPTO_PROVIDERS {
        for part in ["token", "secret"] {
            forget_credential(&format!("crypto-{provider}-{part}"));
        }
    }
    delete_reg_value("Software\\Microsoft\\Windows\\CurrentVersion\\Run", "arizo-translate");
    delete_reg_value("Software\\Microsoft\\Windows\\CurrentVersion\\Run", PRODUCT);
    delete_reg_tree(&format!("Software\\arizo\\{PRODUCT}"));
    delete_reg_tree("Software\\arizo");
}

fn forget_credential(name: &str) {
    if let Ok(entry) = keyring::Entry::new(CREDENTIAL_SERVICE, name) {
        let _ = entry.delete_credential();
    }
}

/// What is still in use while this process runs (its webview profile, its own exe when it is
/// the uninstaller's copy, the emptied install folder): a hidden script removes it all once the
/// process is gone, then itself.
fn remove_after_exit(paths: &[PathBuf]) {
    let me = std::process::id();
    let mut lines = vec![
        "@echo off".to_string(),
        ":wait".to_string(),
        format!("tasklist /fi \"PID eq {me}\" | find \"{me}\" >nul && (ping -n 2 127.0.0.1 >nul & goto wait)"),
        // WebView2's own processes let go of the profile a moment later.
        "ping -n 3 127.0.0.1 >nul".to_string(),
    ];
    for p in paths {
        let p = p.to_string_lossy();
        lines.push(format!("if exist \"{p}\\*\" (rd /s /q \"{p}\") else (del /f /q \"{p}\" 2>nul)"));
    }
    lines.push("del /f /q \"%~f0\"".into());
    let script = std::env::temp_dir().join(format!("arizo-cleanup-{me}.cmd"));
    if std::fs::write(&script, lines.join("\r\n")).is_ok() {
        let _ = Command::new("cmd.exe").arg("/c").arg(&script).creation_flags(CREATE_NO_WINDOW).spawn();
    }
}

fn desktop_dir() -> Option<PathBuf> {
    use windows::Win32::UI::Shell::{FOLDERID_Desktop, SHGetKnownFolderPath, KF_FLAG_DEFAULT};
    unsafe {
        let p = SHGetKnownFolderPath(&FOLDERID_Desktop, KF_FLAG_DEFAULT, None).ok()?;
        let s = p.to_string().ok();
        windows::Win32::System::Com::CoTaskMemFree(Some(p.0 as _));
        s.map(PathBuf::from)
    }
}

// ── Registry (HKCU only: the app installs for the current user) ───────────────

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn reg_string(key: &str, value: &str) -> Option<String> {
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};
    let (k, v) = (wide(key), wide(value));
    let mut buf = vec![0u16; 1024];
    let mut size = (buf.len() * 2) as u32;
    let err = unsafe {
        RegGetValueW(HKEY_CURRENT_USER, PCWSTR(k.as_ptr()), PCWSTR(v.as_ptr()), RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr() as _), Some(&mut size))
    };
    if err.is_err() {
        return None;
    }
    let len = (size as usize / 2).saturating_sub(1);
    Some(String::from_utf16_lossy(&buf[..len]).trim_matches('"').to_string())
}

fn delete_reg_value(key: &str, value: &str) {
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{RegDeleteKeyValueW, HKEY_CURRENT_USER};
    let (k, v) = (wide(key), wide(value));
    unsafe {
        let _ = RegDeleteKeyValueW(HKEY_CURRENT_USER, PCWSTR(k.as_ptr()), PCWSTR(v.as_ptr()));
    }
}

fn delete_reg_tree(key: &str) {
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{RegDeleteKeyW, RegDeleteTreeW, HKEY_CURRENT_USER};
    let k = wide(key);
    unsafe {
        let _ = RegDeleteTreeW(HKEY_CURRENT_USER, PCWSTR(k.as_ptr()));
        let _ = RegDeleteKeyW(HKEY_CURRENT_USER, PCWSTR(k.as_ptr()));
    }
}

// ── The window ────────────────────────────────────────────────────────────────

/// The setup app: only this window, nothing of the island starts.
pub fn run(mode: Mode, mut context: tauri::Context) {
    // tauri.conf.json declares the island window; the setup builds only its own.
    context.config_mut().app.windows.clear();
    // The copy of the app this runs from: installer.nsi puts it in the temp folder as
    // arizo-setup-<n>.exe. Anything else (a dev build run by hand) is left alone.
    if let Ok(me) = std::env::current_exe() {
        // By name only: the temp folder can be spelled short (AMIRHO~1) on one side and long on the other.
        let temp_copy = me.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("arizo-setup-"));
        if temp_copy {
            LEFTOVERS.lock().unwrap().push(me);
        }
    }
    LEFTOVERS.lock().unwrap().push(webview_dir());
    tauri::Builder::default()
        .manage(mode)
        .invoke_handler(tauri::generate_handler![setup_info, setup_install, setup_uninstall, setup_launch, setup_close, setup_minimize])
        .setup(|app| {
            let handle = app.handle().clone();
            let url = page_url(&handle);
            let win = WebviewWindowBuilder::new(app, LABEL, url)
                .title(PRODUCT)
                .inner_size(720.0, 460.0)
                .resizable(false)
                .maximizable(false)
                .decorations(false)
                // Undecorated with a shadow: Windows 11 rounds the corners and draws the shadow itself.
                .shadow(true)
                .background_color(tauri::window::Color(13, 14, 20, 255))
                .center()
                .data_directory(webview_dir())
                .build()?;
            crate::platform::match_display_scale(&win, 1.0);
            Ok(())
        })
        .on_window_event(|_win, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if BUSY.load(Ordering::SeqCst) {
                    api.prevent_close();
                }
            }
        })
        .build(context)
        .expect("error while building the Arizo-Agent setup")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                remove_after_exit(&LEFTOVERS.lock().unwrap());
            }
        });
}

fn page_url(app: &AppHandle) -> WebviewUrl {
    #[cfg(dev)]
    if let Some(mut base) = app.config().build.dev_url.clone() {
        base.set_path("/setup.html");
        return WebviewUrl::External(base);
    }
    let _ = app;
    WebviewUrl::App("setup.html".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn reads_the_mode_from_the_command_line() {
        assert_eq!(mode_from_args(&args(&["arizo-agent.exe"])), None);
        assert_eq!(mode_from_args(&args(&["arizo-agent.exe", "--hidden"])), None);
        assert_eq!(
            mode_from_args(&args(&["arizo-agent.exe", "--setup", r"C:\Downloads\Setup.exe"])),
            Some(Mode::Install(PathBuf::from(r"C:\Downloads\Setup.exe")))
        );
        assert_eq!(
            mode_from_args(&args(&["arizo-agent.exe", "--uninstall", r"C:\Apps\Arizo-Agent"])),
            Some(Mode::Uninstall(PathBuf::from(r"C:\Apps\Arizo-Agent")))
        );
        // A flag without its path is not a mode.
        assert_eq!(mode_from_args(&args(&["arizo-agent.exe", "--setup"])), None);
    }
}
