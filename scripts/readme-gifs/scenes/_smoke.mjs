// A minimal scene that proves the recorder works end to end (kept as the template for the others).
import { sleep } from "../recorder.mjs";

export const meta = { file: "_smoke", width: 920, height: 520, fps: 15, hold: 600 };

export async function scene(rec, lang) {
  await rec.arizo(`A.island.alert("translate");`);
  await sleep(900);
  await rec.click(".src-input");
  await rec.type(lang === "fa" ? "سلام دنیا" : "Hello world", { delay: 70 });
  await sleep(900);
  await rec.click(".tab[data-view=spotify]");
  await sleep(700);
}
