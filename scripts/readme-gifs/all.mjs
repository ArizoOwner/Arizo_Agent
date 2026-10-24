// Records every README animation, a few at a time, into docs/media.
//
//   npm run readme-gifs:all [-- <outDir>]      (the Vite dev server must be up: npm run web)
//
// One browser per scene and language, each on its own debugging port. The scenes are the files
// in scenes/ that do not start with an underscore.

import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ? resolve(process.argv[2]) : "";
const scenes = readdirSync(join(here, "scenes")).filter((f) => f.endsWith(".mjs") && !f.startsWith("_")).map((f) => f.slice(0, -4)).sort();
const jobs = scenes.flatMap((scene) => ["en", "fa"].map((lang) => ({ scene, lang })));
const workers = Math.max(1, Math.min(Number(process.env.GIF_JOBS) || 4, Math.floor(cpus().length / 3)));

function run({ scene, lang }, slot) {
  return new Promise((done) => {
    const args = [join(here, "record.mjs"), scene, lang, ...(outDir ? [outDir] : [])];
    const env = { ...process.env, GIF_PORT: String(9800 + slot * 10 + (lang === "fa" ? 1 : 0)) };
    const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    child.stdout.on("data", (d) => (text += d));
    child.stderr.on("data", (d) => (text += d));
    child.on("close", (code) => {
      const line = text.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" | ");
      console.log(`${code === 0 ? "ok    " : "FAILED"} ${scene}/${lang}  ${line}`);
      done(code === 0);
    });
  });
}

console.log(`${jobs.length} recordings, ${workers} at a time`);
const queue = [...jobs];
const results = [];
await Promise.all(Array.from({ length: workers }, async (_, slot) => {
  while (queue.length) results.push(await run(queue.shift(), slot));
}));
const failed = results.filter((ok) => !ok).length;
console.log(failed ? `${failed} failed` : "all recorded");
process.exit(failed ? 1 : 0);
