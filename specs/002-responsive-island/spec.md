# Feature Specification: An island that fits every screen

**Feature Branch**: `002-responsive-island`
**Created**: 2026-10-28
**Status**: Implemented (3.5.1)
**Input**: "Friends who downloaded the release see the island cut off everywhere and the fonts too big; on my PC it is fine. Detect the screen and size the island to it automatically."

## Clarifications

### Session 2026-10-28
- Q: On a small screen (1366×768 laptop, high Windows scale), what should the island do? → A: The whole island shrinks proportionally — text, buttons and frame together — so nothing is cut off. Large screens stay exactly as now.
- Q: Add a manual "island size" slider? → A: No, automatic only.
- Q: Publish 3.5.1 after testing? → A: Yes.

## Root cause

WebView2 rasterizes a page at the display scale times Windows' **Text size** (Accessibility). The
island window is sized in logical px for its page, so with a text size above 100 % the page's CSS
viewport is smaller than the island drawn in it: the tabs are cut on one side, the bottom is gone
and every font is too large. The island also measured `window.screen` (taskbar included) instead
of the work area, and never went below the 920×640 panel.

## Requirements

- **FR-001**: Every app webview (island, bubble, Muse) MUST be drawn at the display scale only, without Windows' text size on top.
- **FR-002**: The backend MUST report the display's work area (screen less taskbar) and report it again when the display, resolution, scale or taskbar changes.
- **FR-003**: When the island's largest views (with the user's look) do not fit the work area, the whole page MUST be zoomed out by one factor (in 1 % steps, never below 50 %) so that they do; at 1 on any screen they fit.
- **FR-004**: Click-through, the cursor, Muse's placement and the window size MUST follow the zoom.
- **FR-005**: The tab row MUST never run past the island: other tabs drop their labels first, then the open one.

## Success Criteria

- 2560×1440 and 1920×1080 at 100 %: identical to 3.5.0.
- 1024×576 logical (1280×720 at 125 %) and below: every view fully visible.
