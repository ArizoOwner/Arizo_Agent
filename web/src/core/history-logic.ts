// Filtering and searching the history list. Pure.

export interface HistoryItem {
  id: string;
  timestamp: string;
  query: string;
  translation: string;
  detectedLang: string;
  targetLang: string;
  engine: string;
  favorite: boolean;
}

export type HistoryFilter = "all" | "starred";

/** Lower-cases and folds the Arabic yeh and kaf and the zero-width joiner, so "می‌خوام" finds "میخوام". */
export function foldForSearch(s: string): string {
  return s
    .toLowerCase()
    .replace(/‌/g, "")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .trim();
}

/** The items the list shows: the tab's filter, then the search words (all must match). */
export function filterHistory(items: readonly HistoryItem[], filter: HistoryFilter, search: string): HistoryItem[] {
  const words = foldForSearch(search).split(/\s+/).filter(Boolean);
  return items.filter((it) => {
    if (filter === "starred" && !it.favorite) return false;
    if (!words.length) return true;
    const hay = foldForSearch(`${it.query}\n${it.translation}`);
    return words.every((w) => hay.includes(w));
  });
}

/** How long ago, as a unit and a count so the view can say it in the right language. */
export function timeAgoParts(iso: string, now = Date.now()): ["now" | "m" | "h" | "d", number] {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return ["now", 0];
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return ["now", 0];
  if (s < 3600) return ["m", Math.max(1, Math.round(s / 60))];
  if (s < 86400) return ["h", Math.round(s / 3600)];
  return ["d", Math.round(s / 86400)];
}
