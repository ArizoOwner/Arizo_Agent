# Changelog

## 3.5.5 — An island that fits every screen

- **Fixed: the island was cut off on some PCs.** With Windows' **Text size** above 100 %
  (Settings → Accessibility), the island was drawn bigger than its own window: tabs cut on one
  side, the bottom gone, every font too large. The island is now drawn at the display scale only,
  and keeps its own text size setting (Settings → Island look). muse.ai and the quick-translate
  bubble are fixed the same way.
- **Fits small screens on its own.** The island measures the room it really has on its display —
  the screen less the taskbar — and when its largest views would not fit (a small laptop, a high
  display scale, a tall taskbar), the whole island is drawn smaller by the one factor that makes
  everything fit, text included, so nothing is cut off and nothing has to scroll. On a large
  screen it stays exactly as designed. It fits itself again when the display, its resolution, its
  scale or the taskbar changes.
- **Tabs never run past the island.** When the tab row does not fit (the narrow Muse tab, bigger
  text, more tabs), the other tabs drop their names first and keep their Ari; the open one keeps
  its name while there is room. They fit themselves again when the island's width or text size
  changes.
- **No more flicker while sizing the island.** In Settings → Island look, the width, height and
  text size sliders apply when you let go, instead of resizing the window at every step of the
  drag. Transparency and corners still follow the slider live.
- **Football fits the smallest island.** At the narrowest and shortest island, and at any text
  size, the dates and the opponents' names stay whole: what is said twice gives way first (the
  "in 7 d" beside the date, the small crest, the home / away label), a long name such as Paris
  Saint-Germain takes a second line, the two lists stack when the text is large, and the lists
  scroll instead of losing their last rows. The "@" before away opponents is gone.
- **Settings at the smallest island.** A setting's control moves under its text when the row is
  too narrow (the AI model picker no longer shrinks to "De…"), and the tab of the open section
  no longer runs past the panel in Persian with large text.
- **A new installer, with Ari in it.** Installing, updating and removing Arizo-Agent now happen
  in one dark, modern window, in Persian or English (switch with one click), with Ari alive
  beside the words: his eyes follow the pointer, a click is a pat (three are too many), he works
  while the bar fills, cheers when it is done, and looks sad when you are about to remove him.
  Choose the desktop shortcut and see where it installs; an update keeps everything. Without
  WebView2 the classic installer still runs, and installs it.
- **Dress Ari in the installer.** The hanger under Ari opens his wardrobe: rest on an outfit to
  try it on, click to keep it. What he wears in the installer he wears in the app.
- **Ari's eyes follow the pointer everywhere,** outside the installer window too, and nothing
  sits on him any more when the install is done.
- **Removing the app removes all of its data.** Uninstalling now deletes, by default, every
  trace of Arizo-Agent: settings, history and the log, the saved AI key, the Spotify and
  exchange tokens in the Windows Credential Manager, the start-up entry and the registry keys.
  Before, settings and tokens stayed behind. Clear the box to keep them for a later install.

## 3.5.0 — Muse in the island

- **Muse, in the island.** A new Muse tab puts the [muse.ai](https://muse.ai) web app itself
  inside the island: the real site, live, with your login, your chats and everything it does.
  The island takes the shape of a small tablet standing up while it is open (520 × 860, less on
  a short screen) and stays open when the pointer leaves it; a click outside folds it.
- **Off until you want it.** Muse is switched off every time the app starts, Windows start-up
  included: nothing of it runs, so it uses no memory, processor or internet. Ari sleeps in the
  middle of the tab with the button that turns it on; the power button in its toolbar turns it off
  again. Switching it off never logs you out.
- **Ari while it connects.** While muse.ai opens, Ari searches for it in the middle of the tab, the
  steps light up one by one and a bar keeps moving; if it cannot be opened, Ari says so with
  **Try again** and **Turn Muse off**.
- **Reads well in both languages.** The chat uses the island's own fonts, Inter for English and
  Vazirmatn for Persian, a step smaller than the site draws them, and every paragraph, list and
  text field turns right-to-left or left-to-right on its own, by what is written in it — while
  an answer is still being written, and while you type.
- **Background work, in the capsule.** While Muse loads, its mini Ari thinks in the folded island;
  when its title announces something new, the mini shows a dot.
- **Kept apart from the app.** muse.ai runs in its own webview that cannot reach a single app
  command; links that open new windows go to your browser, only web pages may load, and the
  microphone, camera and location are asked for every time. Muse can be turned off for good in
  Settings → **Island widgets**.
- **Fixed: long text came back cut short, or not at all.** Both engines now translate long text in
  pieces and put it back together whole:
  - **Fast:** each piece is retried on its own (and in smaller pieces if Google refuses it), a few
    at a time so Google does not answer "too many requests", and paragraph breaks are put back
    where Google trims them, so paragraphs are no longer glued together. A run of text with no
    full stop is cut between words, never inside one.
  - **Smart:** the model is given room enough for its whole answer; an answer it had to cut off is
    noticed and that part translated again in smaller pieces instead of being shown as done; long
    text streams in from the top in reading order; and when the Smart engine gives up, what it had
    written is cleared before the Fast engine answers.
  - Up to 30,000 characters (an article) are translated; the limit was 8,000, and the rest was
    dropped without a word.
- **Smart engine: a blocked network is called that.** When the AI service turns this network away
  (some providers do for some countries), the island says so and suggests a VPN or another
  provider, instead of calling the key invalid.
- **Fixed: Settings lost the History size row.** Settings → General showed a widget where the
  number of translations kept belongs.

## 3.4.0 — Make it yours

- **Island look.** A new Settings page, *Island look*, sets how the island looks and each
  setting has its own "back to default" button, plus one for all of them: **width** and
  **height**, **transparency** (the body and the cards, never the text), **text size**,
  **corner roundness**, and a **floating island** that hangs a chosen distance below the top
  edge. Dragging a slider shows the change on the real island at once; letting go saves it.
- **The folded island is yours too.** The capsule has its own **width**, **height** and **zoom**
  (Ari, the clock and the mini Aris grow and shrink together and always keep their places), with
  a small drawing of it above the sliders.
- **Drag the tabs.** Pick up Translate, Spotify, Football or Crypto in the header and drop it
  where you want it; the others slide aside, and the order is remembered (right to left in
  Persian too).
- **Any text size, no overlap.** Text from 80 % to 140 % at any island width and height: the
  buttons, cards and rows wrap or share the room instead of leaving the island, overlapping or
  being cut — in the translator, Crypto, Football, Spotify, the wardrobe and Settings, in
  English and Persian.
- **Fixed: dragging the width slider jittered.** The slider sat inside the island, which is
  centred, so it slid away from under the pointer as the island widened. The island now grows
  from the other edge while you drag, the window is resized once instead of on every step, and
  its size and place are set in one call.
- **Fixed: the language row of the translator** broke onto two lines: the target-language
  menu dropped under the source chip and the swap button.
- **Translation.** The Smart engine's token budget follows the text's length, not its word count;
  MyMemory's error messages inside a 200 reply are no longer taken for translations; a
  rate-limit (429) holds back later calls until the wait is over; sentences that were cut into
  chunks are joined with a space again; paragraph breaks and dotted tokens survive the PDF
  line cleaner; and a Latin-script guess is only called ambiguous next to another Latin language.
- **In any app.** Terminals are recognised by their window class when you translate in place,
  and the quick bubble and the island keep their own translation slots.
- **History.** The cap keeps starred items, and a history full of stars still records the new
  lookup.
- **Crypto.** A Toman Tether market is no longer listed as a USDT row.
- **Fixed: "Hide when I click elsewhere" did nothing.** The setting was saved but never read. With it
  on, a click outside the island now hides it completely (open or folded); the pointer at the top
  edge brings it back.
- **Fixed: the folded island hid itself after a minute.** Only an island that peeked up from hiding
  goes back to hiding; one you folded yourself stays where it is.
- **Fixed: the hidden island sometimes did not wake** when the pointer reached the top edge. The
  cursor poll could switch click-through back on just after the window shrank to its wake strip.
- **Fixed: Settings tabs lost their labels** at a low island height. Their padding and the point
  where inactive tabs turn into icons now follow the text size.
- **README.** The Wardrobe animations (English and Persian) were damaged and are recorded again,
  like Spotify and the three island modes, and the recorder drops frames of the wrong size.
- **Only the island is the island.** Clicks pass through everything but its shape, and the
  window is never smaller than the default or absurdly large.
- **README.** Every animation was recorded again from the app itself (`npm run readme-gifs`), in
  English and Persian, and the new features have their own.

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
