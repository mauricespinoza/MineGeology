// The server's copy of each scenario: the full bake, with the answer key, read from a folder or from
// private storage. And the graded bundle the browser gets instead: the public files with every
// observation removed, so what an outcrop shows can only be learnt by asking the server there.

import { loadManifest, loadPracticeLitho, loadPracticeTruth, loadReveal, loadScenario, loadTruth } from "../../game/src/format/loader";
import type { Manifest, Scenario, Truth } from "../../game/src/format/types";
import { type Grid, buildGrid } from "../../game/src/world/blocks";

/** Reads one file of a scenario folder; rejects when it is missing. */
export type SourceReader = (folder: string, path: string) => Promise<Uint8Array>;

export interface Loaded {
  scenario: Scenario; // with observations
  truth: Truth;
  litho: Uint8Array | null;
  grid: Grid;
}

/** Folder names the server accepts: what `geomapper publish` writes. */
export const FOLDER = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class Scenarios {
  private readonly cache = new Map<string, Promise<Loaded>>();
  constructor(private readonly read: SourceReader) {}

  /** The full scenario. A full bake has truth.json and litho.bin; a practice bundle has them packed, and serves too. */
  load(folder: string): Promise<Loaded> {
    if (!FOLDER.test(folder)) return Promise.reject(new Error(`bad scenario name: ${folder}`));
    let p = this.cache.get(folder);
    if (!p) {
      const read = (path: string) => this.read(folder, path);
      p = (async () => {
        const scenario = await loadScenario(read);
        const m = scenario.manifest;
        const truth = await loadTruth(read, m).catch(() => loadPracticeTruth(read, m));
        if (!truth) throw new Error(`${folder}: no answer key on the server`);
        const litho = await loadReveal(read, m).then((r) => r.litho, () => loadPracticeLitho(read, m));
        return { scenario, truth, litho, grid: buildGrid(scenario) };
      })();
      p.catch(() => this.cache.delete(folder));
      this.cache.set(folder, p);
    }
    return p;
  }

  /** The list of published scenarios (index.json at the top of the source). */
  async index(): Promise<{ scenarios: unknown[] }> {
    return JSON.parse(new TextDecoder().decode(await this.read("", "index.json"))) as { scenarios: unknown[] };
  }

  /**
   * The files of the graded bundle: the manifest (with the new hash of outcrops.json; the answer-key files
   * stay listed, as the format requires, but are never served), terrain, cover, units, photos and outcrops
   * without observations. Practice files never.
   */
  async graded(folder: string, path: string): Promise<Uint8Array | null> {
    if (!FOLDER.test(folder)) return null;
    const read = (p: string) => this.read(folder, p);
    const manifest = await loadManifest(read);
    const stripped = await strippedOutcrops(read, manifest);
    if (path === "manifest.json") {
      const files = { ...manifest.files, outcrops: { ...manifest.files.outcrops, sha256: await sha256(stripped), bytes: stripped.length } };
      return new TextEncoder().encode(JSON.stringify({ ...manifest, files }, null, 2));
    }
    if (path === manifest.files.outcrops.path) return stripped;
    const allowed = new Set([...Object.values(manifest.files).filter((f) => f.visibility === "public").map((f) => f.path), ...(manifest.assets ?? []).map((a) => a.path)]);
    return allowed.has(path) ? read(path) : null;
  }
}

async function strippedOutcrops(read: (p: string) => Promise<Uint8Array>, manifest: Manifest): Promise<Uint8Array> {
  const doc = JSON.parse(new TextDecoder().decode(await read(manifest.files.outcrops.path))) as { outcrops: { observation?: unknown }[] };
  for (const o of doc.outcrops) delete o.observation;
  return new TextEncoder().encode(`${JSON.stringify(doc)}\n`);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}
