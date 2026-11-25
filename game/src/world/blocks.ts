// The blocky world: a heightfield with visible steps, not a voxel volume.

import type { Scenario } from "../format/types";
import { PATTERN, patternFor } from "./rockPattern";
import { type RiverMask, riverMask } from "./rivers";

/** Near the student each scenario cell is drawn as SUB x SUB blocks; far away, as one. */
export const SUB = 2;
/** Height of one terrain step of the near blocks, in metres. Far blocks step twice as high. */
export const STEP_M = 2.5;

/** Since format 1.5.0, `faultZone`: a strip of crushed, iron-stained rock and breccia along a fault trace. */
export const COVER = { rock: 0, soil: 1, alluvium: 2, scree: 3, vegetation: 4, faultZone: 5 } as const;
export const COVER_COLOURS = [0x8d8d86, 0xb9a67c, 0xe0d8bd, 0x9a948a, 0x6f8f55, 0xa0644a];
export const DIRT_COLOUR = 0x8a7352;
export type Environment = "temperate" | "desert" | "forest";
/** Colours of rock, soil, alluvium, scree and vegetation, and of the dirt in the block sides, by environment. */
export const ENVIRONMENT_LOOK: Record<Environment, { cover: number[]; dirt: number; sky: number; fogNear: number; fogFar: number }> = {
  temperate: { cover: COVER_COLOURS, dirt: DIRT_COLOUR, sky: 0x9ec3dd, fogNear: 0.45, fogFar: 1 },
  // Pale gravel and sand, a few grey-green shrubs, a clear sky that lets the far hills show.
  desert: { cover: [0x8d8d86, 0xd2b88c, 0xe6d9b8, 0xa89a86, 0x8f8f5e, 0xa8613f], dirt: 0xb08f62, sky: 0xa9cbe6, fogNear: 0.7, fogFar: 1.25 },
  // Dark soil and forest green under a hazier sky.
  forest: { cover: [0x8d8d86, 0x7a6448, 0xc9bf9f, 0x8e8a80, 0x3d6a35, 0x93583e], dirt: 0x5e4a33, sky: 0x9fb9c4, fogNear: 0.25, fogFar: 0.8 },
};
export const UNKNOWN_ROCK_COLOUR = 0x8d8d86;
/** Colour of the water of streams and rivers, by environment: clear and blue, greener under the forest. */
export const WATER_COLOUR: Record<Environment, number> = { temperate: 0x2b6896, desert: 0x2f73a3, forest: 0x2a6474 };
/** How far a river's surface lies below its banks, in metres: a stream, a river. */
export const RIVER_DEPTH_M = [0, 0.9, 1.4];
/** Surface pattern of soil, alluvium, scree, vegetation and fault breccia, by cover class; rock takes its unit's. */
export const COVER_PATTERNS = [PATTERN.plain, PATTERN.soil, PATTERN.alluvium, PATTERN.scree, PATTERN.vegetation, PATTERN.faultZone];

export interface Grid {
  nx: number;
  ny: number;
  cell: number;
  /** True surface elevation of each cell centre in metres. */
  elevation: Float32Array;
  cover: Uint8Array;
  /** Unit index of the rock exposed in each cell; -1 where covered or not yet known. */
  rock: Int16Array;
  /** Outcrop number (index into scenario.outcrops) per cell; -1 where there is none. */
  outcrop: Int32Array;
  unitColours: number[];
  /** Surface pattern of each unit's rock (see rockPattern.ts); plain where missing. */
  unitPatterns?: number[];
  coverColours: number[];
  dirtColour: number;
  environment: Environment;
  /**
   * Since format 1.6.0: the colour of each cell where hydrothermal alteration stains the ground, -1 elsewhere.
   * Altered outcrops take a blend of their rock's colour and the zone's; scree and soil next to them a fainter
   * one, as weathered altered rock stains the debris around it. Absent without alteration.
   */
  stain?: Int32Array;
  /**
   * Blocks broken with the hammer, as in a block game: how many steps each near block (SUB x SUB per cell,
   * index bx + nx * SUB * by) has been lowered. Absent until the first one is broken.
   */
  dug?: Uint8Array;
  /** Water in each cell: 0 dry, 1 a stream, 2 a river (see rivers.ts). Absent on hand-made grids. */
  river?: RiverMask;
}

/** How many steps deep one block can be broken down. */
export const MAX_DIG_STEPS = 4;

/** Index of the near block under model point x, y (metres from the south-west corner). */
export function blockIndex(grid: Grid, x: number, y: number): { bx: number; by: number; index: number } {
  const size = grid.cell / SUB;
  const bx = Math.min(Math.max(Math.floor(x / size), 0), grid.nx * SUB - 1);
  const by = Math.min(Math.max(Math.floor(y / size), 0), grid.ny * SUB - 1);
  return { bx, by, index: bx + grid.nx * SUB * by };
}

export function parseColour(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}

/** a toward b by t (0 to 1). */
export function blend(a: number, b: number, t: number): number {
  const ch = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t) << shift;
  return ch(16) | ch(8) | ch(0);
}

/** How strongly each intensity of alteration stains the rock. */
export const STAIN_STRENGTH = { weak: 0.3, moderate: 0.55, strong: 0.8 } as const;

/** The stain of altered outcrops on the ground, and its fainter halo on the debris around them. */
export function stainOf(scenario: Scenario, outcrop: Int32Array, rock: Int16Array, unitColours: number[], coverColours: number[]): Int32Array | undefined {
  const zones = new Map((scenario.alterations ?? []).map((a) => [a.key, parseColour(a.colour)]));
  if (!zones.size) return undefined;
  const { nx, ny } = scenario.manifest.grid;
  const stain = new Int32Array(nx * ny).fill(-1);
  const halo = new Float32Array(nx * ny);
  const haloColour = new Int32Array(nx * ny).fill(-1);
  scenario.outcrops.forEach((o, n) => {
    const seen = o.observation?.alteration;
    const colour = seen && zones.get(seen.key);
    if (colour === undefined || !seen) return;
    const strength = STAIN_STRENGTH[seen.intensity];
    for (const [ix, iy] of o.cells) {
      const i = ix + nx * iy;
      if (outcrop[i] !== n) continue;
      stain[i] = blend(rock[i]! >= 0 ? unitColours[rock[i]!]! : UNKNOWN_ROCK_COLOUR, colour, strength);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const jx = ix + dx, jy = iy + dy;
          if (jx < 0 || jy < 0 || jx >= nx || jy >= ny) continue;
          const j = jx + nx * jy, s = strength * (dx * dx + dy * dy <= 2 ? 0.45 : 0.25);
          if (s > halo[j]!) ((halo[j] = s), (haloColour[j] = colour));
        }
      }
    }
  });
  for (let i = 0; i < stain.length; i++) {
    const cover = scenario.cover[i]!;
    if (stain[i] === -1 && haloColour[i] !== -1 && (cover === COVER.scree || cover === COVER.soil || cover === COVER.alluvium)) {
      stain[i] = blend(coverColours[cover]!, haloColour[i]!, halo[i]!);
    }
  }
  return stain;
}

export function buildGrid(scenario: Scenario): Grid {
  const { nx, ny, cell_size_m } = scenario.manifest.grid;
  const { scale_m, offset_m } = scenario.manifest.terrain;
  const elevation = new Float32Array(nx * ny);
  for (let i = 0; i < elevation.length; i++) elevation[i] = offset_m + scenario.terrain[i]! * scale_m;
  const rock = new Int16Array(nx * ny).fill(-1);
  const outcrop = new Int32Array(nx * ny).fill(-1);
  const unitIndex = new Map(scenario.units.map((u, i) => [u.key, i]));
  scenario.outcrops.forEach((o, n) => {
    const unit = o.observation ? (unitIndex.get(o.observation.unit) ?? -1) : -1;
    for (const [ix, iy] of o.cells) {
      outcrop[ix + nx * iy] = n;
      rock[ix + nx * iy] = unit;
    }
  });
  const unitColours = scenario.units.map((u) => parseColour(u.colour));
  const coverColours = ENVIRONMENT_LOOK[scenario.manifest.environment ?? "temperate"].cover;
  const environment = scenario.manifest.environment ?? "temperate";
  return {
    nx,
    ny,
    cell: cell_size_m.x,
    elevation,
    cover: scenario.cover,
    rock,
    outcrop,
    stain: stainOf(scenario, outcrop, rock, unitColours, coverColours),
    unitColours,
    unitPatterns: scenario.units.map((u) => patternFor(u.texture)),
    coverColours,
    dirtColour: ENVIRONMENT_LOOK[scenario.manifest.environment ?? "temperate"].dirt,
    environment,
    river: riverMask({ nx, ny, cell: cell_size_m.x, elevation, environment }),
  };
}

/**
 * Stepped height of block (bx, by) when every cell is cut into sub x sub blocks. The true elevation is
 * interpolated between cell centres, then rounded to the step of that level of detail.
 */
export function blockHeight(grid: Grid, bx: number, by: number, sub: number): number {
  const { nx, ny, elevation } = grid;
  const u = Math.min(Math.max((bx + 0.5) / sub - 0.5, 0), nx - 1);
  const v = Math.min(Math.max((by + 0.5) / sub - 0.5, 0), ny - 1);
  const ix = Math.min(Math.floor(u), nx - 2), iy = Math.min(Math.floor(v), ny - 2);
  const fx = u - ix, fy = v - iy;
  const i = ix + nx * iy;
  const z =
    elevation[i]! * (1 - fx) * (1 - fy) + elevation[i + 1]! * fx * (1 - fy) + elevation[i + nx]! * (1 - fx) * fy + elevation[i + nx + 1]! * fx * fy;
  const stepM = (STEP_M * SUB) / sub;
  const dug = sub === SUB && grid.dug ? grid.dug[bx + nx * SUB * by]! * STEP_M : 0; // broken blocks show only up close
  const water = grid.river ? RIVER_DEPTH_M[grid.river[Math.floor(bx / sub) + nx * Math.floor(by / sub)]!]! : 0; // the bed below the banks
  return Math.round(z / stepM) * stepM - dug - water;
}

/** The true ground surface at a point, interpolated between cell centres; smooth, unlike the blocks. */
export function surfaceElevation(grid: Grid, x: number, y: number): number {
  const { nx, ny, elevation, cell } = grid;
  const u = Math.min(Math.max(x / cell - 0.5, 0), nx - 1), v = Math.min(Math.max(y / cell - 0.5, 0), ny - 1);
  const ix = Math.min(Math.floor(u), nx - 2), iy = Math.min(Math.floor(v), ny - 2);
  const fx = u - ix, fy = v - iy, i = ix + nx * iy;
  return elevation[i]! * (1 - fx) * (1 - fy) + elevation[i + 1]! * fx * (1 - fy) + elevation[i + nx]! * (1 - fx) * fy + elevation[i + nx + 1]! * fx * fy;
}

/** Height of the ground the student stands on, at a position in metres from the south-west corner. */
export function heightAt(grid: Grid, x: number, y: number): number {
  const size = grid.cell / SUB;
  const bx = Math.min(Math.max(Math.floor(x / size), 0), grid.nx * SUB - 1);
  const by = Math.min(Math.max(Math.floor(y / size), 0), grid.ny * SUB - 1);
  return blockHeight(grid, bx, by, SUB);
}

/** Deterministic value in [0, 1) for a cell, for colour variation and scattered decoration. */
export function cellHash(ix: number, iy: number, salt = 0): number {
  let h = (ix * 374761393 + iy * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
