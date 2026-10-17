<div align="center">

<img src="assets/readme/hero.svg" width="100%" alt="Arizo-Agent — Ari, the mascot, greets in English and Persian">

<img src="assets/readme/marquee.svg" width="100%" alt="">

**A tiny friend that lives at the top of your Windows screen — and translates anything, anywhere, without making you leave what you're doing.**

A Dynamic Island for translation. Ari, a little mascot, watches your cursor; a shortcut swaps the text you just typed for its translation, right where you typed it. Persian ⇄ English out of the box, 100+ languages underneath.

[![Version](https://img.shields.io/badge/version-3.2.0-8b5cf6?logo=github)](https://github.com/ArizoOwner/Arizo_Agent/releases)
![Windows 10/11](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?logo=windows&logoColor=white)
![Tauri 2](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black)
![Rust](https://img.shields.io/badge/Rust-backend-000000?logo=rust)
![TypeScript](https://img.shields.io/badge/TypeScript-front%20end-3178C6?logo=typescript&logoColor=white)
![Tests](https://img.shields.io/badge/tests-177%20passing-22c55e)
![No telemetry](https://img.shields.io/badge/telemetry-none-22c55e)
![Native Windows](https://img.shields.io/badge/build-native%20Windows-0A84FF)
![Code: MIT](https://img.shields.io/badge/code-MIT-green)
[![GitHub stars](https://img.shields.io/github/stars/ArizoOwner/Arizo_Agent?style=social)](https://github.com/ArizoOwner/Arizo_Agent/stargazers)

**🌐 Language:** English • [فارسی](README.fa.md)

<img src="assets/readme/demo.svg" width="760" alt="Typing a sentence and getting its Persian translation in the island">

[Features](#features) • [Install](#install) • [Shortcuts](#keyboard-shortcuts) • [Engines](#two-engines) • [Privacy](#privacy) • [Build](#build-from-source) • [License](#license)

</div>

<div align="center"><img src="assets/readme/divider.svg" width="100%" alt=""></div>

## Why

Switching between a browser tab, a translation site and the window you're working in breaks your focus. **Arizo-Agent stays out of the way.** It sits at the top of the screen, never steals focus from the app you're in, and answers a keystroke or a text selection.

Meet **Ari**: a soft little squircle with two dark eyes that breathes, blinks, follows your cursor from anywhere on the screen, thinks while a translation is on its way, and celebrates when you copy one.

## Features

- 🏝️ **A real island** — a frameless, always-on-top island docked at the top centre of the display you're working on. It is exactly as tall as its content, so the empty part never blocks a click on the app underneath. `Ctrl+M` collapses it to a capsule.
- ⚡ **Translate in place — `Alt+Shift+D`** — type in Telegram, Discord, Word, Notepad, a web form or an IDE, press the shortcut, and your text is replaced by its translation in the field it was written in. Nothing selected? The whole field is used. No window opens.
- 🎯 **Quick-translate bubble** — select text anywhere by dragging: a small button appears next to the cursor. Click it to translate, then copy, listen, or replace the selection. Plain clicks, double clicks, the desktop and the taskbar never trigger it, and your clipboard isn't touched until you click.
- 🧠 **Smart language handling** — auto direction (your first language → your second, anything else → your first; swap with `Ctrl+S`), Persian-aware detection even for sentences full of English technical words, and an idiom polish that swaps literal renderings for the natural equivalent (« سنگ تمام گذاشت » → *spared no effort*, *piece of cake* → « مثل آب خوردن »).
- 🔁 **Two engines, never empty-handed** — a free **Fast** engine and a language-model **Smart** one. If Smart fails (no key, no network, quota) the translation is made with Fast and you're told why.
- 🎵 **Spotify in the island** — two ways to listen, and you can use both. **On this PC, with no setup:** the island reads the Spotify desktop app through the Windows media controls and shows the cover, title, artist and timeline, with play/pause, previous/next, seek, shuffle, repeat and Spotify's own volume. **With your account:** connect once (OAuth with PKCE — you paste the Client ID of a free developer app you create and approve access in the browser; there is no client secret) to follow and control playback on your phone or any other device too. Account controls need Spotify Premium; a free account can watch. If both are playing, the account wins unless only this PC is. While a song plays, Ari dances to the beat (112 BPM) with little ♪ notes floating beside — white on the dark island, black on the light one.
- ⚽ **Football for your favourite team** — pick a club or national side once and the island shows its **live score**, the **next matches** (in their own framed card) and the **recent results**, read online (no account, no key). Kick-off dates and times follow your language: **Solar Hijri (شمسی)** in Persian, **Gregorian** in English, with Persian digits. The score is read **every 3 seconds** while your team plays, and **every moment of the match gets its own show**: the island grows into a stage that fits it, Ari reacts, and a matching sound plays — your goals (confetti and balls), goals against (blue drops, a groan, sweat), yellow and red cards for either side, kick-off, half-time, the second half and the final whistle (win, draw or loss). Several events at once play in turn; bigger ones interrupt smaller ones. It works from the compact capsule and even from the fully hidden island.
- 👕 **Ari in your team's kit** — in the Football section Ari wears the real shirt of your favourite team: Barcelona's blue and garnet stripes, Real Madrid's white with black trim, Juventus, PSG, Milan, Esteghlal… (any other team takes its own colour). The shirt is drawn in 3D with his head — when he looks down or turns, the collar, stripes, badge and number follow and his eyes never sink into it. A switch in Settings turns it off, and everywhere else he keeps his usual outfit.
- ✨ **A mini companion for every feature** — Translate, Spotify, Football and Settings each have their own animated, colour-coded miniature in the header. The green one dances with the music.
- 🗣️ **Speech for every language** — including Persian, which Windows has no voice for.
- 📋 **Bilingual copy, PDF line-break cleaner, searchable history** — copy source + translation together, undo the broken lines from a pasted PDF, and open **History** from inside Translate to star, search and re-translate what you did before. History from 2.x is imported on first launch.
- 👗 **Dress Ari up** — a wardrobe of hats and accessories (witch hat, party hat, crown, sunglasses, bunny ears…) that also changes with the seasons on its own. Open it from **Settings**, or right-click Ari.
- 🔊 **30 original sounds** — a soft, synthesized sound for every gesture, all generated from code (`npm run sounds`). Mute or set the volume in Settings.
- 🌓 **Looks the part** — dark, light, or follow Windows. Persian (right-to-left, Vazirmatn) or English interface, switched live in **Settings** (`Ctrl+,`).
- 🔒 **Private by design** — no telemetry, your API key lives in the Windows Credential Manager and never reaches the page.
- 🪶 **Lightweight** — Rust and the system WebView2 instead of a bundled Chromium. Download the installer or the single-file portable executable from Releases.

## Ari's wardrobe

<div align="center">

<img src="assets/readme/outfits.svg" width="760" alt="Ari trying on hats and accessories">

</div>

## Football

<div align="center">

<img src="assets/readme/football.svg" width="760" alt="The island growing for every moment of a match — kick-off, goal, yellow card, half-time, goal conceded, red card, sent off, full time — while Ari reacts in his team kit">

<br>

<img src="assets/readme/kits.svg" width="760" alt="Ari wearing the kits of Barcelona, Real Madrid, Juventus, Paris Saint-Germain, AC Milan and Esteghlal">

</div>

| Moment | The island | Ari | Sound |
| :--- | :--- | :--- | :--- |
| ⚽ Your goal | Grows to a full stage, goal rain, scorer and score | Jumps for joy, stars and hearts | Crowd cheer |
| 😬 Goal against | Blue drops, the scorer and score | Tired eyes, sweat | A groan |
| 🟨 Yellow card (yours or theirs) | Falling yellow cards | Surprised, or a wink | Card |
| 🟥 Red card / opponent sent off | Red cards, a red glow | Droops, or cheers when it is theirs | Card |
| 🏁 Kick-off, second half | Falling balls | Happy | Whistle |
| ⏸️ Half-time | A calm teal stage | A wink | Whistle |
| 🏆 Full time | Win: confetti. Draw: calm. Loss: drops | Cheers, shrugs or droops | Cheer, whistle or groan |

## Spotify

<div align="center">

<img src="assets/readme/spotify.svg" width="760" alt="Ari dancing with music notes while a song plays in the Spotify player">

</div>

<div align="center"><img src="assets/readme/divider.svg" width="100%" alt=""></div>

<div align="center">

| | |
| :---: | :---: |
| <img src="docs/media/translate-fa.png" width="380" alt="Persian interface"><br>**Persian, right-to-left** | <img src="docs/media/translate-light.png" width="380" alt="Light theme"><br>**Light theme** |
| <img src="docs/media/settings.png" width="380" alt="Settings"><br>**Settings** | <img src="docs/media/wardrobe.png" width="380" alt="Ari's wardrobe"><br>**Ari's wardrobe** |
| <img src="docs/media/bubble.png" width="380" alt="Quick-translate bubble"><br>**Quick-translate bubble** | <img src="docs/media/compact.png" width="380" alt="Capsule mode"><br>**Capsule mode** |

</div>

## Two engines

| Engine | What it is | Best for |
| :--- | :--- | :--- |
| **⚡ Fast** | Google Translate's free endpoint, MyMemory as a second chance. No key, no limit, long text chunked automatically. | Everyday reading and chat |
| **✦ Smart** | A language model: tone control (formal, casual, technical, literary), idiom breakdown, alternative wordings, streamed as it is written. | Slang, idioms, code, formal mail |

**Smart providers:** OpenRouter, Google Gemini, DeepSeek, Groq, OpenAI, and local models (Ollama, LM Studio) that need no key — or any OpenAI-compatible endpoint.

## Keyboard shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Alt+D` | Open or close the island (on the selected text, if any) |
| `Alt+Shift+D` | Translate in place, in any app |
| `Ctrl+Tab` | Switch engine |
| `Ctrl+S` | Swap languages |
| `Ctrl+M` | Capsule mode |
| `Ctrl+,` | Settings |
| `Enter` | Copy and close |
| `Ctrl+Enter` | Replace the text in the app you came from |
| `Esc` | Close |

The two global shortcuts can be changed in **Settings**: click the field and press the new keys. If another app holds a combination, the previous one is kept.

## Install

Download from the [Releases](https://github.com/ArizoOwner/Arizo_Agent/releases) page:

| File | What it is |
| :--- | :--- |
| `Arizo-Agent-Setup-3.2.0.exe` | Installer for the current user — no administrator rights |
| `Arizo-Agent-3.2.0-Portable.exe` | One executable, runs without installing |
| `SHA256SUMS.txt` | Checksums of both |

The installer is **not code-signed**, so Windows SmartScreen shows a warning the first time: click **More info → Run anyway**. The app is open source — read it, or build it yourself.

The app lives in the notification area. Closing the island only hides it; quit from the tray menu.

## Privacy

- **No telemetry.** Nothing is sent anywhere you didn't ask for.
- The text you translate goes to the engine you chose: Google (and MyMemory as its fallback) for Fast, your provider for Smart. Speech goes to Google's text-to-speech.
- **Your API key** is kept in the Windows Credential Manager. It is never written to a file and never handed to the page — the interface can only ask whether one exists.
- Settings and history stay on your PC, in `%APPDATA%\Arizo Translate`. This legacy folder, the credential service and the bundle identifier are intentionally preserved in Arizo-Agent 3.1.0, so upgrades keep your data and API key.
- Spotify: on this PC the island only reads the media session Windows already shows for the Spotify app and sends it the usual play/pause/skip requests; nothing leaves your computer. The account is optional and used only after you connect it. Its access covers your playback state, playback control and your plan (Premium or free) — nothing else. The token is kept in the Windows Credential Manager, never in a file and never in the page, and **Disconnect** deletes it.
- Football: the island asks ESPN's public football data for your team's id (and, for a live game, its league and day) — nothing about you is sent, no account or key is involved, and the team you chose is only stored in your settings file. Turn it off in Settings and nothing is requested.
- Your clipboard is borrowed for a moment to read a selection or paste a translation, and given back (text and images).

## Build from source

You need [Rust](https://rustup.rs), [Node.js 20+](https://nodejs.org) and the **MSVC build tools** (Visual Studio Build Tools with "Desktop development with C++"). WebView2 ships with Windows 10/11.

```powershell
git clone https://github.com/ArizoOwner/Arizo_Agent.git
cd Arizo_Agent
npm install
npm install --prefix web
npm run dev            # live-reloading development build
npm test               # Rust + front-end test suites
npm run pack           # installer + portable exe + checksums in release/
```

```
web/                      the island, the bubble and the settings window
  src/ari/                Ari: the engine, the wardrobe, the outfits
  src/views/              translate, history, settings, the themed dropdown
  src/core/               state, bridge, theme, sound, layout…
src-tauri/src/            Rust backend
  lib.rs                  windows, tray, shortcuts, the commands the page calls
  input.rs                Win32: copy, paste, focus, the selection watcher
  google.rs  aphra.rs     the two engines        translator.rs  cache, fallback, history
  langs.rs  idioms.rs     detection and polish   store.rs       settings, history, API key
  textutil.rs  tts.rs     chunking and speech
scripts/                  icon + sound generators, packaging
```

The icon is drawn in code (`npm run icons`) and so are the sounds (`npm run sounds`): there are no binary design files to keep in sync.

## Upgrading from 2.x

The first launch imports the settings and history of the Electron version (`%USERPROFILE%\.aphra-translate`). Its API key was encrypted for that app and cannot be read by this one: enter it once in **Settings**.

## Contributing

Issues and pull requests are welcome. Run `npm test` before you open one. Translations of the interface live in `web/src/i18n/`.

## Credits

Ari's island and engine are ported from [Coucou](https://github.com/Louis-CFM/coucou) by Louis Raillé (MIT) — see [NOTICE.md](NOTICE.md). Fonts: [Vazirmatn](https://github.com/rastikerdar/vazirmatn) and [Inter](https://rsms.me/inter/) (SIL OFL). Built with [Tauri](https://tauri.app/).

## License

- **Code:** [MIT](LICENSE) — use it, fork it, learn from it, just keep the copyright notices.
- **Name, icon, sounds and media:** © ArizoOwner, all rights reserved — see [LICENSE-ASSETS.md](LICENSE-ASSETS.md). Shipping your own fork? Give it your own name and icon.

<div align="center">

<img src="assets/readme/footer.svg" width="100%" alt="Made with love by ArizoOwner — arizoteam.ir">

</div>
