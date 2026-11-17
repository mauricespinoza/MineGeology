// The stratigraphic column and the geological history, as the student writes them.

export type BaseContact = "depositional" | "unconformity" | "intrusive" | "fault" | "not_exposed";
export type EventType = "deposition" | "tilting" | "folding" | "faulting" | "intrusion" | "erosion" | "metamorphism" | "uplift";

export const BASE_NAMES: Record<BaseContact, string> = {
  depositional: "depositacional",
  unconformity: "discordancia",
  intrusive: "intrusivo",
  fault: "falla",
  not_exposed: "no expuesto",
};
export const EVENT_NAMES: Record<EventType, string> = {
  deposition: "Depósito",
  tilting: "Basculamiento",
  folding: "Plegamiento",
  faulting: "Fallamiento",
  intrusion: "Intrusión",
  erosion: "Erosión",
  metamorphism: "Metamorfismo",
  uplift: "Alzamiento",
};
/** Events that are about one unit. */
export const EVENT_HAS_UNIT: Record<EventType, boolean> = {
  deposition: true,
  intrusion: true,
  tilting: false,
  folding: false,
  faulting: false,
  erosion: false,
  metamorphism: false,
  uplift: false,
};

export interface ColumnRow {
  /** A map unit id. */
  unit: number;
  thickness?: number;
  base: BaseContact;
}

export interface HistoryEvent {
  id: number;
  type: EventType;
  /** A map unit id, for deposition and intrusion. */
  unit?: number;
}

/** Oldest first, in both. */
export interface ColumnState {
  rows: ColumnRow[];
  events: HistoryEvent[];
  nextId: number;
}

export const emptyColumn = (): ColumnState => ({ rows: [], events: [], nextId: 1 });

/** Moves item `i` one place up (toward younger, delta = +1) or down. */
export function move<T>(items: T[], i: number, delta: number): void {
  const j = i + delta;
  if (j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j]!, items[i]!];
}
