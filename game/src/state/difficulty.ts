// Three levels of difficulty for every scenario. The scenario's geology never changes; what changes is how
// much of it shows and what the tools allow:
//
// - easy:   no soil, gravel or vegetation: bare rock everywhere, so the student can hammer and measure
//           anywhere; the solutions (map and section) can be looked at; no hydrothermal alteration.
// - medium: the outcrops as the scenario was baked, partly covered, without the alteration; the lens works
//           on any ground (the rock under the soil) and the compass goes on every structure of every outcrop,
//           poor ones included.
// - hard:   the scenario as baked, alteration mapping included.
//
// The levels are applied to the scenario on load, before the world is built, so the rest of the game reads an
// ordinary scenario.

import { expandTruthMap } from "../format/loader";
import type { Outcrop, Plane, Scenario, Truth } from "../format/types";
import { COVER } from "../world/blocks";
import type { GameState } from "./state";

export type Difficulty = "easy" | "medium" | "hard";
export const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

export const DIFFICULTY_NAMES: Record<Difficulty, string> = { easy: "Fácil", medium: "Medio", hard: "Difícil" };
export const DIFFICULTY_TEXT: Record<Difficulty, string> = {
  easy: "Toda la roca a la vista, sin suelo ni vegetación: puedes martillar y medir en cualquier parte, y ver las soluciones. Sin alteración hidrotermal.",
  medium: "Afloramientos parciales, sin alteración hidrotermal. La lupa funciona en cualquier parte (la roca bajo el suelo) y la brújula mide todas las estructuras, también en afloramientos malos.",
  hard: "El escenario completo: afloramientos parciales y de calidad variable, y el mapeo de la alteración hidrotermal donde la hay.",
};

/** The level of a saved attempt; saves from before the levels were all hard. */
export function difficultyOf(state: Pick<GameState, "difficulty">): Difficulty {
  return state.difficulty ?? "hard";
}

export function parseDifficulty(text: string | null | undefined): Difficulty | null {
  const t = (text ?? "").toLowerCase();
  if (t === "easy" || t === "facil" || t === "fácil") return "easy";
  if (t === "medium" || t === "medio") return "medium";
  if (t === "hard" || t === "dificil" || t === "difícil") return "hard";
  return null;
}

/** Whether the solutions (map, section, sense of slip) can be looked at: in free mode, and always at easy. */
export function showsAnswers(state: Pick<GameState, "mode" | "difficulty">): boolean {
  return state.mode === "free" || state.difficulty === "easy";
}

/** Easy needs the answer key (practice mode) to know the rock under the cover. */
export function available(difficulty: Difficulty, truth: Truth | null): boolean {
  return difficulty !== "easy" || !!truth;
}

/** Cells per side of the outcrops made where cover is taken away at easy. */
const TILE = 4;
/** Farthest a structure is copied from, metres, onto an outcrop made at easy. */
const COPY_REACH_M = 300;
/** Planes that belong to the rock itself, and so carry over to nearby rock of the same unit. */
const ROCK_PLANES: Plane["kind"][] = ["bedding", "foliation", "cleavage", "joint"];

const noAlteration = (outcrop: Outcrop): Outcrop => {
  const obs = outcrop.observation;
  if (!obs) return outcrop;
  const { alteration: _gone, ...rest } = obs;
  return { ...outcrop, observation: { ...rest, planes: obs.planes.filter((p) => p.kind !== "vein") } };
};

const fullyExposed = (outcrop: Outcrop): Outcrop =>
  outcrop.observation?.quality === "poor" ? { ...outcrop, observation: { ...outcrop.observation, quality: "fair", sampleable: true } } : outcrop;

/** The answer key without the alteration, for the levels that leave it out. */
export function truthFor(truth: Truth | null, difficulty: Difficulty): Truth | null {
  if (!truth || difficulty === "hard" || !truth.alteration) return truth;
  const { alteration: _gone, ...rest } = truth;
  return rest;
}

/** The scenario as this level shows it. Returns the scenario itself at hard. */
export function applyDifficulty(scenario: Scenario, truth: Truth | null, difficulty: Difficulty): Scenario {
  if (difficulty === "hard") return scenario;
  const base: Scenario = { ...scenario, alterations: [], outcrops: scenario.outcrops.map(noAlteration) };
  if (difficulty === "medium") return { ...base, outcrops: base.outcrops.map(fullyExposed) };
  if (!truth) return { ...base, outcrops: base.outcrops.map(fullyExposed) };
  return exposeEverything({ ...base, outcrops: base.outcrops.map(fullyExposed) }, truth);
}

/**
 * Easy: every covered cell becomes bare rock of the true unit underneath, grouped in small outcrops. Each
 * takes the bedding (or foliation, joints) of the nearest real outcrop of the same unit, and a fault plane
 * where a fault of the model crosses it, so the compass can be put down anywhere.
 */
function exposeEverything(scenario: Scenario, truth: Truth): Scenario {
  const { nx, ny, cell_size_m, origin } = scenario.manifest.grid;
  const cell = cell_size_m.x;
  const map = expandTruthMap(truth, scenario.manifest);
  const owned = new Int32Array(nx * ny).fill(-1);
  scenario.outcrops.forEach((o, n) => o.cells.forEach(([ix, iy]) => (owned[ix + nx * iy] = n)));

  // Real outcrops with planes of the rock, by unit, to copy from.
  const sources = new Map<string, { x: number; y: number; planes: Plane[] }[]>();
  for (const o of scenario.outcrops) {
    const planes = o.observation?.planes.filter((p) => ROCK_PLANES.includes(p.kind)) ?? [];
    if (!o.observation || !planes.length) continue;
    const list = sources.get(o.observation.unit) ?? [];
    list.push({ x: o.position.easting - origin.easting, y: o.position.northing - origin.northing, planes });
    sources.set(o.observation.unit, list);
  }
  // Fault planes measured at real outcrops, to copy onto made outcrops on a fault trace.
  const faultSources = scenario.outcrops.flatMap((o) =>
    (o.observation?.planes ?? []).filter((p) => p.kind === "fault_plane").map((p) => ({ x: o.position.easting - origin.easting, y: o.position.northing - origin.northing, plane: p })),
  );
  const faults = faultCells(truth, scenario, cell);

  const cover = new Uint8Array(scenario.cover.length); // all bare rock
  const outcrops = [...scenario.outcrops];
  const elevation = (ix: number, iy: number) => scenario.manifest.terrain.offset_m + scenario.terrain[ix + nx * iy]! * scenario.manifest.terrain.scale_m;
  let made = 0;
  for (let ty = 0; ty < ny; ty += TILE) {
    for (let tx = 0; tx < nx; tx += TILE) {
      // One outcrop per unit in the tile, over the cells no real outcrop holds.
      const byUnit = new Map<number, [number, number][]>();
      for (let iy = ty; iy < Math.min(ty + TILE, ny); iy++) {
        for (let ix = tx; ix < Math.min(tx + TILE, nx); ix++) {
          if (owned[ix + nx * iy]! >= 0) continue;
          const u = map[ix + nx * iy]!;
          byUnit.set(u, [...(byUnit.get(u) ?? []), [ix, iy]]);
        }
      }
      for (const [u, cells] of byUnit) {
        const unit = scenario.units[u];
        if (!unit) continue;
        let sx = 0, sy = 0, sz = 0;
        for (const [ix, iy] of cells) ((sx += ix), (sy += iy), (sz += elevation(ix, iy)));
        const x = (sx / cells.length + 0.5) * cell, y = (sy / cells.length + 0.5) * cell;
        const id = `F${String(++made).padStart(5, "0")}`;
        const planes: Plane[] = [];
        let best: Plane[] | null = null, bestD = COPY_REACH_M;
        for (const s of sources.get(unit.key) ?? []) {
          const d = Math.hypot(s.x - x, s.y - y);
          if (d < bestD) ((best = s.planes), (bestD = d));
        }
        for (const p of best ?? []) planes.push({ ...p, id: `${id}-${p.kind}` });
        if (cells.some(([ix, iy]) => faults.has(ix + nx * iy))) {
          let fault: Plane | null = null, faultD = COPY_REACH_M;
          for (const s of faultSources) {
            const d = Math.hypot(s.x - x, s.y - y);
            if (d < faultD) ((fault = s.plane), (faultD = d));
          }
          if (fault) planes.push({ ...fault, id: `${id}-fault` });
        }
        outcrops.push({
          id,
          position: { easting: origin.easting + x, northing: origin.northing + y, elevation: sz / cells.length },
          cells,
          observation: { quality: "good", unit: unit.key, features: [], planes, sampleable: true },
        });
      }
    }
  }
  return { ...scenario, cover, outcrops };
}

/** Cells on a fault: crossed by a fault trace of the model, or in the strip of crushed rock along one. */
function faultCells(truth: Truth, scenario: Scenario, cell: number): Set<number> {
  const { nx, ny, origin } = scenario.manifest.grid;
  const out = new Set<number>();
  scenario.cover.forEach((c, i) => c === COVER.faultZone && out.add(i));
  for (const f of truth.contacts.features) {
    if (f.properties.type !== "fault") continue;
    const pts = f.geometry.coordinates;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i]!, [x1, y1] = pts[i + 1]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (cell / 2)));
      for (let k = 0; k <= steps; k++) {
        const ix = Math.floor((x0 + ((x1 - x0) * k) / steps - origin.easting) / cell);
        const iy = Math.floor((y0 + ((y1 - y0) * k) / steps - origin.northing) / cell);
        if (ix >= 0 && iy >= 0 && ix < nx && iy < ny) out.add(ix + nx * iy);
      }
    }
  }
  return out;
}

/** Medium and easy: the cover hides rock, but the lens still reaches it. Hard: only outcrops and loose rock. */
export function lensUnderCover(difficulty: Difficulty): boolean {
  return difficulty !== "hard";
}
