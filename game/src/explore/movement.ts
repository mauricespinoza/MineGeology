// Walking model: how fast the student moves on screen and how much field time it costs.

import { COVER, type Grid, heightAt } from "../world/blocks";

/** On-screen speed on flat open ground, m/s. Field time is compressed: see fieldMinutes. */
export const SCREEN_SPEED = 14;
/** The camera sits above a person's eyes so that one terrain step does not block the view. */
export const EYE_HEIGHT = 3.2;
const VEGETATION_FACTOR = 0.6;

/** Tobler's hiking function: walking speed in km/h for a slope given as rise over run (uphill positive). */
export function hikingSpeedKmh(slope: number): number {
  return 6 * Math.exp(-3.5 * Math.abs(slope + 0.05));
}

/** Speed relative to flat open ground, from the ground slope along the walking direction and the cover. */
export function speedFactor(slope: number, cover: number): number {
  const terrain = hikingSpeedKmh(slope) / hikingSpeedKmh(0);
  return Math.max(terrain, 0.12) * (cover === COVER.vegetation ? VEGETATION_FACTOR : 1);
}

/** Field minutes needed to walk `distance` metres at the given relative speed. */
export function fieldMinutes(distance: number, factor: number): number {
  return distance / ((hikingSpeedKmh(0) * factor * 1000) / 60);
}

/** How much of the field slowdown is shown on screen. */
export function screenFactor(factor: number): number {
  return 0.4 + 0.6 * factor;
}

export interface Walker {
  /** Metres east and north of the south-west corner. */
  x: number;
  y: number;
  /** Azimuth the student faces, degrees clockwise from north. */
  heading: number;
  /** Looking up (positive) or down, degrees. */
  pitch: number;
}

export interface StepResult {
  distance: number;
  minutes: number;
}

/**
 * Move for `dt` seconds. `forward` and `right` are in [-1, 1]. Slope is taken over about two blocks along
 * the direction of travel, so single steps of the blocky surface do not stop the walker.
 */
export function step(walker: Walker, grid: Grid, forward: number, right: number, dt: number): StepResult {
  const length = Math.hypot(forward, right);
  if (length < 1e-3) return { distance: 0, minutes: 0 };
  const a = (walker.heading * Math.PI) / 180;
  const dx = (forward * Math.sin(a) + right * Math.cos(a)) / Math.max(length, 1);
  const dy = (forward * Math.cos(a) - right * Math.sin(a)) / Math.max(length, 1);
  const norm = Math.hypot(dx, dy);
  const probe = 2 * grid.cell;
  const here = heightAt(grid, walker.x, walker.y);
  const ahead = heightAt(grid, walker.x + (dx / norm) * probe, walker.y + (dy / norm) * probe);
  const ix = Math.min(Math.max(Math.floor(walker.x / grid.cell), 0), grid.nx - 1);
  const iy = Math.min(Math.max(Math.floor(walker.y / grid.cell), 0), grid.ny - 1);
  const factor = speedFactor((ahead - here) / probe, grid.cover[ix + grid.nx * iy]!);

  // On screen, slopes slow the student less than they cost in field time, or steep ground would be a chore.
  const screen = SCREEN_SPEED * screenFactor(factor);
  const margin = 0.5;
  const nx = Math.min(Math.max(walker.x + dx * screen * dt, margin), grid.nx * grid.cell - margin);
  const ny = Math.min(Math.max(walker.y + dy * screen * dt, margin), grid.ny * grid.cell - margin);
  const distance = Math.hypot(nx - walker.x, ny - walker.y);
  walker.x = nx;
  walker.y = ny;
  return { distance, minutes: fieldMinutes(distance, factor) };
}
