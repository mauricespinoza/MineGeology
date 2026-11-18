// A graded attempt in progress: keeps the server's copy up to date, asks the server what outcrops show
// and what the lab found, and hands the attempt in. The game state stays the one object the game uses;
// this only mirrors it.

import type { Outcrop } from "../format/types";
import { serialize } from "../state/save";
import type { GameState, Sample } from "../state/state";
import type { Grid } from "../world/blocks";
import { type AttemptView, type Remote, RemoteError } from "./remote";

export interface Track {
  t: string;
  kind: string;
  data: unknown;
}

export class GradedSession {
  version: number;
  status: AttemptView["status"];
  /** Lab answers by sample number, as far as their day has come. */
  lab: Record<string, string>;
  private events: Track[] = [];
  private saving: Promise<void> | null = null;
  private dirty = false;
  private timer = 0;
  /** Called when another device saved first: the page must reload the server's copy. */
  onConflict: (message: string) => void = () => {};
  /** Called when a save fails for another reason (offline, session expired). */
  onError: (message: string) => void = () => {};

  constructor(
    readonly remote: Remote,
    readonly attempt: AttemptView,
    private readonly state: GameState,
  ) {
    this.version = attempt.version;
    this.status = attempt.status;
    this.lab = { ...attempt.lab };
  }

  /** The state as plain JSON, as the browser save writes it (the sets of outcrops found become lists). */
  private plain(): unknown {
    return JSON.parse(serialize(this.state));
  }

  get submitted(): boolean {
    return this.status === "submitted";
  }

  /** Something worth keeping for the teacher's replay: a position, an action. */
  track(kind: string, data: unknown): void {
    this.events.push({ t: new Date().toISOString(), kind, data });
  }

  /** Saves soon: changes within a few seconds go together. */
  queue(): void {
    if (this.submitted) return;
    this.dirty = true;
    if (!this.timer) this.timer = window.setTimeout(() => ((this.timer = 0), void this.flush()), 3000);
  }

  /** Saves now, and waits for it. */
  async flush(): Promise<void> {
    if (this.submitted) return;
    if (this.saving) await this.saving;
    if (!this.dirty && !this.events.length) return;
    this.dirty = false;
    const events = this.events.splice(0);
    this.saving = (async () => {
      try {
        const r = await this.remote.save(this.attempt.id, this.version, this.plain(), events);
        this.version = r.version;
      } catch (e) {
        if (e instanceof RemoteError && e.status === 409) this.onConflict(e.message);
        else {
          this.events.unshift(...events); // try them again with the next save
          this.dirty = true;
          this.onError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        this.saving = null;
      }
    })();
    await this.saving;
  }

  /** Asks the server what an outcrop shows; it answers only to a student standing at it. */
  async observe(outcrop: Outcrop, grid: Grid, units: string[]): Promise<void> {
    if (outcrop.observation) return;
    await this.flush(); // the server checks the position against the last save
    const r = await this.remote.observe(this.attempt.id, outcrop.id, this.state.walker.x, this.state.walker.y);
    reveal(outcrop, r.observation, grid, units);
  }

  /** Sends a sample to the lab; the answer comes back the next field day. */
  async sample(sample: Sample): Promise<void> {
    await this.remote.sample(this.attempt.id, { outcrop: sample.outcrop, unit: sample.unit, analysis: sample.analysis, number: sample.number, day: sample.day });
    this.queue();
  }

  /** Fetches the lab answers whose day has come (after a save, so the server knows the day). */
  async refreshLab(): Promise<void> {
    await this.flush();
    this.lab = (await this.remote.lab(this.attempt.id)).lab;
  }

  async submit(): Promise<void> {
    await this.flush();
    await this.remote.submit(this.attempt.id, this.plain());
    this.status = "submitted";
  }
}

/** Puts what the server showed into the outcrop, and its rock into the grid, so the map can colour it. */
export function reveal(outcrop: Outcrop, observation: Outcrop["observation"], grid: Grid, units: string[]): void {
  outcrop.observation = observation;
  const unit = observation ? units.indexOf(observation.unit) : -1;
  for (const [ix, iy] of outcrop.cells) grid.rock[ix + grid.nx * iy] = unit;
}
