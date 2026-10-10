// Copies the installer Tauri buries in src-tauri/target/release/bundle/ into
// release/, under the names it ships with.   npm run pack

import { readFileSync, mkdirSync, copyFileSync, readdirSync, statSync, createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = join(root, "src-tauri", "target", "release", "bundle", "nsis");
const releaseDir = join(root, "release");

const { version } = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));

const installers = (() => {
  try {
    return readdirSync(bundle).filter((f) => f.endsWith("-setup.exe"));
  } catch {
    return [];
  }
})();
if (installers.length === 0) {
  console.error(`No *-setup.exe in ${bundle} — run \`npm run tauri build\` first.`);
  process.exit(1);
}
const built = installers
  .map((f) => join(bundle, f))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];

mkdirSync(releaseDir, { recursive: true });
const setup = join(releaseDir, `Arizo-Translate-Setup-${version}.exe`);
const portable = join(releaseDir, `Arizo-Translate-${version}-Portable.exe`);
copyFileSync(built, setup);
// The app is one self-contained executable: it runs without installing.
copyFileSync(join(root, "src-tauri", "target", "release", "arizo-translate.exe"), portable);

const sha = (file) =>
  new Promise((ok, fail) => {
    const h = createHash("sha256");
    createReadStream(file).on("data", (d) => h.update(d)).on("end", () => ok(h.digest("hex"))).on("error", fail);
  });

const lines = [];
for (const f of [setup, portable]) {
  lines.push(`${await sha(f)}  ${f.split(/[\\/]/).pop()}`);
  console.log(`  ${f}  (${(statSync(f).size / 1024 / 1024).toFixed(2)} MB)`);
}
writeFileSync(join(releaseDir, "SHA256SUMS.txt"), lines.join("\n") + "\n");
console.log("  SHA256SUMS.txt written\n");
