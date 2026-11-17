// The one state object of an attempt: where the student is, what time it is, and the field notebook.

import type { Clock } from "../explore/clock";
import type { Discovery } from "../explore/discovery";
import type { Walker } from "../explore/movement";
import type { Scenario } from "../format/types";
import { COVER, type Grid } from "../world/blocks";

export interface Measurement {
  /** What was measured: a plane kind (bedding, dyke...) or a lineation kind (striae...). */
  feature: string;
  /** The plane of the outcrop it belongs to. */
  planeId: string;
  type: "plane" | "line";
  /** Strike and dip for a plane; trend and plunge for a line. Degrees. */
  a: number;
  b: number;
  day: number;
  minutes: number;
}

export interface Note {
  tool: "lens" | "way_up" | "contact";
  lines: string[];
  day: number;
  minutes: number;
}

export interface Station {
  number: number;
  outcrop: string;
  easting: number;
  northing: number;
  elevation: number;
  day: number;
  minutes: number;
  /** What the student calls the rock. The game never suggests a name. */
  rock: string;
  text: string;
  /** Sketch strokes: each a flat list of x, y pairs in 0..1 of the sketch area. */
  sketch: number[][];
  notes: Note[];
  measurements: Measurement[];
}

export interface Sample {
  number: number;
  station: number;
  outcrop: string;
  /** Unit key of the rock that was sampled (the host, or a dyke that cuts it). */
  unit: string;
  analysis: "thin_section" | "age";
  day: number;
}

export interface GameState {
  scenarioId: string;
  variant: string;
  /** Fixes this student's measurement scatter. */
  seed: number;
  walker: Walker;
  clock: Clock;
  found: Discovery;
  /** Metres walked in this attempt. */
  walked: number;
  stations: Station[];
  samples: Sample[];
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

export function newGame(scenario: Scenario, grid: Grid, seed = Math.floor(Math.random() * 2 ** 32)): GameState {
  const start = startPosition(grid);
  return {
    scenarioId: scenario.manifest.scenario_id,
    variant: scenario.manifest.variant,
    seed,
    walker: { x: start.x, y: start.y, heading: 90, pitch: 0 },
    clock: { day: 1, minutes: 0 },
    found: { sighted: new Set(), visited: new Set() },
    walked: 0,
    stations: [],
    samples: [],
  };
}

/** The names the student has given to rocks so far, most used first. */
export function rockNames(state: GameState): string[] {
  const count = new Map<string, number>();
  for (const s of state.stations) if (s.rock.trim()) count.set(s.rock.trim(), (count.get(s.rock.trim()) ?? 0) + 1);
  return [...count.entries()].sort((p, q) => q[1] - p[1] || p[0].localeCompare(q[0])).map(([name]) => name);
}
