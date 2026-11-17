// What the student draws on the map board, and the geometry that works on it.
// Coordinates are metres east and north of the south-west corner of the area ("model" coordinates).

export type LineKind = "contact" | "fault";
/** Solid: observed. Dashed: approximate. Inferred: concealed or interpreted, drawn dotted. */
export type LineStyle = "solid" | "dashed" | "inferred";
export type Kinematics = "normal" | "reverse" | "thrust" | "dextral" | "sinistral" | "oblique";

export interface MapUnit {
  id: number;
  name: string;
  colour: string;
}

export interface MapLine {
  id: number;
  kind: LineKind;
  style: LineStyle;
  /** Faults only; absent while undetermined. */
  kinematics?: Kinematics;
  /** Flat x, y pairs. */
  points: number[];
}

export interface MapPolygon {
  id: number;
  unit: number;
  /** Flat x, y pairs; the ring is closed implicitly. */
  points: number[];
}

export interface MapState {
  units: MapUnit[];
  lines: MapLine[];
  polygons: MapPolygon[];
  nextId: number;
}

export const emptyMap = (): MapState => ({ units: [], lines: [], polygons: [], nextId: 1 });

export const UNIT_PALETTE = ["#e8a87c", "#85c1a8", "#c3a6e0", "#f2d16b", "#7fb2e5", "#d98c8c", "#b7c86f", "#9fa8b5", "#e59bd0", "#8fd6d6"];

export const STYLE_NAMES: Record<LineStyle, string> = { solid: "observado", dashed: "aproximado", inferred: "inferido" };
const STYLE_NAMES_FEMININE: Record<LineStyle, string> = { solid: "observada", dashed: "aproximada", inferred: "inferida" };

/** "Contacto observado", "Falla inferida": the style agrees with the gender of the line's name. */
export function lineName(kind: LineKind, style: LineStyle): string {
  return kind === "fault" ? `Falla ${STYLE_NAMES_FEMININE[style]}` : `Contacto ${STYLE_NAMES[style]}`;
}

export const KINEMATICS_NAMES: Record<Kinematics, string> = {
  normal: "normal",
  reverse: "inversa",
  thrust: "cabalgamiento",
  dextral: "dextral",
  sinistral: "sinistral",
  oblique: "oblicua",
};

export function addUnit(map: MapState, name: string): MapUnit {
  const unit: MapUnit = { id: map.nextId++, name: name.trim(), colour: UNIT_PALETTE[map.units.length % UNIT_PALETTE.length]! };
  map.units.push(unit);
  return unit;
}

/** Removes a unit and the polygons painted with it. */
export function removeUnit(map: MapState, id: number): void {
  map.units = map.units.filter((u) => u.id !== id);
  map.polygons = map.polygons.filter((p) => p.unit !== id);
}

export function addLine(map: MapState, kind: LineKind, style: LineStyle, points: number[], kinematics?: Kinematics): MapLine {
  const line: MapLine = { id: map.nextId++, kind, style, points: [...points] };
  if (kind === "fault" && kinematics) line.kinematics = kinematics;
  map.lines.push(line);
  return line;
}

export function addPolygon(map: MapState, unit: number, points: number[]): MapPolygon {
  const polygon: MapPolygon = { id: map.nextId++, unit, points: [...points] };
  map.polygons.push(polygon);
  return polygon;
}

export function clone(map: MapState): MapState {
  return JSON.parse(JSON.stringify(map)) as MapState;
}

/** Area of a ring given as flat x, y pairs; positive when it runs counter-clockwise. */
export function signedArea(points: number[]): number {
  let sum = 0;
  const n = points.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += points[2 * i]! * points[2 * j + 1]! - points[2 * j]! * points[2 * i + 1]!;
  }
  return sum / 2;
}

export function pointInPolygon(x: number, y: number, points: number[]): boolean {
  let inside = false;
  const n = points.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = points[2 * i]!, yi = points[2 * i + 1]!, xj = points[2 * j]!, yj = points[2 * j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const t = dx === 0 && dy === 0 ? 0 : Math.min(Math.max(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0), 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distance from a point to a polyline (or to the outline of a ring when `closed`). */
export function distanceToPath(px: number, py: number, points: number[], closed: boolean): number {
  const n = points.length / 2;
  let best = Infinity;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const j = (i + 1) % n;
    best = Math.min(best, distanceToSegment(px, py, points[2 * i]!, points[2 * i + 1]!, points[2 * j]!, points[2 * j + 1]!));
  }
  return best;
}

export type Hit = { type: "line" | "polygon"; id: number };

/** The line or polygon outline nearest to a point within `tolerance` metres; lines win ties. */
export function nearestFeature(map: MapState, x: number, y: number, tolerance: number): Hit | null {
  let best: Hit | null = null, bestDistance = tolerance;
  for (const line of map.lines) {
    const d = distanceToPath(x, y, line.points, false);
    if (d <= bestDistance) ((best = { type: "line", id: line.id }), (bestDistance = d));
  }
  for (const polygon of map.polygons) {
    const d = distanceToPath(x, y, polygon.points, true);
    if (d < bestDistance) ((best = { type: "polygon", id: polygon.id }), (bestDistance = d));
  }
  if (!best) {
    // Inside a polygon counts too, so that a filled area can be picked up without hitting its edge.
    for (let i = map.polygons.length - 1; i >= 0; i--) {
      if (pointInPolygon(x, y, map.polygons[i]!.points)) return { type: "polygon", id: map.polygons[i]!.id };
    }
  }
  return best;
}

export function removeFeature(map: MapState, hit: Hit): void {
  if (hit.type === "line") map.lines = map.lines.filter((l) => l.id !== hit.id);
  else map.polygons = map.polygons.filter((p) => p.id !== hit.id);
}

/** The unit painted at a point: the last polygon drawn over it wins, as ink does on paper. -1 where none. */
export function unitAt(map: MapState, x: number, y: number): number {
  for (let i = map.polygons.length - 1; i >= 0; i--) {
    if (pointInPolygon(x, y, map.polygons[i]!.points)) return map.polygons[i]!.unit;
  }
  return -1;
}

/**
 * The map as a raster of unit ids, one value per cell centre (row-major, southern row first, as in the
 * baked files); -1 where nothing is painted. Work package 7 compares this with the true map.
 */
export function rasterize(map: MapState, nx: number, ny: number, cell: number): Int32Array {
  const out = new Int32Array(nx * ny).fill(-1);
  for (const polygon of map.polygons) {
    const xs = polygon.points.filter((_, i) => i % 2 === 0), ys = polygon.points.filter((_, i) => i % 2 === 1);
    const ix0 = Math.max(Math.floor(Math.min(...xs) / cell - 0.5), 0), ix1 = Math.min(Math.ceil(Math.max(...xs) / cell), nx - 1);
    const iy0 = Math.max(Math.floor(Math.min(...ys) / cell - 0.5), 0), iy1 = Math.min(Math.ceil(Math.max(...ys) / cell), ny - 1);
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        if (pointInPolygon((ix + 0.5) * cell, (iy + 0.5) * cell, polygon.points)) out[ix + nx * iy] = polygon.unit;
      }
    }
  }
  return out;
}
