/**
 * Generates the PWA icons and the OG image from the FitMacro design tokens.
 *
 * Written as a dependency-free PNG encoder (zlib is in Node core) so the repo does not
 * carry binary blobs whose provenance nobody can check, and so the icons regenerate
 * from the tokens if the palette ever changes.
 *
 * Run: node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = resolve(ROOT, 'public');

// Design tokens — must stay in sync with src/index.css.
const BLACK = [0x0b, 0x0b, 0x0a];
const GOLD = [0xd4, 0xaf, 0x37];
const GOLD_LIGHT = [0xf0, 0xd8, 0x78];
const GOLD_DIM = [0x8a, 0x72, 0x24];
const INK = [0x17, 0x13, 0x05];

/**
 * 5x7 bitmap glyphs for the wordmark. Any character used in text() must exist here —
 * a missing glyph renders as a gap (see assertGlyphs below, which fails the build
 * rather than shipping "TRAC R").
 */
const GLYPHS = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['111', '010', '010', '010', '010', '010', '111'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  ' ': ['000', '000', '000', '000', '000', '000', '000'],
};

/** Fails loudly instead of silently rendering a gap for an unknown character. */
function assertGlyphs(word) {
  const missing = [...word].filter((char) => !GLYPHS[char]);
  if (missing.length > 0) {
    throw new Error(`No glyph for ${JSON.stringify(missing.join(''))} in "${word}"`);
  }
}

class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }

  set(x, y, [r, g, b], alpha = 255) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    if (alpha === 255) {
      this.data[i] = r;
      this.data[i + 1] = g;
      this.data[i + 2] = b;
      this.data[i + 3] = 255;
      return;
    }
    // Source-over blend against what is already there.
    const a = alpha / 255;
    this.data[i] = Math.round(r * a + this.data[i] * (1 - a));
    this.data[i + 1] = Math.round(g * a + this.data[i + 1] * (1 - a));
    this.data[i + 2] = Math.round(b * a + this.data[i + 2] * (1 - a));
    this.data[i + 3] = 255;
  }

  fill(color) {
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) this.set(x, y, color);
    }
  }

  /** Rounded rect with a diagonal gradient and lightly anti-aliased corners. */
  roundedRect(x0, y0, w, h, radius, from, to) {
    for (let y = y0; y < y0 + h; y += 1) {
      for (let x = x0; x < x0 + w; x += 1) {
        const coverage = roundedCoverage(x - x0, y - y0, w, h, radius);
        if (coverage <= 0) continue;

        const t = (x - x0 + (y - y0)) / (w + h);
        const color = [
          Math.round(from[0] + (to[0] - from[0]) * t),
          Math.round(from[1] + (to[1] - from[1]) * t),
          Math.round(from[2] + (to[2] - from[2]) * t),
        ];
        this.set(x, y, color, Math.round(coverage * 255));
      }
    }
  }

  text(word, x, y, scale, color, spacing = 1) {
    assertGlyphs(word);
    let cursor = x;
    for (const char of word) {
      const glyph = GLYPHS[char];
      for (let row = 0; row < glyph.length; row += 1) {
        for (let col = 0; col < glyph[row].length; col += 1) {
          if (glyph[row][col] !== '1') continue;
          for (let dy = 0; dy < scale; dy += 1) {
            for (let dx = 0; dx < scale; dx += 1) {
              this.set(cursor + col * scale + dx, y + row * scale + dy, color);
            }
          }
        }
      }
      cursor += (glyph[0].length + spacing) * scale;
    }
    return cursor;
  }

  toPNG() {
    const raw = Buffer.alloc((this.width * 4 + 1) * this.height);
    let offset = 0;
    for (let y = 0; y < this.height; y += 1) {
      raw[offset] = 0; // filter: none
      offset += 1;
      for (let x = 0; x < this.width; x += 1) {
        const i = (y * this.width + x) * 4;
        raw[offset] = this.data[i];
        raw[offset + 1] = this.data[i + 1];
        raw[offset + 2] = this.data[i + 2];
        raw[offset + 3] = this.data[i + 3];
        offset += 4;
      }
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // colour type: RGBA
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

/** Anti-aliased coverage for a rounded rectangle, 0..1. */
function roundedCoverage(x, y, w, h, radius) {
  const cx = Math.min(Math.max(x, radius), w - radius);
  const cy = Math.min(Math.max(y, radius), h - radius);
  const distance = Math.hypot(x - cx, y - cy);
  if (distance <= radius - 1) return 1;
  if (distance >= radius) return 0;
  return radius - distance;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed) >>> 0, 0);
  return Buffer.concat([length, typed, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return crc ^ -1;
}

function makeIcon(size) {
  const canvas = new Canvas(size, size);
  canvas.fill(BLACK);

  const pad = Math.round(size * 0.11);
  const box = size - pad * 2;
  canvas.roundedRect(pad, pad, box, box, Math.round(box * 0.22), GOLD_LIGHT, GOLD_DIM);

  // "FM" centred on the gold tile.
  const scale = Math.max(1, Math.round(size / 18));
  const width = (5 + 1 + 5) * scale;
  canvas.text('FM', Math.round((size - width) / 2), Math.round((size - 7 * scale) / 2), scale, INK);

  return canvas.toPNG();
}

function makeOgImage() {
  const canvas = new Canvas(1200, 630);
  canvas.fill(BLACK);

  // Ambient gold wash from the top, mirroring the app's radial background.
  for (let y = 0; y < 630; y += 1) {
    for (let x = 0; x < 1200; x += 1) {
      const dx = (x - 600) / 700;
      const dy = (y + 60) / 500;
      const glow = Math.max(0, 1 - Math.hypot(dx, dy));
      if (glow > 0) canvas.set(x, y, GOLD, Math.round(glow * 26));
    }
  }

  const tile = 132;
  canvas.roundedRect(96, 96, tile, tile, 30, GOLD_LIGHT, GOLD_DIM);
  canvas.text('FM', 96 + 26, 96 + 38, 8, INK);

  canvas.text('FITMACRO', 96, 300, 12, [0xf7, 0xf5, 0xf0]);
  canvas.text('MACRO TRACKER', 96, 420, 5, GOLD);

  return canvas.toPNG();
}

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f0d878"/>
      <stop offset="0.55" stop-color="#d4af37"/>
      <stop offset="1" stop-color="#8a7224"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="#0b0b0a"/>
  <rect x="7" y="7" width="50" height="50" rx="13" fill="url(#g)"/>
  <path d="M18 44V20h13v5h-8v5h7v5h-7v9z" fill="#171305"/>
  <path d="M36 44V20h5l4 8 4-8h5v24h-5V31l-4 7-4-7v13z" fill="#171305"/>
</svg>
`;

mkdirSync(PUBLIC_DIR, { recursive: true });

writeFileSync(resolve(PUBLIC_DIR, 'pwa-192.png'), makeIcon(192));
writeFileSync(resolve(PUBLIC_DIR, 'pwa-512.png'), makeIcon(512));
writeFileSync(resolve(PUBLIC_DIR, 'apple-touch-icon.png'), makeIcon(180));
writeFileSync(resolve(PUBLIC_DIR, 'og-image.png'), makeOgImage());
writeFileSync(resolve(PUBLIC_DIR, 'favicon.svg'), FAVICON);

console.log('Generated: pwa-192.png, pwa-512.png, apple-touch-icon.png, og-image.png, favicon.svg');
