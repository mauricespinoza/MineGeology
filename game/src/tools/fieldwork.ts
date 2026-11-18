// The field tools. Each one reads what the outcrop shows, writes it in the notebook and costs field time.
// The game reports observations; naming the rock and correlating outcrops is the student's work.

import { type ClockRules, dayState } from "../explore/clock";
import type { Outcrop, Plane, Scenario, Truth, Unit } from "../format/types";
import type { GameState, Measurement, Note, Sample, Station } from "../state/state";
import { INDICATOR_TEXT } from "../ui/kinematicSketch";
import { readLine, readPlane, readingSeed } from "./compass";

/** Field minutes per use. */
export const COST = { lens: 5, compass: 3, way_up: 5, contact: 15, kinematics: 10, sample: 30 } as const;

export const PLANE_NAMES: Record<Plane["kind"], string> = {
  bedding: "estratificación",
  foliation: "foliación",
  cleavage: "clivaje",
  fault_plane: "plano de falla",
  dyke: "dique",
  joint: "diaclasa",
  contact: "plano de contacto",
  axial_plane: "plano axial",
};
export const LINE_NAMES: Record<NonNullable<Plane["lineation"]>["kind"], string> = {
  striae: "estrías",
  fold_hinge: "charnela",
  mineral: "lineación mineral",
  intersection: "lineación de intersección",
  stretching: "lineación de estiramiento",
};
export const QUALITY_NAMES = { good: "buena", fair: "regular", poor: "mala" } as const;
const WAY_UP = {
  graded_bedding: "Gradación normal dentro de una capa",
  cross_bedding: "Estratificación cruzada truncada hacia el techo",
  pillow_shapes: "Almohadillas con la base en cuña",
  load_casts: "Calcos de carga en la base de una capa",
  vesicle_zoning: "Vesículas concentradas hacia el techo de la colada",
  scour_marks: "Marcas de erosión en la base de una capa",
} as const;
const CONTACT = {
  depositional: "Contacto depositacional concordante",
  unconformity: "Discordancia",
  intrusive: "Contacto intrusivo",
  fault: "Contacto por falla",
  gradational: "Contacto gradual",
} as const;

export interface Field {
  scenario: Scenario;
  state: GameState;
  /** The answer key in practice mode; null when the server holds it. */
  truth: Truth | null;
  /** Where a scenario file such as a photo is served from. */
  assetUrl?: (path: string) => string;
}

export interface Done<T> {
  minutes: number;
  result: T;
}

const stamp = (state: GameState) => ({ day: state.clock.day, minutes: state.clock.minutes });

/** The station of an outcrop, opened on the first visit. One outcrop, one station. */
export function stationAt(field: Field, outcrop: Outcrop): Station {
  const { state } = field;
  const existing = state.stations.find((s) => s.outcrop === outcrop.id);
  if (existing) return existing;
  const station: Station = {
    number: state.stations.length + 1,
    outcrop: outcrop.id,
    easting: Math.round(outcrop.position.easting),
    northing: Math.round(outcrop.position.northing),
    elevation: Math.round(outcrop.position.elevation),
    ...stamp(state),
    rock: "",
    text: "",
    sketch: [],
    notes: [],
    measurements: [],
  };
  state.stations.push(station);
  return station;
}

function note(field: Field, outcrop: Outcrop, tool: Note["tool"], lines: string[]): Note {
  const entry: Note = { tool, lines, ...stamp(field.state) };
  stationAt(field, outcrop).notes.push(entry);
  return entry;
}

const NO_DATA = "Este afloramiento no entrega observaciones en este modo de juego.";

/**
 * A good (or fair) outcrop can be described in full and measured; a poor one, weathered and broken, gives only a
 * partial description of the rock: no planes to put the compass on, no way-up criteria, no fault plane or contact.
 */
export function wellExposed(outcrop: Outcrop): boolean {
  return !!outcrop.observation && outcrop.observation.quality !== "poor";
}

export const POOR_OUTCROP = "Afloramiento de mala calidad: la roca está meteorizada y fracturada, y la descripción es solo parcial.";
export const POOR_TOOLS = "Aquí no se puede medir estratificación ni fallas, ni ver criterios de polaridad o el contacto: busca un afloramiento de buena calidad.";

/** The first clause of a description: what still shows on a weathered, broken surface. */
function firstClause(text: string, marks = ";:."): string {
  const cut = text.search(new RegExp(`[${marks}](\\s|$)`));
  const clause = (cut > 0 ? text.slice(0, cut) : text).trim();
  return clause.endsWith(".") ? clause : `${clause}.`;
}

/** The partial description of a rock seen only on weathered pieces, without the details of the fresh rock. */
export function partialDescription(unit: Unit): string[] {
  return [`${firstClause(unit.description.field, ",;:.").slice(0, -1)}, en superficie meteorizada.`, `Con lupa, en un trozo algo más fresco: ${firstClause(unit.description.hand_lens).replace(/^./, (c) => c.toLowerCase())}`];
}

/** Hammer and hand lens: what the rock looks like; only in part where the outcrop is poor. */
export function describeRock(field: Field, outcrop: Outcrop): Done<Note> {
  const obs = outcrop.observation;
  const unit = obs && field.scenario.units.find((u) => u.key === obs.unit);
  const lines: string[] = [];
  if (!obs || !unit) lines.push(NO_DATA);
  else if (!wellExposed(outcrop)) lines.push(POOR_OUTCROP, ...partialDescription(unit));
  else {
    lines.push(unit.description.field, `Con lupa: ${unit.description.hand_lens}`);
    if (unit.fossils?.length) lines.push(`Fósiles: ${unit.fossils.join(", ")}.`);
    for (const feature of obs.features) lines.push(`${feature}.`);
    lines.push(`Calidad del afloramiento: ${QUALITY_NAMES[obs.quality]}.`);
  }
  return { minutes: COST.lens, result: note(field, outcrop, "lens", lines) };
}

/** What the compass can be put on at this outcrop. */
export function measurable(outcrop: Outcrop): { planeId: string; type: "plane" | "line"; feature: string; label: string }[] {
  const out = [];
  if (!wellExposed(outcrop)) return [];
  for (const plane of outcrop.observation?.planes ?? []) {
    out.push({ planeId: plane.id, type: "plane" as const, feature: plane.kind, label: PLANE_NAMES[plane.kind] });
    if (plane.lineation) {
      out.push({ planeId: plane.id, type: "line" as const, feature: plane.lineation.kind, label: `${LINE_NAMES[plane.lineation.kind]} sobre ${PLANE_NAMES[plane.kind]}` });
    }
  }
  return out;
}

export interface CompassReading {
  planeId: string;
  type: "plane" | "line";
  feature: string;
  /** Strike (right-hand rule) and dip, or trend and plunge: what the instrument shows, with its scatter. */
  a: number;
  b: number;
}

/**
 * Compass: puts the instrument on a plane or on the lineation on it and returns what it shows. Nothing is
 * written down yet; the student reads the compass and writes the measurement with `record`. The reading
 * depends on how many have been written down for that plane, so taking it again before writing gives the
 * same numbers.
 */
export function readCompass(field: Field, outcrop: Outcrop, planeId: string, type: "plane" | "line"): Done<CompassReading> | null {
  const obs = outcrop.observation;
  const plane = obs?.planes.find((p) => p.id === planeId);
  if (!obs || !plane || (type === "line" && !plane.lineation) || !wellExposed(outcrop)) return null;
  const station = stationAt(field, outcrop);
  const n = station.measurements.filter((m) => m.planeId === planeId && m.type === type).length;
  const seed = readingSeed(field.state.seed, outcrop.id, `${planeId}:${type}`, n);
  const scatter = field.scenario.manifest.rules.scatter;
  let a: number, b: number;
  if (type === "plane") ({ strike: a, dip: b } = readPlane(plane, obs.quality, scatter, seed));
  else ({ trend: a, plunge: b } = readLine(plane.lineation!, obs.quality, scatter, seed));
  const feature = type === "plane" ? plane.kind : plane.lineation!.kind;
  return { minutes: COST.compass, result: { planeId, type, feature, a, b } };
}

/** Writes a measurement in the notebook as the student entered it, next to what the compass showed. */
export function record(field: Field, outcrop: Outcrop, reading: CompassReading, entered: { a: number; b: number; notation: NonNullable<Measurement["notation"]>; text: string }): Measurement {
  const measurement: Measurement = {
    feature: reading.feature,
    planeId: reading.planeId,
    type: reading.type,
    a: entered.a,
    b: entered.b,
    read: { a: reading.a, b: reading.b },
    notation: entered.notation,
    entered: entered.text,
    ...stamp(field.state),
  };
  stationAt(field, outcrop).measurements.push(measurement);
  return measurement;
}

/** Reads the compass and writes down exactly what it shows, in the right-hand rule: for tests and tools. */
export function measure(field: Field, outcrop: Outcrop, planeId: string, type: "plane" | "line"): Done<Measurement> | null {
  const done = readCompass(field, outcrop, planeId, type);
  if (!done) return null;
  const r = done.result;
  const text = r.type === "plane" ? `${String(r.a).padStart(3, "0")}/${String(r.b).padStart(2, "0")}` : `${String(r.b).padStart(2, "0")}→${String(r.a).padStart(3, "0")}`;
  return { minutes: done.minutes, result: record(field, outcrop, r, { a: r.a, b: r.b, notation: r.type === "plane" ? "rhr" : "trend_plunge", text }) };
}

/** Way-up check: which way the beds young, where the outcrop shows it. */
export function checkWayUp(field: Field, outcrop: Outcrop): Done<Note> {
  const obs = outcrop.observation;
  const lines = !obs
    ? [NO_DATA]
    : !wellExposed(outcrop)
      ? ["La roca está demasiado meteorizada para reconocer criterios de polaridad."]
      : obs.way_up
      ? [`${WAY_UP[obs.way_up.indicator]}.`, obs.way_up.younging === "upright" ? "Las capas están en posición normal: el techo queda hacia arriba." : "Las capas están invertidas: el techo queda hacia abajo."]
      : ["No se observan criterios de polaridad en este afloramiento."];
  return { minutes: COST.way_up, result: note(field, outcrop, "way_up", lines) };
}

/** Looking for shear-sense indicators on a fault plane. The student reads the sense from the sketch. */
export function lookForKinematics(field: Field, outcrop: Outcrop): Done<Note> {
  const obs = outcrop.observation;
  const fault = obs?.planes.some((p) => p.kind === "fault_plane");
  const lines = !obs
    ? [NO_DATA]
    : !wellExposed(outcrop)
      ? ["El afloramiento está demasiado meteorizado y cubierto para reconocer un plano de falla o sus indicadores."]
      : obs.kinematic
      ? [`${INDICATOR_TEXT[obs.kinematic.indicator]}.`, "Dibujado en el croquis: decide el sentido de movimiento."]
      : fault
        ? ["El plano de falla está demasiado meteorizado para ver indicadores del sentido de movimiento."]
        : ["No hay un plano de falla expuesto en este afloramiento."];
  return { minutes: fault && wellExposed(outcrop) ? COST.kinematics : COST.lens, result: note(field, outcrop, "kinematics", lines) };
}

/** Contact inspection: the evidence at a contact, where one is exposed. */
export function inspectContact(field: Field, outcrop: Outcrop): Done<Note> {
  const obs = outcrop.observation;
  let lines: string[];
  if (!obs) lines = [NO_DATA];
  else if (!wellExposed(outcrop)) lines = ["Entre la roca meteorizada y los derrubios no se distingue ningún contacto."];
  else if (!obs.contact) lines = ["No hay un contacto expuesto en este afloramiento."];
  else {
    const other = obs.contact.units.find((k) => k !== obs.unit);
    const rock = other && field.scenario.units.find((u) => u.key === other);
    lines = [`${CONTACT[obs.contact.type]}.`, ...obs.contact.evidence.map((e) => `${e}.`)];
    if (rock) lines.push(`Al otro lado: ${rock.lithology}.`);
  }
  return { minutes: obs?.contact && wellExposed(outcrop) ? COST.contact : COST.lens, result: note(field, outcrop, "contact", lines) };
}

/** Free mode has no limit. */
export function samplesLeft(field: Field): number {
  if (field.state.mode === "free") return Infinity;
  return Math.max(field.scenario.manifest.rules.sample_limit - field.state.samples.length, 0);
}

/** The rocks that can be sampled here: the outcrop's rock and, where a dyke cuts it, the dyke. */
export function sampleTargets(field: Field, outcrop: Outcrop): { unit: string; label: string }[] {
  const obs = outcrop.observation;
  if (!obs?.sampleable) return [];
  const targets = [{ unit: obs.unit, label: "la roca del afloramiento" }];
  const hasDyke = obs.planes.some((p) => p.kind === "dyke");
  const dyke = obs.contact?.type === "intrusive" ? obs.contact.units.find((k) => k !== obs.unit) : undefined;
  if (hasDyke && dyke) targets.push({ unit: dyke, label: "el dique" });
  return targets;
}

/** Sample: sent to the lab, back the next field day. Returns a message instead when it cannot be taken. */
export function takeSample(field: Field, outcrop: Outcrop, unit: string, analysis: Sample["analysis"]): Done<Sample> | string {
  if (!outcrop.observation?.sampleable) return "La roca está demasiado meteorizada para tomar una muestra útil.";
  if (samplesLeft(field) === 0) return "No quedan muestras disponibles en esta campaña.";
  if (!sampleTargets(field, outcrop).some((t) => t.unit === unit)) return "Esa roca no se puede muestrear aquí.";
  const station = stationAt(field, outcrop);
  const sample: Sample = { number: field.state.samples.length + 1, station: station.number, outcrop: outcrop.id, unit, analysis, day: field.state.clock.day };
  field.state.samples.push(sample);
  return { minutes: COST.sample, result: sample };
}

/** The lab's answer, or null while the sample is still at the lab. In free mode the lab answers at once. */
export function sampleResult(field: Field, sample: Sample, rules: ClockRules): string | null {
  const back = field.state.mode === "free" || field.state.clock.day > sample.day || dayState(field.state.clock, rules) === "campaign_over";
  if (!back) return null;
  const unit = field.scenario.units.find((u) => u.key === sample.unit);
  if (sample.analysis === "thin_section") return unit?.thin_section ?? "El corte delgado no entregó información adicional.";
  if (!field.truth) return "El resultado no está disponible en este modo de juego.";
  const age = field.truth.units.find((u) => u.key === sample.unit)?.lab_age;
  if (!age) return "La muestra no contenía material datable.";
  const number = (v: number) => String(v).replace(".", ",");
  return `Edad ${age.method}${age.material ? ` en ${age.material}` : ""}: ${number(age.value_ma)} ± ${number(age.error_ma)} Ma.`;
}
