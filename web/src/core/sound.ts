// SoundEngine — port of SoundEngine.swift.
// The 30 WAVs are synthesized by scripts/gen-sounds.mjs (`npm run sounds`) and served at
// /sounds/<name>.wav. Several sounds may overlap.

export const SOUND_NAMES = [
  "peek", "open", "close", "hover", "blip", "slap", "annoyed", "dizzy", "greet",
  "work", "finish", "error", "approval", "question", "approve", "gulp", "tick",
  "send", "love", "pop", "proud", "wink", "yawn", "attach", "think", "search",
  "rate", "sleep", "greeting", "goal", "whistle", "card", "groan",
] as const;

export type SoundName = (typeof SOUND_NAMES)[number];

class SoundEngine {
  enabled = true;
  volume = 0.5;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private idleTimer: number | null = null;
  /** Sounds still playing, by name, so one can be faded out (the greeting). */
  private playing = new Map<string, Set<{ src: AudioBufferSourceNode; gain: GainNode }>>();

  /** Creates the context and decodes every WAV. Safe to call more than once. */
  preload(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = this.volume;
      master.connect(ctx.destination);
      this.master = master;
      await Promise.all(
        SOUND_NAMES.map(async (name) => {
          try {
            const res = await fetch(`/sounds/${name}.wav`);
            if (!res.ok) return;
            const buf = await ctx.decodeAudioData(await res.arrayBuffer());
            this.buffers.set(name, buf);
          } catch {
            /* a missing sound must never break the island */
          }
        }),
      );
    })();
    return this.loading;
  }

  /** WebView2 can hand us a suspended context; call after any user input. */
  resume() {
    if (this.idleTimer != null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    void this.ctx?.resume();
  }

  /**
   * Called when the island goes quiet. A running AudioContext keeps an audio
   * thread and its render quantum alive even with nothing playing, which shows
   * up as a steady trickle of CPU on a machine that is supposed to be idle.
   *
   * The delay covers the tail of whatever just played — suspending mid-sound
   * would clip it — and `play()` resumes the context on its own.
   */
  idle() {
    if (!this.ctx || this.ctx.state !== "running" || this.idleTimer != null) return;
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = null;
      void this.ctx?.suspend();
    }, 1500);
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1.0, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
  }

  async play(name: SoundName | string) {
    if (!this.enabled) return;
    if (this.buffers.size === 0 && this.loading) {
      await this.loading;
    }
    const ctx = this.ctx;
    const master = this.master;
    const buf = this.buffers.get(name);
    if (!ctx || !master || !buf) {
      try {
        const audio = new Audio(`/sounds/${name}.wav`);
        audio.volume = this.volume;
        void audio.play();
      } catch {}
      return;
    }
    if (this.idleTimer != null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {}
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    src.connect(gain);
    gain.connect(master);
    const voice = { src, gain };
    let voices = this.playing.get(name);
    if (!voices) this.playing.set(name, (voices = new Set()));
    voices.add(voice);
    src.onended = () => {
      voices.delete(voice);
      gain.disconnect();
    };
    try {
      src.start();
    } catch {
      try {
        const audio = new Audio(`/sounds/${name}.wav`);
        audio.volume = this.volume;
        void audio.play();
      } catch {}
    }
  }

  /** Fades every playing copy of `name` to silence over `seconds`, then stops it. */
  fadeOut(name: string, seconds: number) {
    const ctx = this.ctx;
    const voices = this.playing.get(name);
    if (!ctx || !voices) return;
    const t = ctx.currentTime;
    for (const { src, gain } of voices) {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + seconds);
      try {
        src.stop(t + seconds);
      } catch {
        /* already stopped */
      }
    }
  }
}

export const Sound = new SoundEngine();
