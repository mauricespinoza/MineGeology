// Supabase as the store: the tables of supabase/migrations through PostgREST, and the full scenario
// bakes in a private Storage bucket. Only the server functions use these, with the service key; the
// browser never reads the tables directly (row-level security lets it read nothing).

import type { SourceReader } from "./scenarios";
import type { AttemptRecord, EventRecord, GradeRecord, Store } from "./store";

type Row = Record<string, unknown>;

export class SupabaseStore implements Store {
  constructor(
    private readonly url: string,
    private readonly serviceKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async rest(path: string, init: RequestInit = {}): Promise<Row[]> {
    const r = await this.fetcher(`${this.url}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: this.serviceKey, Authorization: `Bearer ${this.serviceKey}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) },
    });
    if (!r.ok) throw new Error(`supabase ${init.method ?? "GET"} ${path}: ${r.status} ${await r.text()}`);
    const text = await r.text();
    return text ? (JSON.parse(text) as Row[]) : [];
  }

  private static toAttempt(r: Row): AttemptRecord {
    return {
      id: r.id as string, user: r.user_id as string, email: r.email as string, folder: r.folder as string, seed: r.seed as number,
      status: r.status as AttemptRecord["status"], version: r.version as number, state: r.state, observations: (r.observations ?? {}) as AttemptRecord["observations"],
      lab: (r.lab ?? {}) as AttemptRecord["lab"], created: r.created_at as string, updated: r.updated_at as string,
    };
  }

  private static fromAttempt(a: AttemptRecord): Row {
    return { id: a.id, user_id: a.user, email: a.email, folder: a.folder, seed: a.seed, status: a.status, version: a.version, state: a.state, observations: a.observations, lab: a.lab, created_at: a.created, updated_at: a.updated };
  }

  async findAttempt(user: string, folder: string) {
    const rows = await this.rest(`attempts?user_id=eq.${encodeURIComponent(user)}&folder=eq.${encodeURIComponent(folder)}&select=*`);
    return rows[0] ? SupabaseStore.toAttempt(rows[0]) : null;
  }
  async getAttempt(id: string) {
    const rows = await this.rest(`attempts?id=eq.${encodeURIComponent(id)}&select=*`);
    return rows[0] ? SupabaseStore.toAttempt(rows[0]) : null;
  }
  async createAttempt(record: AttemptRecord) {
    const rows = await this.rest("attempts", { method: "POST", body: JSON.stringify(SupabaseStore.fromAttempt(record)) });
    return SupabaseStore.toAttempt(rows[0]!);
  }
  async updateAttempt(record: AttemptRecord, expected: number) {
    // The version in the filter makes the write conditional: no row matches if another save came first.
    const rows = await this.rest(`attempts?id=eq.${encodeURIComponent(record.id)}&version=eq.${expected}`, { method: "PATCH", body: JSON.stringify(SupabaseStore.fromAttempt(record)) });
    return rows.length === 1;
  }
  async listAttempts() {
    return (await this.rest("attempts?select=*&order=email.asc")).map(SupabaseStore.toAttempt);
  }
  async appendEvents(attempt: string, events: EventRecord[]) {
    if (!events.length) return;
    await this.rest("events", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(events.map((e) => ({ attempt_id: attempt, t: e.t, kind: e.kind, data: e.data }))) });
  }
  async listEvents(attempt: string) {
    return (await this.rest(`events?attempt_id=eq.${encodeURIComponent(attempt)}&select=t,kind,data&order=t.asc`)) as unknown as EventRecord[];
  }
  async getGrade(attempt: string) {
    const rows = await this.rest(`grades?attempt_id=eq.${encodeURIComponent(attempt)}&select=*`);
    const r = rows[0];
    return r ? { attempt, auto: r.auto, released: r.released as boolean, updated: r.updated_at as string, ...(r.adjusted != null ? { adjusted: r.adjusted as number } : {}), ...(r.note ? { note: r.note as string } : {}) } : null;
  }
  async putGrade(g: GradeRecord) {
    await this.rest("grades", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ attempt_id: g.attempt, auto: g.auto, adjusted: g.adjusted ?? null, note: g.note ?? null, released: g.released, updated_at: g.updated }),
    });
  }
}

/** Full bakes in the private bucket "scenarios", one folder per published scenario. */
export function storageReader(url: string, serviceKey: string, bucket = "scenarios", fetcher: typeof fetch = fetch): SourceReader {
  return async (folder, path) => {
    const r = await fetcher(`${url}/storage/v1/object/${bucket}/${folder ? `${folder}/` : ""}${path}`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    if (!r.ok) throw new Error(`${folder}/${path}: ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  };
}
