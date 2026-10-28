# Tasks: An island that fits every screen

- [x] T001 Draw webviews at the display scale only (`platform::match_display_scale`, island, bubble, Muse)
- [x] T002 Work area in `ScreenInfo`; `screen-changed` carries it; taskbar changes are noticed (src-tauri/src/island.rs)
- [x] T003 Page zoom in `PollGate`; window = panel × zoom; cursor and click-through in page px; `set_ui_zoom`, `screen_info` commands
- [x] T004 `fitZoom` / `screenRoom` (web/src/core/appearance.ts); island limit from the work area (web/src/island/island.ts)
- [x] T005 Tabs drop labels when they do not fit (web/src/views/views.ts, spotify.css)
- [x] T006 Tests: fit on 2560/1920/1366/1024/911 wide screens, work area, ZOOM_MIN shared with Rust, zoom clamp
- [x] T007 3.5.1: CHANGELOG, README versions, release
- [ ] T008 Manual check on a PC with Text size 150 % and on a 1366×768 laptop (user)
