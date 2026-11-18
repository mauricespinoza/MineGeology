// What the student is pointing at: a ray from the eye along the line of sight, stopped by the ground.

import { type Grid, heightAt } from "../world/blocks";

export interface Aim {
  ix: number;
  iy: number;
  /** Straight-line distance from the eye, metres. */
  distance: number;
}

export interface Hit extends Aim {
  /** Where the ray meets the ground, model metres (x east, y north, z up). */
  x: number;
  y: number;
  z: number;
}

/** Marches a ray from (ox, oy, oz) along the unit direction (dx, dy, dz) to the first ground it meets within `reach` metres. */
export function rayHit(grid: Grid, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, reach: number, step = 0.25): Hit | null {
  for (let t = step; t <= reach; t += step) {
    const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
    if (px < 0 || py < 0 || px >= grid.nx * grid.cell || py >= grid.ny * grid.cell) return null;
    const ground = heightAt(grid, px, py);
    if (pz <= ground) return { ix: Math.floor(px / grid.cell), iy: Math.floor(py / grid.cell), distance: t, x: px, y: py, z: ground };
  }
  return null;
}

/** The ground cell the crosshair points at, within `reach` metres; null when the sky or nothing near. */
export function aimAt(grid: Grid, x: number, y: number, eye: number, heading: number, pitch: number, reach = 14): Aim | null {
  const h = (heading * Math.PI) / 180, p = (pitch * Math.PI) / 180;
  const hit = rayHit(grid, x, y, eye, Math.cos(p) * Math.sin(h), Math.cos(p) * Math.cos(h), Math.sin(p), reach, 0.5);
  return hit && { ix: hit.ix, iy: hit.iy, distance: hit.distance };
}
