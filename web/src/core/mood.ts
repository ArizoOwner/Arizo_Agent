// How Ari feels about what just happened: thinking while a translation runs,
// happy after a copy, unhappy after a failure, calm otherwise. The island's
// frame loop reads `State.botState`; this only sets it, and plays the sound.

import { Sound } from "./sound";
import { State } from "./state";
import type { BotEmoteName, BotStateName } from "./layout";

let timer: number | null = null;
type EmoteListener = (emote: BotEmoteName) => void;
const emoteListeners = new Set<EmoteListener>();

/** The island subscribes to make Ari do an emote (proud, love…). */
export function onEmote(fn: EmoteListener): () => void {
  emoteListeners.add(fn);
  return () => emoteListeners.delete(fn);
}

/** Sets Ari's state; with `ms` it goes back to idle after that long. */
export function setMood(state: BotStateName, ms = 0) {
  if (timer != null) window.clearTimeout(timer);
  timer = null;
  State.botState = state;
  if (ms > 0) {
    timer = window.setTimeout(() => {
      timer = null;
      if (State.botState === state) {
        State.botState = "idle";
        State.notify();
      }
    }, ms);
  }
  State.notify();
}

/** A translation is running on `engine` (or stopped: null). */
export function setWorking(engine: "google" | "aphra" | null) {
  State.working = engine;
  State.syncPills();
  if (engine) setMood("thinking");
  else if (State.botState === "thinking") setMood("idle");
  else State.notify();
}

/** A copy or a replace worked: Ari is proud, with a light sound. */
export function celebrate() {
  setMood("finished", 1600);
  Sound.play("approve");
  for (const fn of emoteListeners) fn("proud");
}

/** A translation failed. */
export function fail() {
  State.working = null;
  State.syncPills();
  setMood("error", 3000);
  Sound.play("error");
}
