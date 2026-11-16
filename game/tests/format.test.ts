import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FormatError,
  type FileReader,
  elevationAt,
  expandTruthMap,
  loadReveal,
  loadScenario,
  loadTruth,
} from "../src/format/loader";
import { COVER_CLASSES } from "../src/format/types";

const TOY = fileURLToPath(new URL("../../format/examples/toy/", import.meta.url));
const fromDisk: FileReader = async (path) => new Uint8Array(await readFile(TOY + path));

/** Serves the toy scenario with some files replaced, fixing the manifest when asked. */
function withFiles(replaced: Record<string, Uint8Array>, fixManifest = false): FileReader {
  return async (path) => {
    if (path === "manifest.json" && fixManifest) {
      const manifest = JSON.parse(new TextDecoder().decode(await fromDisk(path)));
      for (const entry of Object.values<{ path: string; sha256: string; bytes: number }>(manifest.files)) {
        const data = replaced[entry.path];
        if (!data) continue;
        entry.sha256 = createHash("sha256").update(data).digest("hex");
        entry.bytes = data.length;
      }
      return new TextEncoder().encode(JSON.stringify(manifest));
    }
    return replaced[path] ?? fromDisk(path);
  };
}

async function editedJson(path: string, change: (doc: any) => void): Promise<Uint8Array> {
  const doc = JSON.parse(new TextDecoder().decode(await fromDisk(path)));
  change(doc);
  return new TextEncoder().encode(JSON.stringify(doc));
}

describe("toy scenario", () => {
  it("loads the public part", async () => {
    const scenario = await loadScenario(fromDisk);
    const { nx, ny } = scenario.manifest.grid;
    expect(scenario.manifest.scenario_id).toBe("toy-homocline");
    expect(scenario.terrain).toHaveLength(nx * ny);
    expect(scenario.cover).toHaveLength(nx * ny);
    expect(scenario.units).toHaveLength(3);
    expect(scenario.outcrops.map((o) => o.id)).toEqual(["o001", "o002", "o003"]);
    // The stream valley sits below the slopes on either side.
    expect(elevationAt(scenario, 8, 7)).toBeLessThan(elevationAt(scenario, 8, 0));
    // Terrain rises to the east.
    expect(elevationAt(scenario, 15, 0)).toBeCloseTo(1052.5, 1);
  });

  it("exposes rock only where an outcrop is", async () => {
    const scenario = await loadScenario(fromDisk);
    const { nx } = scenario.manifest.grid;
    const exposed = new Set(scenario.outcrops.flatMap((o) => o.cells.map(([ix, iy]) => ix + nx * iy)));
    scenario.cover.forEach((value, i) => {
      expect(value).toBeLessThan(COVER_CLASSES.length);
      expect(COVER_CLASSES[value] === "bare_rock").toBe(exposed.has(i));
    });
  });

  it("loads reveal data and the answer key, and they agree", async () => {
    const scenario = await loadScenario(fromDisk);
    const { nx, ny, nz } = scenario.manifest.grid;
    const reveal = await loadReveal(fromDisk, scenario.manifest);
    const truth = await loadTruth(fromDisk, scenario.manifest);
    expect(reveal.litho).toHaveLength(nx * ny * nz);
    expect(reveal.orient).toHaveLength(nx * ny * nz * 3);

    const [e, n, u] = [reveal.orient[0]!, reveal.orient[1]!, reveal.orient[2]!];
    expect((Math.acos(u / Math.hypot(e, n, u)) * 180) / Math.PI).toBeCloseTo(30, 0);
    expect(n).toBe(0);
    expect(e).toBeGreaterThan(0); // pole leans east: beds dip east

    const map = expandTruthMap(truth, scenario.manifest);
    expect(truth.units.map((x) => x.key)).toEqual(scenario.units.map((x) => x.key));
    for (const outcrop of scenario.outcrops) {
      const [ix, iy] = outcrop.cells[0]!;
      expect(scenario.units[map[ix + nx * iy]!]!.key).toBe(outcrop.observation!.unit);
    }
  });
});

describe("rejected scenarios", () => {
  it("refuses a newer major version with a clear message", async () => {
    const manifest = await editedJson("manifest.json", (m) => (m.format_version = "2.0.0"));
    const load = loadScenario(withFiles({ "manifest.json": manifest }));
    await expect(load).rejects.toThrow(FormatError);
    await expect(load).rejects.toThrow(/format 2\.0\.0/);
  });

  it("refuses a file that does not match its hash", async () => {
    const units = await editedJson("units.json", (d) => (d.units[0].lithology = "dacita"));
    await expect(loadScenario(withFiles({ "units.json": units }))).rejects.toThrow(/does not match the manifest/);
  });

  it("refuses a document that breaks its schema", async () => {
    const outcrops = await editedJson("outcrops.json", (d) => (d.outcrops[0].observation.planes[0].dip = 120));
    await expect(loadScenario(withFiles({ "outcrops.json": outcrops }, true))).rejects.toThrow(/outcrops\.json/);
  });

  it("refuses an outcrop of an unknown unit", async () => {
    const outcrops = await editedJson("outcrops.json", (d) => (d.outcrops[0].observation.unit = "u99"));
    await expect(loadScenario(withFiles({ "outcrops.json": outcrops }, true))).rejects.toThrow(/unknown unit u99/);
  });

  it("accepts graded-mode outcrops without observations", async () => {
    const outcrops = await editedJson("outcrops.json", (d) =>
      d.outcrops.forEach((o: { observation?: unknown }) => delete o.observation),
    );
    const scenario = await loadScenario(withFiles({ "outcrops.json": outcrops }, true));
    expect(scenario.outcrops.every((o) => o.observation === undefined)).toBe(true);
  });
});
