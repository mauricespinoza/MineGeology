import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

/*
 * THE MINEGEOLOGY ICON, FROM ONE SOURCE.
 *
 * It is the FieldDraw icon (a pencil drawing a thrust fault on a simplified
 * geological map, in the colours of the international chronostratigraphic
 * chart) redrawn as a 24 x 24 block texture, like the game's world. The map
 * units are sampled from FieldDraw's own curves at the centre of each block;
 * the fault, its teeth, the dashed contact ahead of the pencil and the pencil
 * itself are drawn block by block. Corners are stepped instead of rounded.
 *
 * Writes:
 *   game/icons/favicon.svg           browser tab (crisp blocks)
 *   game/icons/icon-180/192/512.png  apple-touch-icon and the web manifest
 *
 *     node game/tools/make-icons.mjs
 */

const G = 24; // blocks per side: FieldDraw's own grid
const S = G / 24; // FieldDraw's 24 x 24 grid to ours

const COLOR = {
  jurasico: '#34b2c9',
  triasico: '#9a5ea8',
  cretacico: '#8fd16a',
  neogeno: '#ffe619',
  tinta: '#111827',
  lapiz: '#ef4444',
  lapizSombra: '#c81e1e',
  madera: '#f1d6ac',
  mina: '#1f2937',
  virola: '#cbd5e1',
  goma: '#fda4af',
};

/* ------------------------------------------------------------ geometry */

function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

/** A polygon from a list of segments: points and cubics, in FieldDraw units. */
function polygon(parts) {
  const pts = [];
  for (const part of parts) {
    if (part.length === 2) pts.push(part);
    else {
      const p0 = pts[pts.length - 1];
      for (let i = 1; i <= 40; i++) pts.push(cubic(p0, part[0], part[1], part[2], i / 40));
    }
  }
  return pts.map(([x, y]) => [x * S, y * S]);
}

function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// FieldDraw's fault and contact, a little flatter near the point so that a
// 45-degree pencil does not line up with the end of the fault.
const PUNTA = [12.6, 12.4];
const FALLA = [[-1, 20.2], [4.6, 19.2], [8.4, 14.6], PUNTA];
const DELANTE = [PUNTA, [16.4, 10.6], [20.5, 9.6], [25, 9.2]];

const UNITS = [
  [COLOR.jurasico, polygon([[-1, -1], [15.2, -1], [[12.6, 3.6], [8.6, 8], [6.4, 16.4]], [-1, 20]])],
  [COLOR.cretacico, polygon([FALLA[0], FALLA.slice(1), DELANTE.slice(1), [25, 25], [-1, 25]])],
  [COLOR.neogeno, polygon([[25, 13.2], [[20.6, 13.6], [16.4, 16.6], [13.6, 25]], [25, 25]])],
];

/* -------------------------------------------------------------- blocks */

// grid[y][x] = { color, noise } or null (transparent)
const grid = Array.from({ length: G }, () => Array(G).fill(null));
const set = (x, y, color, noise = 0.07) => {
  if (x >= 0 && y >= 0 && x < G && y < G) grid[y][x] = { color, noise };
};

// Stepped corners: the blocks a radius-5.5 rounded tile, like FieldDraw's, would mostly leave out.
const CUT = [4, 2, 1, 1]; // blocks removed on rows 0 to 3 from each corner
const cut = (x, y) => {
  const r = Math.min(y, G - 1 - y), c = Math.min(x, G - 1 - x);
  return r < CUT.length && c < CUT[r];
};

// The map.
for (let y = 0; y < G; y++)
  for (let x = 0; x < G; x++) {
    if (cut(x, y)) continue;
    let color = COLOR.triasico;
    for (const [c, poly] of UNITS) if (inside(poly, x + 0.5, y + 0.5)) color = c;
    set(x, y, color);
  }

// Thin contacts: a darker shade on the blocks that touch another unit,
// except where the fault will go.
const shade = (hex, f) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * f).toString(16).padStart(2, '0')).join('');
const base = grid.map((row) => row.map((b) => b && b.color));
for (let y = 0; y < G; y++)
  for (let x = 0; x < G; x++) {
    const c = base[y][x];
    if (!c) continue;
    const other = [[1, 0], [0, 1]].some(([dx, dy]) => {
      const n = base[y + dy]?.[x + dx];
      return n && n !== c && n !== COLOR.cretacico;
    });
    if (other && c !== COLOR.cretacico) set(x, y, shade(c, 0.78));
  }

// The fault: a one-block line of ink blocks along FieldDraw's curve.
const scaled = (P) => P.map(([x, y]) => [x * S, y * S]);
const F = scaled(FALLA);
// One block per column (the fault is flatter than 45 degrees), so the line
// steps diagonally instead of filling the corners.
const faultCells = [];
for (let x = 0; x <= Math.floor(F[3][0]); x++) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (cubic(...F, mid)[0] < x + 0.5) lo = mid; else hi = mid;
  }
  faultCells.push([x, Math.floor(cubic(...F, lo)[1])]);
}
for (const [x, y] of faultCells) if (!cut(x, y)) set(x, y, COLOR.tinta, 0.04);

// Teeth on the hanging wall (above the line): two-block spikes with a
// one-block foot, every four columns.
for (const x of [2, 6, 10]) {
  const y = faultCells[x][1];
  for (const [dx, dy] of [[0, -1], [0, -2], [-1, -1]]) if (!cut(x + dx, y + dy)) set(x + dx, y + dy, COLOR.tinta, 0.04);
}

// The contact still to be drawn, ahead of the pencil: dashed, half dark.
const D = scaled(DELANTE);
const seen = new Set();
let k = 0;
for (let i = 0; i <= 400; i++) {
  const [x, y] = cubic(...D, i / 400);
  const key = `${Math.floor(x)},${Math.floor(y)}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const [cx, cy] = key.split(',').map(Number);
  if (k++ % 2 === 1 && grid[cy]?.[cx] && !cut(cx, cy)) set(cx, cy, shade(COLOR.cretacico, 0.62));
}

// The pencil, at 45 degrees, its point on the end of the fault. In the
// diagonal frame u runs along the pencil (0 at the point) and v across it.
const [px, py] = faultCells[faultCells.length - 1].map((v, i) => v + (i ? -1 : 1));
const pencil = new Map();
for (let y = -2; y < G + 2; y++)
  for (let x = -2; x < G + 2; x++) {
    const u = (x - px) + (py - y), v = (x - px) - (py - y);
    if (u < 0 || Math.abs(v) > 2 || u > 16) continue;
    if (Math.abs(v) === 2 && u < 4) continue; // the cone of the point
    if (u === 0 && v !== 0) continue;
    let color;
    if (u <= 1) color = COLOR.mina;
    else if (u <= 5) color = COLOR.madera;
    else if (u <= 12) color = v > 0 ? COLOR.lapizSombra : COLOR.lapiz;
    else if (u <= 14) color = COLOR.virola;
    else color = COLOR.goma;
    pencil.set(`${x},${y}`, color);
  }
const outline = new Set();
for (const key of pencil.keys()) {
  const [x, y] = key.split(',').map(Number);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = `${x + dx},${y + dy}`;
    if (!pencil.has(n)) outline.add(n);
  }
}
for (const key of outline) {
  const [x, y] = key.split(',').map(Number);
  // The outline may leave the stepped corner, as FieldDraw's pencil leaves
  // the rounded tile; it never leaves the square.
  set(x, y, COLOR.tinta, 0);
}
for (const [key, color] of pencil) {
  const [x, y] = key.split(',').map(Number);
  set(x, y, color, 0.03);
}

/* --------------------------------------------------- texture and colour */

// Deterministic per-block brightness, the speckle of a block texture.
function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const pixels = grid.map((row, y) =>
  row.map((b, x) => {
    if (!b) return null;
    const f = 1 + (hash(x, y) * 2 - 1) * b.noise;
    return rgb(b.color).map((c) => Math.max(0, Math.min(255, Math.round(c * f))));
  }),
);

/* ------------------------------------------------------------------ SVG */

const hexOf = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
let rects = '';
for (let y = 0; y < G; y++) {
  let x = 0;
  while (x < G) {
    const c = pixels[y][x];
    if (!c) { x++; continue; }
    let w = 1;
    while (x + w < G && pixels[y][x + w] && hexOf(pixels[y][x + w]) === hexOf(c)) w++;
    rects += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${hexOf(c)}"/>`;
    x += w;
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${G} ${G}" width="${G}" height="${G}" shape-rendering="crispEdges">
<!-- GENERATED BY game/tools/make-icons.mjs: do not edit by hand. The FieldDraw icon (a pencil drawing a thrust fault on a geological map) as a ${G} x ${G} block texture. -->
<title>MineGeology</title>
${rects}
</svg>
`;

/* ------------------------------------------------------------------ PNG */

function raster(size) {
  const SS = 8;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const gx = Math.floor(((x + (sx + 0.5) / SS) / size) * G);
          const gy = Math.floor(((y + (sy + 0.5) / SS) / size) * G);
          const c = pixels[gy][gx];
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a++;
        }
      const o = (y * size + x) * 4;
      if (a) { buf[o] = Math.round(r / a); buf[o + 1] = Math.round(g / a); buf[o + 2] = Math.round(b / a); }
      buf[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  return buf;
}

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------- output */

const outDir = new URL('../icons/', import.meta.url);
mkdirSync(outDir, { recursive: true });
writeFileSync(new URL('favicon.svg', outDir), svg);
console.log('game/icons/favicon.svg');
for (const size of [180, 192, 512]) {
  const out = png(size, raster(size));
  writeFileSync(new URL(`icon-${size}.png`, outDir), out);
  console.log(`game/icons/icon-${size}.png  ${out.length} B`);
}
