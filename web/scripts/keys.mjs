// Lists every i18n key the code uses: t("…"), tl("…"), tn("…","…"), N_("…").
// Used by the tests (every key has a Persian string) and to write the tables.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const SRC = join(here, "..", "src");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** A string literal (single, double or template without ${}) right after `(`. */
const CALL = /\b(?:t|tl|N_)\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`([^`$]*)`)/g;
const CALL_N = /\btn\(\s*(?:"((?:[^"\\]|\\.)*)")\s*,\s*(?:"((?:[^"\\]|\\.)*)")/g;

function unescape(s) {
  return JSON.parse(`"${s.replace(/"/g, '\\"').replace(/\\'/g, "'")}"`);
}

export function usedKeys() {
  const keys = new Set();
  for (const file of walk(SRC)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(CALL)) {
      const raw = m[1] ?? m[2] ?? m[3];
      if (raw !== undefined) keys.add(unescape(raw));
    }
    for (const m of src.matchAll(CALL_N)) {
      keys.add(unescape(m[1]));
      keys.add(unescape(m[2]));
    }
  }
  return [...keys].sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const k of usedKeys()) console.log(JSON.stringify(k));
}
