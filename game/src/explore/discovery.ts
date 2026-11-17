// Fog of war for the map: the topography is known from the start, outcrops are not.
// An outcrop is "sighted" when seen from afar along a clear line of sight and "visited" when the
// student comes close enough to see what rock it is.

import type { Scenario } from "../format/types";
import { type Grid, heightAt } from "../world/blocks";
import { EYE_HEIGHT } from "./movement";

export const VISIT_RADIUS_M = 60;
export const SIGHT_RADIUS_M = 450;

export interface Discovery {
  sighted: Set<number>;
  visited: Set<number>;
}

/** True when nothing between the eye and the target rises above the straight line joining them. */
export function lineOfSight(grid: Grid, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  const distance = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.ceil(distance / (grid.cell / 2));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (heightAt(grid, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t) > z0 + (z1 - z0) * t + 0.01) return false;
  }
  return true;
}

/** Updates `found` for a student standing at x, y. Returns the outcrop numbers newly sighted or visited. */
export function discover(scenario: Scenario, grid: Grid, found: Discovery, x: number, y: number): number[] {
  const origin = scenario.manifest.grid.origin;
  const eye = heightAt(grid, x, y) + EYE_HEIGHT;
  const fresh: number[] = [];
  scenario.outcrops.forEach((outcrop, n) => {
    if (found.visited.has(n)) return;
    const ox = outcrop.position.easting - origin.easting;
    const oy = outcrop.position.northing - origin.northing;
    const distance = Math.hypot(ox - x, oy - y);
    if (distance <= VISIT_RADIUS_M) {
      found.visited.add(n);
      found.sighted.add(n);
      fresh.push(n);
    } else if (distance <= SIGHT_RADIUS_M && !found.sighted.has(n)) {
      if (lineOfSight(grid, x, y, eye, ox, oy, heightAt(grid, ox, oy) + 0.5)) {
        found.sighted.add(n);
        fresh.push(n);
      }
    }
  });
  return fresh;
}

/** The outcrop under or nearest to the student within `reach` metres, or -1. */
export function outcropInReach(scenario: Scenario, grid: Grid, x: number, y: number, reach = 12): number {
  const ix = Math.floor(x / grid.cell), iy = Math.floor(y / grid.cell);
  const span = Math.ceil(reach / grid.cell);
  let best = -1, bestDistance = Infinity;
  for (let jy = Math.max(iy - span, 0); jy <= Math.min(iy + span, grid.ny - 1); jy++) {
    for (let jx = Math.max(ix - span, 0); jx <= Math.min(ix + span, grid.nx - 1); jx++) {
      const n = grid.outcrop[jx + grid.nx * jy]!;
      if (n < 0) continue;
      const cx = Math.min(Math.max(x, jx * grid.cell), (jx + 1) * grid.cell);
      const cy = Math.min(Math.max(y, jy * grid.cell), (jy + 1) * grid.cell);
      const distance = Math.hypot(cx - x, cy - y);
      if (distance <= reach && distance < bestDistance) {
        best = n;
        bestDistance = distance;
      }
    }
  }
  return best;
}
