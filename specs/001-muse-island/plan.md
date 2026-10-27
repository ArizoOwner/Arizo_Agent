# Implementation Plan: Muse in the Dynamic Island

**Branch**: `001-muse-island` | **Date**: 2026-10-27 | **Spec**: [spec.md](spec.md)

## Summary

muse.ai runs in its own WebView2 window, owned by the island window and laid exactly
over the Muse view's frame. The island page owns the geometry and sends the frame's
rectangle; the backend creates, places, shows and hides the webview. Nothing of
muse.ai runs in the island page, and the webview's label is in no capability, so it
cannot call the app.

## Technical Context

- **Stack**: Tauri 2.12 (Rust) + Vite/TypeScript island page, Windows 10/11, WebView2.
- **Testing**: `cargo test --lib`, `npm test --prefix web` (node:test), `tsc --noEmit`.
- **Constraints**: one WebView2 environment per app: every webview MUST pass the same
  `additionalBrowserArgs` as the island, or it comes up blank. On Windows, creating a
  window from a synchronous command deadlocks: `muse_show` MUST be `async`.

## Why an owned window and not a child webview

`Window::add_child` (multi-webview) needs Tauri's `unstable` feature and makes the
island window hold two webviews, after which `get_webview_window("island")` returns
`None` and every island call site breaks. An owned top-level window is always above
its owner, is hidden and destroyed with it, keeps its own keyboard focus (the island
never takes focus) and needs no change to the rest of the app. It follows the island
whenever the island is placed (`island::apply_geometry` → `muse::follow`).

## Design

| Concern | Where | How |
|---|---|---|
| Webview lifecycle | `src-tauri/src/muse.rs` | created on first `muse_show`, hidden on `muse_hide`, destroyed by `muse::close` when the setting goes off |
| Loading state | `muse.rs` + `views/muse.ts` | the window stays hidden until the first page load finishes; the frame's spinner shows meanwhile |
| Placement | `muse.rs` (`follow`) | last rect kept; re-applied after every island placement |
| Security | `muse.rs` | no capability; `on_navigation` keeps http(s) only; `on_new_window` → system browser; no permission handler (WebView2 prompts) |
| Stay open | `island/fsm.ts` (`stayOpen`) | no home→petit countdown while Muse is on screen |
| Indicator | `views/muse.ts`, `island/island.ts` | `busy` (page loading) → thinking; title `(n) …` → finished |
| Corners | `platform.rs` | Windows 11 rounded corners on the Muse window, matching the frame |

## Constitution Check

No project constitution is ratified yet (`.specify/memory/constitution.md` is the template).
The repo's own rules apply: remote content gets no privileges, every window shares the
browser arguments, comments explain why, tests sit next to the existing ones.
