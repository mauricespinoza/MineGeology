// Bedding drawn on outcrop blocks. Beds are real planes in space, pole . X = k * spacing, and each
// block face shows where those planes cut it: strike lines on top faces, the true apparent dip on side
// faces, and lines that join up from face to face and block to block.

import type { Scenario } from "../format/types";
import { type Vec3, poleFromStrikeDip } from "../orientation";
import { type Grid, SUB, blockHeight } from "./blocks";

/** Spacing between drawn beds, measured across bedding, in metres. */
export const BED_SPACING_M = 1.0;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Where the planes pole . X = k * spacing cut the rectangle origin + s * u + t * v (0 <= s <= w, 0 <= t <= h;
 * u and v are unit vectors). Returns [s1, t1, s2, t2] per trace.
 */
export function planeTraces(origin: Vec3, u: Vec3, v: Vec3, w: number, h: number, pole: Vec3, spacing: number): number[][] {
  const a = dot(pole, u), b = dot(pole, v);
  const norm = a * a + b * b;
  if (norm < 1e-4) return []; // the face is parallel to bedding
  const base = dot(pole, origin);
  const reach = [0, a * w, b * h, a * w + b * h];
  const lo = base + Math.min(...reach), hi = base + Math.max(...reach);
  const out: number[][] = [];
  for (let k = Math.ceil(lo / spacing); k * spacing < hi; k++) {
    const e = k * spacing - base; // the trace is a * s + b * t = e
    const ps = (e * a) / norm, pt = (e * b) / norm; // a point on it
    const ds = b, dt = -a; // its direction
    let q0 = -Infinity, q1 = Infinity;
    for (const [p, d, max] of [[ps, ds, w], [pt, dt, h]] as const) {
      if (Math.abs(d) < 1e-9) {
        if (p < 0 || p > max) q0 = Infinity;
      } else {
        const x = -p / d, y = (max - p) / d;
        q0 = Math.max(q0, Math.min(x, y));
        q1 = Math.min(q1, Math.max(x, y));
      }
    }
    if ((q1 - q0) * Math.sqrt(norm) > 0.05) out.push([ps + q0 * ds, pt + q0 * dt, ps + q1 * ds, pt + q1 * dt]);
  }
  return out;
}

/** Line segments for three.js (x east, y up, z south; two points each) for every outcrop with known bedding. */
export function beddingSegments(scenario: Scenario, grid: Grid): Float32Array {
  const size = grid.cell / SUB;
  const limitX = grid.nx * SUB, limitY = grid.ny * SUB;
  const out: number[] = [];
  const lift = 0.05; // keep the lines just off the faces
  const push = (origin: Vec3, u: Vec3, v: Vec3, w: number, h: number, pole: Vec3, normal: Vec3) => {
    for (const [s1, t1, s2, t2] of planeTraces(origin, u, v, w, h, pole, BED_SPACING_M)) {
      for (const [s, t] of [[s1!, t1!], [s2!, t2!]]) {
        const e = origin[0] + s! * u[0] + t! * v[0] + lift * normal[0];
        const n = origin[1] + s! * u[1] + t! * v[1] + lift * normal[1];
        const z = origin[2] + s! * u[2] + t! * v[2] + lift * normal[2];
        out.push(e, z, -n);
      }
    }
  };
  for (const outcrop of scenario.outcrops) {
    const plane = outcrop.observation?.planes.find((p) => p.kind === "bedding");
    if (!plane) continue;
    const pole = poleFromStrikeDip(plane.strike, plane.dip);
    for (const [ix, iy] of outcrop.cells) {
      for (let by = iy * SUB; by < (iy + 1) * SUB; by++) {
        for (let bx = ix * SUB; bx < (ix + 1) * SUB; bx++) {
          const h = blockHeight(grid, bx, by, SUB);
          const x0 = bx * size, y0 = by * size;
          push([x0, y0, h], [1, 0, 0], [0, 1, 0], size, size, pole, [0, 0, 1]);
          const faces: [number, number, Vec3, Vec3][] = [
            [1, 0, [x0 + size, y0, 0], [0, 1, 0]],
            [-1, 0, [x0, y0, 0], [0, 1, 0]],
            [0, 1, [x0, y0 + size, 0], [1, 0, 0]],
            [0, -1, [x0, y0, 0], [1, 0, 0]],
          ];
          for (const [dx, dy, corner, along] of faces) {
            const jx = bx + dx, jy = by + dy;
            const low = jx >= 0 && jx < limitX && jy >= 0 && jy < limitY ? blockHeight(grid, jx, jy, SUB) : h;
            if (low >= h) continue;
            push([corner[0], corner[1], low], along, [0, 0, 1], size, h - low, pole, [dx, dy, 0]);
          }
        }
      }
    }
  }
  return new Float32Array(out);
}
