// Records one README animation from the running app.
//
//   npm run readme-gifs -- <scene> <en|fa|both> [outDir]
//   (the Vite dev server must be up: npm run web)
//
// A scene is scripts/readme-gifs/scenes/<name>.mjs exporting
//   export const meta = { file: "translate", width: 920, height: 560, fps: 15 };
//   export async function scene(rec, lang) { ... }   // rec is the Recorder in ./recorder.mjs
// The GIF is written to docs/media/<file>[-fa].gif (English has no suffix, Persian has "-fa"),
// unless an outDir is given (trial runs, so the committed files are not touched).

import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Recorder } from "./recorder.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");

const [,, name, langArg = "both", outArg] = process.argv;
if (!name) {
  console.error("usage: record.mjs <scene> <en|fa|both> [outDir]");
  process.exit(2);
}
const outDir = outArg ? resolve(outArg) : join(root, "docs", "media");
const port = Number(process.env.GIF_PORT || 9500);
const langs = langArg === "both" ? ["en", "fa"] : [langArg];

const mod = await import(pathToFileURL(join(here, "scenes", `${name}.mjs`)).href);
let failed = false;
for (const lang of langs) {
  const meta = { width: 920, height: 560, fps: 15, ...mod.meta };
  const rec = await Recorder.open({ port: port + (lang === "fa" ? 1 : 0), width: meta.width, height: meta.height, lang, url: meta.url ?? "/?mock=1", setup: meta.setup });
  try {
    await rec.start();
    await mod.scene(rec, lang);
    await rec.stop(meta.hold ?? 1000);
    const file = join(outDir, `${meta.file}-${lang}.gif`);
    const r = await rec.save(file, { fps: meta.fps, keyframes: process.env.GIF_KEYFRAMES ? resolve(process.env.GIF_KEYFRAMES) : null });
    console.log(`${r.over ? "TOO BIG " : "ok      "} ${lang} ${r.file.slice(root.length + 1)}  ${r.kb} KB  ${r.seconds}s  ${r.frames} frames`);
    if (r.over) failed = true;
  } catch (e) {
    failed = true;
    console.error(`FAILED  ${lang} ${name}: ${e && e.stack || e}`);
  } finally {
    await rec.close();
  }
}
process.exit(failed ? 1 : 0);
