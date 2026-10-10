// The history view: past translations in the island's card style. A search
// field, the All / Starred tabs, and per row: star, copy, translate again, delete.

import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { card } from "./parts";
import { Bridge } from "../core/bridge";
import { filterHistory, timeAgoParts, type HistoryFilter, type HistoryItem } from "../core/history-logic";
import { langLabel } from "../core/text";
import { toast } from "../core/toast";
import { State } from "../core/state";
import { t, tl } from "../i18n/i18n";
import type { ViewHost } from "./views";

export interface HistoryActions {
  /** "Translate again": back to the translate view with this text. */
  retranslate(item: HistoryItem): void;
  blip(): void;
}

function ago(iso: string): string {
  const [unit, n] = timeAgoParts(iso);
  if (unit === "now") return t("just now");
  if (unit === "m") return t("{n} min ago", { n });
  if (unit === "h") return t("{n} h ago", { n });
  return t("{n} d ago", { n });
}

export function buildHistory(actions: HistoryActions): ViewHost {
  let items: HistoryItem[] = [];
  let filter: HistoryFilter = "all";
  let search = "";
  let loaded = false;
  let shownKey = "";

  const tabAll = h("button", { class: "seg-btn", text: tl("All"), onclick: () => setFilter("all") });
  const tabStar = h("button", { class: "seg-btn", text: tl("Starred"), onclick: () => setFilter("starred") });
  const tabs = h("div", { class: "seg hist-tabs" }, tabAll, tabStar);
  const searchInput = h("input", {
    class: "hist-search", type: "text", dir: "auto", spellcheck: false, placeholder: tl("Search history…"),
  });
  searchInput.addEventListener("input", () => {
    search = searchInput.value;
    shownKey = "";
    render();
  });
  const clearAll = h("button", {
    class: "link-btn clear-all", text: tl("Clear all"),
    onclick: async () => {
      await Bridge.clearHistory();
      items = [];
      shownKey = "";
      render();
      toast(t("History cleared"));
    },
  });
  const head = h("div", { class: "hist-head" }, tabs, searchInput, clearAll);
  const list = h("div", { class: "hist-list" });
  const el = h("div", { class: "view history" }, card(null, h("div", { class: "hist-body" }, head, list)));

  function setFilter(next: HistoryFilter) {
    actions.blip();
    filter = next;
    shownKey = "";
    render();
  }

  async function load() {
    items = (await Bridge.getHistory()) ?? [];
    loaded = true;
    shownKey = "";
    render();
  }

  function iconBtn(title: string, path: string, onClick: (b: HTMLElement) => void, cls = "", fill = true): HTMLElement {
    const b = h("button", { class: `row-btn ${cls}`.trim(), title }, svg(path, 12, fill ? {} : { stroke: 2 }));
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick(b);
    });
    return b;
  }

  function row(item: HistoryItem): HTMLElement {
    const engine = item.engine === "aphra" ? t("Smart") : item.engine === "google" ? t("Fast") : item.engine;
    const info = `${langLabel(item.detectedLang)} → ${langLabel(item.targetLang)} · ${engine} · ${ago(item.timestamp)}`;
    const actionsEl = h(
      "span", { class: "row-actions" },
      iconBtn(item.favorite ? t("Remove from starred") : t("Star"), item.favorite ? ICONS.star : ICONS.starOutline,
        async () => { await Bridge.toggleFavoriteItem(item.id); item.favorite = !item.favorite; shownKey = ""; render(); },
        `star${item.favorite ? " on" : ""}`, item.favorite),
      iconBtn(t("Copy translation"), ICONS.copy, async (b) => {
        await Bridge.copyText(item.translation);
        b.classList.add("done");
        window.setTimeout(() => b.classList.remove("done"), 900);
      }),
      iconBtn(t("Translate again"), ICONS.arrowClockwise, () => actions.retranslate(item), "", false),
      iconBtn(t("Delete"), ICONS.xmark, async () => {
        await Bridge.deleteHistoryItem(item.id);
        items = items.filter((x) => x.id !== item.id);
        shownKey = "";
        render();
      }, "danger"),
    );
    return h("div", { class: "hist-row", onclick: () => actions.retranslate(item) },
      h("div", { class: "hist-q", dir: "auto", text: item.query }),
      h("div", { class: "hist-t", dir: "auto", text: item.translation }),
      h("div", { class: "hist-meta" }, h("span", { text: info }), actionsEl),
    );
  }

  function render() {
    tabAll.classList.toggle("on", filter === "all");
    tabStar.classList.toggle("on", filter === "starred");
    const shown = filterHistory(items, filter, search);
    const key = `${filter}|${search}|${shown.map((i) => `${i.id}${i.favorite ? "*" : ""}`).join(",")}`;
    clearAll.style.display = items.length ? "" : "none";
    if (key === shownKey) return;
    shownKey = key;
    clear(list);
    if (!shown.length) {
      const empty = search
        ? t("Nothing found.")
        : filter === "starred"
          ? t("Nothing starred yet. Use the star on a row.")
          : State.settings.saveHistory
            ? t("No translations yet.")
            : t("History is off. Turn it on in the full settings.");
      list.append(h("div", { class: "hist-empty", text: empty }));
      return;
    }
    for (const item of shown) list.append(row(item));
  }

  return {
    el,
    sync() {
      // Reloaded each time the view opens: translations are added from other windows too.
      if (State.mode === "expanded" && State.view === "history") {
        if (!loaded) void load();
        else render();
      } else {
        loaded = false;
      }
    },
    focus() {
      searchInput.focus();
    },
  };
}
