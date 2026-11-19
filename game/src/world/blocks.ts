// The blocky world: a heightfield with visible steps, not a voxel volume.

import type { Scenario } from "../format/types";
import { PATTERN, patternFor } from "./rockPattern";

/** Near the student each scenario cell is drawn as SUB x SUB blocks; far away, as one. */
export const SUB = 2;
/** Height of one terrain step of the near blocks, in metres. Far blocks step twice as high. */
export const STEP_M = 2.5;

export const COVER = { rock: 0, soil: 1, alluvium: 2, scree: 3, vegetation: 4 } as const;
export const COVER_COLOURS = [0x8d8d86, 0xb9a67c, 0xe0d8bd, 0x9a948a, 0x6f8f55];
export const DIRT_COLOUR = 0x8a7352;
export type Environment = "temperate" | "desert" | "forest";
/** Colours of rock, soil, alluvium, scree and vegetation, and of the dirt in the block sides, by environment. */
export const ENVIRONMENT_LOOK: Record<Environment, { cover: number[]; dirt: number; sky: number; fogNear: number; fogFar: number }> = {
  temperate: { cover: COVER_COLOURS, dirt: DIRT_COLOUR, sky: 0x9ec3dd, fogNear: 0.45, fogFar: 1 },
  // Pale gravel and sand, a few grey-green shrubs, a clear sky that lets the far hills show.
  desert: { cover: [0x8d8d86, 0xd2b88c, 0xe6d9b8, 0xa89a86, 0x8f8f5e], dirt: 0xb08f62, sky: 0xa9cbe6, fogNear: 0.7, fogFar: 1.25 },
  // Dark soil and forest green under a hazier sky.
  forest: { cover: [0x8d8d86, 0x7a6448, 0xc9bf9f, 0x8e8a80, 0x3d6a35], dirt: 0x5e4a33, sky: 0x9fb9c4, fogNear: 0.25, fogFar: 0.8 },
};
export const UNKNOWN_ROCK_COLOUR = 0x8d8d86;
/** Surface pattern of soil, alluvium, scree and vegetation, by cover class; rock takes its unit's. */
export const COVER_PATTERNS = [PATTERN.plain, PATTERN.soil, PATTERN.alluvium, PATTERN.scree, PATTERN.vegetation];

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
}

export function parseColour(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
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
  return {
    nx,
    ny,
    cell: cell_size_m.x,
    elevation,
    cover: scenario.cover,
    rock,
    outcrop,
    unitColours: scenario.units.map((u) => parseColour(u.colour)),
    unitPatterns: scenario.units.map((u) => patternFor(u.texture)),
    coverColours: ENVIRONMENT_LOOK[scenario.manifest.environment ?? "temperate"].cover,
    dirtColour: ENVIRONMENT_LOOK[scenario.manifest.environment ?? "temperate"].dirt,
    environment: scenario.manifest.environment ?? "temperate",
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
  return Math.round(z / stepM) * stepM;
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
