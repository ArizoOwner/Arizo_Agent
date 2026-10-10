// The theme, resolved once for every window (island, settings, bubble).
//
// "dark" and "light" are what they say; "system" follows Windows and keeps
// following it while the app runs. Anything else (a stale preference) is the
// island's own look, dark. The result is <html data-theme>, which the tokens in
// style.css (and settings.css) switch on.

export type ThemeChoice = "dark" | "light" | "system";

/** Whether `theme` shows the dark palette, given what the OS prefers. */
export function resolveDark(theme: string | undefined | null, systemPrefersLight: boolean): boolean {
  if (theme === "light") return false;
  if (theme === "system") return !systemPrefersLight;
  return true;
}

function systemPrefersLight(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false;
}

/** Puts `theme` on the page. */
export function applyTheme(theme: string | undefined | null) {
  if (typeof document === "undefined" || !document.documentElement) return;
  document.documentElement.dataset.theme = resolveDark(theme, systemPrefersLight()) ? "dark" : "light";
}

/**
 * Re-applies the theme when Windows flips between light and dark, for as long as
 * the choice is "system". `current` says what the choice is right now.
 */
export function watchSystemTheme(current: () => string | undefined | null) {
  const query = window.matchMedia?.("(prefers-color-scheme: light)");
  if (!query?.addEventListener) return;
  query.addEventListener("change", () => {
    if (current() === "system") applyTheme("system");
  });
}
