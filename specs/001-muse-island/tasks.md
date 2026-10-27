# Tasks: Muse in the Dynamic Island

**Input**: [spec.md](spec.md), [plan.md](plan.md)

## Phase 1: Foundation (done in the first session)
- [x] T001 Add `muse` to `FEATURE_IDS` / `FEATURE_TABS` and `museEnabled` to the settings (web/src/core/feature-order.ts, web/src/core/state.ts, src-tauri/src/store.rs)
- [x] T002 Muse view: toolbar + frame + loading/error (web/src/views/muse.ts, web/src/views/muse.css)
- [x] T003 Muse tab, island size and layout (web/src/views/views.ts, web/src/core/layout.ts)
- [x] T004 Settings toggles and en/fa strings (web/src/settings/main.ts, web/src/views/settings.ts, web/src/i18n/extra.json)

## Phase 2: User Story 1 - the real muse.ai in the island (P1)
- [x] T005 [US1] `muse_show` async (Windows deadlock) and same browser arguments as the island (src-tauri/src/muse.rs)
- [x] T006 [US1] Muse window owned by the island; hidden until the first page has loaded (src-tauri/src/muse.rs)
- [x] T007 [US1] Follow the island when it is placed again (src-tauri/src/muse.rs, src-tauri/src/island.rs)
- [x] T008 [US1] Navigation kept on http(s), new windows to the system browser (src-tauri/src/muse.rs)
- [x] T009 [US1] Island stays open on the Muse tab until a click outside (web/src/island/fsm.ts, web/src/island/island.ts)
- [x] T010 [P] [US1] Rounded corners matching the frame (src-tauri/src/platform.rs, src-tauri/Cargo.toml, web/src/views/muse.css)

## Phase 3: User Story 2 - stay logged in (P2)
- [x] T011 [US2] Shared WebView2 environment keeps the profile (covered by T005)

## Phase 4: User Story 3 - background work (P3)
- [x] T012 [US3] Unread count from the page title → "new" mini in the capsule (web/src/views/muse.ts, web/src/island/island.ts)
- [x] T013 [US3] Turning Muse off in Settings closes the webview (src-tauri/src/lib.rs, src-tauri/src/muse.rs)

## Phase 5: Tests & polish
- [x] T014 [P] FSM test: stayOpen holds the open island (web/tests/state.test.mjs)
- [x] T015 [P] Test: unread title parsing (web/tests/muse.test.mjs)
- [x] T016 [P] Rust tests: rect validation, navigation filter (src-tauri/src/muse.rs)
- [x] T017 `?view=muse` dev hook (web/src/core/dev.ts)
- [ ] T018 Manual check in the running app: log in, type, fold/reopen, restart (user)
