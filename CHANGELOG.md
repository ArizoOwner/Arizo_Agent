# Changelog

## 3.1.0 — Arizo-Agent

- **New name.** Arizo Translate is now **Arizo-Agent**. App, tray, installer,
  executable, package metadata and project links use the new name. Settings,
  history, API credentials and the startup entry keep their stable identities.
- **Spotify: this PC or your account.** With no setup, the island shows and controls the
  Spotify desktop app through the Windows media controls (cover, title, timeline, play/pause,
  previous/next, seek, shuffle, repeat, Spotify's own volume). Optionally connect your account
  to follow and control playback on any other device too; when both play, the account wins
  unless only this PC is playing. Notes (♪) float beside the dancing character while music
  plays. Account details: connect once with OAuth (PKCE, no client secret):
  create a free app in the Spotify developer dashboard, paste its Client ID, approve access
  in the browser. The island then shows and controls what plays on any of your devices —
  cover, title, artist, timeline, play/pause, previous/next, seek, shuffle, repeat, volume.
  Controls need Premium; a free account can watch. The refresh token lives in the Windows
  Credential Manager and **Disconnect** removes it. Failed commands show Spotify's own reason.
- **One mini character per feature.** Translate, Spotify and Settings have
  colour-coded miniatures in the header using the Coucou 0.4.0 canvas renderer.
  Spotify's green miniature and Ari dance during eligible playback using the
  same 112 BPM bounce, with smooth fade-in and fade-out.
- **Tidier header.** History now opens from inside Translate (button next to Paste,
  with a back button); the wardrobe lives in Settings and opens from a right-click on Ari.
- **Fixes found while testing.** The account setup replaces the local player instead of
  overlapping it; every control that has no body (next, previous, play/pause…) sends
  `Content-Length: 0`, which fixes Spotify's HTTP 411; play/pause stays enabled whichever
  of pause/resume Spotify forbids at that moment; Premium is read from the account's plan.
- **README art.** A new animated Spotify scene (Ari dancing to a 112 BPM beat with
  floating notes) in the English and Persian READMEs.
- **Reliable lifecycle.** One poller that runs only while the integration is on and an
  account is connected or Spotify runs on this PC (4 s while playing, slower when paused or idle), honours rate limits
  (Retry-After), keeps the last state on a network hiccup, and stops cleanly on exit.
- **Persian and English.** Player controls, empty states, accessibility labels
  and errors are translated; the layout supports both directions and themes.
- **Checks.** Added focused Spotify clock, artwork, dance, UI-command outcome
  and backend conversion tests, plus old-settings compatibility coverage.

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
