// Publishes a release: tags the current commit and uploads what `npm run pack` put in release/.
//   npm run release
// Needs the GitHub CLI logged in as the maintainer (gh auth status). The notes come from
// the CHANGELOG section of the version, and the download table is added below them.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const repo = "ArizoOwner/Arizo_Agent";
const tag = `v${version}`;

const files = [`Arizo-Agent-Setup-${version}.exe`, `Arizo-Agent-${version}-Portable.exe`, "SHA256SUMS.txt"].map((f) => join(root, "release", f));
for (const f of files) if (!existsSync(f)) { console.error(`Missing ${f} - run \`npm run pack\` first.`); process.exit(1); }

const log = readFileSync(join(root, "CHANGELOG.md"), "utf8").replace(/\r\n/g, "\n");
const m = log.match(new RegExp(`^## ${version.replace(/\./g, "\\.")}[^\\n]*\\n([\\s\\S]*?)(?=^## \\d|$(?![\\s\\S]))`, "m"));
if (!m) { console.error(`CHANGELOG.md has no section for ${version}.`); process.exit(1); }
const title = log.match(new RegExp(`^## (${version.replace(/\./g, "\\.")}[^\\n]*)`, "m"))[1];

const notes = [
  `## Arizo-Agent ${title.replace(version + " — ", `${version} — `)}`,
  "",
  `<p align="center"><img src="https://raw.githubusercontent.com/${repo}/main/assets/readme/muse.svg" width="760" alt="The Muse tab: off with Ari asleep, turned on, Ari connecting, then a chat with Persian messages right to left and English ones left to right"></p>`,
  "",
  m[1].trim(),
  "",
  "### Downloads",
  "",
  "| File | What it is |",
  "| :--- | :--- |",
  `| \`Arizo-Agent-Setup-${version}.exe\` | Installer for the current user - no administrator rights |`,
  `| \`Arizo-Agent-${version}-Portable.exe\` | One executable, runs without installing |`,
  "| `SHA256SUMS.txt` | Checksums of both |",
  "",
  "The installer is not code-signed, so Windows SmartScreen shows a warning the first time: **More info → Run anyway**.",
  "",
  `Full list of changes: [CHANGELOG.md](https://github.com/${repo}/blob/main/CHANGELOG.md)`,
  "",
].join("\n");
const notesFile = join(root, "release", "NOTES.md");
writeFileSync(notesFile, notes);

const gh = (...args) => execFileSync("gh", args, { cwd: root, stdio: ["ignore", "pipe", "inherit"] }).toString().trim();
let exists = true;
try { gh("release", "view", tag, "--repo", repo); } catch { exists = false; }
if (exists) {
  console.log(`${tag} exists: updating its files and notes`);
  gh("release", "upload", tag, "--repo", repo, "--clobber", ...files);
  gh("release", "edit", tag, "--repo", repo, "--title", `Arizo-Agent ${title}`, "--notes-file", notesFile, "--latest");
} else {
  console.log(`creating ${tag}`);
  gh("release", "create", tag, ...files, "--repo", repo, "--target", "main", "--title", `Arizo-Agent ${title}`, "--notes-file", notesFile, "--latest");
}
console.log(gh("release", "view", tag, "--repo", repo, "--json", "url", "-q", ".url"));