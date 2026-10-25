// Settings > Island look > "Folded island": the capsule width, height and zoom sliders change the drawn preview while
// they are dragged; then the island is folded for real and shows the capsule at that size (Ari, the clock and the
// little Aris scale together); finally everything is reset, so the scene ends on the screen it started on.
//
// The helpers (screenshot-loop capture, clock-based pointer and scroll) live in look.mjs.
import { sleep } from "../recorder.mjs";
import { kit, openLook } from "./look.mjs";

const { lighten, slide, reveal, wheelTo, START } = kit;

export const meta = { file: "folded", width: 1040, height: 640, fps: 15, hold: 900, setup: openLook };

export async function scene(rec, lang) {
  await lighten(rec);
  await sleep(300);
  await reveal(rec, ".look-preview", 0, 0.1, 440);                    // down to the "Folded island" section
  await sleep(150);
  await slide(rec, 6, [146, 126], { ms: 380, pause: 110 });           // capsule width: wider, settle
  await slide(rec, 7, [138], { ms: 340 });                            // capsule height: taller
  await slide(rec, 8, [148], { ms: 380, pause: 150 });                // zoom: everything in it grows
  await sleep(200);
  await rec.move(960, 590, 340);                                      // the pointer leaves the island
  await sleep(150);
  await rec.arizo(`A.island.collapse();`);                            // the real folded island, at the chosen size
  await sleep(1900);
  await rec.arizo(`A.island.alert("settings");`);                     // and back to the settings
  await sleep(900);
  await rec.click(".settings-nav-btn", 1, { ms: 340, after: 380 });
  await reveal(rec, ".look-reset-all", 0, 0.7, 440);
  await rec.click(".look-reset-all", 0, { ms: 300, after: 520 });     // all back to default
  await wheelTo(rec, 0, 380);
  await rec.move(START.x, START.y, 320);
  await sleep(150);
}
