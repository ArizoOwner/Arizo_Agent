// The two pills of the translator: the engine that does the work. They reuse
// the island's pill component and its colour handling (a mini Ari in the
// pill's colour). The IDs are stable contract values: never rename them.

import type { BotStateName } from "./layout";
import { N_ } from "../i18n/i18n";

export type Engine = "google" | "aphra";
export type EnginePillId = "engine_google" | "engine_aphra";

export interface PillDefinition {
  id: EnginePillId;
  engine: Engine;
  /** The English label, the key of its translations. */
  name: string;
  /** What the pill says it is, shown as its tooltip (also an i18n key). */
  hint: string;
  color: string;
  glyph: "bolt" | "spark";
}

export const PILLS: readonly PillDefinition[] = [
  {
    id: "engine_google", engine: "google", name: N_("Fast"),
    hint: N_("Fast engine: instant, free, no key needed"), color: "#4285F4", glyph: "bolt",
  },
  {
    id: "engine_aphra", engine: "aphra", name: N_("Smart"),
    hint: N_("Smart engine: AI, understands idioms and tone"), color: "#A78BFA", glyph: "spark",
  },
];

export const DEFAULT_ENGINE: Engine = "google";

export function pillForEngine(engine: Engine): PillDefinition {
  return PILLS.find((p) => p.engine === engine) ?? PILLS[0];
}

export function pillById(id: string): PillDefinition | undefined {
  return PILLS.find((p) => p.id === id);
}

/** Anything the backend or a stale preference gives us becomes a real engine. */
export function parseEngine(raw: unknown): Engine {
  return raw === "aphra" ? "aphra" : DEFAULT_ENGINE;
}

/** The other engine, for Ctrl+Tab. */
export function otherEngine(engine: Engine): Engine {
  return engine === "google" ? "aphra" : "google";
}

/** What a pill's mini Ari does: the one at work thinks, the others rest. */
export function pillState(engine: Engine, working: Engine | null): BotStateName {
  return working === engine ? "thinking" : "idle";
}
