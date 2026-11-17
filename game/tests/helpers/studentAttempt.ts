// Whole attempts for testing the grader: one built from the answer key, as a perfect student would draw it,
// and random ones.

import type { Scenario, Truth } from "../../src/format/types";
import type { ColumnState, EventType } from "../../src/interpret/column";
import { contourLines } from "../../src/interpret/contours";
import { type MapState, addLine, addPolygon, addUnit, emptyMap, pointInPolygon, signedArea } from "../../src/interpret/mapdata";
import { type SectionLine, type SectionState, sectionLength, trueSection } from "../../src/interpret/section";
import { type GameState, newGame } from "../../src/state/state";
import { generator } from "../../src/tools/random";
import type { Grid } from "../../src/world/blocks";
import { studentMapFromTruth } from "./studentMap";

/** Outer rings of each value of a raster on a lattice (cell centres at x0 + (i + 0.5) dx), largest first. */
export function polygonize(cells: ArrayLike<number>, nx: number, ny: number, x0: number, y0: number, dx: number, dy: number, values: number[]): { value: number; points: number[] }[] {
  const out: { value: number; points: number[]; area: number }[] = [];
  for (const value of values) {
    const w = nx + 2, h = ny + 2;
    const mask = new Float32Array(w * h);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) mask[i + 1 + w * (j + 1)] = cells[i + nx * j] === value ? 1 : 0;
    const rings = contourLines(mask, w, h, x0 - 0.5 * dx, y0 - 0.5 * dy, dx, dy, 0.5)
      .filter((l) => l.length > 8 && l[0] === l[l.length - 2] && l[1] === l[l.length - 1])
      .map((l) => ({ points: l.slice(0, -2), area: Math.abs(signedArea(l.slice(0, -2))) }));
    for (const r of rings) {
      const depth = rings.filter((o) => o !== r && o.area > r.area && pointInPolygon(r.points[0]!, r.points[1]!, o.points)).length;
      if (depth % 2 === 0) out.push({ value, ...r });
    }
  }
  return out.sort((a, b) => b.area - a.area);
}

/** A west-to-east line through the middle of the area. */
export function middleLine(grid: Grid): SectionLine {
  const w = grid.nx * grid.cell, h = grid.ny * grid.cell;
  return { x1: 0.04 * w, y1: 0.5 * h, x2: 0.96 * w, y2: 0.5 * h };
}

export function perfectAttempt(scenario: Scenario, truth: Truth, litho: Uint8Array, grid: Grid): GameState {
  const state = newGame(scenario, grid, 1);
  state.map = studentMapFromTruth(scenario, truth, { simplify: 3 });
  const unitId = (index: number) => state.map.units[index]!.id; // studentMapFromTruth adds units in scenario order
  const keyIndex = new Map(truth.units.map((u, i) => [u.key, i]));

  const line = middleLine(grid);
  const t = trueSection(litho, scenario.manifest, grid, line);
  const dd = sectionLength(line) / t.nd;
  const section: SectionState = { line, polygons: [], lines: [], nextId: 1 };
  for (const ring of polygonize(t.cells, t.nd, t.nz, 0, t.z0, dd, t.dz, truth.units.map((_, i) => i))) {
    section.polygons.push({ id: section.nextId++, unit: unitId(ring.value), points: ring.points });
  }
  state.section = section;

  const column: ColumnState = { rows: [], events: [], nextId: 1 };
  for (const row of truth.column) column.rows.push({ unit: unitId(keyIndex.get(row.unit)!), thickness: row.thickness_m, base: row.base_contact });
  for (const e of [...truth.events].sort((a, b) => a.rank - b.rank)) {
    column.events.push({ id: column.nextId++, type: e.type, ...(e.units?.length ? { unit: unitId(keyIndex.get(e.units[0]!)!) } : {}) });
  }
  state.column = column;

  // Stations at half of the key outcrops and at every tenth other outcrop, each with the true
  // attitude of its first plane, a name and notes; and the sense read from any kinematic indicator.
  const key = new Set(truth.key_outcrops.filter((_, i) => i % 2 === 0));
  const visited = scenario.outcrops.filter((o, i) => key.has(o.id) || i % 10 === 0);
  for (const [n, o] of visited.entries()) {
    const plane = o.observation?.planes[0];
    const k = o.observation?.kinematic;
    state.stations.push({
      number: n + 1, outcrop: o.id, easting: o.position.easting, northing: o.position.northing, elevation: o.position.elevation, day: 1, minutes: 0,
      rock: "roca", text: "notas", sketch: [],
      notes: k ? [{ tool: "kinematics", lines: [], day: 1, minutes: 0 }] : [],
      measurements: plane ? [{ feature: plane.kind, planeId: plane.id, type: "plane", a: plane.strike, b: plane.dip, day: 1, minutes: 0 }] : [],
      ...(k ? { sense: k.sense } : {}),
    });
  }
  return state;
}

const EVENT_TYPES: EventType[] = ["deposition", "tilting", "folding", "faulting", "intrusion", "erosion", "metamorphism", "uplift"];

export function randomAttempt(scenario: Scenario, grid: Grid, seed: number): GameState {
  const random = generator(seed);
  const state = newGame(scenario, grid, seed);
  const w = grid.nx * grid.cell, h = grid.ny * grid.cell;
  const map: MapState = emptyMap();
  const units = ["unidad A", "unidad B", "unidad C", "unidad D", "unidad E", "unidad F"].map((n) => addUnit(map, n).id);
  const pick = <T>(xs: T[]) => xs[Math.floor(random() * xs.length)]!;
  addPolygon(map, pick(units), [0, 0, w, 0, w, h, 0, h]); // a background, then patches
  for (let i = 0; i < 14; i++) {
    const cx = random() * w, cy = random() * h, r = 150 + random() * 500;
    const pts: number[] = [];
    for (let k = 0; k < 6; k++) pts.push(cx + Math.cos((k / 6) * 2 * Math.PI) * r * (0.6 + 0.4 * random()), cy + Math.sin((k / 6) * 2 * Math.PI) * r * (0.6 + 0.4 * random()));
    addPolygon(map, pick(units), pts);
  }
  for (let i = 0; i < 4; i++) addLine(map, i === 3 ? "fault" : "contact", pick(["solid", "dashed", "inferred"] as const), [random() * w, random() * h, random() * w, random() * h], "normal");
  state.map = map;

  const line = { x1: random() * w, y1: random() * h, x2: random() * w, y2: random() * h };
  const length = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
  const section: SectionState = { line, polygons: [], lines: [], nextId: 1 };
  const z0 = scenario.manifest.grid.origin.elevation, top = z0 + scenario.manifest.grid.nz * scenario.manifest.grid.cell_size_m.z;
  section.polygons.push({ id: section.nextId++, unit: pick(units), points: [0, z0, length, z0, length, top, 0, top] });
  for (let i = 0; i < 6; i++) {
    const d = random() * length, z = z0 + random() * (top - z0), a = 100 + random() * 400, b = 50 + random() * 200;
    section.polygons.push({ id: section.nextId++, unit: pick(units), points: [d - a, z - b, d + a, z - b, d + a, z + b, d - a, z + b] });
  }
  state.section = section;

  const order = [...units].sort(() => random() - 0.5);
  state.column = {
    rows: order.map((u) => ({ unit: u, base: pick(["depositional", "unconformity", "intrusive", "fault", "not_exposed"] as const) })),
    events: Array.from({ length: 7 }, (_, i) => ({ id: i + 1, type: pick(EVENT_TYPES), unit: pick(units) })),
    nextId: 8,
  };
  for (let n = 0; n < 3; n++) {
    const o = pick(scenario.outcrops);
    state.stations.push({ number: n + 1, outcrop: o.id, easting: o.position.easting, northing: o.position.northing, elevation: o.position.elevation, day: 1, minutes: 0, rock: "", text: "", sketch: [], notes: [], measurements: [] });
  }
  return state;
}
