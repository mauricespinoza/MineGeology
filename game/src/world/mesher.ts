// Turns one chunk of the heightfield into triangles. Pure: it runs in a worker and in tests.
// World axes follow three.js: x east, y up, z south (so north is -z).

import { COVER, COVER_COLOURS, COVER_PATTERNS, DIRT_COLOUR, type Grid, UNKNOWN_ROCK_COLOUR, blockHeight, cellHash } from "./blocks";
import { treeAt } from "./treeplaces";

/** Chunk size in scenario cells. */
export const CHUNK = 32;
const SKIRT_M = 30;

export interface ChunkMesh {
  positions: Float32Array;
  normals: Float32Array;
  colours: Float32Array;
  /** Surface pattern of each vertex (see rockPattern.ts). */
  patterns: Float32Array;
  indices: Uint32Array;
}

class Builder {
  positions: number[] = [];
  normals: number[] = [];
  colours: number[] = [];
  patterns: number[] = [];
  indices: number[] = [];

  /** A quad a-b-c-d (any winding) that must face along `normal`. */
  quad(a: number[], b: number[], c: number[], d: number[], normal: [number, number, number], colour: number, shade = 1, pattern = 0): void {
    const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
    const vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
    const facing = (uy * vz - uz * vy) * normal[0] + (uz * vx - ux * vz) * normal[1] + (ux * vy - uy * vx) * normal[2];
    const corners = facing >= 0 ? [a, b, c, d] : [a, d, c, b];
    const base = this.positions.length / 3;
    const r = (((colour >> 16) & 255) / 255) * shade, g = (((colour >> 8) & 255) / 255) * shade, bl = ((colour & 255) / 255) * shade;
    for (const p of corners) {
      this.positions.push(p[0]!, p[1]!, p[2]!);
      this.normals.push(normal[0], normal[1], normal[2]);
      this.colours.push(r, g, bl);
      this.patterns.push(pattern);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** An axis-aligned box standing on y0, for bushes. */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, colour: number, pattern = 0): void {
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], colour, 1, pattern);
    this.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [1, 0, 0], colour, 0.85, pattern);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], colour, 0.85, pattern);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], colour, 0.75, pattern);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1], colour, 0.75, pattern);
  }

  finish(): ChunkMesh {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colours: new Float32Array(this.colours),
      patterns: new Float32Array(this.patterns),
      indices: new Uint32Array(this.indices),
    };
  }
}

/** Halfway between two colours. */
export function mix(a: number, b: number): number {
  const half = (shift: number) => ((((a >> shift) & 255) + ((b >> shift) & 255)) >> 1) << shift;
  return half(16) | half(8) | half(0);
}

/** Surface pattern of a cell: its cover's, or its rock's where the rock is bare. */
export function topPattern(grid: Grid, ix: number, iy: number): number {
  const i = ix + grid.nx * iy;
  const cover = grid.cover[i]!;
  if (cover !== COVER.rock) return COVER_PATTERNS[cover] ?? 0;
  const unit = grid.rock[i]!;
  return unit >= 0 ? (grid.unitPatterns?.[unit] ?? 0) : COVER_PATTERNS[COVER.scree]!;
}

export function topColour(grid: Grid, ix: number, iy: number): number {
  const i = ix + grid.nx * iy;
  const stain = grid.stain?.[i] ?? -1;
  if (stain >= 0) return stain;
  const cover = grid.cover[i]!;
  const colours = grid.coverColours ?? COVER_COLOURS;
  if (cover !== COVER.rock) return colours[cover] ?? colours[COVER.soil]!;
  const unit = grid.rock[i]!;
  return unit >= 0 ? grid.unitColours[unit]! : UNKNOWN_ROCK_COLOUR;
}

/**
 * Mesh of the cells [cx0, cx0 + CHUNK) x [cy0, cy0 + CHUNK), clipped to the grid, with each cell drawn
 * as sub x sub blocks.
 */
export function buildChunk(grid: Grid, cx0: number, cy0: number, sub: number): ChunkMesh {
  const { nx, ny } = grid;
  const size = grid.cell / sub;
  const bx0 = cx0 * sub, by0 = cy0 * sub;
  const bx1 = Math.min(cx0 + CHUNK, nx) * sub, by1 = Math.min(cy0 + CHUNK, ny) * sub;
  const out = new Builder();
  if (bx1 <= bx0 || by1 <= by0) return out.finish(); // the chunk lies outside the grid
  // Heights of the chunk's blocks and of one ring around it, for the side faces.
  const w = bx1 - bx0 + 2;
  const heights = new Float32Array(w * (by1 - by0 + 2));
  for (let by = by0 - 1; by <= by1; by++) {
    for (let bx = bx0 - 1; bx <= bx1; bx++) {
      const inside = bx >= 0 && bx < nx * sub && by >= 0 && by < ny * sub;
      heights[bx - bx0 + 1 + w * (by - by0 + 1)] = inside ? blockHeight(grid, bx, by, sub) : Number.NaN;
    }
  }
  const sides: [number, number, [number, number, number]][] = [
    [1, 0, [1, 0, 0]],
    [-1, 0, [-1, 0, 0]],
    [0, 1, [0, 0, -1]], // north is -z
    [0, -1, [0, 0, 1]],
  ];
  for (let by = by0; by < by1; by++) {
    for (let bx = bx0; bx < bx1; bx++) {
      const ix = Math.floor(bx / sub), iy = Math.floor(by / sub);
      const i = ix + nx * iy;
      const k = bx - bx0 + 1 + w * (by - by0 + 1);
      const h = heights[k]!;
      const x0 = bx * size, x1 = x0 + size;
      const z0 = -by * size, z1 = z0 - size; // z0 south edge, z1 north edge
      const tree = treeAt(grid, ix, iy);
      // The ground under a crown lies in its shade.
      const shade = (0.93 + 0.14 * cellHash(bx, by, sub)) * (tree ? 0.74 : 1);
      const top = topColour(grid, ix, iy), pattern = topPattern(grid, ix, iy);
      out.quad([x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1], [0, 1, 0], top, shade, pattern);

      const cover = grid.cover[i]!;
      const bare = cover === COVER.rock || cover === COVER.alluvium || cover === COVER.faultZone;
      const wall = bare ? top : mix(top, grid.dirtColour ?? DIRT_COLOUR);
      const wallPattern = bare ? pattern : COVER_PATTERNS[COVER.soil]!;
      for (const [dx, dy, normal] of sides) {
        const neighbour = heights[k + dx + w * dy]!;
        const low = Number.isNaN(neighbour) ? h - SKIRT_M : neighbour;
        if (low >= h) continue;
        const a = dx !== 0 ? (dx > 0 ? x1 : x0) : dy > 0 ? z1 : z0;
        if (dx !== 0) out.quad([a, low, z0], [a, low, z1], [a, h, z1], [a, h, z0], normal, wall, shade * 0.8, wallPattern);
        else out.quad([x0, low, a], [x1, low, a], [x1, h, a], [x0, h, a], normal, wall, shade * 0.72, wallPattern);
      }

      // One bush on some vegetated cells, drawn with the cell's first block.
      if (cover === COVER.vegetation && !tree && bx % sub === 0 && by % sub === 0 && cellHash(ix, iy, 11) < 0.45) {
        const s = grid.cell * (0.22 + 0.18 * cellHash(ix, iy, 12));
        const px = x0 + (size - s) * cellHash(ix, iy, 13), pz = z0 - (size - s) * cellHash(ix, iy, 14);
        if (s <= size) out.box(px, px + s, h, h + 1.5 + 2.0 * cellHash(ix, iy, 15), pz - s, pz, 0x4f7340, COVER_PATTERNS[COVER.vegetation]);
      }
    }
  }
  return out.finish();
}
