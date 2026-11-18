// Where attempts, their event log and their grades are kept. The server talks to this interface only;
// MemoryStore and FileStore serve tests and the local server, SupabaseStore (supabase.ts) production.

import type { Observation } from "../../game/src/format/types";

export interface LabResult {
  /** The lab's text, held back until `day` begins. */
  text: string;
  day: number;
}

export interface AttemptRecord {
  id: string;
  user: string;
  email: string;
  /** The published scenario folder, e.g. quebrada-los-litres-a. */
  folder: string;
  /** Fixes this student's measurement scatter. */
  seed: number;
  status: "open" | "submitted";
  /** Grows by one with every save; a save from an older copy is refused. */
  version: number;
  /** The game state as the client last saved it (the notebook, the map, the clock, where the student stands). */
  state: unknown;
  /** What each outcrop showed this student, given only when they stood at it. */
  observations: Record<string, Observation>;
  /** Lab answers by sample number. */
  lab: Record<string, LabResult>;
  created: string;
  updated: string;
}

export interface EventRecord {
  t: string;
  kind: string;
  data: unknown;
}

export interface GradeRecord {
  attempt: string;
  /** The automatic grade (total 0..1 and its parts), as computed at submission. */
  auto: unknown;
  /** The teacher's total, 0..1, when they changed it. */
  adjusted?: number;
  note?: string;
  released: boolean;
  updated: string;
}

export interface Store {
  findAttempt(user: string, folder: string): Promise<AttemptRecord | null>;
  getAttempt(id: string): Promise<AttemptRecord | null>;
  createAttempt(record: AttemptRecord): Promise<AttemptRecord>;
  /** Writes the record if the stored version is still `expected`; returns false when another copy saved first. */
  updateAttempt(record: AttemptRecord, expected: number): Promise<boolean>;
  listAttempts(): Promise<AttemptRecord[]>;
  appendEvents(attempt: string, events: EventRecord[]): Promise<void>;
  listEvents(attempt: string): Promise<EventRecord[]>;
  getGrade(attempt: string): Promise<GradeRecord | null>;
  putGrade(grade: GradeRecord): Promise<void>;
}

const copy = <T>(v: T): T => structuredClone(v);

export class MemoryStore implements Store {
  protected attempts = new Map<string, AttemptRecord>();
  protected events = new Map<string, EventRecord[]>();
  protected grades = new Map<string, GradeRecord>();

  protected changed(): void {}

  async findAttempt(user: string, folder: string) {
    const a = [...this.attempts.values()].find((r) => r.user === user && r.folder === folder);
    return a ? copy(a) : null;
  }
  async getAttempt(id: string) {
    const a = this.attempts.get(id);
    return a ? copy(a) : null;
  }
  async createAttempt(record: AttemptRecord) {
    this.attempts.set(record.id, copy(record));
    this.changed();
    return copy(record);
  }
  async updateAttempt(record: AttemptRecord, expected: number) {
    const current = this.attempts.get(record.id);
    if (!current || current.version !== expected) return false;
    this.attempts.set(record.id, copy(record));
    this.changed();
    return true;
  }
  async listAttempts() {
    return [...this.attempts.values()].map(copy);
  }
  async appendEvents(attempt: string, events: EventRecord[]) {
    this.events.set(attempt, [...(this.events.get(attempt) ?? []), ...copy(events)]);
    this.changed();
  }
  async listEvents(attempt: string) {
    return copy(this.events.get(attempt) ?? []);
  }
  async getGrade(attempt: string) {
    const g = this.grades.get(attempt);
    return g ? copy(g) : null;
  }
  async putGrade(grade: GradeRecord) {
    this.grades.set(grade.attempt, copy(grade));
    this.changed();
  }
}

/** The memory store written to one JSON file after every change: enough for the local server. */
export class FileStore extends MemoryStore {
  constructor(
    private readonly path: string,
    private readonly fs: { readFileSync(p: string, e: "utf8"): string; writeFileSync(p: string, d: string): void; existsSync(p: string): boolean },
  ) {
    super();
    if (fs.existsSync(path)) {
      const data = JSON.parse(fs.readFileSync(path, "utf8")) as { attempts: AttemptRecord[]; events: [string, EventRecord[]][]; grades: GradeRecord[] };
      for (const a of data.attempts) this.attempts.set(a.id, a);
      for (const [k, v] of data.events) this.events.set(k, v);
      for (const g of data.grades) this.grades.set(g.attempt, g);
    }
  }
  protected override changed(): void {
    this.fs.writeFileSync(this.path, JSON.stringify({ attempts: [...this.attempts.values()], events: [...this.events.entries()], grades: [...this.grades.values()] }));
  }
}
