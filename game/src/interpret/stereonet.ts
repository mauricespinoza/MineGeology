// Lower-hemisphere equal-area (Schmidt) stereonet: projection, great circles, and the statistics a
// structural geologist reads off it. Vectors are [east, north, up]; right-hand rule for planes.

import type { Station } from "../state/state";
import { formatLine, formatPlane } from "../tools/compass";

export type Vec = [number, number, number];

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const mod360 = (a: number) => ((a % 360) + 360) % 360;

/** Unit vector of a line given by trend and plunge, both in degrees. */
export function lineVector(trend: number, plunge: number): Vec {
  return [Math.cos(plunge * RAD) * Math.sin(trend * RAD), Math.cos(plunge * RAD) * Math.cos(trend * RAD), -Math.sin(plunge * RAD)];
}

/** The pole of a plane as a line in the lower hemisphere: trend strike - 90, plunge 90 - dip. */
export function poleVector(strike: number, dip: number): Vec {
  return lineVector(mod360(strike - 90), 90 - dip);
}

export function trendPlunge(v: Vec): { trend: number; plunge: number } {
  const s = v[2] > 0 ? -1 : 1; // a line and its opposite are the same line; use the one pointing down
  const e = s * v[0], n = s * v[1], u = s * v[2];
  const length = Math.hypot(e, n, u) || 1;
  return { trend: mod360(Math.atan2(e, n) * DEG), plunge: Math.asin(Math.min(Math.max(-u / length, -1), 1)) * DEG };
}

/** Strike and dip of the plane whose pole is the line v. */
export function planeOfPole(v: Vec): { strike: number; dip: number } {
  const { trend, plunge } = trendPlunge(v);
  return { strike: mod360(trend + 90), dip: 90 - plunge };
}

/** Position on the net: the primitive circle has radius 1 and north is +y. */
export function project(v: Vec): [number, number] {
  const s = v[2] > 0 ? -1 : 1;
  const e = s * v[0], n = s * v[1], u = s * v[2];
  const length = Math.hypot(e, n, u) || 1;
  const theta = Math.acos(Math.min(Math.max(-u / length, -1), 1)); // angle from the centre of the net
  const r = Math.SQRT2 * Math.sin(theta / 2);
  const h = Math.hypot(e, n);
  return h < 1e-12 ? [0, 0] : [(r * e) / h, (r * n) / h];
}

/** Points along the trace of a plane on the lower hemisphere, as net positions. */
export function greatCircle(strike: number, dip: number, steps = 90): [number, number][] {
  const s = strike * RAD, ds = (strike + 90) * RAD, d = dip * RAD;
  const along: Vec = [Math.sin(s), Math.cos(s), 0];
  const down: Vec = [Math.cos(d) * Math.sin(ds), Math.cos(d) * Math.cos(ds), -Math.sin(d)];
  const out: [number, number][] = [];
  for (let k = 0; k <= steps; k++) {
    const t = (Math.PI * k) / steps;
    out.push(project([Math.cos(t) * along[0] + Math.sin(t) * down[0], Math.cos(t) * along[1] + Math.sin(t) * down[1], Math.cos(t) * along[2] + Math.sin(t) * down[2]]));
  }
  return out;
}

/** Eigen-decomposition of a symmetric 3 x 3 matrix by Jacobi rotations; values descending. */
export function eigen(matrix: number[][]): { values: Vec; vectors: Vec[] } {
  const a = matrix.map((row) => [...row]);
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = Math.abs(a[0]![1]!) + Math.abs(a[0]![2]!) + Math.abs(a[1]![2]!);
    if (off < 1e-14) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      if (Math.abs(a[p]![q]!) < 1e-18) continue;
      const theta = (a[q]![q]! - a[p]![p]!) / (2 * a[p]![q]!);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k]![p]!, akq = a[k]![q]!;
        a[k]![p] = c * akp - s * akq;
        a[k]![q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p]![k]!, aqk = a[q]![k]!;
        a[p]![k] = c * apk - s * aqk;
        a[q]![k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k]![p]!, vkq = v[k]![q]!;
        v[k]![p] = c * vkp - s * vkq;
        v[k]![q] = s * vkp + c * vkq;
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j]![j]! - a[i]![i]!);
  return { values: order.map((i) => a[i]![i]!) as Vec, vectors: order.map((i) => [v[0]![i]!, v[1]![i]!, v[2]![i]!] as Vec) };
}

export type Shape = "cluster" | "girdle" | "scattered" | "too_few";

export interface Fit {
  n: number;
  /** Eigenvalues of the orientation tensor, largest first, adding up to 1. */
  values: Vec;
  /** The principal axes: the mean direction first, the girdle's pole last. */
  axes: Vec[];
  shape: Shape;
  /** Mean direction, as a line. */
  mean: { trend: number; plunge: number };
  /** For poles: the plane perpendicular to the mean pole. */
  meanPlane: { strike: number; dip: number };
  /** The direction all the planes of a girdle share: a fold axis when they are the limbs of one fold. */
  girdleAxis: { trend: number; plunge: number };
  /** The plane that best fits the poles of a girdle. */
  girdlePlane: { strike: number; dip: number };
}

/** Principal axes of a set of lines (or poles), with a verdict on whether they cluster or form a girdle. */
export function fitOrientations(vectors: Vec[]): Fit | null {
  const n = vectors.length;
  if (n === 0) return null;
  const t = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const v of vectors) {
    const length = Math.hypot(...v) || 1;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) t[i]![j]! += (v[i]! / length) * (v[j]! / length) / n;
  }
  const { values, vectors: axes } = eigen(t);
  const shape: Shape = n < 3 ? "too_few" : values[0] >= 0.75 ? "cluster" : values[2] <= 0.12 && values[1] >= 0.2 ? "girdle" : "scattered";
  return {
    n,
    values,
    axes,
    shape,
    mean: trendPlunge(axes[0]!),
    meanPlane: planeOfPole(axes[0]!),
    girdleAxis: trendPlunge(axes[2]!),
    girdlePlane: planeOfPole(axes[2]!),
  };
}

export interface Datum {
  kind: "plane" | "line";
  feature: string;
  /** Strike and dip, or trend and plunge. */
  a: number;
  b: number;
  station: number;
  rock: string;
}

export interface Filter {
  /** Plane or line kind, e.g. "bedding"; all when absent. */
  feature?: string;
  /** Only stations where the student named the rock this. */
  rock?: string;
  /** Only stations in this set (a map unit, say). */
  stations?: Set<number>;
}

/** The student's own measurements, with the filters applied. */
export function collect(stations: Station[], filter: Filter = {}): Datum[] {
  const out: Datum[] = [];
  for (const s of stations) {
    if (filter.rock !== undefined && s.rock !== filter.rock) continue;
    if (filter.stations && !filter.stations.has(s.number)) continue;
    for (const m of s.measurements) {
      if (filter.feature !== undefined && m.feature !== filter.feature) continue;
      out.push({ kind: m.type, feature: m.feature, a: m.a, b: m.b, station: s.number, rock: s.rock });
    }
  }
  return out;
}

export const vectorOf = (d: Datum): Vec => (d.kind === "plane" ? poleVector(d.a, d.b) : lineVector(d.a, d.b));

export const FEATURE_COLOURS: Record<string, string> = {
  bedding: "#1d1d1d",
  foliation: "#6a3d9a",
  cleavage: "#6a3d9a",
  fault_plane: "#c0392b",
  dyke: "#d35400",
  joint: "#7f8c8d",
  contact: "#2471a3",
  axial_plane: "#117a65",
  striae: "#c0392b",
  fold_hinge: "#117a65",
  mineral: "#6a3d9a",
  intersection: "#7f8c8d",
  stretching: "#6a3d9a",
};

export interface NetOptions {
  mode: "poles" | "circles";
  /** Draw the best-fit girdle and the fold axis, or the mean plane for a cluster. */
  fit: boolean;
}

/** Draws the net, the data and, if asked, the fit. The context must be square: `size` x `size` pixels. */
export function drawStereonet(ctx: CanvasRenderingContext2D, size: number, data: Datum[], options: NetOptions): Fit | null {
  const c = size / 2, R = size / 2 - 24;
  const at = ([x, y]: [number, number]): [number, number] => [c + x * R, c - y * R];
  ctx.fillStyle = "#fbf8ee";
  ctx.fillRect(0, 0, size, size);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#222";
  ctx.beginPath();
  ctx.arc(c, c, R, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.strokeStyle = "#999";
  ctx.beginPath();
  ctx.moveTo(c - R, c); ctx.lineTo(c + R, c);
  ctx.moveTo(c, c - R); ctx.lineTo(c, c + R);
  ctx.stroke();
  ctx.fillStyle = "#222";
  ctx.font = "13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("N", c, c - R - 8);
  ctx.fillText("E", c + R + 11, c + 4);
  ctx.fillText("S", c, c + R + 17);
  ctx.fillText("O", c - R - 11, c + 4);

  const planes = data.filter((d) => d.kind === "plane");
  if (options.mode === "circles") {
    for (const d of planes) {
      ctx.strokeStyle = FEATURE_COLOURS[d.feature] ?? "#333";
      ctx.globalAlpha = 0.65;
      ctx.beginPath();
      greatCircle(d.a, d.b).forEach((p, i) => (i === 0 ? ctx.moveTo(...at(p)) : ctx.lineTo(...at(p))));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  for (const d of data) {
    if (d.kind === "plane" && options.mode === "circles") continue;
    const [x, y] = at(project(vectorOf(d)));
    ctx.fillStyle = FEATURE_COLOURS[d.feature] ?? "#333";
    ctx.beginPath();
    if (d.kind === "plane") ctx.arc(x, y, 3.6, 0, 2 * Math.PI);
    else (ctx.moveTo(x, y - 5), ctx.lineTo(x + 4.5, y + 3.5), ctx.lineTo(x - 4.5, y + 3.5), ctx.closePath());
    ctx.globalAlpha = 0.8;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  const fit = fitOrientations(data.filter((d) => d.kind === "plane").map(vectorOf));
  if (options.fit && fit && fit.shape !== "too_few") {
    if (fit.shape === "girdle") {
      ctx.strokeStyle = "#b03a2e";
      ctx.lineWidth = 1.6;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      greatCircle(fit.girdlePlane.strike, fit.girdlePlane.dip).forEach((p, i) => (i === 0 ? ctx.moveTo(...at(p)) : ctx.lineTo(...at(p))));
      ctx.stroke();
      ctx.setLineDash([]);
      const [x, y] = at(project(lineVector(fit.girdleAxis.trend, fit.girdleAxis.plunge)));
      ctx.fillStyle = "#b03a2e";
      ctx.fillRect(x - 5, y - 5, 10, 10);
      ctx.fillStyle = "#222";
      ctx.textAlign = "left";
      ctx.fillText("eje", x + 8, y + 4);
    } else if (fit.shape === "cluster") {
      const [x, y] = at(project(lineVector(fit.mean.trend, fit.mean.plunge)));
      ctx.strokeStyle = "#b03a2e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }
  return fit;
}

const decimal = (v: number) => v.toFixed(2).replace(".", ",");

/** One or two sentences in Spanish saying what the fit shows. */
export function describeFit(fit: Fit | null, what = "planos"): string {
  if (!fit) return "No hay mediciones con estos filtros.";
  const lead = `n = ${fit.n} ${what}`;
  if (fit.shape === "too_few") return `${lead}. Se necesitan al menos 3 para ajustar.`;
  const lambda = `Valores propios ${fit.values.map(decimal).join(" / ")}.`;
  if (fit.shape === "cluster") {
    const plane = formatPlane({ strike: Math.round(fit.meanPlane.strike) % 360, dip: Math.round(fit.meanPlane.dip) });
    return `${lead}, agrupados. Plano medio ${plane}. ${lambda}`;
  }
  if (fit.shape === "girdle") {
    const axis = formatLine({ trend: Math.round(fit.girdleAxis.trend) % 360, plunge: Math.round(fit.girdleAxis.plunge) });
    const plane = formatPlane({ strike: Math.round(fit.girdlePlane.strike) % 360, dip: Math.round(fit.girdlePlane.dip) });
    return `${lead}, en guirnalda. Eje de pliegue (π) ${axis}; plano de la guirnalda ${plane}. ${lambda}`;
  }
  return `${lead}, dispersos: no forman un grupo ni una guirnalda. ${lambda}`;
}
