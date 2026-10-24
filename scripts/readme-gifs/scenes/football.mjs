// Football: choose a team, see the live game, then a goal (confetti, Ari cheering) and a yellow card.
// It starts on the team picker and ends on the team picker, so the loop is calm.
import { sleep } from "../recorder.mjs";

export const meta = {
  file: "football", width: 920, height: 440, fps: 15, hold: 700,
  setup: async (rec) => {
    // The shows play a little shorter than in the app so the whole story fits one short loop.
    // (Vite serves the module the app uses under a "?t=..." address after a hot update: import that very one.)
    await rec.eval(`(() => {
      const url = performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /\\/core\\/football\\.ts/.test(n)).pop() || "/src/core/football.ts";
      return import(url).then((m) => { m.EVENT_STYLE.goal.ms = 3200; m.EVENT_STYLE.yellow.ms = 2400; });
    })()`);
    await rec.arizo(`A.island.alert("football");`);
    await sleep(900);
  },
};

// Headless Edge's screencast sometimes starts sending frames at a smaller size (it did about 7 s into a
// run) while the page keeps its size: those frames would be cut off and garbled in the GIF. Put the
// viewport back the moment it happens, and drop the few frames that came out at the wrong size.
function guardViewport(rec) {
  let fixing = false;
  rec.ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (d.method !== "Page.screencastFrame") return;
    const { deviceWidth, deviceHeight } = d.params.metadata;
    if ((deviceWidth !== rec.width || deviceHeight !== rec.height) && !fixing) {
      fixing = true;
      rec.send("Emulation.setDeviceMetricsOverride", { width: rec.width, height: rec.height, deviceScaleFactor: 1, mobile: false, screenWidth: 1920, screenHeight: 1080 })
        .finally(() => { fixing = false; });
    }
  });
  return () => { rec.frames = rec.frames.filter((f) => f.png.readUInt32BE(16) === rec.width && f.png.readUInt32BE(20) === rec.height); };
}

// The live game, from what the mock already holds, with the given score, clock, goals and cards.
const liveState = (mine, theirs, clock, goals, cards) => `
  const l = A.football.state().live;
  const put = (s, v) => ({ ...s, score: v });
  const home = l.home.id === "83" ? put(l.home, ${mine}) : put(l.home, ${theirs});
  const away = l.away.id === "83" ? put(l.away, ${mine}) : put(l.away, ${theirs});
  A.football.mock({ live: { ...l, clock: ${JSON.stringify(clock)}, home, away, goals: ${JSON.stringify(goals)}, cards: ${JSON.stringify(cards)} } }, true);`;

const G1 = { minute: "23'", player: "Vinícius Jr.", teamId: "86", ownGoal: false, penalty: false };
const G2 = { minute: "41'", player: "Lewandowski", teamId: "83", ownGoal: false, penalty: true };
const G3 = { minute: "68'", player: "L. Yamal", teamId: "83", ownGoal: false, penalty: false };
const C1 = { minute: "72'", player: "Pedri", teamId: "83", red: false };

export async function scene(rec, lang) {
  const dropWrongFrames = guardViewport(rec);

  // 1. The picker: the popular teams, then Barcelona.
  await rec.arizo(`A.football.mock({}, true);`);
  await sleep(350);
  await rec.moveTo(".fb-chip", 3, 320);
  await sleep(40);
  await rec.click(".fb-chip", 0, { ms: 300, after: 150 });
  await rec.arizo(liveState(1, 1, "67'", [G1, G2], []));

  // 2. The team page: the game that is on now, what comes next, what just happened.
  await sleep(400);
  await rec.moveTo(".fb-col", 0, 350);
  await sleep(80);
  await rec.moveTo(".fb-col", 1, 350);
  await sleep(150);
  await rec.move(878, 330, 320);

  // 3. A goal: the island grows into the stage, balls and confetti fall, Ari cheers, then it settles.
  await rec.arizo(liveState(2, 1, "68'", [G1, G2, G3], []));
  await sleep(3300);

  // 4. A yellow card for the team.
  await rec.arizo(liveState(2, 1, "72'", [G1, G2, G3], [C1]));
  await sleep(2500);

  // 5. Back to the picker, where it started (the kit goes with the team, so the team is let go too).
  await rec.click(".fb-link", 0, { ms: 420, after: 150 });
  await rec.arizo(`A.football.setState({ enabled: false, configured: false, team: null, live: null, upcoming: [], recent: [], updatedAt: 0, error: "" }); A.State.notify();`);
  await rec.eval(`document.activeElement && document.activeElement.blur()`);
  await sleep(250);
  await rec.drawCursor(-100, -100);
  dropWrongFrames();
}
