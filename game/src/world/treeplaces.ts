// Where trees stand: shared by the trees (trees.ts) and the mesher, which shades the ground under them.
// Kept free of three.js, as the mesher runs in a worker.

import { COVER, type Grid, cellHash } from "./blocks";

export type Species = "pine" | "eucalyptus" | "native" | "sclerophyll" | "espino";

/** The stand a forest cell belongs to: planted pine, planted eucalyptus or native forest, in blocks of 8 to 14 cells. */
export function stand(ix: number, iy: number): Species {
  const size = 8 + Math.floor(6 * cellHash(Math.floor(ix / 24), Math.floor(iy / 24), 31));
  const v = cellHash(Math.floor(ix / size), Math.floor(iy / size), 21);
  return v < 0.34 ? "pine" : v < 0.5 ? "eucalyptus" : "native";
}

/** Whether a tree stands on this cell. The mesher reads it too, to shade the ground under the canopy. */
export function treeAt(grid: Pick<Grid, "cover" | "nx" | "environment">, ix: number, iy: number): boolean {
  if (grid.cover[ix + grid.nx * iy] !== COVER.vegetation) return false;
  if (grid.environment === "forest") return cellHash(ix, iy, 7) <= (stand(ix, iy) === "native" ? 0.6 : 0.82);
  if (grid.environment === "temperate") return cellHash(ix, iy, 7) < 0.13;
  return false;
}
