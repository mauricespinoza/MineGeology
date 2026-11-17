// The automatic grade: the student's map, structures, cross-section, column and history, and field practice,
// compared with the hidden model. Shared by practice mode in the browser and, later, by the server.
// The score is a proposal: the teacher reviews it before it is released.

import { expandTruthMap } from "../format/loader";
import type { Scenario, Truth } from "../format/types";
import type { ColumnState } from "../interpret/column";
import { type MapState, distanceToSegment, rasterize } from "../interpret/mapdata";
import { type SectionState, rasterizeSection, sectionLength, trueSection } from "../interpret/section";
import { collect, fitOrientations, lineVector, vectorOf } from "../interpret/stereonet";
import type { GameState } from "../state/state";
import type { Grid } from "../world/blocks";
import { type Matching, kappa, matchUnits } from "./match";

export type PartKey = "map" | "structures" | "section" | "column" | "field";

export const WEIGHTS: Record<PartKey, number> = { map: 0.35, structures: 0.2, section: 0.2, column: 0.15, field: 0.1 };
export const PART_NAMES: Record<PartKey, string> = {
  map: "Mapa geológico",
  structures: "Estructuras",
  section: "Perfil (corte geológico)",
  column: "Columna e historia",
  field: "Práctica de terreno",
};
/** Distance, in metres, at which a line stops counting as on a contact; inferred lines are given more room. */
export const TOLERANCE = { solid: 30, dashed: 45, inferred: 60 } as const;

export interface Part {
  key: PartKey;
  /** 0 to 1, or null when it does not apply (no faults or folds in the area, say). */
  score: number | null;
  weight: number;
  notes: string[];
}

export interface Grade {
  /** 0 to 1. */
  total: number;
  parts: Part[];
  /** Which true units each student unit stood for. */
  pairs: { student: number; trueUnits: number[] }[];
}

export interface GradeInput {
  scenario: Scenario;
  truth: Truth;
  /** The lithology block; without it the cross-section is not graded. */
  litho: Uint8Array | null;
  grid: Grid;
  state: GameState;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const pct = (v: number) => `${Math.round(v * 100)} %`;

type Seg = [number, number, number, number, number]; // x1, y1, x2, y2, tolerance

/** Points every `step` metres along a polyline given as flat x, y pairs. */
export function samples(points: number[], step = 10): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 3 < points.length; i += 2) {
    const ax = points[i]!, ay = points[i + 1]!, bx = points[i + 2]!, by = points[i + 3]!;
    const n = Math.max(Math.ceil(Math.hypot(bx - ax, by - ay) / step), 1);
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  if (points.length >= 2) out.push([points[points.length - 2]!, points[points.length - 1]!]);
  return out;
}

function segments(points: number[], tolerance: number, closed = false): Seg[] {
  const out: Seg[] = [];
  const n = points.length / 2;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const j = (i + 1) % n;
    out.push([points[2 * i]!, points[2 * i + 1]!, points[2 * j]!, points[2 * j + 1]!, tolerance]);
  }
  return out;
}

/** Credit for a point near lines: 1 on a line, 0 beyond that line's tolerance; the best line counts. */
function credit(x: number, y: number, segs: Seg[]): { credit: number; distance: number } {
  let best = 0, nearest = Infinity;
  for (const [ax, ay, bx, by, tol] of segs) {
    const d = distanceToSegment(x, y, ax, ay, bx, by);
    if (d < nearest) nearest = d;
    const c = 1 - d / tol;
    if (c > best) best = c;
  }
  return { credit: best, distance: nearest };
}

function trueLines(truth: Truth, scenario: Scenario, fault: boolean): number[][] {
  const o = scenario.manifest.grid.origin;
  return truth.contacts.features
    .filter((f) => (f.properties.type === "fault") === fault)
    .map((f) => f.geometry.coordinates.flatMap(([e, n]) => [e - o.easting, n - o.northing]));
}

/** Outline segments of the student's areas, without those along the edge of the map, which are not contacts. */
function outlineSegments(map: MapState, width: number, height: number): Seg[] {
  const edge = 12;
  const onEdge = (x: number, y: number) => x < edge || y < edge || x > width - edge || y > height - edge;
  return map.polygons.flatMap((p) => segments(p.points, TOLERANCE.solid, true)).filter(([ax, ay, bx, by]) => !(onEdge(ax, ay) && onEdge(bx, by)));
}

function gradeMap(input: GradeInput, painted: Int32Array, trueMap: Uint8Array, matching: Matching): Part {
  const { scenario, truth, state, grid } = input;
  const notes: string[] = [];
  const area = kappa(painted, trueMap, matching);
  const covered = painted.filter((v) => v >= 0).length / painted.length;
  notes.push(`Coincidencia de áreas con el mapa verdadero, corregida por azar: ${pct(area)} (${pct(covered)} del área pintada).`);

  const contacts = trueLines(truth, scenario, false);
  if (!contacts.length) return { key: "map", score: area, weight: WEIGHTS.map, notes };
  const drawn = state.map.lines.filter((l) => l.kind === "contact").flatMap((l) => segments(l.points, TOLERANCE[l.style]));
  const outline = outlineSegments(state.map, grid.nx * grid.cell, grid.ny * grid.cell);
  const all = [...drawn, ...outline];
  if (!all.length) {
    notes.push("No hay contactos dibujados.");
    return { key: "map", score: 0.7 * area, weight: WEIGHTS.map, notes };
  }
  const truePoints = contacts.flatMap((l) => samples(l));
  const recall = truePoints.reduce((sum, [x, y]) => sum + clamp01(credit(x, y, all).credit), 0) / truePoints.length;
  // Precision: every drawn contact should lie on a true one; a confident line far from any contact costs more.
  const trueSegs = contacts.flatMap((l) => segments(l, 1));
  const own = drawn.length ? state.map.lines.filter((l) => l.kind === "contact") : [];
  const studentPoints: [number, number, number][] = own.length
    ? own.flatMap((l) => samples(l.points).map(([x, y]) => [x, y, TOLERANCE[l.style]] as [number, number, number]))
    : outline.flatMap(([ax, ay, bx, by]) => samples([ax, ay, bx, by]).map(([x, y]) => [x, y, TOLERANCE.solid] as [number, number, number]));
  const precision = studentPoints.reduce((sum, [x, y, tol]) => sum + clamp01(1 - credit(x, y, trueSegs).distance / tol), 0) / Math.max(studentPoints.length, 1);
  const lines = (recall + precision) / 2;
  notes.push(`Contactos: ${pct(recall)} de los contactos verdaderos trazados; ${pct(precision)} de lo trazado cae sobre un contacto verdadero.`);
  return { key: "map", score: 0.7 * area + 0.3 * lines, weight: WEIGHTS.map, notes };
}

const SAME_KINEMATICS: Record<string, string> = { thrust: "reverse" };
const sameKinematics = (a?: string, b?: string) => !!a && !!b && (SAME_KINEMATICS[a] ?? a) === (SAME_KINEMATICS[b] ?? b);

function gradeStructures(input: GradeInput): Part {
  const { scenario, truth, state } = input;
  const notes: string[] = [];
  const faults = truth.contacts.features.filter((f) => f.properties.type === "fault");
  const studentFaults = state.map.lines.filter((l) => l.kind === "fault");
  const parts: number[] = [];
  if (!faults.length && !truth.fold_axes.length) {
    if (!studentFaults.length) return { key: "structures", score: null, weight: WEIGHTS.structures, notes: ["El área no tiene fallas ni pliegues mayores: no se evalúa."] };
    notes.push(`Dibujaste ${studentFaults.length} ${studentFaults.length === 1 ? "falla" : "fallas"} donde el modelo no tiene ninguna.`);
    return { key: "structures", score: 0, weight: WEIGHTS.structures, notes };
  }
  if (faults.length) {
    const o = scenario.manifest.grid.origin;
    const used = new Set<number>();
    const scores = faults.map((f) => {
      const pts = samples(f.geometry.coordinates.flatMap(([e, n]) => [e - o.easting, n - o.northing]));
      let best = -1, bestDistance = Infinity;
      studentFaults.forEach((l, i) => {
        const segs = segments(l.points, 1);
        const mean = pts.reduce((sum, [x, y]) => sum + credit(x, y, segs).distance, 0) / pts.length;
        if (mean < bestDistance) ((bestDistance = mean), (best = i));
      });
      if (best < 0 || bestDistance > 150) return 0;
      used.add(best);
      const kin = studentFaults[best]!.kinematics;
      const kinematics = sameKinematics(kin, f.properties.kinematics) ? 1 : kin ? 0 : 0.25;
      return 0.4 + 0.4 * clamp01(1 - bestDistance / 60) + 0.2 * kinematics;
    });
    const precision = studentFaults.length ? used.size / studentFaults.length : 1;
    const faultScore = (scores.reduce((a, b) => a + b, 0) / scores.length) * (0.5 + 0.5 * precision);
    notes.push(`Fallas: ${scores.filter((s) => s > 0).length} de ${faults.length} encontradas; ${studentFaults.length - used.size} dibujadas de más.`);
    parts.push(faultScore);
  }
  if (truth.fold_axes.length) {
    const fit = fitOrientations(collect(state.stations, { feature: "bedding" }).map(vectorOf));
    if (fit && fit.shape === "girdle") {
      const axis = lineVector(fit.girdleAxis.trend, fit.girdleAxis.plunge);
      const errors = truth.fold_axes.map((f) => {
        const t = lineVector(f.trend, f.plunge);
        return (Math.acos(Math.min(1, Math.abs(axis[0] * t[0] + axis[1] * t[1] + axis[2] * t[2]))) * 180) / Math.PI;
      });
      const error = Math.min(...errors);
      notes.push(`Eje de pliegue de tus mediciones: error de ${Math.round(error)}°.`);
      parts.push(clamp01(1 - error / 30));
    } else {
      notes.push("Tus mediciones de estratificación no definen un eje de pliegue.");
      parts.push(0);
    }
  }
  return { key: "structures", score: parts.reduce((a, b) => a + b, 0) / parts.length, weight: WEIGHTS.structures, notes };
}

function gradeSection(input: GradeInput, matching: Matching): Part {
  const { state, litho, scenario, grid } = input;
  const section: SectionState = state.section;
  if (!litho) return { key: "section", score: null, weight: WEIGHTS.section, notes: ["Sin el bloque del modelo no se puede revisar el perfil."] };
  if (!section.line || sectionLength(section.line) < 50 || !section.polygons.length) {
    return { key: "section", score: 0, weight: WEIGHTS.section, notes: ["No hay un perfil dibujado."] };
  }
  const t = trueSection(litho, scenario.manifest, grid, section.line);
  const length = sectionLength(section.line);
  const drawn = rasterizeSection(section, t.nd, t.nz, length, t.z0, t.dz);
  // The top 500 m below the ground count fully; deeper, less.
  const weight = new Float32Array(t.cells.length);
  for (let i = 0; i < t.nd; i++) {
    let top = -1;
    for (let k = t.nz - 1; k >= 0; k--) if (t.cells[i + t.nd * k]! >= 0) ((top = k), (k = -1));
    for (let k = 0; k <= top; k++) weight[i + t.nd * k] = (top - k) * t.dz < 500 ? 1 : 0.3;
  }
  const score = kappa(drawn, t.cells, matching, weight);
  return { key: "section", score, weight: WEIGHTS.section, notes: [`Coincidencia del perfil con el corte verdadero, corregida por azar y con más peso en los primeros 500 m: ${pct(score)}.`] };
}

/** Kendall's tau between two orderings of the same items; 0 when fewer than two pairs can be compared. */
export function tau(a: number[], b: number[]): number {
  let concordant = 0, discordant = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      const s = Math.sign(a[j]! - a[i]!) * Math.sign(b[j]! - b[i]!);
      if (s > 0) concordant++;
      else if (s < 0) discordant++;
    }
  }
  return concordant + discordant ? (concordant - discordant) / (concordant + discordant) : 0;
}

function gradeColumn(input: GradeInput, matching: Matching, onMap: Set<number>): Part {
  const { truth, state } = input;
  const column: ColumnState = state.column;
  const notes: string[] = [];
  const keyIndex = new Map(truth.units.map((u, i) => [u.key, i]));
  const truePosition = new Map(truth.column.map((r, i) => [keyIndex.get(r.unit)!, i]));

  let columnScore = 0;
  const rows = column.rows.map((r) => ({ row: r, cls: matching.classes.get(r.unit) })).filter((r) => r.cls && r.cls.some((t) => truePosition.has(t)));
  if (rows.length) {
    const position = rows.map((r) => Math.min(...r.cls!.filter((t) => truePosition.has(t)).map((t) => truePosition.get(t)!)));
    const order = Math.max(0, rows.length > 1 ? tau(rows.map((_, i) => i), position) : 1);
    const coveredTrue = new Set(rows.flatMap((r) => r.cls!.filter((t) => truePosition.has(t))));
    const coverage = coveredTrue.size / truth.column.length;
    const contactsRight = rows.filter((r, i) => truth.column[position[i]!]!.base_contact === r.row.base).length / rows.length;
    columnScore = 0.7 * order * coverage + 0.3 * contactsRight;
    notes.push(`Columna: orden ${pct(order)}, ${pct(coverage)} de las unidades, contactos basales correctos ${pct(contactsRight)}.`);
  } else notes.push("La columna no tiene unidades del mapa.");

  // History: pair each true event with a student event of the same kind (and unit, where it has one).
  const events = column.events;
  const used = new Set<number>();
  const pairs: [number, number][] = []; // true rank, student position
  for (const e of [...truth.events].sort((a, b) => a.rank - b.rank)) {
    // Units that are not areas on the map (dykes, drawn as lines) cannot be matched: the kind of event is enough.
    const units = (e.units ?? []).map((k) => keyIndex.get(k)!).filter((t) => onMap.has(t));
    const at = events.findIndex((s, i) => {
      if (used.has(i) || s.type !== e.type) return false;
      if (!units.length) return true;
      const cls = s.unit === undefined ? undefined : matching.classes.get(s.unit);
      return !!cls && cls.some((t) => units.includes(t));
    });
    if (at >= 0) (used.add(at), pairs.push([e.rank, at]));
  }
  let historyScore = 0;
  if (events.length && pairs.length) {
    const recall = pairs.length / truth.events.length, precision = pairs.length / events.length;
    const f1 = (2 * recall * precision) / (recall + precision);
    const order = Math.max(0, pairs.length > 1 ? tau(pairs.map((p) => p[0]), pairs.map((p) => p[1])) : 1);
    historyScore = f1 * (0.3 + 0.7 * order);
    notes.push(`Historia: ${pairs.length} de ${truth.events.length} eventos reconocidos, ${events.length - pairs.length} de más; orden ${pct(order)}.`);
  } else notes.push("La historia no tiene eventos que correspondan a los del modelo.");
  return { key: "column", score: 0.5 * columnScore + 0.5 * historyScore, weight: WEIGHTS.column, notes };
}

function gradeField(input: GradeInput): Part {
  const { truth, state, scenario } = input;
  const stations = state.stations;
  if (!stations.length) return { key: "field", score: 0, weight: WEIGHTS.field, notes: ["No hay estaciones en la libreta."] };
  const at = new Set(stations.map((s) => s.outcrop));
  const key = truth.key_outcrops.length ? truth.key_outcrops : scenario.outcrops.map((o) => o.id);
  const target = Math.max(1, Math.ceil(key.length * (truth.key_outcrops.length ? 0.4 : 0.1)));
  const coverage = clamp01(key.filter((id) => at.has(id)).length / target);
  const density = stations.filter((s) => s.measurements.length > 0).length / stations.length;
  const complete = stations.filter((s) => s.rock && (s.text.trim() || s.notes.some((n) => n.tool === "lens"))).length / stations.length;
  return {
    key: "field",
    score: 0.5 * coverage + 0.25 * density + 0.25 * complete,
    weight: WEIGHTS.field,
    notes: [`Afloramientos clave visitados: ${pct(coverage)} de lo esperado; estaciones con mediciones ${pct(density)}; con roca nombrada y notas ${pct(complete)}.`],
  };
}

export function grade(input: GradeInput): Grade {
  const { scenario, truth, state, grid } = input;
  const painted = rasterize(state.map, grid.nx, grid.ny, grid.cell);
  const trueMap = expandTruthMap(truth, scenario.manifest);
  const keyIndex = new Map(truth.units.map((u, i) => [u.key, i]));
  const lumpable = truth.lumpable.map((g) => g.map((k) => keyIndex.get(k)!));
  const used = [...new Set(painted)].filter((u) => u >= 0);
  const matching = matchUnits(painted, trueMap, used, truth.units.length, lumpable);
  const parts = [gradeMap(input, painted, trueMap, matching), gradeStructures(input), gradeSection(input, matching), gradeColumn(input, matching, new Set(trueMap)), gradeField(input)];
  const applicable = parts.filter((p) => p.score !== null);
  const weightSum = applicable.reduce((sum, p) => sum + p.weight, 0);
  const total = weightSum ? applicable.reduce((sum, p) => sum + p.weight * clamp01(p.score!), 0) / weightSum : 0;
  return { total, parts, pairs: [...matching.classes].map(([student, trueUnits]) => ({ student, trueUnits })) };
}
