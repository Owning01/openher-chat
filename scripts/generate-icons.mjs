/**
 * Genera los iconos raster de OpenHer Chat desde la geometría de
 * `public/icons/icon.svg` (tile con burbuja + tres puntos de typing).
 *
 * Rasterizador propio con solo builtins de Node (sin dependencias): la misma
 * geometría vive en `src/shared/brand/Logo.tsx` para la UI. Si cambia el logo,
 * se actualizan los tres lugares y se corre `node scripts/generate-icons.mjs`.
 *
 * Salidas (en `public/icons/`, commiteadas: las necesita el hosting/PWA):
 * - `icon-192.png` / `icon-512.png` (manifest, instalabilidad en Android)
 * - `apple-touch-icon-180.png` (iOS, a sangre completa: iOS redondea solo)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'icons');

const START = [59, 108, 240]; // #3b6cf0
const END = [67, 56, 202]; // #4338ca
const WHITE = [255, 255, 255];
const DOT = [59, 108, 240]; // #3b6cf0

const TILE_RADIUS = 120;
const BUBBLE = { x0: 112, y0: 128, x1: 400, y1: 328, r: 56 };
const TAIL = [
  [200, 328],
  [272, 328],
  [200, 392],
];
const DOTS = [
  [200, 228],
  [256, 228],
  [312, 228],
];
const DOT_RADIUS = 24;

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Cobertura AA [0..1] de un rounded-rect (SDF exacto). */
function roundRectCover(px, py, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const bx = (x1 - x0) / 2 - r;
  const by = (y1 - y0) / 2 - r;
  const qx = Math.abs(px - cx) - bx;
  const qy = Math.abs(py - cy) - by;
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  const dist = Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
  return clamp01(0.5 - dist);
}

function pointInTriangle(px, py, triangle) {
  const [[ax, ay], [bx, by], [cx, cy]] = triangle;
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  const u = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d;
  const v = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d;
  return u >= 0 && v >= 0 && u + v <= 1;
}

function circleCover(px, py, cx, cy, r) {
  return clamp01(0.5 - (Math.hypot(px - cx, py - cy) - r));
}

function lerpChannel(a, b, t) {
  return Math.round(a + (b - a) * t);
}

/** Renderiza a `2x` y promedia (SSAA barato para bordes suaves). */
function render(size, tileRadius) {
  const scale = 2;
  const n = size * scale;
  const grid = new Float32Array(n * n * 4);
  for (let y = 0; y < n; y += 1) {
    const py = (y + 0.5) / scale;
    for (let x = 0; x < n; x += 1) {
      const px = (x + 0.5) / scale;
      const tile = tileRadius <= 0 ? 1 : roundRectCover(px, py, 0, 0, 512, 512, tileRadius);
      const t = (px + py) / 1024;
      let r = lerpChannel(START[0], END[0], t);
      let g = lerpChannel(START[1], END[1], t);
      let b = lerpChannel(START[2], END[2], t);
      let a = tile;
      if (tile > 0) {
        const bubble =
          Math.max(
            roundRectCover(px, py, BUBBLE.x0, BUBBLE.y0, BUBBLE.x1, BUBBLE.y1, BUBBLE.r),
            pointInTriangle(px, py, TAIL) ? 1 : 0,
          ) * tile;
        if (bubble > 0) {
          let dot = 0;
          for (const [dx, dy] of DOTS) dot = Math.max(dot, circleCover(px, py, dx, dy, DOT_RADIUS));
          dot *= bubble;
          const wr = WHITE[0] * (1 - dot) + DOT[0] * dot;
          const wg = WHITE[1] * (1 - dot) + DOT[1] * dot;
          const wb = WHITE[2] * (1 - dot) + DOT[2] * dot;
          r = r * (1 - bubble) + wr * bubble;
          g = g * (1 - bubble) + wg * bubble;
          b = b * (1 - bubble) + wb * bubble;
        }
      }
      const i = (y * n + x) * 4;
      // Premultiplicado: el promedio del filtro debe pesar el color por su
      // cobertura para no crear halos en los bordes antialiaseados.
      grid[i] = r * a;
      grid[i + 1] = g * a;
      grid[i + 2] = b * a;
      grid[i + 3] = a * 255;
    }
  }
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const i = ((y * scale + dy) * n + (x * scale + dx)) * 4;
          r += grid[i];
          g += grid[i + 1];
          b += grid[i + 2];
          a += grid[i + 3];
        }
      }
      const o = (y * size + x) * 4;
      const am = a / 4 / 255;
      out[o] = am <= 0 ? 0 : Math.round(r / 4 / Math.max(am, 1e-6));
      out[o + 1] = am <= 0 ? 0 : Math.round(g / 4 / Math.max(am, 1e-6));
      out[o + 2] = am <= 0 ? 0 : Math.round(b / 4 / Math.max(am, 1e-6));
      out[o + 3] = Math.round(a / 4);
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return png;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const { name, size, tileRadius } of [
  { name: 'icon-192.png', size: 192, tileRadius: TILE_RADIUS },
  { name: 'icon-512.png', size: 512, tileRadius: TILE_RADIUS },
  { name: 'apple-touch-icon-180.png', size: 180, tileRadius: 0 },
]) {
  writeFileSync(join(OUT_DIR, name), encodePng(size, render(size, tileRadius)));
  console.log(`generado public/icons/${name}`);
}
