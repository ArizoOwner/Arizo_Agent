# Feature Specification: Muse in the Dynamic Island

**Feature Branch**: `001-muse-island`
**Created**: 2026-10-27
**Status**: Clarified
**Input**: "Add a feature so https://muse.ai can be used exactly inside the Dynamic Island."

## Clarifications

### Session 2026-10-27 (first)
- Q: Integration approach? → A: Embed the real muse.ai site in a webview inside the island (works exactly like the site).
- Q: Placement? → A: New draggable feature tab "Muse" beside Translate / Spotify / Football / Crypto.
- Q: Size? → A: Island grows to a larger panel (~460×640) only while the Muse tab is open.
- Q: Session storage? → A: Use the app's default webview storage (login persists).
- Q: Collapsed state? → A: Small Muse icon with a "thinking" pulse while Muse works in the background.

### Session 2026-10-27 (second)
- Q: Is a look-alike client acceptable? → A: No. It MUST be the muse.ai web app itself, running live in the island, not a re-implementation or an imitation of it.
- Q: When the pointer leaves the island while Muse is open, what happens? → A: The island stays open until a click outside it (or another tab is chosen); the auto-close countdown does not run on the Muse tab.
- Q: When muse.ai asks for the microphone, camera or location, what happens? → A: Ask every time: the webview's own permission prompt is shown and the user decides. The app never grants a permission by itself.
- Q: What lights the Muse indicator in the folded island? → A: Page loading (pulse) plus the page title: a title with an unread count such as "(1) Muse" shows a "something new" mini. Nothing reads the inside of the page.
- Q: When is the Muse page created and destroyed? → A: Created the first time the Muse tab opens, then kept alive (hidden) until the app quits, so a task in progress goes on. Turning the feature off in Settings closes it.

## User Scenarios & Testing

### User Story 1 - Use Muse in the island (Priority: P1)

The user expands the island, picks the Muse tab; the island grows and the real muse.ai web app appears inside it, fully interactive (log in, chat, type, scroll).

**Independent Test**: Open the Muse tab, log in, send a message, read the answer.

**Acceptance Scenarios**:
1. **Given** the island is open, **When** the user picks Muse, **Then** the island grows to the Muse size and muse.ai appears inside its frame within the island's outline.
2. **Given** Muse is open, **When** the user clicks in the chat box and types, **Then** the keys go to muse.ai.
3. **Given** Muse is open, **When** the pointer leaves the island, **Then** the island stays open.
4. **Given** Muse is open, **When** the user clicks outside the island, **Then** the island folds and muse.ai is hidden (still running).

### User Story 2 - Stay logged in (Priority: P2)

After restarting the app, the Muse tab is still logged in.

**Independent Test**: Log in, quit the app, start it, open Muse: no login screen.

### User Story 3 - Background work (Priority: P3)

The user folds the island while Muse is working; the capsule shows a pulsing Muse mini while the page loads, and a "something new" mini when the page title shows an unread count.

### Edge Cases
- Offline: the spinner shows until the page answers; WebView2's own "can't reach this page" appears in the frame, and the Home button tries again.
- The webview cannot be created: the frame shows an error with "Try again".
- The island moves (another display, floating gap, size change): muse.ai follows it.
- A goal celebration fills the island: muse.ai hides for the show.
- A link opens a new window (`target=_blank`, `window.open`): it goes to the system browser.
- A navigation to a non-web scheme (`file:`, app protocols): refused.

## Requirements

### Functional Requirements
- **FR-001**: `muse` MUST be a member of `FEATURE_IDS` and reorderable like other tabs.
- **FR-002**: The Muse view MUST host the live `https://muse.ai` web app in a webview laid exactly over the island's Muse frame, moving with the island.
- **FR-003**: The remote webview MUST get NO Tauri IPC capabilities (remote content is untrusted).
- **FR-004**: New windows MUST open in the system browser; top-level navigation MUST stay on `http(s)`.
- **FR-005**: While Muse is the active tab the island MUST be ~460×640 and MUST NOT auto-close on pointer leave; a click outside folds it.
- **FR-006**: A loading state MUST show until the first page has loaded; a creation failure MUST show an error with retry.
- **FR-007**: The folded island MUST show a pulsing Muse mini while the page loads and a "new" mini while the title carries an unread count.
- **FR-008**: Strings MUST be localized (en + fa) and respect RTL layout.
- **FR-009**: Permission requests (microphone, camera, location…) MUST be left to the webview's prompt; the app MUST NOT auto-grant them.
- **FR-010**: The webview MUST be created on first use, kept alive while hidden, and closed when Muse is turned off in Settings.
- **FR-011**: The webview MUST share the app's WebView2 environment (same browser arguments), so it comes up and the login persists.

## Success Criteria
- **SC-001**: muse.ai is usable from the island with no separate browser window.
- **SC-002**: A logged-in session survives an app restart.
- **SC-003**: Folding and reopening the island does not reload muse.ai.
