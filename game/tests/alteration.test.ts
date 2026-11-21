// Hydrothermal alteration over the rock (format 1.6.0), on the pilot scenario Cerro Amarillo.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expandAlterationMap, loadPracticeTruth, loadScenario } from "../src/format/loader";
import type { Outcrop, Scenario, Truth } from "../src/format/types";
import { newGame } from "../src/state/state";
import { type Field, assayOf, assayText, describeRock, measurable, sampleResult, takeSample } from "../src/tools/fieldwork";
import { buildGrid } from "../src/world/blocks";
import { topColour } from "../src/world/mesher";

const FOLDER = fileURLToPath(new URL("../../baked/cerro-amarillo-a/", import.meta.url));
const fromDisk = async (path: string) => new Uint8Array(await readFile(FOLDER + path));

async function pilot(): Promise<Field & { scenario: Scenario; truth: Truth }> {
  const scenario = await loadScenario(fromDisk);
  const truth = (await loadPracticeTruth(fromDisk, scenario.manifest))!;
  const field = { scenario, truth, state: newGame(scenario, buildGrid(scenario), 11) };
  field.state.mode = "free"; // the lab answers at once
  return field;
}

const zoneName = (truth: Truth, key: string) => truth.alteration!.zones.find((z) => z.key === key)!.name;
const altered = (scenario: Scenario, test: (o: Outcrop) => boolean = () => true) =>
  scenario.outcrops.find((o) => o.observation?.alteration && o.observation.quality === "good" && test(o))!;

describe("alteration over the rock", () => {
  it("loads the zones without their names, and the true map with them", async () => {
    const { scenario, truth } = await pilot();
    expect(scenario.alterations.length).toBe(4);
    expect(JSON.stringify(scenario.alterations)).not.toMatch(/potásica|fílica|propilítica|argílica/i);
    expect(truth.alteration!.zones.map((z) => z.key)).toEqual(scenario.alterations.map((a) => a.key));
    const map = expandAlterationMap(truth, scenario.manifest)!;
    expect(new Set(map)).toEqual(new Set([0, 1, 2, 3, 4]));
  });

  it("describes the altered rock with its minerals, without naming the zone", async () => {
    const field = await pilot();
    const outcrop = altered(field.scenario, (o) => o.observation!.alteration!.intensity !== "strong");
    const zone = field.scenario.alterations.find((a) => a.key === outcrop.observation!.alteration!.key)!;
    const lines = describeRock(field, outcrop).result.lines.join("\n");
    const unit = field.scenario.units.find((u) => u.key === outcrop.observation!.unit)!;
    expect(lines).toContain(unit.description.field);
    expect(lines).toContain(zone.minerals[0]!);
    expect(lines).toMatch(/Alteración (débil|moderada) sobre la roca/);
    expect(lines).not.toContain(zoneName(field.truth, zone.key));
  });

  it("blurs the rock where the alteration is strong", async () => {
    const field = await pilot();
    const outcrop = altered(field.scenario, (o) => o.observation!.alteration!.intensity === "strong");
    const unit = field.scenario.units.find((u) => u.key === outcrop.observation!.unit)!;
    const lines = describeRock(field, outcrop).result.lines.join("\n");
    expect(lines).toContain("textura original en gran parte borrada");
    expect(lines).not.toContain(unit.description.hand_lens);
  });

  it("lets the compass go on veins", async () => {
    const { scenario } = await pilot();
    const withVein = scenario.outcrops.find((o) => o.observation?.planes.some((p) => p.kind === "vein"))!;
    expect(measurable(withVein).map((m) => m.label)).toContain("vetilla");
  });

  it("gives assays in the zone's ranges, the same on a reload, and fresh-rock values for a post-mineral dyke", async () => {
    const field = await pilot();
    const truth = field.truth;
    for (const zone of truth.alteration!.zones) {
      const values = assayOf(truth, zone.key, 1234);
      const [low, high] = zone.assay!.cu_ppm!;
      expect(values.cu_ppm!).toBeGreaterThanOrEqual(low);
      expect(values.cu_ppm!).toBeLessThanOrEqual(high);
    }
    expect(assayOf(truth, null, 9).cu_ppm!).toBeLessThanOrEqual(truth.alteration!.background_assay!.cu_ppm![1]);
    expect(assayText({ cu_ppm: 3421.6, mo_ppm: 85, au_ppb: 7.25 })).toBe("Análisis químico de roca: Cu 3 422 ppm · Mo 85 ppm · Au 7,3 ppb.");

    const outcrop = altered(field.scenario, (o) => o.observation!.sampleable);
    const done = takeSample(field, outcrop, outcrop.observation!.unit, "assay");
    if (typeof done === "string") throw new Error(done);
    const result = sampleResult(field, done.result, field.scenario.manifest.rules)!;
    expect(result).toMatch(/^Análisis químico de roca: Cu /);
    expect(sampleResult(field, done.result, field.scenario.manifest.rules)).toBe(result);
  });

  it("stains altered outcrops and the debris beside them", async () => {
    const { scenario } = await pilot();
    const grid = buildGrid(scenario);
    expect(grid.stain).toBeDefined();
    const outcrop = altered(scenario);
    const [ix, iy] = outcrop.cells[0]!;
    const unit = grid.rock[ix + grid.nx * iy]!;
    expect(topColour(grid, ix, iy)).not.toBe(grid.unitColours[unit]);
    const stainedDebris = Array.from(grid.stain!).filter((c, i) => c >= 0 && grid.cover[i] !== 0).length;
    expect(stainedDebris).toBeGreaterThan(100);
  });
});
