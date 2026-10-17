// Handles for looking at the island in a plain browser: `?view=history`,
// `?state=compact`… set the screen before the first frame, and
// `window.__arizo` lets a script drive it. Never reached inside the real window.

import type { Island } from "../island/island";
import type { IslandViewName } from "./layout";
import { State } from "./state";
import { setLanguage } from "../i18n/i18n";
import { Football, setFootballState } from "./football";
import { mockFootball } from "./mock";

const VIEWS: readonly IslandViewName[] = ["translate", "settings", "note", "wardrobe", "spotify", "football"];

export function installDevHooks(island: Island) {
  const q = new URLSearchParams(location.search);
  (window as unknown as { __arizo: unknown }).__arizo = { island, State, setLanguage, engine: (island as unknown as { engine: unknown }).engine, football: { setState: setFootballState, state: () => Football.state, mock: mockFootball } };
  const view = q.get("view") as IslandViewName | null;
  const mode = q.get("state");
  const text = q.get("text");
  // `?goal=1` plays the goal celebration once the page is up (for looking at it in a browser).
  if (q.get("goal")) window.setTimeout(() => island.celebrateGoal({ teamName: "Barcelona", player: "L. Yamal", score: "2 – 1", opponent: "Real Madrid" }), 1800);
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
