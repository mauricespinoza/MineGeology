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
