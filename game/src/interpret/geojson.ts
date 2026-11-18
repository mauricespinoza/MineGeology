// Export of the student's map as GeoJSON, in the scenario's local metric grid.

import type { Scenario } from "../format/types";
import type { GameState } from "../state/state";
import { KINEMATICS_NAMES, lineName } from "./mapdata";
import { meanPlanes } from "./symbols";

type Position = [number, number];
type Feature = { type: "Feature"; geometry: Record<string, unknown>; properties: Record<string, unknown> };

export interface FeatureCollection {
  type: "FeatureCollection";
  name: string;
  geomapper: Record<string, unknown>;
  features: Feature[];
}

const round = (v: number) => Math.round(v * 10) / 10;

/**
 * Units as polygons, contacts and faults as lines, stations and strike-and-dip symbols as points.
 * Coordinates are easting and northing in metres of the fictional grid, not longitude and latitude.
 */
export function toGeoJSON(scenario: Scenario, state: GameState, exportedAt = new Date()): FeatureCollection {
  const origin = scenario.manifest.grid.origin;
  const at = (x: number, y: number): Position => [round(origin.easting + x), round(origin.northing + y)];
  const positions = (points: number[]): Position[] => Array.from({ length: points.length / 2 }, (_, i) => at(points[2 * i]!, points[2 * i + 1]!));
  const units = new Map(state.map.units.map((u) => [u.id, u]));
  const features: Feature[] = [];

  for (const p of state.map.polygons) {
    const unit = units.get(p.unit);
    const ring = positions(p.points);
    ring.push(ring[0]!);
    features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: { kind: "unit", id: p.id, unit: unit?.name ?? "", colour: unit?.colour ?? "" } });
  }
  for (const l of state.map.lines) {
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: positions(l.points) },
      properties: {
        kind: l.kind,
        id: l.id,
        style: l.style,
        name_es: lineName(l.kind, l.style),
        ...(l.kinematics ? { kinematics: l.kinematics, kinematics_es: KINEMATICS_NAMES[l.kinematics] } : {}),
      },
    });
  }
  for (const s of state.stations) {
    const planes = meanPlanes(s);
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.easting, s.northing] },
      properties: {
        kind: "station",
        number: s.number,
        outcrop: s.outcrop,
        rock: s.rock,
        unit: state.map.units.find((u) => u.id === s.unit)?.name ?? null,
        notes: s.text,
        elevation_m: s.elevation,
        day: s.day,
        measurements: s.measurements.map((m) => ({ type: m.type, feature: m.feature, a: m.a, b: m.b })),
      },
    });
    for (const p of planes) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [s.easting, s.northing] },
        properties: { kind: "strike_dip", station: s.number, feature: p.feature, strike: p.strike, dip: p.dip, readings: p.n },
      });
    }
  }

  return {
    type: "FeatureCollection",
    name: `${scenario.manifest.scenario_id}-${scenario.manifest.variant}`,
    geomapper: {
      scenario: scenario.manifest.scenario_id,
      variant: scenario.manifest.variant,
      exported: exportedAt.toISOString(),
      coordinates: "easting and northing in metres of the scenario's local grid (fictional, UTM-like); not WGS84",
      units_listed: state.map.units.map((u) => ({ name: u.name, colour: u.colour })),
    },
    features,
  };
}
