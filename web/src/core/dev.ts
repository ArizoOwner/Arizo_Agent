// Handles for looking at the island in a plain browser: `?view=history`,
// `?state=compact`… set the screen before the first frame, and
// `window.__arizo` lets a script drive it. Never reached inside the real window.

import type { Island } from "../island/island";
import type { IslandViewName } from "./layout";
import { State } from "./state";
import { setLanguage } from "../i18n/i18n";

const VIEWS: readonly IslandViewName[] = ["translate", "settings", "note", "wardrobe", "spotify"];

export function installDevHooks(island: Island) {
  const q = new URLSearchParams(location.search);
  (window as unknown as { __arizo: unknown }).__arizo = { island, State, setLanguage };
  const view = q.get("view") as IslandViewName | null;
  const mode = q.get("state");
  const text = q.get("text");
  // Let the greeting be skipped so a screenshot lands on the screen asked for.
  if (view && VIEWS.includes(view)) {
    window.setTimeout(() => {
      island.alert(view);
      if (text) island.openWithText(text);
    }, 300);
  } else if (mode === "compact") {
    window.setTimeout(() => island.collapse(), 300);
  }
}
