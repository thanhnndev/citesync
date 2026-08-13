// scripts/gen-pwa-icons.mjs
// Deterministic PWA icon generator for CiteSync (M003 T4, R011).
//
// Zero-dep by design: hand-rolled PNG encoder (signature + IHDR + IDAT via
// node:zlib deflateSync + IEND, ~10-line CRC32). No timestamps, no random
// state, no external generator — identical bytes on every run, so the output
// is safe to commit. @vite-pwa/assets-generator is deliberately NOT used
// (optional peer of vite-plugin-pwa; avoid the extra dependency).
//
// Usage: node scripts/gen-pwa-icons.mjs
// Writes: apps/web/public/pwa-192x192.png, apps/web/public/pwa-512x512.png
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- PNG primitives --------------------------------------------------------

// CRC32 (PNG variant: reflected polynomial 0xEDB88320, init/xor-out 0xFFFFFFFF).
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// One PNG chunk: 4-byte big-endian length + type + data + CRC over type+data.
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

// Encode an RGBA pixel buffer as a PNG. Scanlines prefixed with filter byte 0
// (None) — simple and deterministic. Color type 6 (RGBA), 8-bit depth.
function encodePng(width, height, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace: none
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter byte: None
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Icon art (deterministic, proportional to size) ------------------------

// CiteSync brand colors — must match the manifest theme_color in
// apps/web/vite.config.ts.
const BG = [0x1a, 0x5c, 0xff, 0xff]; // #1a5cff
const GLYPH = [0xff, 0xff, 0xff, 0xff]; // #ffffff

// Point-in-rounded-rect test (no anti-aliasing; deterministic integer math).
function inRoundedRect(x, y, rx, ry, rw, rh, r) {
  if (x < rx || x >= rx + rw || y < ry || y >= ry + rh) return false;
  const dx = Math.min(x - rx, rx + rw - 1 - x);
  const dy = Math.min(y - ry, ry + rh - 1 - y);
  if (dx < r && dy < r) {
    const ddx = r - dx;
    const ddy = r - dy;
    if (ddx * ddx + ddy * ddy > r * r) return false; // corner cut
  }
  return true;
}

// Flat brand-blue background + white double-quote glyph (citation mark).
// Layout is defined on a 192px grid and scaled by `size / 192`, so the 512
// icon is an exact proportional upscale of the 192 icon.
function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = BG[0];
    px[i + 1] = BG[1];
    px[i + 2] = BG[2];
    px[i + 3] = BG[3];
  }
  const s = size / 192;
  const barW = 34 * s; // quote bar width
  const barH = 62 * s; // quote bar height
  const radius = 8 * s; // corner radius
  const gapX = 16 * s; // gap between the two bars
  const totalW = barW * 2 + gapX;
  const x0 = (size - totalW) / 2;
  const y0 = (size - barH) / 2; // vertically centered
  const bars = [
    { x: x0, y: y0, w: barW, h: barH },
    { x: x0 + barW + gapX, y: y0, w: barW, h: barH },
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (const b of bars) {
        if (inRoundedRect(x, y, b.x, b.y, b.w, b.h, radius)) {
          const i = (y * size + x) * 4;
          px[i] = GLYPH[0];
          px[i + 1] = GLYPH[1];
          px[i + 2] = GLYPH[2];
          px[i + 3] = GLYPH[3];
          break;
        }
      }
    }
  }
  return encodePng(size, size, px);
}

// --- Write outputs ---------------------------------------------------------

const outDir = join(ROOT, 'apps', 'web', 'public');
mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
  const png = drawIcon(size);
  const file = join(outDir, `pwa-${size}x${size}.png`);
  writeFileSync(file, png);
  console.log(`wrote ${file} (${png.length} bytes)`);
}
