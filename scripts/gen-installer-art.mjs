// Generates beautiful, custom NSIS installer artwork for Arizo-Agent:
// 1. nsis-sidebar.bmp (164 x 314 px 24-bit BMP) for Welcome & Finish wizard pages
// 2. nsis-header.bmp (150 x 57 px 24-bit BMP) for inner wizard pages
// 3. installer.ico & uninstaller.ico with multi-resolution PNG frames
//
// Run: node scripts/gen-installer-art.mjs

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src-tauri", "icons");
mkdirSync(outDir, { recursive: true });

// ── Math & Color Helpers ───────────────────────────────────────────────────────

const clamp = (v, min = 0, max = 1) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const super_ = (x, y, cx, cy, rx, ry, p) =>
  Math.pow(Math.abs((x - cx) / rx), p) + Math.pow(Math.abs((y - cy) / ry), p);

// Colors
const BLUE = [59, 130, 246];       // Fast engine cyan-blue
const BLUE_LIGHT = [96, 165, 250];
const VIOLET = [167, 139, 250];    // Smart engine violet
const VIOLET_DARK = [124, 58, 237];
const BG_TOP = [14, 16, 24];
const BG_BOT = [6, 7, 10];
const ISLAND_BG = [18, 20, 28];
const ISLAND_BORDER = [48, 52, 68];
const BODY_TOP = [252, 252, 254];
const BODY_BOT = [198, 202, 216];
const BODY_EDGE = [150, 155, 172];
const EYE_COL = [14, 12, 16];
const BLUSH_COL = [255, 145, 170];

// ── 24-bit Windows BMP Encoder ────────────────────────────────────────────────

function encodeBmp24(width, height, getRgb) {
  const rowBytes = width * 3;
  const padding = (4 - (rowBytes % 4)) % 4;
  const stride = rowBytes + padding;
  const imageSize = stride * height;
  const fileSize = 54 + imageSize;

  const buf = Buffer.alloc(fileSize);

  // BITMAPFILEHEADER (14 bytes)
  buf.write("BM", 0, "ascii");
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6);
  buf.writeUInt32LE(54, 10);

  // BITMAPINFOHEADER (40 bytes)
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22); // positive = bottom-up
  buf.writeUInt16LE(1, 26);     // planes = 1
  buf.writeUInt16LE(24, 28);    // 24 bits
  buf.writeUInt32LE(0, 30);     // BI_RGB (uncompressed)
  buf.writeUInt32LE(imageSize, 34);
  buf.writeInt32LE(2835, 38);   // 72 DPI
  buf.writeInt32LE(2835, 42);
  buf.writeUInt32LE(0, 46);
  buf.writeUInt32LE(0, 50);

  // Pixel rows bottom-to-top
  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y;
    const rowOffset = 54 + y * stride;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = getRgb(x, srcY);
      const pixelOffset = rowOffset + x * 3;
      buf[pixelOffset] = Math.round(clamp(b, 0, 255));     // Blue
      buf[pixelOffset + 1] = Math.round(clamp(g, 0, 255)); // Green
      buf[pixelOffset + 2] = Math.round(clamp(r, 0, 255)); // Red
    }
  }

  return buf;
}

// ── PNG & ICO Encoders ────────────────────────────────────────────────────────

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
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

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
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

// ── Renderer: Ari Character Helper ───────────────────────────────────────────

function drawAri(c, x, y, cx, cy, rx, ry) {
  // Soft shadow under body
  const sh = super_(x, y, cx, cy + ry * 0.42, rx * 1.08, ry * 0.9, 2.6);
  if (sh < 1) c = mix(c, [0, 0, 0], (1 - sh) * 0.45);

  // Body squircle
  const sq = super_(x, y, cx, cy, rx, ry, 3.3);
  if (sq <= 1) {
    const t = clamp((y - (cy - ry)) / (ry * 2));
    let b = mix(BODY_TOP, BODY_BOT, Math.pow(t, 0.88));

    // Outer edge shading
    const dc = Math.hypot((x - cx) / rx, (y - cy) / ry);
    if (dc > 0.6) b = mix(b, BODY_EDGE, clamp((dc - 0.6) / 0.4) * 0.48);

    // Specular highlight at top-left
    const hl = Math.hypot((x - (cx - rx * 0.32)) / (rx * 0.55), (y - (cy - ry * 0.35)) / (ry * 0.42));
    if (hl < 1) b = mix(b, [255, 255, 255], Math.pow(1 - hl, 1.5) * 0.55);

    c = b;

    // Blush cheeks
    for (const bx of [cx - rx * 0.55, cx + rx * 0.55]) {
      const db = Math.hypot((x - bx) / (rx * 0.22), (y - (cy + ry * 0.24)) / (ry * 0.16));
      if (db < 1) c = mix(c, BLUSH_COL, Math.pow(1 - db, 1.4) * 0.45);
    }

    // Two expressive dark eyes
    const eyeRx = rx * 0.11;
    const eyeRy = ry * 0.18;
    const eyeY = cy - ry * 0.05;
    for (const ex of [cx - rx * 0.36, cx + rx * 0.36]) {
      const de = Math.pow((x - ex) / eyeRx, 2) + Math.pow((y - eyeY) / eyeRy, 2);
      if (de <= 1) {
        c = EYE_COL;
        // Specular glint in eye
        const dg = Math.hypot((x - (ex + eyeRx * 0.3)) / (eyeRx * 0.42), (y - (eyeY - eyeRy * 0.32)) / (eyeRy * 0.42));
        if (dg < 1) c = [255, 255, 255];
      }
    }
  }
  return c;
}

// ── 1. SIDEBAR IMAGE: 164 x 314 px (NSIS Modern UI Welcome & Finish) ──────────

function shadeSidebar(px, py) {
  const x = px / 164;
  const y = py / 314;

  // Background obsidian gradient
  let c = mix(BG_TOP, BG_BOT, clamp(y * 1.1));

  // Ambient glows
  const radial = (gx, gy, r, col, k) => {
    const d = Math.hypot((px - gx) / r, (py - gy) / r);
    if (d < 1) c = mix(c, col, Math.pow(1 - d, 2) * k);
  };

  // Top-left fast blue aura
  radial(42, 65, 80, BLUE, 0.42);
  // Top-right smart violet aura
  radial(122, 90, 85, VIOLET, 0.45);
  // Mid card glow
  radial(82, 170, 75, BLUE_LIGHT, 0.18);
  // Bottom soft glow
  radial(82, 280, 90, VIOLET_DARK, 0.30);

  // 1. Island capsule container (Top)
  const isCx = 82, isCy = 72, isRx = 64, isRy = 38;
  const isSq = super_(px, py, isCx, isCy, isRx, isRy, 4.2);
  if (isSq <= 1.08 && isSq > 1.0) {
    c = mix(c, ISLAND_BORDER, (1.08 - isSq) / 0.08 * 0.7);
  } else if (isSq <= 1.0) {
    const isGrad = clamp((py - (isCy - isRy)) / (isRy * 2));
    c = mix([22, 25, 34], [12, 14, 20], isGrad);
  }

  // Draw Ari inside the island
  c = drawAri(c, px, py, isCx, isCy + 2, 28, 22);

  // 2. Floating Translation Card (Middle: py ~ 132 to 198)
  const cardX1 = 16, cardX2 = 148, cardY1 = 135, cardY2 = 196;
  if (px >= cardX1 && px <= cardX2 && py >= cardY1 && py <= cardY2) {
    const crx = 10;
    // Rounded rect distance
    const dx = Math.max(cardX1 + crx - px, 0, px - (cardX2 - crx));
    const dy = Math.max(cardY1 + crx - py, 0, py - (cardY2 - crx));
    const dist = Math.hypot(dx, dy);
    if (dist <= crx) {
      const isEdge = dist >= crx - 1.2;
      if (isEdge) {
        c = mix(c, [70, 76, 98], 0.75);
      } else {
        const ct = (py - cardY1) / (cardY2 - cardY1);
        c = mix([24, 28, 38], [14, 16, 24], ct);

        // Inside card: Source pill ("Hello")
        if (px >= 26 && px <= 78 && py >= 145 && py <= 163) {
          const inPill = Math.hypot(Math.max(35 - px, 0, px - 69), Math.max(154 - py, 0, py - 154)) <= 9;
          if (inPill) c = [36, 44, 62];
          // Blue dot inside source pill
          if (Math.hypot(px - 34, py - 154) <= 3.2) c = BLUE_LIGHT;
        }

        // Center sparkle (✦)
        const spD = Math.hypot(px - 82, py - 165);
        if (spD <= 6) {
          const sx = Math.abs(px - 82) / 6;
          const sy = Math.abs(py - 165) / 6;
          if (Math.pow(sx, 0.5) + Math.pow(sy, 0.5) <= 1) c = [220, 200, 255];
        }

        // Target pill ("سلام")
        if (px >= 86 && px <= 138 && py >= 168 && py <= 186) {
          const inPill = Math.hypot(Math.max(95 - px, 0, px - 129), Math.max(177 - py, 0, py - 177)) <= 9;
          if (inPill) c = [48, 38, 70];
          // Violet dot inside target pill
          if (Math.hypot(px - 130, py - 177) <= 3.2) c = VIOLET;
        }
      }
    }
  }

  // 3. Audio & Feature Waves (py ~ 216 to 242)
  for (let i = 0; i < 9; i++) {
    const wx = 32 + i * 12.5;
    const heights = [10, 16, 24, 18, 28, 22, 17, 12, 8];
    const wh = heights[i];
    const wy1 = 230 - wh / 2;
    const wy2 = 230 + wh / 2;
    if (Math.abs(px - wx) <= 2.2 && py >= wy1 && py <= wy2) {
      const blend = i / 8;
      const barCol = mix(BLUE_LIGHT, VIOLET, blend);
      c = mix(c, barCol, 0.85);
    }
  }

  // 4. Feature Badges (py ~ 254 to 286)
  // Badge 1: "Fast Google" (Left)
  if (px >= 22 && px <= 78 && py >= 258 && py <= 276) {
    const inB = Math.hypot(Math.max(31 - px, 0, px - 69), Math.max(267 - py, 0, py - 267)) <= 9;
    if (inB) c = mix([20, 32, 54], BLUE, 0.25);
  }
  // Badge 2: "Smart AI" (Right)
  if (px >= 86 && px <= 142 && py >= 258 && py <= 276) {
    const inB = Math.hypot(Math.max(95 - px, 0, px - 133), Math.max(267 - py, 0, py - 267)) <= 9;
    if (inB) c = mix([34, 24, 58], VIOLET, 0.25);
  }

  // Bottom subtle brand line
  if (py >= 298 && py <= 299 && px >= 40 && px <= 124) {
    const fade = 1 - Math.abs(px - 82) / 42;
    c = mix(c, VIOLET, fade * 0.4);
  }

  return c;
}

// ── 2. HEADER IMAGE: 150 x 57 px (NSIS Modern UI Page Header) ────────────────

function shadeHeader(px, py) {
  const x = px / 150;
  const y = py / 57;

  // Header background gradient
  let c = mix([16, 18, 26], [10, 11, 16], y);

  // Soft glow on right side near mascot
  const dGlow = Math.hypot((px - 124) / 40, (py - 28) / 30);
  if (dGlow < 1) c = mix(c, VIOLET, Math.pow(1 - dGlow, 2) * 0.45);
  const dBlue = Math.hypot((px - 100) / 35, (py - 25) / 25);
  if (dBlue < 1) c = mix(c, BLUE, Math.pow(1 - dBlue, 2) * 0.35);

  // Decorative left sparkle
  const spD = Math.hypot(px - 26, py - 28);
  if (spD <= 8) {
    const sx = Math.abs(px - 26) / 8;
    const sy = Math.abs(py - 28) / 8;
    if (Math.pow(sx, 0.5) + Math.pow(sy, 0.5) <= 1) c = [230, 220, 255];
  }

  // Decorative subtle dots
  for (const [dotX, dotY] of [[44, 28], [56, 28], [68, 28]]) {
    if (Math.hypot(px - dotX, py - dotY) <= 2.2) c = mix(c, [100, 110, 140], 0.6);
  }

  // Mini island capsule on right: cx = 120, cy = 28
  const isCx = 120, isCy = 28, isRx = 24, isRy = 18;
  const isSq = super_(px, py, isCx, isCy, isRx, isRy, 4.0);
  if (isSq <= 1.1 && isSq > 1.0) {
    c = mix(c, ISLAND_BORDER, 0.7);
  } else if (isSq <= 1.0) {
    c = [18, 20, 28];
  }

  // Mini Ari
  c = drawAri(c, px, py, isCx, isCy + 1, 13, 10.5);

  // Hairline border at bottom
  if (py >= 55) c = mix(c, [35, 38, 50], 0.7);

  return c;
}

// ── 3. INSTALLER & UNINSTALLER ICONS (ICO) ─────────────────────────────────────

function shadeIconTile(px, py, size, isUninstall = false) {
  const x = px / size;
  const y = py / size;

  // Squircle icon tile
  if (super_(x, y, 0.5, 0.5, 0.485, 0.485, 5) > 1) return null;

  let c = mix([24, 26, 36], [8, 9, 13], clamp(y));

  // Glow
  const glow = (gx, gy, r, col, k) => {
    const d = Math.hypot(x - gx, y - gy) / r;
    if (d < 1) c = mix(c, col, Math.pow(1 - d, 2) * k);
  };
  glow(0.2, 0.86, 0.62, BLUE, 0.65);
  glow(0.84, 0.16, 0.58, VIOLET, 0.60);

  // Ari on tile
  c = drawAri(c, x, y, 0.5, 0.5, 0.31, 0.255);

  // Corner Badge (Bottom Right: x ~ 0.74, y ~ 0.74, radius ~ 0.18)
  const badgeCx = 0.76, badgeCy = 0.76, badgeR = 0.17;
  const dBadge = Math.hypot(x - badgeCx, y - badgeCy) / badgeR;
  if (dBadge <= 1.0) {
    // Outer border
    if (dBadge > 0.88) {
      c = [18, 20, 28];
    } else {
      // Badge body
      const badgeCol = isUninstall ? [239, 68, 68] : [34, 197, 94];
      const badgeGrad = isUninstall ? [220, 38, 38] : [16, 185, 129];
      c = mix(badgeCol, badgeGrad, dBadge);

      // Icon symbol in badge
      if (isUninstall) {
        // Trash / X mark
        const mx = Math.abs(x - badgeCx);
        const my = Math.abs(y - badgeCy);
        if (Math.abs(mx - my) <= 0.025 && mx <= 0.08 && my <= 0.08) {
          c = [255, 255, 255];
        }
      } else {
        // Download / arrow down inside badge
        const dx = Math.abs(x - badgeCx);
        const dy = y - badgeCy;
        // Arrow stem
        if (dx <= 0.025 && dy >= -0.07 && dy <= 0.03) c = [255, 255, 255];
        // Arrow head
        if (dy > 0.01 && dy <= 0.075 && dx <= (0.075 - dy) * 1.1) c = [255, 255, 255];
      }
    }
  }

  return [c[0], c[1], c[2], 255];
}

function renderPngIcon(size, isUninstall = false) {
  const ss = size <= 64 ? 4 : 2;
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const s = shadeIconTile(px + (sx + 0.5) / ss, py + (sy + 0.5) / ss, size, isUninstall);
          if (s) {
            r += s[0]; g += s[1]; b += s[2]; a += s[3];
          }
        }
      }
      const i = (py * size + px) * 4;
      if (a > 0) {
        const total = ss * ss;
        out[i] = Math.round(r / total);
        out[i + 1] = Math.round(g / total);
        out[i + 2] = Math.round(b / total);
        out[i + 3] = Math.round(a / total);
      }
    }
  }
  return encodePng(size, size, out);
}

// ── Render & Write All Files ──────────────────────────────────────────────────

console.log("Generating NSIS Installer graphics...");

// 1. Sidebar BMP (164 x 314) with 2x supersampling
console.log("  Rendering nsis-sidebar.bmp (164x314)...");
const sidebarBmp = encodeBmp24(164, 314, (px, py) => {
  let r = 0, g = 0, b = 0;
  const ss = 2;
  for (let sy = 0; sy < ss; sy++) {
    for (let sx = 0; sx < ss; sx++) {
      const col = shadeSidebar(px + (sx + 0.5) / ss, py + (sy + 0.5) / ss);
      r += col[0]; g += col[1]; b += col[2];
    }
  }
  return [r / 4, g / 4, b / 4];
});
writeFileSync(join(outDir, "nsis-sidebar.bmp"), sidebarBmp);

// 2. Header BMP (150 x 57) with 2x supersampling
console.log("  Rendering nsis-header.bmp (150x57)...");
const headerBmp = encodeBmp24(150, 57, (px, py) => {
  let r = 0, g = 0, b = 0;
  const ss = 2;
  for (let sy = 0; sy < ss; sy++) {
    for (let sx = 0; sx < ss; sx++) {
      const col = shadeHeader(px + (sx + 0.5) / ss, py + (sy + 0.5) / ss);
      r += col[0]; g += col[1]; b += col[2];
    }
  }
  return [r / 4, g / 4, b / 4];
});
writeFileSync(join(outDir, "nsis-header.bmp"), headerBmp);

// 3. Installer ICO (multi-res: 16, 24, 32, 48, 64, 128, 256)
console.log("  Rendering installer.ico & uninstaller.ico...");
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const installerIco = encodeIco(SIZES.map((size) => ({ size, png: renderPngIcon(size, false) })));
const uninstallerIco = encodeIco(SIZES.map((size) => ({ size, png: renderPngIcon(size, true) })));

writeFileSync(join(outDir, "installer.ico"), installerIco);
writeFileSync(join(outDir, "uninstaller.ico"), uninstallerIco);

console.log("All installer artwork generated successfully in src-tauri/icons/!");
