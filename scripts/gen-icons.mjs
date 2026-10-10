// Draws the Arizo Translate icon: Ari on a black island tile.
// Pure code, no image files.    npm run icons
// npm run icons

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src-tauri", "icons");

// ── PNG encoding ──────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Ari on the island tile ────────────────────────────────────────────────────
// A black island-coloured tile, Ari as he looks in the app (porcelain squircle,
// two small dark eyes, no extras) and a soft blue + violet glow behind him: the
// Fast and Smart engines.

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const super_ = (x, y, cx, cy, rx, ry, p) =>
  Math.pow(Math.abs((x - cx) / rx), p) + Math.pow(Math.abs((y - cy) / ry), p);

const TILE_TOP = [22, 23, 30];
const TILE_BOTTOM = [6, 6, 9];
const FAST = [59, 130, 246]; // the Fast engine's blue
const SMART = [167, 139, 250]; // the Smart engine's violet
const BODY_TOP = [250, 250, 252];
const BODY_BOTTOM = [201, 204, 213];
const BODY_EDGE = [160, 165, 178];
const EYE = [14, 12, 16];

function shade(x, y) {
  // The tile: a full-bleed squircle with a hair of margin.
  if (super_(x, y, 0.5, 0.5, 0.485, 0.485, 5) > 1) return null;

  let c = mix(TILE_TOP, TILE_BOTTOM, clamp01(y));
  const glow = (gx, gy, r, col, k) => {
    const d = Math.hypot(x - gx, y - gy) / r;
    if (d < 1) c = mix(c, col, Math.pow(1 - d, 2) * k);
  };
  glow(0.2, 0.86, 0.62, FAST, 0.62);
  glow(0.84, 0.16, 0.58, SMART, 0.56);

  // Soft shadow under Ari.
  const sh = super_(x, y, 0.5, 0.64, 0.33, 0.25, 2.6);
  if (sh < 1) c = mix(c, [0, 0, 0], (1 - sh) * 0.55);

  // Ari's body: wider than tall, a flatter belly.
  const cx = 0.5, cy = 0.5, rx = 0.31, ry = 0.255;
  const sq = super_(x, y, cx, cy, rx, ry, 3.3);
  if (sq <= 1) {
    const t = clamp01((y - (cy - ry)) / (ry * 2));
    let b = mix(BODY_TOP, BODY_BOTTOM, Math.pow(t, 0.9));
    const dc = Math.hypot((x - cx) / rx, (y - cy) / ry);
    if (dc > 0.62) b = mix(b, BODY_EDGE, clamp01((dc - 0.62) / 0.38) * 0.5);
    const dl = Math.hypot((x - 0.4) / 0.2, (y - 0.4) / 0.14);
    if (dl < 1) b = mix(b, [255, 255, 255], Math.pow(1 - dl, 1.6) * 0.5);
    c = b;

    // Two small dark eyes, a touch taller than wide.
    for (const ex of [cx - 0.115, cx + 0.115]) {
      const e = Math.pow((x - ex) / 0.03, 2) + Math.pow((y - (cy - 0.005)) / 0.042, 2);
      if (e <= 1) c = mix(EYE, [60, 58, 66], clamp01(1 - e) * 0.0);
    }
  }
  return [c[0], c[1], c[2], 1];
}

function renderIcon(size) {
  const ss = size <= 64 ? 4 : 2;
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const s = shade((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
          if (s) { r += s[0]; g += s[1]; b += s[2]; a += 1; }
        }
      }
      const i = (py * size + px) * 4;
      if (a > 0) {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(g / a);
        out[i + 2] = Math.round(b / a);
        out[i + 3] = Math.round((a / (ss * ss)) * 255);
      }
    }
  }
  return encodePng(size, size, out);
}

/** A Windows .ico whose images are PNGs (supported since Vista). */
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, png }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

mkdirSync(outDir, { recursive: true });
const png = (size) => renderIcon(size);

writeFileSync(join(outDir, "32x32.png"), png(32));
writeFileSync(join(outDir, "128x128.png"), png(128));
writeFileSync(join(outDir, "128x128@2x.png"), png(256));
writeFileSync(join(outDir, "icon.png"), png(512));
writeFileSync(
  join(outDir, "icon.ico"),
  encodeIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: png(size) }))),
);

// Also copy to assets/icons
const assetsIcons = resolve(root, "assets", "icons");
mkdirSync(assetsIcons, { recursive: true });
writeFileSync(join(assetsIcons, "icon.png"), png(512));
writeFileSync(join(assetsIcons, "icon.ico"), encodeIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: png(size) }))));

console.log(`Icons successfully written to ${outDir} and ${assetsIcons}`);
