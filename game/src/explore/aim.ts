// What the student is pointing at: a ray from the eye along the line of sight, stopped by the ground.

import { type Grid, heightAt } from "../world/blocks";

export interface Aim {
  ix: number;
  iy: number;
  /** Straight-line distance from the eye, metres. */
  distance: number;
}

/** The ground cell the crosshair points at, within `reach` metres; null when the sky or nothing near. */
export function aimAt(grid: Grid, x: number, y: number, eye: number, heading: number, pitch: number, reach = 14): Aim | null {
  const h = (heading * Math.PI) / 180, p = (pitch * Math.PI) / 180;
  const dx = Math.cos(p) * Math.sin(h), dy = Math.cos(p) * Math.cos(h), dz = Math.sin(p);
  for (let t = 0.5; t <= reach; t += 0.5) {
    const px = x + dx * t, py = y + dy * t, pz = eye + dz * t;
    if (px < 0 || py < 0 || px >= grid.nx * grid.cell || py >= grid.ny * grid.cell) return null;
    if (pz <= heightAt(grid, px, py)) return { ix: Math.floor(px / grid.cell), iy: Math.floor(py / grid.cell), distance: t };
  }
  return null;
}
