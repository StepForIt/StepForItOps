/**
 * Génère les icônes PWA (PNG) à partir d'une seule description de forme.
 *
 * Aucun rasteriseur n'est disponible côté build (ni sharp, ni librsvg) et une
 * icône PWA doit être du PNG : Chrome n'accepte pas un SVG pour l'installation
 * sur toutes les plateformes. Le rendu est donc fait ici, en pur Node (zlib),
 * avec un suréchantillonnage 4x pour les bords.
 *
 * Usage : node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const BLUE = [22, 119, 255]; // colorPrimary du thème Refine Blue
const WHITE = [255, 255, 255];
const SS = 4; // suréchantillonnage

/** Marque : trois nœuds reliés (un déclencheur, deux branches), en unités 0..1. */
const NODES = [
  { x: 0.28, y: 0.5, r: 0.085 },
  { x: 0.72, y: 0.3, r: 0.085 },
  { x: 0.72, y: 0.7, r: 0.085 },
];
const EDGES = [
  [NODES[0], NODES[1]],
  [NODES[0], NODES[2]],
];
const STROKE = 0.035;

function insideRoundedSquare(x, y, inset, radius) {
  const min = inset;
  const max = 1 - inset;
  if (x < min || x > max || y < min || y > max) return false;
  const cx = Math.min(Math.max(x, min + radius), max - radius);
  const cy = Math.min(Math.max(y, min + radius), max - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function onSegment(x, y, a, b, width) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.min(Math.max(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy), 0), 1);
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return (x - px) ** 2 + (y - py) ** 2 <= (width / 2) ** 2;
}

/** Couleur du point (u, v) ∈ [0,1]² — null = transparent. */
function sample(u, v, { maskable }) {
  // Maskable : le fond couvre tout le carré (le système découpe lui-même),
  // et la marque est resserrée dans la « safe zone » centrale (80 %).
  const inset = maskable ? 0 : 0.04;
  const radius = maskable ? 0 : 0.19;
  if (!maskable && !insideRoundedSquare(u, v, inset, radius)) return null;
  const scale = maskable ? 0.8 : 1;
  const x = 0.5 + (u - 0.5) / scale;
  const y = 0.5 + (v - 0.5) / scale;
  const mark =
    NODES.some((n) => (x - n.x) ** 2 + (y - n.y) ** 2 <= n.r ** 2) ||
    EDGES.some(([a, b]) => onSegment(x, y, a, b, STROKE));
  return mark ? WHITE : BLUE;
}

function render(size, options) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const color = sample((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, options);
          if (!color) continue;
          r += color[0];
          g += color[1];
          b += color[2];
          a += 255;
        }
      }
      const covered = a / 255;
      const offset = (py * size + px) * 4;
      if (covered > 0) {
        pixels[offset] = Math.round(r / covered);
        pixels[offset + 1] = Math.round(g / covered);
        pixels[offset + 2] = Math.round(b / covered);
      }
      pixels[offset + 3] = Math.round(a / (SS * SS));
    }
  }
  return pixels;
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

function toPng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 bits par canal
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filtre « None »
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const TARGETS = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  // iOS ignore le manifeste : son icône d'écran d'accueil vient de ce lien.
  { file: 'apple-touch-icon.png', size: 180, maskable: true },
];

for (const { file, size, maskable } of TARGETS) {
  writeFileSync(join(OUT_DIR, file), toPng(size, render(size, { maskable })));
  console.log(`${file} (${size}px)`);
}
