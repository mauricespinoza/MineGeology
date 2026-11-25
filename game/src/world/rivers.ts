// Rivers in the main courses: where the water of the hills gathers, read from the terrain itself.
//
// The hollows of the terrain are filled first (priority flood), so that every cell drains to the edge of the
// area; then each cell sends its water to its steepest neighbour (D8) and the water is added up downhill. A cell
// that gathers the rain of more than RIVER_AREA_M2 carries a stream; one that gathers four times as much is a
// river two cells wide. In the desert only the largest courses carry water, as in the few rivers that
// cross the Atacama; the rest stay dry quebradas of gravel.
//
// Pure: it runs in tests, and the mask it makes travels with the grid to the meshing worker.

import type { Environment } from "./blocks";

/** Area that must drain to a cell for it to carry a stream, in square metres, by environment. */
export const RIVER_AREA_M2: Record<Environment, number> = { temperate: 300_000, forest: 300_000, desert: 600_000 };
/** How far away a stream is heard, in metres. */
export const WATER_EARSHOT_M = 70;
/** Water in a river cell: 1 for a stream, 2 for a river. 0 is dry. */
export type RiverMask = Uint8Array;

/** The eight neighbours, the four sides first. */
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

/** A binary min-heap of cell indices keyed by elevation. */
class Heap {
  private readonly keys: number[] = [];
  private readonly items: number[] = [];
  get size(): number {
    return this.items.length;
  }
  push(key: number, item: number): void {
    const { keys, items } = this;
    let i = items.length;
    keys.push(key);
    items.push(item);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent]! <= key) break;
      keys[i] = keys[parent]!;
      items[i] = items[parent]!;
      i = parent;
    }
    keys[i] = key;
    items[i] = item;
  }
  pop(): [number, number] {
    const { keys, items } = this;
    const top: [number, number] = [keys[0]!, items[0]!];
    const key = keys.pop()!, item = items.pop()!;
    const n = items.length;
    if (n) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && keys[child + 1]! < keys[child]!) child++;
        if (keys[child]! >= key) break;
        keys[i] = keys[child]!;
        items[i] = items[child]!;
        i = child;
      }
      keys[i] = key;
      items[i] = item;
    }
    return top;
  }
}

/**
 * How many cells drain through each cell, over a terrain whose hollows are filled. Returns the counts and the
 * cell each one drains to (-1 off the edge).
 */
export function drainage(nx: number, ny: number, elevation: Float32Array): { area: Float32Array; receiver: Int32Array } {
  const n = nx * ny;
  const filled = new Float64Array(n);
  const seen = new Uint8Array(n);
  const order = new Int32Array(n);
  const heap = new Heap();
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      if (ix > 0 && iy > 0 && ix < nx - 1 && iy < ny - 1) continue;
      const i = ix + nx * iy;
      seen[i] = 1;
      filled[i] = elevation[i]!;
      heap.push(filled[i]!, i);
    }
  }
  // Cells leave the heap from low to high, each after the cell it drains to.
  let k = 0;
  while (heap.size) {
    const [level, i] = heap.pop();
    order[k++] = i;
    const ix = i % nx, iy = (i - ix) / nx;
    for (let d = 0; d < 8; d++) {
      const jx = ix + DX[d]!, jy = iy + DY[d]!;
      if (jx < 0 || jy < 0 || jx >= nx || jy >= ny) continue;
      const j = jx + nx * jy;
      if (seen[j]) continue;
      seen[j] = 1;
      // A hollow is filled to a gentle slope towards its outlet, so the water finds its way out across it.
      filled[j] = Math.max(elevation[j]!, level + 1e-3);
      heap.push(filled[j]!, j);
    }
  }
  const receiver = new Int32Array(n).fill(-1);
  const area = new Float32Array(n).fill(1);
  for (let k2 = n - 1; k2 >= 0; k2--) {
    const i = order[k2]!;
    const ix = i % nx, iy = (i - ix) / nx;
    let best = -1, steepest = 0;
    for (let d = 0; d < 8; d++) {
      const jx = ix + DX[d]!, jy = iy + DY[d]!;
      if (jx < 0 || jy < 0 || jx >= nx || jy >= ny) continue;
      const j = jx + nx * jy;
      const slope = (filled[i]! - filled[j]!) / (d < 4 ? 1 : Math.SQRT2);
      if (slope > steepest) ((steepest = slope), (best = j));
    }
    receiver[i] = best;
    if (best >= 0) area[best] = area[best]! + area[i]!;
  }
  return { area, receiver };
}

/** The cells that carry water: 1 for a stream, 2 for a river, joined side to side so the water never breaks. */
export function riverMask(grid: { nx: number; ny: number; cell: number; elevation: Float32Array; environment: Environment }): RiverMask {
  const { nx, ny, cell, elevation } = grid;
  const { area, receiver } = drainage(nx, ny, elevation);
  const threshold = RIVER_AREA_M2[grid.environment] / (cell * cell);
  const mask = new Uint8Array(nx * ny);
  const wet = (i: number, level: number) => {
    if (mask[i]! < level) mask[i] = level;
  };
  for (let i = 0; i < mask.length; i++) {
    if (area[i]! < threshold) continue;
    const level = area[i]! >= threshold * 4 ? 2 : 1;
    wet(i, level);
    const ix = i % nx, iy = (i - ix) / nx;
    const j = receiver[i]!;
    if (j >= 0) {
      const jx = j % nx, jy = (j - jx) / nx;
      // A diagonal step would leave the two cells touching only at a corner: wet the lower of the two between.
      if (jx !== ix && jy !== iy) {
        const a = jx + nx * iy, b = ix + nx * jy;
        wet(elevation[a]! <= elevation[b]! ? a : b, level);
      }
    }
    if (level === 2) {
      // A river spreads over the lowest cell beside it: two cells wide.
      let low = -1;
      for (let d = 0; d < 4; d++) {
        const jx = ix + DX[d]!, jy = iy + DY[d]!;
        if (jx < 0 || jy < 0 || jx >= nx || jy >= ny) continue;
        const k2 = jx + nx * jy;
        if (k2 !== j && area[k2]! < area[i]! && (low < 0 || elevation[k2]! < elevation[low]!)) low = k2;
      }
      if (low >= 0) wet(low, 2);
    }
  }
  return mask;
}

/** Distance in metres from model point x, y to the nearest wet cell, looking no further than `reach`. */
export function distanceToWater(grid: { nx: number; ny: number; cell: number; river?: RiverMask }, x: number, y: number, reach: number): number {
  const { nx, ny, cell, river } = grid;
  if (!river) return Infinity;
  const r = Math.ceil(reach / cell);
  const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
  let best = Infinity;
  for (let iy = Math.max(cy - r, 0); iy <= Math.min(cy + r, ny - 1); iy++) {
    for (let ix = Math.max(cx - r, 0); ix <= Math.min(cx + r, nx - 1); ix++) {
      if (!river[ix + nx * iy]) continue;
      // Distance to the cell's square, zero inside it.
      const dx = Math.max(ix * cell - x, 0, x - (ix + 1) * cell);
      const dy = Math.max(iy * cell - y, 0, y - (iy + 1) * cell);
      best = Math.min(best, Math.hypot(dx, dy));
    }
  }
  return best <= reach ? best : Infinity;
}
