// Builds a complete, plausible student map from the answer key, for tests: every unit as polygons and
// every contact and fault as a line. It is what a careful student would draw, without the errors.

import type { Scenario, Truth } from "../../src/format/types";
import { expandTruthMap } from "../../src/format/loader";
import { contourLines } from "../../src/interpret/contours";
import { type MapState, addLine, addPolygon, addUnit, emptyMap, pointInPolygon, signedArea } from "../../src/interpret/mapdata";
import { generator, normal } from "../../src/tools/random";

/** Douglas-Peucker on flat x, y pairs. */
export function simplify(points: number[], tolerance: number): number[] {
  const n = points.length / 2;
  if (n < 3) return points;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let best = -1, bestDistance = tolerance;
    const ax = points[2 * i]!, ay = points[2 * i + 1]!, bx = points[2 * j]!, by = points[2 * j + 1]!;
    const length = Math.hypot(bx - ax, by - ay);
    for (let k = i + 1; k < j; k++) {
      const x = points[2 * k]!, y = points[2 * k + 1]!;
      const d = length === 0 ? Math.hypot(x - ax, y - ay) : Math.abs((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / length;
      if (d > bestDistance) ((best = k), (bestDistance = d));
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([i, best], [best, j]);
    }
  }
  const out: number[] = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push(points[2 * k]!, points[2 * k + 1]!);
  return out;
}

export interface StudentMapOptions {
  /** Standard deviation of the shift applied to every vertex, in metres: the student's hand. */
  jitter?: number;
  /** Vertices closer than this to the straight line between their neighbours are dropped. */
  simplify?: number;
  seed?: number;
}

export function studentMapFromTruth(scenario: Scenario, truth: Truth, options: StudentMapOptions = {}): MapState {
  const { nx, ny, cell_size_m, origin } = scenario.manifest.grid;
  const cell = cell_size_m.x;
  const random = generator(options.seed ?? 1);
  const jitter = options.jitter ?? 0, tolerance = options.simplify ?? 3;
  const map = emptyMap();
  const raster = expandTruthMap(truth, scenario.manifest);
  const unitIds = scenario.units.map((u) => addUnit(map, u.lithology).id);

  // The outline of each unit: contours of its mask, on a lattice padded by one cell so that outlines
  // close along the edge of the area.
  const loops: { unit: number; points: number[]; area: number }[] = [];
  scenario.units.forEach((_, u) => {
    if (!raster.includes(u)) return;
    const w = nx + 2, h = ny + 2;
    const mask = new Float32Array(w * h);
    for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) mask[ix + 1 + w * (iy + 1)] = raster[ix + nx * iy] === u ? 1 : 0;
    const found = contourLines(mask, w, h, -0.5 * cell, -0.5 * cell, cell, cell, 0.5).filter((l) => l.length > 8 && l[0] === l[l.length - 2] && l[1] === l[l.length - 1]);
    const rings = found.map((l) => ({ points: l.slice(0, -2), area: Math.abs(signedArea(l.slice(0, -2))) }));
    for (const ring of rings) {
      // A ring inside an odd number of larger rings is a hole of this unit, which another unit fills.
      const depth = rings.filter((o) => o !== ring && o.area > ring.area && pointInPolygon(ring.points[0]!, ring.points[1]!, o.points)).length;
      if (depth % 2 === 0) loops.push({ unit: unitIds[u]!, points: ring.points, area: ring.area });
    }
  });
  // Big areas first, so that small ones painted later sit on top of them.
  for (const loop of loops.sort((p, q) => q.area - p.area)) {
    const closed = simplify([...loop.points, loop.points[0]!, loop.points[1]!], tolerance).slice(0, -2);
    const hand = closed.map((v) => v + normal(random) * jitter);
    if (hand.length >= 6) addPolygon(map, loop.unit, hand);
  }

  for (const feature of truth.contacts.features) {
    const points = feature.geometry.coordinates.flatMap(([e, n]) => [e - origin.easting, n - origin.northing]);
    const hand = simplify(points, tolerance).map((v) => v + normal(random) * jitter);
    if (feature.properties.type === "fault") addLine(map, "fault", "solid", hand, feature.properties.kinematics);
    else addLine(map, "contact", "solid", hand);
  }
  return map;
}
