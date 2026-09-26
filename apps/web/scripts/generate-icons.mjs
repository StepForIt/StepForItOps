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
/*
 * Le signe StepForIt Ops (charte du 2026-09-26, référence : StepForIt/video-studio,
 * `brand/mark-night.svg`), en unités 0..100 comme le SVG. Peint par calques, du fond
 * vers la comète : chaque calque a sa couleur et son opacité, composées « par-dessus ».
 */
const NUIT = [6, 24, 45];
const LAGON = [4, 178, 173];
const AMBRE = [245, 179, 1];
const SS = 4; // suréchantillonnage

/** Distance d'un point au segment [a, b], et la position t du projeté (0 = a, 1 = b). */
function toSegment(x, y, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.min(Math.max(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy), 0), 1);
  return { d: Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)), t };
}

function insideRoundedSquare(x, y, min, max, radius) {
  if (x < min || x > max || y < min || y > max) return false;
  const cx = Math.min(Math.max(x, min + radius), max - radius);
  const cy = Math.min(Math.max(y, min + radius), max - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

const P = (x, y) => ({ x, y });

/** Les calques du signe, épuré (`compact`) ou complet. */
function layers(compact) {
  const link = compact ? 6 : 3.5;
  const out = compact ? 7 : 5;
  const main = compact ? 10 : 8;
  const segs = [
    [P(36, 74), P(20, 34)],
    [P(64, 26), P(80, 66)],
    ...(compact
      ? []
      : [
          [P(20, 34), P(40, 22)],
          [P(80, 66), P(60, 78)],
        ]),
  ];
  return [
    ...segs.map(([a, b]) => ({ kind: 'seg', a, b, w: link, color: LAGON, alpha: 0.45 })),
    { kind: 'dot', c: P(20, 34), r: out, color: LAGON, alpha: 0.8 },
    { kind: 'dot', c: P(80, 66), r: out, color: LAGON, alpha: 0.8 },
    ...(compact
      ? []
      : [
          { kind: 'dot', c: P(40, 22), r: 4.5, color: LAGON, alpha: 0.6 },
          { kind: 'dot', c: P(60, 78), r: 4.5, color: LAGON, alpha: 0.6 },
        ]),
    { kind: 'dot', c: P(36, 74), r: main, color: LAGON, alpha: 1 },
    { kind: 'dot', c: P(64, 26), r: main, color: LAGON, alpha: 1 },
    // La traîne : opacité qui monte de 0 à 0,95 vers la tête.
    { kind: 'trail', a: P(43, 62.5), b: P(58, 37), w: compact ? 9 : 7, color: AMBRE },
    { kind: 'dot', c: P(58, 37), r: compact ? 8.5 : 6.6, color: AMBRE, alpha: 1 },
  ];
}

function over(dst, color, alpha) {
  const a = alpha + dst[3] * (1 - alpha);
  if (a === 0) return [0, 0, 0, 0];
  return [
    (color[0] * alpha + dst[0] * dst[3] * (1 - alpha)) / a,
    (color[1] * alpha + dst[1] * dst[3] * (1 - alpha)) / a,
    (color[2] * alpha + dst[2] * dst[3] * (1 - alpha)) / a,
    a,
  ];
}

/**
 * Couleur RGBA du point (u, v) ∈ [0,1]².
 * `fullBleed` (maskable, iOS) : le fond nuit couvre tout le carré, le système découpe
 * lui-même, et le signe est resserré dans la zone sûre centrale.
 */
function sample(u, v, { fullBleed, compact }) {
  let px = [0, 0, 0, 0];
  const x = u * 100;
  const y = v * 100;
  if (fullBleed) px = over(px, NUIT, 1);
  else if (insideRoundedSquare(x, y, 1.5, 98.5, 23)) px = over(px, NUIT, 1);
  else return px;
  // Le liseré de la version épurée : sans lui, le signe se perd dans un onglet sombre.
  if (compact && !fullBleed && !insideRoundedSquare(x, y, 5.5, 94.5, 19)) px = over(px, LAGON, 0.55);
  const scale = fullBleed ? 0.78 : 1;
  const mx = 50 + (x - 50) / scale;
  const my = 50 + (y - 50) / scale;
  for (const l of layers(compact)) {
    if (l.kind === 'dot') {
      if (Math.hypot(mx - l.c.x, my - l.c.y) <= l.r) px = over(px, l.color, l.alpha);
    } else {
      const { d, t } = toSegment(mx, my, l.a, l.b);
      if (d <= l.w / 2) px = over(px, l.color, l.kind === 'trail' ? 0.95 * t : l.alpha);
    }
  }
  return px;
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
          const c = sample((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, options);
          r += c[0] * c[3];
          g += c[1] * c[3];
          b += c[2] * c[3];
          a += c[3];
        }
      }
      const offset = (py * size + px) * 4;
      if (a > 0) {
        pixels[offset] = Math.round(r / a);
        pixels[offset + 1] = Math.round(g / a);
        pixels[offset + 2] = Math.round(b / a);
      }
      pixels[offset + 3] = Math.round((a / (SS * SS)) * 255);
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
  { file: 'icon-192.png', size: 192, fullBleed: false, compact: false },
  { file: 'icon-512.png', size: 512, fullBleed: false, compact: false },
  { file: 'icon-maskable-512.png', size: 512, fullBleed: true, compact: false },
  // iOS ignore le manifeste : son icône d'écran d'accueil vient de ce lien.
  { file: 'apple-touch-icon.png', size: 180, fullBleed: true, compact: false },
  // L'onglet du navigateur : la version épurée, seule lisible à cette taille.
  { file: 'favicon-32.png', size: 32, fullBleed: false, compact: true },
];

for (const { file, size, ...options } of TARGETS) {
  writeFileSync(join(OUT_DIR, file), toPng(size, render(size, options)));
  console.log(`${file} (${size}px)`);
}
