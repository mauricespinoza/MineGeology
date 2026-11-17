// The cross-section: a line on the map, the ground along it, the student's stations projected onto it,
// and what the student draws at depth. Distances along the line ("d") and elevations ("z") in metres.

import type { Manifest } from "../format/types";
import type { Station } from "../state/state";
import { type Grid, surfaceElevation } from "../world/blocks";
import { meanPlanes } from "./symbols";
import { type LineKind, type LineStyle, pointInPolygon } from "./mapdata";

export interface SectionLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SectionShape {
  id: number;
  unit: number;
  /** Flat d, z pairs; closed implicitly. */
  points: number[];
}

export interface SectionTrace {
  id: number;
  kind: LineKind;
  style: LineStyle;
  points: number[];
}

export interface SectionState {
  line: SectionLine | null;
  polygons: SectionShape[];
  lines: SectionTrace[];
  nextId: number;
}

export const emptySection = (): SectionState => ({ line: null, polygons: [], lines: [], nextId: 1 });

export function sectionLength(line: SectionLine): number {
  return Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
}

/** Azimuth of the line from its start to its end, degrees from north. */
export function sectionAzimuth(line: SectionLine): number {
  return ((Math.atan2(line.x2 - line.x1, line.y2 - line.y1) * 180) / Math.PI + 360) % 360;
}

/** The map point at distance d along the line. */
export function along(line: SectionLine, d: number): [number, number] {
  const t = d / (sectionLength(line) || 1);
  return [line.x1 + (line.x2 - line.x1) * t, line.y1 + (line.y2 - line.y1) * t];
}

/** The ground along the line, every `step` metres: flat d, z pairs. */
export function profile(grid: Grid, line: SectionLine, step = 10): number[] {
  const length = sectionLength(line);
  const n = Math.max(Math.ceil(length / step), 1);
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const d = (length * i) / n;
    const [x, y] = along(line, d);
    out.push(d, surfaceElevation(grid, x, y));
  }
  return out;
}

/**
 * Apparent dip of a plane on the section, in degrees: positive when the plane goes down toward the end of
 * the line, negative toward its start. tan(apparent) = tan(dip) * cos(dip direction - section azimuth).
 */
export function apparentDipOnSection(strike: number, dip: number, azimuth: number): number {
  const rad = Math.PI / 180;
  if (dip >= 89.999) return Math.cos((strike + 90 - azimuth) * rad) >= 0 ? 90 : -90;
  return Math.atan(Math.tan(dip * rad) * Math.cos((strike + 90 - azimuth) * rad)) / rad;
}

export interface ProjectedStation {
  number: number;
  d: number;
  z: number;
  /** Distance from the line on the map, metres. */
  offset: number;
  planes: { feature: string; apparent: number }[];
}

/** Stations within `buffer` metres of the line, projected onto it with the apparent dip of each mean plane. */
export function projectStations(stations: Station[], manifest: Manifest, line: SectionLine, buffer = 150): ProjectedStation[] {
  const length = sectionLength(line);
  const ux = (line.x2 - line.x1) / length, uy = (line.y2 - line.y1) / length;
  const azimuth = sectionAzimuth(line);
  const origin = manifest.grid.origin;
  const out: ProjectedStation[] = [];
  for (const s of stations) {
    const x = s.easting - origin.easting - line.x1, y = s.northing - origin.northing - line.y1;
    const d = x * ux + y * uy, offset = Math.abs(-x * uy + y * ux);
    if (d < 0 || d > length || offset > buffer) continue;
    out.push({ number: s.number, d, z: s.elevation, offset, planes: meanPlanes(s).map((p) => ({ feature: p.feature, apparent: apparentDipOnSection(p.strike, p.dip, azimuth) })) });
  }
  return out.sort((a, b) => a.d - b.d);
}

/**
 * The true units along the line, from the lithology block: `nz` rows (bottom first) of `nd` columns.
 * Cells above the ground are -1. Columns are `length / nd` metres wide, rows the block's cell height.
 */
export function trueSection(litho: Uint8Array, manifest: Manifest, grid: Grid, line: SectionLine, step = 10): { nd: number; nz: number; dz: number; z0: number; cells: Int16Array } {
  const { nx, ny, nz } = manifest.grid;
  const cell = manifest.grid.cell_size_m.x, dz = manifest.grid.cell_size_m.z, z0 = manifest.grid.origin.elevation;
  const length = sectionLength(line);
  const nd = Math.max(Math.round(length / step), 1);
  const cells = new Int16Array(nd * nz).fill(-1);
  for (let i = 0; i < nd; i++) {
    const [x, y] = along(line, ((i + 0.5) * length) / nd);
    const ix = Math.min(Math.max(Math.floor(x / cell), 0), nx - 1), iy = Math.min(Math.max(Math.floor(y / cell), 0), ny - 1);
    const ground = surfaceElevation(grid, x, y);
    for (let k = 0; k < nz; k++) {
      if (z0 + (k + 0.5) * dz > ground) break;
      cells[i + nd * k] = litho[ix + nx * (iy + ny * k)]!;
    }
  }
  return { nd, nz, dz, z0, cells };
}

/** The student's section as a raster on the same cells; later shapes over earlier ones, -1 where nothing is drawn. */
export function rasterizeSection(section: SectionState, nd: number, nz: number, length: number, z0: number, dz: number): Int32Array {
  const out = new Int32Array(nd * nz).fill(-1);
  for (const shape of section.polygons) {
    for (let k = 0; k < nz; k++) {
      const z = z0 + (k + 0.5) * dz;
      for (let i = 0; i < nd; i++) {
        if (pointInPolygon(((i + 0.5) * length) / nd, z, shape.points)) out[i + nd * k] = shape.unit;
      }
    }
  }
  return out;
}
