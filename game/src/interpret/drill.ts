// Drill holes: a straight hole from a collar on the ground, logged against the model's lithology block.
// Coordinates are local metres (x east, y north from the grid origin) and elevations in metres; depths are
// measured along the hole from the collar. Inclination is the angle below the horizontal (90 = vertical).

import type { Manifest, Truth, Unit } from "../format/types";
import { type Grid, surfaceElevation } from "../world/blocks";

export interface DrillInterval {
  /** Depth along the hole, metres from the collar. */
  from: number;
  to: number;
  /** Unit key (units.json) of the rock in this interval. */
  unit: string;
  /** Set when the interval is a dyke crossed by the hole (dykes are too thin for the block). */
  dyke?: string;
  /** The student's map unit given to this interval, if any (an id in map.units). */
  mapUnit?: number;
}

export interface DrillHole {
  id: number;
  name: string;
  /** Collar, local metres and elevation. */
  x: number;
  y: number;
  z: number;
  /** Azimuth of the hole, degrees from north, and inclination below the horizontal, degrees. */
  azimuth: number;
  inclination: number;
  /** Drilled length, metres along the hole. */
  length: number;
  /** What it cost, US dollars (0 in free mode). */
  cost: number;
  day: number;
  minutes: number;
  intervals: DrillInterval[];
}

export interface DrillState {
  holes: DrillHole[];
  nextId: number;
  /** Money spent so far, US dollars. */
  spent: number;
}

export const emptyDrill = (): DrillState => ({ holes: [], nextId: 1, spent: 0 });

/**
 * Campaign mode prices and times. A diamond-core hole pays for moving the rig to the collar and then per metre;
 * the field time is setting up and logging the core (the drilling itself goes on while the student works).
 */
export const DRILL = {
  budget: 250_000,
  mobilisation: 6_000,
  perMetre: 180,
  setupMinutes: 45,
  logMinutesPerMetre: 0.35,
  minLength: 20,
  maxLength: 600,
  minInclination: 45,
} as const;

export function holeCost(length: number): number {
  return Math.round(DRILL.mobilisation + DRILL.perMetre * length);
}

export function holeMinutes(length: number): number {
  return Math.round(DRILL.setupMinutes + DRILL.logMinutesPerMetre * length);
}

/** The longest hole the budget still pays for, metres (0 when not even the rig can be moved). */
export function affordableLength(spent: number): number {
  return Math.max(Math.floor((DRILL.budget - spent - DRILL.mobilisation) / DRILL.perMetre), 0);
}

/** Unit vector of the hole, x east, y north, z up. */
export function direction(azimuth: number, inclination: number): [number, number, number] {
  const a = (azimuth * Math.PI) / 180, i = (inclination * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(i), Math.cos(a) * Math.cos(i), -Math.sin(i)];
}

export function pointAt(hole: Pick<DrillHole, "x" | "y" | "z" | "azimuth" | "inclination">, depth: number): [number, number, number] {
  const [dx, dy, dz] = direction(hole.azimuth, hole.inclination);
  return [hole.x + dx * depth, hole.y + dy * depth, hole.z + dz * depth];
}

/** How far the hole can go before it leaves the model's block (sides or base), metres. */
export function lengthInBlock(manifest: Manifest, x: number, y: number, z: number, azimuth: number, inclination: number): number {
  const g = manifest.grid;
  const sx = g.nx * g.cell_size_m.x, sy = g.ny * g.cell_size_m.y, z0 = g.origin.elevation;
  const [dx, dy, dz] = direction(azimuth, inclination);
  let t = Infinity;
  if (dx > 1e-9) t = Math.min(t, (sx - x) / dx);
  if (dx < -1e-9) t = Math.min(t, -x / dx);
  if (dy > 1e-9) t = Math.min(t, (sy - y) / dy);
  if (dy < -1e-9) t = Math.min(t, -y / dy);
  if (dz < -1e-9) t = Math.min(t, (z - z0) / -dz);
  return Math.max(Math.floor(t * 10) / 10 - 0.1, 0);
}

type Dyke = NonNullable<Truth["dykes"]>[number];

/** Whether the point (x, y, z) lies inside the dyke: the plane through its trace, thickness about it. */
export function insideDyke(dyke: Dyke, grid: Grid, origin: Manifest["grid"]["origin"], x: number, y: number, z: number): boolean {
  const rad = Math.PI / 180;
  const dipDir = (dyke.strike + 90) * rad;
  const ux = Math.sin(dipDir), uy = Math.cos(dipDir); // horizontal, toward the dip
  // Up the dip to the surface: the depth below the ground over there, moved back by depth / tan(dip).
  let px = x, py = y;
  if (dyke.dip < 89.5) {
    const t = Math.tan(dyke.dip * rad);
    for (let k = 0; k < 6; k++) {
      const depth = surfaceElevation(grid, px, py) - z;
      px = x - (ux * depth) / t;
      py = y - (uy * depth) / t;
    }
  }
  // The trace's half-width on the map: half the thickness over sin(dip).
  const half = dyke.thickness_m / 2 / Math.max(Math.sin(dyke.dip * rad), 0.2);
  const c = dyke.trace.coordinates;
  for (let i = 0; i + 1 < c.length; i++) {
    const ax = c[i]![0] - origin.easting, ay = c[i]![1] - origin.northing;
    const bx = c[i + 1]![0] - origin.easting, by = c[i + 1]![1] - origin.northing;
    const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1;
    const s = Math.min(Math.max(((px - ax) * vx + (py - ay) * vy) / l2, 0), 1);
    if (Math.hypot(px - ax - s * vx, py - ay - s * vy) <= half) return true;
  }
  return false;
}

/**
 * Logs a hole: the units met along it every `step` metres, merged into intervals. Each sample takes the cell
 * of the block it falls in, so contacts are as sharp as the block's cells (its cell size).
 */
export function logHole(
  litho: Uint8Array,
  manifest: Manifest,
  units: Unit[],
  hole: Pick<DrillHole, "x" | "y" | "z" | "azimuth" | "inclination" | "length">,
  dykes: Dyke[] = [],
  grid: Grid | null = null,
  step = 1,
): DrillInterval[] {
  const g = manifest.grid;
  const out: DrillInterval[] = [];
  const n = Math.max(Math.round(hole.length / step), 1);
  for (let i = 0; i < n; i++) {
    const from = (hole.length * i) / n, to = (hole.length * (i + 1)) / n;
    const [x, y, z] = pointAt(hole, (from + to) / 2);
    const ix = Math.min(Math.max(Math.floor(x / g.cell_size_m.x), 0), g.nx - 1);
    const iy = Math.min(Math.max(Math.floor(y / g.cell_size_m.y), 0), g.ny - 1);
    const iz = Math.min(Math.max(Math.floor((z - g.origin.elevation) / g.cell_size_m.z), 0), g.nz - 1);
    let unit = units[litho[ix + g.nx * (iy + g.ny * iz)]!]?.key ?? "?";
    let dyke: string | undefined;
    if (grid) {
      const hit = dykes.find((d) => insideDyke(d, grid, g.origin, x, y, z));
      if (hit) ((unit = hit.unit), (dyke = hit.id));
    }
    const last = out[out.length - 1];
    if (last && last.unit === unit && last.dyke === dyke) last.to = to;
    else out.push(dyke ? { from, to, unit, dyke } : { from, to, unit });
  }
  for (const r of out) ((r.from = Math.round(r.from * 10) / 10), (r.to = Math.round(r.to * 10) / 10));
  return out;
}

/** The elevation of a depth along the hole. */
export function elevationAt(hole: Pick<DrillHole, "z" | "inclination">, depth: number): number {
  return hole.z - depth * Math.sin((hole.inclination * Math.PI) / 180);
}

/**
 * True thickness of a bed crossed over `length` metres of hole, given the bed's strike and dip: the length times
 * the cosine of the angle between the hole and the bed's pole.
 */
export function trueThickness(length: number, azimuth: number, inclination: number, strike: number, dip: number): number {
  const [hx, hy, hz] = direction(azimuth, inclination);
  const rad = Math.PI / 180, dd = (strike + 90) * rad;
  const px = Math.sin(dd) * Math.sin(dip * rad), py = Math.cos(dd) * Math.sin(dip * rad), pz = Math.cos(dip * rad);
  return Math.abs(length * (hx * px + hy * py + hz * pz));
}

/** A hole name in the style of a drilling campaign: DDH-01, DDH-02... */
export function holeName(id: number): string {
  return `DDH-${String(id).padStart(2, "0")}`;
}

const csvCell = (v: string | number) => (typeof v === "number" ? String(v) : /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * The holes as one CSV table, one row per interval, with the collar and survey of its hole: easy to read into
 * a spreadsheet or into drill-hole software (collar, survey and lithology joined on HOLE_ID).
 */
export function drillCsv(holes: DrillHole[], manifest: Manifest, unitName: (key: string) => string, mapUnitName: (id: number | undefined) => string): string {
  const o = manifest.grid.origin;
  const rows: (string | number)[][] = [["HOLE_ID", "EAST", "NORTH", "RL", "AZIMUTH", "DIP", "LENGTH", "FROM", "TO", "UNIT", "LITHOLOGY", "MAP_UNIT"]];
  for (const h of holes) {
    for (const r of h.intervals) {
      rows.push([h.name, Math.round(o.easting + h.x), Math.round(o.northing + h.y), Math.round(h.z), Math.round(h.azimuth), -Math.round(h.inclination), h.length, r.from, r.to, r.unit, unitName(r.unit), mapUnitName(r.mapUnit)]);
    }
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}
