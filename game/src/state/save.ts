// Local save: the attempt is written to the browser after every action, so closing the tab loses nothing.

import { emptyMap } from "../interpret/mapdata";
import type { GameState } from "./state";

/** Version 2 added the map. Version 1 saves still load, with an empty map. */
export const SAVE_VERSION = 2;

/** The part of the browser's storage that the save needs; tests pass their own. */
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function saveKey(scenarioId: string, variant: string): string {
  return `geomapper:attempt:${scenarioId}:${variant}`;
}

export function serialize(state: GameState): string {
  return JSON.stringify({
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    ...state,
    found: { sighted: [...state.found.sighted], visited: [...state.found.visited] },
  });
}

/** Returns null when the text is not a save this version of the game can read, or belongs to another scenario. */
export function deserialize(text: string, scenarioId: string, variant: string): GameState | null {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || ![1, SAVE_VERSION].includes(raw.version) || raw.scenarioId !== scenarioId || raw.variant !== variant) return null;
  if (!raw.walker || !raw.clock || !raw.found || !Array.isArray(raw.stations) || !Array.isArray(raw.samples)) return null;
  return {
    scenarioId: raw.scenarioId,
    variant: raw.variant,
    seed: raw.seed,
    mode: raw.mode === "free" ? "free" : "campaign", // saves from before the modes were all campaigns
    notation: ["rhr", "dipdir", "quadrant"].includes(raw.notation) ? raw.notation : "rhr",
    walker: raw.walker,
    clock: raw.clock,
    found: { sighted: new Set(raw.found.sighted), visited: new Set(raw.found.visited) },
    walked: raw.walked,
    flight: raw.mode === "free" && raw.flight?.on ? { on: true, height: Math.max(0, Number(raw.flight.height) || 0) } : { on: false, height: 0 },
    stations: raw.stations,
    samples: raw.samples,
    map: raw.map && Array.isArray(raw.map.units) && Array.isArray(raw.map.lines) && Array.isArray(raw.map.polygons) ? raw.map : emptyMap(),
  };
}

/** False when the browser refuses (private mode, full storage); the game goes on without saving. */
export function save(store: Store, state: GameState): boolean {
  try {
    store.setItem(saveKey(state.scenarioId, state.variant), serialize(state));
    return true;
  } catch {
    return false;
  }
}

export function load(store: Store, scenarioId: string, variant: string): GameState | null {
  try {
    const text = store.getItem(saveKey(scenarioId, variant));
    return text === null ? null : deserialize(text, scenarioId, variant);
  } catch {
    return null;
  }
}

export function clear(store: Store, scenarioId: string, variant: string): void {
  try {
    store.removeItem(saveKey(scenarioId, variant));
  } catch {
    // nothing to clear
  }
}

/** The browser's storage, or null where it is unavailable. */
export function browserStore(): Store | null {
  try {
    const store = window.localStorage;
    store.setItem("geomapper:probe", "1");
    store.removeItem("geomapper:probe");
    return store;
  } catch {
    return null;
  }
}
