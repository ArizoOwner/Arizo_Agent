// One translation at a time, the newest wins. Shared by the island and the
// bubble (each window has its own Translator and its own request numbers).

import { Bridge, type TranslateResult } from "./bridge";
import type { Engine } from "./pills";

export type Phase = "idle" | "loading" | "done" | "error";

export interface TranslateRequest {
  text: string;
  engine: Engine;
  tone?: string;
  targetLang: string;
}

export class Translator {
  phase: Phase = "idle";
  /** What has streamed in so far (the final text once done). */
  partial = "";
  result: TranslateResult | null = null;
  error = "";
  /** Milliseconds the last request took. */
  ms = 0;
  /** The request that is on screen. */
  request: TranslateRequest | null = null;

  onChange: (() => void) | null = null;

  private seq: number;
  private startedAt = 0;

  /** `firstId` keeps two windows' request numbers apart: partials are broadcast. */
  constructor(firstId = 0) {
    this.seq = firstId;
  }

  get busy(): boolean {
    return this.phase === "loading";
  }

  reset() {
    this.seq++;
    this.phase = "idle";
    this.partial = "";
    this.result = null;
    this.error = "";
    this.request = null;
    this.onChange?.();
  }

  /** Stops what is running and forgets it. */
  cancel() {
    if (this.phase === "loading") void Bridge.translateCancel(this.seq);
    this.reset();
  }

  /** Streamed text from the backend; ignored when it belongs to an older request. */
  partialText(requestId: number, text: string) {
    if (requestId !== this.seq || this.phase !== "loading" || !text) return;
    this.partial = text;
    this.onChange?.();
  }

  async run(req: TranslateRequest): Promise<TranslateResult | null> {
    const query = req.text.trim();
    if (!query) {
      this.cancel();
      return null;
    }
    const id = ++this.seq;
    this.request = { ...req, text: query };
    this.phase = "loading";
    this.partial = "";
    this.result = null;
    this.error = "";
    this.startedAt = performance.now();
    this.onChange?.();
    try {
      const res = await Bridge.translate({
        requestId: id,
        text: query,
        engine: req.engine,
        tone: req.tone,
        targetLang: req.targetLang,
      });
      // A newer request owns the screen now, or this one was cancelled.
      if (id !== this.seq || res?.aborted) return null;
      this.ms = Math.round(performance.now() - this.startedAt);
      if (res && res.success && res.data) {
        this.result = res;
        this.partial = res.data.translation;
        this.phase = "done";
      } else {
        this.error = res?.error || "";
        this.phase = "error";
      }
      this.onChange?.();
      return res;
    } catch (err) {
      if (id !== this.seq) return null;
      this.error = String(err instanceof Error ? err.message : err);
      this.phase = "error";
      this.onChange?.();
      return null;
    }
  }
}
