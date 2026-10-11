# Changelog

## 3.0.1

- **Models dropdown.** In Settings → AI Engine the model is now picked from a list: the
  popular models of the chosen provider, or the full list after *Fetch models* (cached per
  provider). *Type custom model…* still lets you enter any name.
- **Replace in app.** The target window is remembered even when the island is opened from the
  tray, with a fallback to the previous app; copying tries Ctrl+C, then Ctrl+Insert, then
  `WM_COPY`; classic edit boxes are pasted into directly (`WM_PASTE`); and if nothing can
  receive the paste, the translation stays on the clipboard and a message says so. Every step
  is written to `arizo.log`. Known gap: it has not been verified in every app (Chrome's
  address bar in particular), so please report any program where it still fails.
- **Island size.** The translate view is shorter at rest, grows to fit its text and results
  without a scrollbar, and shrinks back when the text is cleared. It is wider (740–860 px) so
  the buttons no longer wrap.
- **Tray menu.** Rebuilt in the app's style; every entry works (open, translate the clipboard,
  hide or show the island, quit).
- **Installer.** New sidebar and header artwork and installer icons (`npm run installer-art`).
- **New icon.** Ari on a black island tile with a soft blue and violet glow, drawn in code (`npm run icons`). It is also the tray icon.
- **Original sounds.** The 29 sound effects are now synthesized from scratch by `npm run sounds`.
- **Dropdowns.** Opening a dropdown a second time no longer shows the square system list: the themed one is always used.
- Added `NOTICE.md` and `LICENSE-ASSETS.md`.

## 3.0.0

A full rewrite on **Tauri 2 + Rust**. Same features as 2.x, a fraction of the size, and no
helper processes.

- **Native input layer.** Copying the selection, pasting the translation and watching the
  mouse now use Win32 directly. The two PowerShell helpers and the VBScript fallbacks are gone.
- **Smaller and lighter.** One small executable instead of a bundled Chromium and Node.
- **API key in the Windows Credential Manager.** It is never written to a file and never
  reaches the page. (2.x used Electron's `safeStorage`; that key can't be read by another
  app, so enter it once again after upgrading.)
- **Your data comes along.** On first launch, the history and settings of 2.x
  (`%USERPROFILE%\.aphra-translate`) are imported.
- **Settings and history** live in `%APPDATA%\Arizo Translate`.
- Gemini keys travel in a request header, not in the URL.
- Streaming handles emoji (UTF-16 surrogate pairs) correctly.
- 34 automated tests cover language detection, chunking, idioms, the AI parsers, the
  settings merge and history, and the selection-gesture rules.

## 2.0.0

The Electron release: Dynamic Island translator, in-place translation, floating bubble,
Google and AI engines, history, themes, Persian and English interface.
