# Changelog

## 3.3.0 — Crypto

- **Live crypto prices.** A new Crypto section shows the live price of any coin, a candlestick
  (or line) chart with volume and a hover crosshair, the 24-hour high, low and volume, and the
  coins you follow. Prices are read straight from your own exchange account — **Nobitex**,
  **Binance** or **Toobit** — with no server of ours in between and no invented numbers: nothing
  is shown until the exchange has accepted your key.
- **Your key, kept safe.** The key is read-only, lives in the Windows Credential Manager (one
  entry per exchange), and is never written to a file or handed to the page; the interface only
  hears short status codes. Nobitex's new API keys are supported with their real scheme (a public
  key plus a private key, every request signed with Ed25519); Binance and Toobit use HMAC-SHA256.
  **Change API** deletes the key.
- **Timeframes.** Choose 1m, 5m, 15m, 1h, 4h or 1d candles from a dropdown; the choice is
  remembered.
- **Favourites and a default coin.** Star up to 40 coins for one-click switching in a bar under
  the picker, and mark one as the default: it is the island's first coin at every start.
- **Coin list and icons from the exchange.** The dropdown lists every coin the exchange offers,
  with its price and change, and the icons are loaded online with a drawn fallback.
- **Toman and Tether.** On Nobitex the price toggles between Toman and USDT. Toman is written
  with `T` on a single line (`4,795,000,000 T`) and the chart axis in millions; Tether is in the
  list too (Nobitex publishes no candles for it, so only its live price and 24-hour figures show).
- **Quiet by design.** Prices are polled only while the Crypto section is on screen (every 5 s on
  Nobitex, 3 s on Toobit, 2 s on Binance), failures are retried with a back-off and the last
  prices stay visible, marked as stale. Switch the whole section off in Settings.
- **Both languages, both themes.** The section is laid out right-to-left in Persian with firm
  Vazirmatn digits, and follows the light and dark themes — including the exchange dropdown and
  the connect card.
- **Fixed: the header tabs could scroll out of view.** Focusing a field while the island was
  collapsed could push the Translate / Spotify / Football / Crypto tabs out of sight; the island
  now clips instead of scrolling.
- **Fixed: Translate buttons wrapping.** Clear, Fix and the other action buttons under the text
  box now stay on one horizontal row at any width.
- **Fixed: Spotify in the light theme.** Colours of the Spotify section now follow the day theme.
- **README.** New Crypto section with an animated recording, animated art and the exchange table,
  in English and Persian.

## 3.2.0 — Football

- **Football.** Choose a favourite team (search any club or national side, or pick one of the
  popular ones) and the island shows its live score, the next matches and the recent results,
  read from ESPN's public data (no key, no account). Dates and times follow the interface
  language: Solar Hijri in Persian, Gregorian in English. When the team scores, the island
  grows into a stage with a "GOAL!" banner and the scorer, rains balls and confetti, Ari cheers
  (jumping, happy eyes, stars and hearts) with a new crowd-cheer sound, then everything returns
  to normal. Only the favourite team's own goal in a game already being followed counts: opening
  the app mid-game, a correction or the other side scoring never celebrates. Off with one switch
  in Settings.
- **Football, second by second.** While the team plays, only the live game is re-read every 3 s
  (the full schedule every 45 s), every 10 s around a kick-off, every 30 s in the 20 minutes
  before and every 5 minutes otherwise; a failed read during a game is retried after 8 s.
  Every event is detected and answered with its own show: your goals (several between two reads
  count together), goals against, yellow and red cards for either side, kick-off, half-time, the
  second half and the final whistle (win, draw, loss). The island grows to a stage that fits the
  event, Ari reacts (cheers, droops with sweat for bad news), a whistle, card or groan sound
  plays, and events that arrive together wait their turn; bigger ones interrupt smaller ones.
- **Ari in the team's kit.** While the favourite team is playing, Ari wears its shirt: the team's
  own colours in broad stripes, a V collar, a club badge, the number 10, a headband and a
  ball rocking at his feet. A new switch in Settings ("Team kit on Ari") turns it off.
- **The kit belongs to the Football section.** Ari wears the favourite team's kit in the Football
  section only, game or no game, and nothing else is worn there; in every other section his usual
  outfit shows and the kit never appears, so the two never mix.
- **The "Smart" button fits its word.** In Persian the engine button now grows to the width of
  "هوشمند" instead of cutting it to "هوشمـ..".
- **Smart translation fits its card.** The island window is taller (640 px), the result card keeps a
  little slack so the last line is never cut, and the bottom fade only shows when there really is
  more text below.
- **Every team in its own kit.** The shirt takes the favourite team's real colours and pattern:
  Barcelona's blue and garnet stripes, Real Madrid's white with black trim, and so on for the big
  clubs; any other team gets its ESPN colour. The kit has no sleeves or hands.
- **Next match for every team.** Teams whose schedule lists no future games (Persepolis, for one)
  now get their next match from the team page, so "Next matches" is no longer empty.
- **The next match in its own frame.** With no game on, the page shows the next match in a framed
  card (both crests, the day, a large kick-off time and how long to wait), then the following ones
  below it.
- **Kit that moves in 3D.** The shirt's neckline, stripes, V collar, badge and number are built in
  the head's own frame: when Ari looks down, up or turns, the shirt follows and his eyes never
  sink into it.
- **Shows from the hidden island.** An event now opens and holds the island even when it was fully
  hidden, so it grows to its stage instead of staying tiny.
- **Folded island.** A show now grows from the folded capsule cleanly: the clock and the mini
  characters step aside, and Ari grows from the capsule to the stage instead of overlapping them.
- **Persian numbers.** The score, clock, times and results use the Persian-capable font with firm
  digits instead of the monospace font.
- **Persian text is clearer.** Vazirmatn is scaled up so its letters match Latin ones, text is a
  touch heavier with more line height, and dimmed text is brighter in Persian.
- **README.** New animated football scenes (the island growing for every moment of a match with Ari in
  Barcelona's kit, and a parade of team kits), a reactions table, the Football section and a new
  ticker, in the English and Persian READMEs.

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
