// The one state object of an attempt: where the student is, what time it is, and the field notebook.

import type { Clock } from "../explore/clock";
import type { Discovery } from "../explore/discovery";
import type { Walker } from "../explore/movement";
import type { Scenario } from "../format/types";
import { type ColumnState, emptyColumn } from "../interpret/column";
import { type MapState, emptyMap } from "../interpret/mapdata";
import { type SectionState, emptySection } from "../interpret/section";
import { COVER, type Grid } from "../world/blocks";

/** Campaign: field days, slopes that cost time, limited samples. Free: no clock, no effort, lab results at once. */
export type Mode = "campaign" | "free";

export interface Measurement {
  /** What was measured: a plane kind (bedding, dyke...) or a lineation kind (striae...). */
  feature: string;
  /** The plane of the outcrop it belongs to. */
  planeId: string;
  type: "plane" | "line";
  /** As the student wrote it down, read back: strike (right-hand rule) and dip for a plane, trend and plunge for a line. */
  a: number;
  b: number;
  /** What the compass showed, in the same form; the student may have misread or miswritten it. */
  read?: { a: number; b: number };
  /** The notation the student used, and the text exactly as typed. */
  notation?: "rhr" | "dipdir" | "quadrant" | "trend_plunge";
  entered?: string;
  day: number;
  minutes: number;
}

export interface Note {
  tool: "lens" | "way_up" | "contact" | "kinematics";
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
  /** The map unit the student assigns to the rock here (an id in map.units). */
  unit?: number;
  /** The sense of slip the student reads from a kinematic indicator here. */
  sense?: "normal" | "reverse" | "dextral" | "sinistral" | "unknown";
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
  mode: Mode;
  /** How the student writes planes down; remembered between readings. */
  notation: "rhr" | "dipdir" | "quadrant";
  walker: Walker;
  clock: Clock;
  found: Discovery;
  /** Metres walked in this attempt; flying does not count. */
  walked: number;
  /** Free mode only: whether the student flies, and how high over the ground. */
  flight: { on: boolean; height: number };
  stations: Station[];
  samples: Sample[];
  /** The student's geological map: units, contacts, faults and polygons. */
  map: MapState;
  /** The cross-section along a line the student chose, drawn with the map's units. */
  section: SectionState;
  /** The stratigraphic column and the geological history. */
  column: ColumnState;
  /** Blocks broken with the hammer: pairs of near-block index and steps lowered (see Grid.dug). */
  dug?: number[];
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

export function newGame(scenario: Scenario, grid: Grid, seed = Math.floor(Math.random() * 2 ** 32), mode: Mode = "campaign"): GameState {
  const start = startPosition(grid);
  return {
    scenarioId: scenario.manifest.scenario_id,
    variant: scenario.manifest.variant,
    seed,
    mode,
    notation: "rhr",
    walker: { x: start.x, y: start.y, heading: 90, pitch: 0 },
    clock: { day: 1, minutes: 0 },
    found: { sighted: new Set(), visited: new Set() },
    walked: 0,
    flight: { on: false, height: 0 },
    stations: [],
    samples: [],
    map: emptyMap(),
    section: emptySection(),
    column: emptyColumn(),
    dug: [],
  };
}

/** The names the student has given to rocks so far, most used first. */
export function rockNames(state: GameState): string[] {
  const count = new Map<string, number>();
  for (const s of state.stations) if (s.rock.trim()) count.set(s.rock.trim(), (count.get(s.rock.trim()) ?? 0) + 1);
  return [...count.entries()].sort((p, q) => q[1] - p[1] || p[0].localeCompare(q[0])).map(([name]) => name);
}
