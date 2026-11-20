// Surfaces for the figure, the hand and the hammer: small procedural textures, drawn once on a canvas, that give
// cloth its weave, leather its grain, rubber its ridges, steel its brushed streaks and skin a soft unevenness.
// The textures are grey, near white, so each part keeps the colour the student chose; they only add the detail.

import * as THREE from "three";

export type SurfaceKind = "cloth" | "denim" | "canvas" | "leather" | "rubber" | "steel" | "skin" | "hair" | "plastic" | "felt";

const SIZE = 128;
const cache = new Map<SurfaceKind, THREE.CanvasTexture | null>();

/** Deterministic pseudo-random numbers, so the textures are the same on every visit. */
function random(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) ^ Math.imul(s ^ (s >>> 13), 3266489917)), ((s ^= s >>> 16) >>> 0) / 4294967296);
}

/** Smooth value noise in [0, 1) that tiles over the texture, `cells` lattice cells across. */
function noise(cells: number, seed: number): (x: number, y: number) => number {
  const r = random(seed);
  const lattice = Array.from({ length: cells * cells }, () => r());
  const at = (i: number, j: number) => lattice[((j + cells) % cells) * cells + ((i + cells) % cells)]!;
  return (x, y) => {
    const u = (x / SIZE) * cells, v = (y / SIZE) * cells;
    const i = Math.floor(u), j = Math.floor(v), fx = u - i, fy = v - j;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return (at(i, j) * (1 - sx) + at(i + 1, j) * sx) * (1 - sy) + (at(i, j + 1) * (1 - sx) + at(i + 1, j + 1) * sx) * sy;
  };
}

/** Brightness (0 to 255) of each texel of a surface. */
function shade(kind: SurfaceKind): (x: number, y: number) => number {
  const grain = random(kind.length * 7919 + kind.charCodeAt(0));
  const fine = () => grain() - 0.5;
  const soft = noise(8, 11), mid = noise(16, 23), big = noise(4, 37);
  switch (kind) {
    case "cloth": // a fine twill: thin diagonal ribs and a little fuzz
      return (x, y) => 222 + 14 * Math.sin(((x + y) / SIZE) * Math.PI * 2 * 24) + 10 * fine() + 12 * (soft(x, y) - 0.5);
    case "denim": // a coarser, more marked twill, with fading
      return (x, y) => 206 + 22 * Math.sin(((x + 2 * y) / SIZE) * Math.PI * 2 * 20) + 14 * fine() + 26 * (big(x, y) - 0.5);
    case "canvas": // a plain weave: threads over and under in a grid
      return (x, y) => {
        const over = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0;
        const thread = over ? Math.sin(((x % 4) / 4) * Math.PI) : Math.sin(((y % 4) / 4) * Math.PI);
        return 200 + 34 * thread + 10 * fine() + 16 * (soft(x, y) - 0.5);
      };
    case "leather": // pebbled grain, darker creases and worn patches
      return (x, y) => {
        const pebble = mid(x, y), crease = Math.abs(soft(x * 1.7, y) - 0.5) < 0.03 ? -40 : 0;
        return 196 + 40 * (pebble - 0.5) + 30 * (big(x, y) - 0.5) + crease + 8 * fine();
      };
    case "rubber": // the grooves of a grip, across the handle
      return (x, y) => 206 + 40 * Math.sin((y / SIZE) * Math.PI * 2 * 10) ** 7 + 8 * fine() - 12 * (mid(x, y) - 0.5);
    case "steel": // brushed lengthwise: long fine streaks, a few scratches
      return (x, y) => {
        const streak = Math.sin(y * 1.9 + 3 * Math.sin(y * 0.37)) * 9 + 14 * (noise(32, 41)(x * 0.06, y) - 0.5);
        const scratch = grain() < 0.004 ? 30 : 0;
        return 214 + streak + 10 * (big(x, y) - 0.5) + scratch + 5 * fine();
      };
    case "skin": // nearly even, with soft blotches and pores
      return (x, y) => 240 + 9 * (soft(x, y) - 0.5) + 6 * (mid(x, y) - 0.5) + 4 * fine();
    case "hair": // strands along the length
      return (x, y) => 214 + 30 * (noise(32, 53)(x, y * 0.08) - 0.5) + 18 * Math.sin(x * 2.3 + 4 * soft(x, y)) * 0.6 + 10 * fine();
    case "plastic": // a moulded helmet: smooth, faint speckle and scuffs
      return (x, y) => 242 + 6 * (soft(x, y) - 0.5) + 4 * fine() - (grain() < 0.003 ? 24 : 0);
    case "felt": // a felt hat: short fibres in every direction
      return (x, y) => 222 + 20 * (mid(x, y) - 0.5) + 16 * fine() + 10 * (big(x, y) - 0.5);
  }
}

/** The texture of a surface, drawn once; null where there is no canvas (in tests). */
function texture(kind: SurfaceKind): THREE.CanvasTexture | null {
  if (cache.has(kind)) return cache.get(kind)!;
  let out: THREE.CanvasTexture | null = null;
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const image = ctx.createImageData(SIZE, SIZE), f = shade(kind);
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const v = Math.max(0, Math.min(255, Math.round(f(x, y)))), o = (x + SIZE * y) * 4;
          image.data[o] = image.data[o + 1] = image.data[o + 2] = v;
          image.data[o + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
      out = new THREE.CanvasTexture(canvas);
      out.wrapS = out.wrapT = THREE.RepeatWrapping;
      out.colorSpace = THREE.SRGBColorSpace;
      out.anisotropy = 4;
    }
  }
  cache.set(kind, out);
  return out;
}

/**
 * A material for a part of the figure: its colour, the detail of its surface repeated `u` x `v` times over each
 * face, and the shine of what it is made of.
 */
export function surfaceMaterial(kind: SurfaceKind, colour: THREE.ColorRepresentation, u = 1, v = 1): THREE.Material {
  const base = texture(kind);
  const map = base ? base.clone() : null;
  if (map) {
    map.repeat.set(Math.max(1, Math.round(u)), Math.max(1, Math.round(v)));
    map.needsUpdate = true;
  }
  const textures = map ? { map, ...(kind !== "skin" && kind !== "plastic" ? { bumpMap: map } : {}) } : {};
  if (kind === "steel") return new THREE.MeshPhongMaterial({ color: colour, ...textures, bumpScale: 0.4, specular: 0xb4bac0, shininess: 80 });
  if (kind === "plastic" || kind === "rubber" || kind === "leather")
    return new THREE.MeshPhongMaterial({ color: colour, ...textures, bumpScale: 0.6, specular: kind === "plastic" ? 0x555555 : 0x2a2a2a, shininess: kind === "plastic" ? 45 : 18 });
  return new THREE.MeshLambertMaterial({ color: colour, ...textures, bumpScale: 0.8 });
}
