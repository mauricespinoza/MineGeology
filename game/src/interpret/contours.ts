// Contour lines by marching squares, chained into polylines. Pure, so that the map board and the
// PDF draw the same lines.

/** A polyline as flat x, y pairs. A closed line repeats its first point at the end. */
export type Line = number[];

const SEGMENTS: Record<number, [number, number][]> = {
  // Edges: 0 bottom, 1 right, 2 top, 3 left; a corner is "in" when its value is at or above the level.
  1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 6: [[0, 2]], 7: [[2, 3]], 8: [[2, 3]],
  9: [[0, 2]], 11: [[1, 2]], 12: [[3, 1]], 13: [[0, 1]], 14: [[3, 0]],
};

/**
 * Lines where `values` crosses `level`. The value at lattice point (i, j) sits at (x0 + i * dx, y0 + j * dy),
 * with j = 0 the southern row.
 */
export function contourLines(values: ArrayLike<number>, nx: number, ny: number, x0: number, y0: number, dx: number, dy: number, level: number): Line[] {
  const at = (i: number, j: number) => values[i + nx * j]!;
  // An edge is named by the lattice point it starts from and its direction, so that the cells on both
  // sides of it agree on the name.
  const horizontal = (i: number, j: number) => 2 * (i + nx * j);
  const vertical = (i: number, j: number) => 2 * (i + nx * j) + 1;
  const crossing = new Map<number, [number, number]>();
  const cross = (id: number, i0: number, j0: number, i1: number, j1: number) => {
    let p = crossing.get(id);
    if (!p) {
      const a = at(i0, j0), b = at(i1, j1);
      const t = (level - a) / (b - a);
      p = [x0 + (i0 + t * (i1 - i0)) * dx, y0 + (j0 + t * (j1 - j0)) * dy];
      crossing.set(id, p);
    }
    return id;
  };

  const segments: [number, number][] = [];
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      const code = (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (d >= level ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const edge = (e: number) =>
        e === 0 ? cross(horizontal(i, j), i, j, i + 1, j)
        : e === 1 ? cross(vertical(i + 1, j), i + 1, j, i + 1, j + 1)
        : e === 2 ? cross(horizontal(i, j + 1), i, j + 1, i + 1, j + 1)
        : cross(vertical(i, j), i, j, i, j + 1);
      let pairs = SEGMENTS[code];
      if (code === 5 || code === 10) {
        // Saddle: the centre value decides which pair of corners the line joins.
        const centreIn = (a + b + c + d) / 4 >= level;
        if (code === 5) pairs = centreIn ? [[0, 1], [2, 3]] : [[3, 0], [1, 2]];
        else pairs = centreIn ? [[3, 0], [1, 2]] : [[0, 1], [2, 3]];
      }
      for (const [e0, e1] of pairs!) segments.push([edge(e0), edge(e1)]);
    }
  }

  const ends = new Map<number, number[]>();
  segments.forEach(([p, q], s) => {
    for (const e of [p, q]) {
      if (!ends.has(e)) ends.set(e, []);
      ends.get(e)!.push(s);
    }
  });
  const used = new Uint8Array(segments.length);
  const lines: Line[] = [];
  const walk = (start: number, first: number): Line => {
    const ids = [start];
    let edge = start, s = first;
    for (;;) {
      used[s] = 1;
      const [p, q] = segments[s]!;
      edge = p === edge ? q : p;
      ids.push(edge);
      const next = (ends.get(edge) ?? []).find((n) => !used[n]);
      if (next === undefined) break;
      s = next;
    }
    return ids.flatMap((id) => crossing.get(id)!);
  };
  for (const [edge, list] of ends) {
    if (list.length === 1 && !used[list[0]!]) lines.push(walk(edge, list[0]!)); // open ends first
  }
  for (const [edge, list] of ends) {
    const free = list.find((s) => !used[s]);
    if (free !== undefined) lines.push(walk(edge, free)); // what remains are closed loops
  }
  return lines;
}

export interface ContourLevel {
  level: number;
  index: boolean;
  lines: Line[];
}

/** Contours of an elevation grid whose values sit at cell centres, every `interval` metres. */
export function contourSet(elevation: ArrayLike<number>, nx: number, ny: number, cell: number, interval: number, indexEvery = 5): ContourLevel[] {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < nx * ny; i++) {
    const v = elevation[i]!;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const out: ContourLevel[] = [];
  for (let k = Math.ceil(lo / interval); k * interval <= hi; k++) {
    const level = k * interval + 1e-6; // avoid levels that meet lattice values exactly
    const lines = contourLines(elevation, nx, ny, cell / 2, cell / 2, cell, cell, level);
    if (lines.length) out.push({ level: k * interval, index: k % indexEvery === 0, lines });
  }
  return out;
}

export function pathLength(line: Line): number {
  let sum = 0;
  for (let i = 2; i < line.length; i += 2) sum += Math.hypot(line[i]! - line[i - 2]!, line[i + 1]! - line[i - 1]!);
  return sum;
}

/** The point halfway along a polyline. */
export function midpoint(line: Line): [number, number] {
  const half = pathLength(line) / 2;
  let run = 0;
  for (let i = 2; i < line.length; i += 2) {
    const step = Math.hypot(line[i]! - line[i - 2]!, line[i + 1]! - line[i - 1]!);
    if (run + step >= half && step > 0) {
      const t = (half - run) / step;
      return [line[i - 2]! + t * (line[i]! - line[i - 2]!), line[i - 1]! + t * (line[i + 1]! - line[i - 1]!)];
    }
    run += step;
  }
  return [line[0]!, line[1]!];
}
