// Synthesizes Ari's 29 sound effects from scratch (sines, glides, soft noise) and writes
// them to web/public/sounds. Original work, deterministic.   npm run sounds

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "web", "public", "sounds");
mkdirSync(outDir, { recursive: true });

const SR = 44100;
const N = (semi) => 440 * 2 ** ((semi - 9) / 12); // semitones from C4 -> Hz
const C = { C4: N(0), D4: N(2), E4: N(4), F4: N(5), G4: N(7), A4: N(9), B4: N(11), C5: N(12), D5: N(14), E5: N(16), G5: N(19), C6: N(24) };

let seed = 20260710;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

// One note: pitch glides f0 -> f1 over `dur`, attack/decay envelope, optional vibrato and overtone.
function note(buf, { t = 0, dur = 0.2, f0, f1 = f0, vol = 0.5, atk = 0.008, vib = 0, vibHz = 6, harm = 0.18, tri = false }) {
  const start = Math.floor(t * SR);
  const len = Math.floor(dur * SR);
  let phase = 0;
  for (let i = 0; i < len && start + i < buf.length; i++) {
    const p = i / len;
    const f = f0 + (f1 - f0) * p + (vib ? Math.sin((2 * Math.PI * vibHz * i) / SR) * vib : 0);
    phase += (2 * Math.PI * f) / SR;
    const env = Math.min(1, i / (atk * SR)) * Math.pow(1 - p, 2);
    const s = tri ? (2 / Math.PI) * Math.asin(Math.sin(phase)) : Math.sin(phase);
    buf[start + i] += (s + harm * Math.sin(2 * phase)) * env * vol;
  }
}

// A burst of low-passed noise, for taps and breaths.
function puff(buf, { t = 0, dur = 0.1, vol = 0.3, tone = 0.15 }) {
  const start = Math.floor(t * SR);
  const len = Math.floor(dur * SR);
  let lp = 0;
  for (let i = 0; i < len && start + i < buf.length; i++) {
    lp += (rnd() - lp) * tone;
    buf[start + i] += lp * Math.pow(1 - i / len, 3) * vol;
  }
}

const seq = (buf, notes, step, base = {}) => notes.forEach((f, i) => note(buf, { ...base, t: (base.t ?? 0) + i * step, f0: f, f1: f }));

const DEFS = {
  peek: (b) => { note(b, { dur: 0.3, f0: 380, f1: 720, vol: 0.5 }); note(b, { t: 0.12, dur: 0.3, f0: 570, f1: 900, vol: 0.3 }); },
  open: (b) => { note(b, { dur: 0.28, f0: 330, f1: 660, vol: 0.5 }); note(b, { t: 0.1, dur: 0.35, f0: C.G4, f1: C.C5, vol: 0.35 }); },
  close: (b) => { note(b, { dur: 0.3, f0: 660, f1: 300, vol: 0.5 }); note(b, { t: 0.08, dur: 0.3, f0: C.C5, f1: C.G4 / 1.2, vol: 0.25 }); },
  hover: (b) => note(b, { dur: 0.07, f0: 900, f1: 1100, vol: 0.35, atk: 0.004 }),
  blip: (b) => note(b, { dur: 0.1, f0: 1200, f1: 1200, vol: 0.4, atk: 0.003 }),
  slap: (b) => { puff(b, { dur: 0.12, vol: 0.7, tone: 0.5 }); note(b, { dur: 0.22, f0: 260, f1: 90, vol: 0.6, atk: 0.002 }); },
  annoyed: (b) => { note(b, { dur: 0.3, f0: 330, f1: 220, vol: 0.5, vib: 18, vibHz: 22, tri: true }); note(b, { t: 0.2, dur: 0.35, f0: 260, f1: 160, vol: 0.45, vib: 14, vibHz: 20, tri: true }); },
  dizzy: (b) => { note(b, { dur: 0.95, f0: 300, f1: 520, vol: 0.5, vib: 90, vibHz: 7 }); note(b, { t: 0.1, dur: 0.85, f0: 450, f1: 280, vol: 0.25, vib: 70, vibHz: 5 }); },
  greet: (b) => seq(b, [C.G4, C.C5, C.E5], 0.13, { dur: 0.3, vol: 0.45 }),
  work: (b) => { note(b, { dur: 0.1, f0: 520, vol: 0.4 }); note(b, { t: 0.15, dur: 0.1, f0: 620, vol: 0.4 }); },
  finish: (b) => { seq(b, [C.C5, C.E5, C.G5, C.C6], 0.12, { dur: 0.35, vol: 0.4 }); note(b, { t: 0.4, dur: 0.7, f0: C.C6, vol: 0.2, harm: 0.4 }); },
  error: (b) => { note(b, { dur: 0.3, f0: 240, f1: 200, vol: 0.5, tri: true }); note(b, { t: 0.3, dur: 0.5, f0: 180, f1: 140, vol: 0.5, tri: true }); },
  approval: (b) => { seq(b, [C.E5, C.G5], 0.18, { dur: 0.45, vol: 0.4 }); note(b, { t: 0.5, dur: 0.35, f0: C.G5, vol: 0.25 }); },
  question: (b) => { note(b, { dur: 0.45, f0: 420, f1: 780, vol: 0.5 }); note(b, { t: 0.4, dur: 0.25, f0: 780, f1: 820, vol: 0.3 }); },
  approve: (b) => seq(b, [C.G4, C.D5], 0.14, { dur: 0.4, vol: 0.45 }),
  gulp: (b) => { note(b, { dur: 0.16, f0: 500, f1: 180, vol: 0.55, atk: 0.004 }); note(b, { t: 0.28, dur: 0.2, f0: 300, f1: 120, vol: 0.5, atk: 0.004 }); puff(b, { t: 0.5, dur: 0.15, vol: 0.2 }); },
  tick: (b) => puff(b, { dur: 0.06, vol: 0.5, tone: 0.7 }),
  send: (b) => { note(b, { dur: 0.3, f0: 500, f1: 1100, vol: 0.4 }); puff(b, { t: 0.25, dur: 0.2, vol: 0.15 }); },
  love: (b) => { seq(b, [C.E5, C.G5, C.E5, C.C6], 0.15, { dur: 0.35, vol: 0.35, vib: 6 }); },
  pop: (b) => { note(b, { dur: 0.2, f0: 900, f1: 300, vol: 0.55, atk: 0.002 }); puff(b, { dur: 0.04, vol: 0.4, tone: 0.8 }); },
  proud: (b) => { seq(b, [C.C5, C.C5, C.G5], 0.17, { dur: 0.3, vol: 0.42 }); note(b, { t: 0.5, dur: 0.4, f0: C.C6, vol: 0.25 }); },
  wink: (b) => { note(b, { dur: 0.1, f0: 800, f1: 1100, vol: 0.4 }); note(b, { t: 0.1, dur: 0.1, f0: 1100, f1: 850, vol: 0.35 }); },
  yawn: (b) => { note(b, { dur: 0.7, f0: 300, f1: 420, vol: 0.4, atk: 0.2, vib: 5, vibHz: 4 }); note(b, { t: 0.3, dur: 0.4, f0: 420, f1: 150, vol: 0.35, atk: 0.1 }); puff(b, { t: 0.1, dur: 0.6, vol: 0.12, tone: 0.05 }); },
  attach: (b) => { note(b, { dur: 0.5, f0: 220, f1: 640, vol: 0.45 }); note(b, { t: 0.5, dur: 0.35, f0: 640, f1: 200, vol: 0.5, atk: 0.003 }); puff(b, { t: 0.55, dur: 0.15, vol: 0.25 }); },
  think: (b) => { note(b, { dur: 0.2, f0: 440, vol: 0.35, vib: 8, vibHz: 9 }); note(b, { t: 0.2, dur: 0.22, f0: 500, vol: 0.35, vib: 8, vibHz: 9 }); },
  search: (b) => { note(b, { dur: 0.15, f0: 600, f1: 800, vol: 0.4 }); note(b, { t: 0.18, dur: 0.15, f0: 800, f1: 600, vol: 0.4 }); },
  rate: (b) => { seq(b, [C.C5, C.E5, C.G5], 0.11, { dur: 0.3, vol: 0.4 }); note(b, { t: 0.33, dur: 0.35, f0: C.C6, vol: 0.3 }); },
  sleep: (b) => { note(b, { dur: 0.45, f0: 380, f1: 220, vol: 0.4, atk: 0.1, vib: 4, vibHz: 3 }); },
  greeting: (b) => {
    const theme = [C.C5, C.E5, C.G5, C.E5, C.G5, C.C6, C.G5, C.C6];
    theme.forEach((f, i) => { note(b, { t: 0.3 + i * 0.28, dur: 0.5, f0: f, vol: 0.35, harm: 0.3 }); note(b, { t: 0.3 + i * 0.28, dur: 0.6, f0: f / 2, vol: 0.18, tri: true }); });
    [C.C5, C.E5, C.G5, C.C6].forEach((f) => note(b, { t: 2.7, dur: 1.4, f0: f, vol: 0.18, atk: 0.04 }));
  },
};

function writeWav(name, samples) {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const gain = peak > 0 ? 0.85 / peak : 1;
  const fade = Math.floor(0.004 * SR);
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => {
    const edge = Math.min(1, (samples.length - i) / fade);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s * gain * edge)) * 32767), i * 2);
  });
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(join(outDir, `${name}.wav`), Buffer.concat([h, data]));
}

for (const [name, build] of Object.entries(DEFS)) {
  const buf = new Float32Array(Math.floor((name === "greeting" ? 4.4 : 1.3) * SR));
  build(buf);
  let end = buf.length;
  while (end > 0 && Math.abs(buf[end - 1]) < 0.001) end--;
  writeWav(name, buf.slice(0, Math.min(buf.length, end + Math.floor(0.03 * SR))));
}
console.log(`wrote ${Object.keys(DEFS).length} sounds to ${outDir}`);
