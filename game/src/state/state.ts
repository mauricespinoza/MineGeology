// The one state object of an attempt. Work package 5 adds stations, measurements and the local save.

import type { Clock } from "../explore/clock";
import type { Discovery } from "../explore/discovery";
import type { Walker } from "../explore/movement";
import type { Scenario } from "../format/types";
import { COVER, type Grid } from "../world/blocks";

export interface GameState {
  scenarioId: string;
  variant: string;
  walker: Walker;
  clock: Clock;
  found: Discovery;
  /** Metres walked in this attempt. */
  walked: number;
}

/** Camp: the valley-floor cell closest to the middle of the area, or the middle itself. */
export function startPosition(grid: Grid): { x: number; y: number } {
  const cx = grid.nx / 2, cy = grid.ny / 2;
  let best = -1, bestDistance = Infinity;
  for (let i = 0; i < grid.cover.length; i++) {
    if (grid.cover[i] !== COVER.alluvium) continue;
    const d = Math.hypot((i % grid.nx) - cx, Math.floor(i / grid.nx) - cy);
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  }
  const ix = best >= 0 ? best % grid.nx : Math.floor(cx);
  const iy = best >= 0 ? Math.floor(best / grid.nx) : Math.floor(cy);
  return { x: (ix + 0.5) * grid.cell, y: (iy + 0.5) * grid.cell };
}

export function newGame(scenario: Scenario, grid: Grid): GameState {
  const start = startPosition(grid);
  return {
    scenarioId: scenario.manifest.scenario_id,
    variant: scenario.manifest.variant,
    walker: { x: start.x, y: start.y, heading: 90, pitch: 0 },
    clock: { day: 1, minutes: 0 },
    found: { sighted: new Set(), visited: new Set() },
    walked: 0,
  };
}
