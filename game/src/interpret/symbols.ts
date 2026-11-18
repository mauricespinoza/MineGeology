// Map symbols shared by the map board, the PDF and the GeoJSON export.

import type { Station } from "../state/state";
import { fitOrientations } from "./stereonet";
import { poleVector } from "./stereonet";
import type { LineKind, LineStyle } from "./mapdata";

export interface LineLook {
  colour: string;
  width: number;
}
/** Widths are in CSS pixels on the screen and in points on paper (the PDF scales them down a little). */
export const LINE_LOOK: Record<LineKind, LineLook> = {
  contact: { colour: "#1a1a1a", width: 1.6 },
  fault: { colour: "#b01c1c", width: 2.6 },
};
/** Dash patterns as multiples of the line width. Observed lines are unbroken; inferred lines are dotted. */
export const DASH: Record<LineStyle, number[]> = { solid: [], dashed: [5, 3], inferred: [0.6, 2.6] };

export interface MeanPlane {
  feature: string;
  strike: number;
  dip: number;
  /** How many readings it averages. */
  n: number;
}

/** The mean plane of each kind of plane the student measured at a station. */
export function meanPlanes(station: Station): MeanPlane[] {
  const byFeature = new Map<string, [number, number][]>();
  for (const m of station.measurements) {
    if (m.type !== "plane") continue;
    if (!byFeature.has(m.feature)) byFeature.set(m.feature, []);
    byFeature.get(m.feature)!.push([m.a, m.b]);
  }
  const out: MeanPlane[] = [];
  for (const [feature, readings] of byFeature) {
    const fit = fitOrientations(readings.map(([strike, dip]) => poleVector(strike, dip)));
    if (fit) out.push({ feature, strike: Math.round(fit.meanPlane.strike) % 360, dip: Math.round(fit.meanPlane.dip), n: readings.length });
  }
  return out;
}

export interface StrikeDipGeometry {
  /** The strike line, from one end to the other. */
  strike: [number, number, number, number];
  /** The tick, from the middle of the strike line toward the dip direction. */
  tick: [number, number, number, number];
  /** Where the dip value goes. */
  label: [number, number];
}

/** The standard symbol, in a frame with x east and y north, around the origin; `length` is the strike line. */
export function strikeDipSymbol(strike: number, dip: number, length: number): StrikeDipGeometry {
  const s = (strike * Math.PI) / 180, d = ((strike + 90) * Math.PI) / 180;
  const half = length / 2, tick = dip >= 85 ? length * 0.2 : length * 0.3;
  return {
    strike: [-Math.sin(s) * half, -Math.cos(s) * half, Math.sin(s) * half, Math.cos(s) * half],
    tick: [0, 0, Math.sin(d) * tick, Math.cos(d) * tick],
    label: [Math.sin(d) * (tick + length * 0.32), Math.cos(d) * (tick + length * 0.32)],
  };
}

/**
 * The marks along a fault, in a frame with y upward, for points already in drawing units (pixels or points).
 * Following the map conventions, the marks stand on the side of the block they describe, which is the
 * right of the drawing direction unless `flip`:
 * - reverse and thrust faults: filled teeth on the hanging wall (bigger and closer for a thrust);
 * - normal faults: a bar with a ball on the downthrown block;
 * - strike-slip faults: a pair of half arrows at the middle, one on each side, showing the slip;
 * - oblique faults: the normal bar and ball, and the half arrows.
 */
export interface FaultMarks {
  teeth: number[][]; // triangles, flat x, y
  bars: number[][]; // segments x1, y1, x2, y2
  balls: [number, number, number][]; // x, y, radius
  arrows: number[][]; // open polylines: the shaft and a one-sided barb
}

export function faultMarks(points: number[], kinematics: string | undefined, size: number, flip = false): FaultMarks {
  const marks: FaultMarks = { teeth: [], bars: [], balls: [], arrows: [] };
  if (!kinematics || points.length < 4) return marks;
  const side = flip ? -1 : 1;
  const segs: { x: number; y: number; ux: number; uy: number; len: number; at: number }[] = [];
  let total = 0;
  for (let i = 0; i + 3 < points.length; i += 2) {
    const dx = points[i + 2]! - points[i]!, dy = points[i + 3]! - points[i + 1]!, len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    segs.push({ x: points[i]!, y: points[i + 1]!, ux: dx / len, uy: dy / len, len, at: total });
    total += len;
  }
  if (!segs.length) return marks;
  const at = (d: number) => {
    const s = segs.find((g) => d <= g.at + g.len) ?? segs[segs.length - 1]!;
    const t = Math.min(Math.max(d - s.at, 0), s.len);
    // Right of the direction, in a frame with y up: (uy, -ux).
    return { x: s.x + s.ux * t, y: s.y + s.uy * t, ux: s.ux, uy: s.uy, rx: s.uy * side, ry: -s.ux * side };
  };
  const along = (spacing: number, place: (p: ReturnType<typeof at>) => void) => {
    const n = Math.max(1, Math.floor(total / spacing));
    const step = total / n;
    for (let k = 0; k < n; k++) place(at(step * (k + 0.5)));
  };
  const thrust = kinematics === "thrust";
  if (kinematics === "reverse" || thrust) {
    const h = size * (thrust ? 0.85 : 0.65), b = size * (thrust ? 0.6 : 0.45);
    along(size * (thrust ? 2.4 : 3.4), (p) => marks.teeth.push([p.x - p.ux * b, p.y - p.uy * b, p.x + p.ux * b, p.y + p.uy * b, p.x + p.rx * h, p.y + p.ry * h]));
  }
  if (kinematics === "normal" || kinematics === "oblique") {
    const l = size * 0.8;
    along(size * 3.6, (p) => {
      marks.bars.push([p.x, p.y, p.x + p.rx * l, p.y + p.ry * l]);
      marks.balls.push([p.x + p.rx * l, p.y + p.ry * l, size * 0.22]);
    });
  }
  if (kinematics === "dextral" || kinematics === "sinistral" || kinematics === "oblique") {
    // Dextral: the block on the left of the drawing direction moves forward, the one on the right backward.
    const forward = kinematics === "sinistral" ? -1 : 1;
    const p = at(total / 2), half = size * 2.1, off = size * 0.6, barb = size * 0.85;
    // The sense of slip does not depend on which way the line was drawn round, so the true right is used, not flipped.
    const rx = p.uy, ry = -p.ux;
    for (const [s, dir] of [[-1, forward], [1, -forward]] as const) {
      const ox = rx * s, oy = ry * s; // away from the fault, on this side
      const cx = p.x + ox * off, cy = p.y + oy * off;
      const tx = cx + p.ux * half * dir, ty = cy + p.uy * half * dir;
      marks.arrows.push([cx - p.ux * half * dir, cy - p.uy * half * dir, tx, ty, tx - p.ux * barb * dir + ox * barb * 0.7, ty - p.uy * barb * dir + oy * barb * 0.7]);
    }
  }
  return marks;
}
