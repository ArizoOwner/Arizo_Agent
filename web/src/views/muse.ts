// The Muse tab: https://muse.ai itself, live, inside the island. The page draws only the
// frame (a slim toolbar and the hole the site shows through); the site lives in its own
// webview the backend lays exactly over that hole (src-tauri/src/muse.rs). Nothing of
// muse.ai runs in this page and it cannot call the app.

import { h, svg } from "./dom";
import { ICONS } from "./icons";
import { Bridge, IS_TAURI, onEvent } from "../core/bridge";
import { State } from "../core/state";
import { tl } from "../i18n/i18n";
import type { ViewHost } from "./views";

export const MUSE_ID = "feature_muse";
export const MUSE_COLOR = "#FF7A59";

/**
 * What the page knows about muse.ai: switched on, loading (busy), its title, how many new
 * things the title announces, whether the first page has loaded, and whether the webview failed.
 *
 * Muse starts switched off every time the app starts (at Windows start-up too): nothing of
 * muse.ai runs, so it costs no memory, processor or network until the user switches it on.
 * Switching it off only closes the page; the login stays in the WebView2 profile.
 */
export const Muse = { on: false, busy: false, title: "", unread: 0, ready: false, failed: false };

/** Back to switched off, as at start-up. */
function reset() {
  Object.assign(Muse, { on: false, busy: false, title: "", unread: 0, ready: false, failed: false });
}

/** The island waits for its grow animation before laying the site over the frame. */
const SETTLE_MS = 280;

/** The count a web app puts in front of its title for unread things: "(3) Muse" → 3. */
export function unreadOf(title: string): number {
  const m = /^\s*\((\d{1,4})\+?\)/.exec(title);
  return m ? Number(m[1]) : 0;
}

/** The title without the count, for the toolbar. */
export function plainTitle(title: string): string {
  return title.replace(/^\s*\(\d{1,4}\+?\)\s*/, "").trim();
}

/** Ari's size while he sleeps in the switched-off frame (the island's Ari, not a mini). */
export const MUSE_ARI_D = 96;

export interface MuseHost extends ViewHost {
  setOnScreen(on: boolean): void;
  /** Where Ari sleeps while Muse is off: the centre of his slot, relative to the given box; null when Muse is on. */
  ariSpot(origin: { x: number; y: number }): { cx: number; cy: number } | null;
}

export function buildMuse(): MuseHost {
  const status = h("span", { class: "muse-status", text: "Muse" });
  const reload = h("button", {
    class: "muse-btn", type: "button", title: tl("Home"), "aria-label": tl("Home"),
    onclick: () => void Bridge.museReload(),
  }, svg(ICONS.house, 14));
  const external = h("button", {
    class: "muse-btn", type: "button", title: tl("Open in browser"), "aria-label": tl("Open in browser"),
    onclick: () => void Bridge.openUrl("https://muse.ai/"),
  }, svg(ICONS.arrowUpRight, 14));
  const power = h("button", {
    class: "muse-btn muse-power-off", type: "button", title: tl("Turn Muse off"), "aria-label": tl("Turn Muse off"),
    onclick: () => turnOff(),
  }, svg(ICONS.power, 14, { stroke: 2 }));
  const toolbar = h("div", { class: "muse-toolbar" },
    h("span", { class: "muse-dot" }), status, h("div", { class: "muse-spacer" }), reload, external, power);

  // Switched off: Ari sleeps in the middle of the frame, with what that means and the way back.
  const ariSlot = h("div", { class: "muse-off-ari", "aria-hidden": "true" });
  const fact = (text: string) => h("li", {}, svg(ICONS.check, 12, { stroke: 2.4 }), h("span", { text: tl(text) }));
  const offCard = h("div", { class: "muse-off" },
    // The island's own Ari is laid over this slot (Island.updateBotTargets); it only keeps his room.
    ariSlot,
    h("h3", { class: "muse-off-title", text: tl("Muse is off") }),
    h("p", { class: "muse-off-text", text: tl("Turn it on to use muse.ai right here in the island.") }),
    h("ul", { class: "muse-off-facts" },
      fact("No memory or processor used"),
      fact("No internet used"),
      fact("You stay logged in")),
    h("button", { class: "muse-on-btn", type: "button", onclick: () => turnOn() },
      svg(ICONS.power, 15, { stroke: 2.2 }), h("span", { text: tl("Turn Muse on") })));

  // Connecting: Ari looks for muse.ai in the middle of the frame while the steps light up one by one.
  const loadSlot = h("div", { class: "muse-off-ari", "aria-hidden": "true" });
  const step = (text: string) => h("li", {}, h("i", { class: "muse-step-dot" }), h("span", { text: tl(text) }));
  const steps = [step("Waking Muse up"), step("Connecting to muse.ai"), step("Loading your chats")];
  const spinner = h("div", { class: "muse-loading", role: "status", "aria-live": "polite" },
    loadSlot,
    h("h3", { class: "muse-off-title", text: tl("Opening Muse…") }),
    h("p", { class: "muse-off-text", text: tl("Ari is connecting to muse.ai. This takes a few seconds.") }),
    h("ul", { class: "muse-steps" }, ...steps),
    h("div", { class: "muse-progress" }, h("i")),
    h("button", { class: "muse-ghost-btn", type: "button", text: tl("Cancel"), onclick: () => turnOff() }));

  // Could not be opened: Ari is unhappy, with the way to try again or to switch it off.
  const errorSlot = h("div", { class: "muse-off-ari", "aria-hidden": "true" });
  const error = h("div", { class: "muse-error", role: "alert" },
    errorSlot,
    h("h3", { class: "muse-off-title", text: tl("Muse could not be opened") }),
    h("p", { class: "muse-off-text", text: tl("Check your internet connection and try again.") }),
    h("button", { class: "muse-on-btn", type: "button", onclick: () => { Muse.failed = false; last = ""; State.notify(); place(); } },
      svg(ICONS.arrowClockwise, 15, { stroke: 2.2 }), h("span", { text: tl("Try again") })),
    h("button", { class: "muse-ghost-btn", type: "button", text: tl("Turn Muse off"), onclick: () => turnOff() }));
  const frame = h("div", { class: "muse-frame" }, spinner, error, offCard);

  // The steps light up on a clock while the page loads; the last waits for the page itself.
  let stepTimer = 0;
  function startSteps() {
    window.clearInterval(stepTimer);
    let n = 0;
    const show = () => steps.forEach((li, i) => { li.classList.toggle("done", i < n); li.classList.toggle("now", i === n); });
    show();
    stepTimer = window.setInterval(() => { if (n < steps.length - 1) { n++; show(); } else window.clearInterval(stepTimer); }, 1100);
  }
  const el = h("div", { class: "view muse-view" }, toolbar, frame);

  let onScreen = false;
  let timer = 0;
  let last = "";
  // One request at a time: the frame changes on every frame of the grow animation, and only
  // the place it ends up at matters. A change while a request runs is sent once it is done.
  let sending = false;
  let again = false;

  function place() {
    if (!onScreen || !IS_TAURI || !Muse.on || Muse.failed) return;
    const r = frame.getBoundingClientRect();
    if (r.width < 120 || r.height < 120) return;
    const rect = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
    const key = `${rect.x},${rect.y},${rect.width},${rect.height}`;
    if (key === last) return;
    if (sending) { again = true; return; }
    last = key;
    sending = true;
    Bridge.museShow(rect)
      .then(() => { if (onScreen) void Bridge.museFocus(); })
      .catch((err) => { console.error("[arizo] muse_show failed", err); Muse.failed = true; last = ""; State.notify(); })
      .finally(() => { sending = false; if (again) { again = false; place(); } });
  }

  function turnOn() {
    if (Muse.on) return;
    Muse.on = true;
    Muse.failed = false;
    startSteps();
    last = "";
    State.notify();
    // The view redraws first, so the frame measured is the one the site will fill.
    window.setTimeout(place, 0);
  }

  function turnOff() {
    if (!Muse.on) return;
    reset();
    last = "";
    again = false;
    void Bridge.musePowerOff();
    State.notify();
  }

  // The frame moves when the island is resized, the text size changes or a tab is dragged.
  new ResizeObserver(() => { if (onScreen) place(); }).observe(frame);

  void onEvent<{ phase: "loading" | "ready" | null; title: string | null }>("muse", (e) => {
    // A page closed a moment ago may still say something: it is not news any more.
    if (!Muse.on) return;
    if (e.phase) Muse.busy = e.phase === "loading";
    // A page that loads is the proof it works, whatever an earlier request said.
    if (e.phase === "ready") { Muse.ready = true; Muse.failed = false; }
    if (e.title != null) {
      Muse.title = plainTitle(e.title);
      Muse.unread = unreadOf(e.title);
    }
    State.notify();
  });

  return {
    el,
    sync() {
      // Turned off in Settings: the backend closed the page, so it starts over next time.
      if (!State.settings.museEnabled && Muse.on) reset();
      el.classList.toggle("off", !Muse.on);
      el.classList.toggle("busy", Muse.busy);
      el.classList.toggle("ready", Muse.ready);
      el.classList.toggle("failed", Muse.failed);
      status.textContent = Muse.title && !/^muse\b/i.test(Muse.title) ? `Muse · ${Muse.title}` : "Muse";
    },
    ariSpot(origin) {
      // Off, connecting or failed: Ari is in the middle of the frame. Once the site shows, he steps aside.
      const slot = !Muse.on ? ariSlot : Muse.failed ? errorSlot : !Muse.ready ? loadSlot : null;
      if (!slot) return null;
      const r = slot.getBoundingClientRect();
      if (r.width === 0) return null;
      return { cx: r.left + r.width / 2 - origin.x, cy: r.top + r.height / 2 - origin.y };
    },
    setOnScreen(on: boolean) {
      if (on === onScreen) return;
      onScreen = on;
      window.clearTimeout(timer);
      last = "";
      if (on) {
        // Opened: whatever the title announced has been seen.
        Muse.unread = 0;
        timer = window.setTimeout(place, SETTLE_MS);
      } else {
        void Bridge.museHide();
      }
    },
  };
}
