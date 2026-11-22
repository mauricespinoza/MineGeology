// The three levels of difficulty applied to the baked scenarios.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expandTruthMap, loadPracticeTruth, loadScenario } from "../src/format/loader";
import { applyDifficulty, showsAnswers, truthFor } from "../src/state/difficulty";
import { deserialize, serialize } from "../src/state/save";
import { newGame } from "../src/state/state";
import { measurable, wellExposed } from "../src/tools/fieldwork";
import { COVER, buildGrid } from "../src/world/blocks";

async function baked(folder: string) {
  const dir = fileURLToPath(new URL(`../../baked/${folder}/`, import.meta.url));
  const read = async (path: string) => new Uint8Array(await readFile(dir + path));
  const scenario = await loadScenario(read);
  const truth = (await loadPracticeTruth(read, scenario.manifest))!;
  return { scenario, truth };
}

describe("levels of difficulty", () => {
  it("leaves the scenario untouched at hard", async () => {
    const { scenario, truth } = await baked("cerro-amarillo-a");
    expect(applyDifficulty(scenario, truth, "hard")).toBe(scenario);
    expect(truthFor(truth, "hard")).toBe(truth);
  });

  it("takes the alteration away at medium and makes every outcrop fully usable", async () => {
    const { scenario, truth } = await baked("cerro-amarillo-a");
    const medium = applyDifficulty(scenario, truth, "medium");
    expect(medium.alterations).toEqual([]);
    expect(medium.outcrops.length).toBe(scenario.outcrops.length);
    expect(medium.outcrops.some((o) => o.observation?.alteration)).toBe(false);
    expect(medium.outcrops.some((o) => o.observation?.planes.some((p) => p.kind === "vein"))).toBe(false);
    expect(medium.outcrops.every(wellExposed)).toBe(true);
    expect(medium.cover).toBe(scenario.cover); // the cover stays as baked
    expect(truthFor(truth, "medium")!.alteration).toBeUndefined();
    // The baked scenario is not changed by the level.
    expect(scenario.alterations.length).toBe(4);
    expect(scenario.outcrops.some((o) => o.observation?.quality === "poor")).toBe(true);
  });

  it("lays bare rock of the true unit over the whole area at easy, measurable nearly everywhere", async () => {
    const { scenario, truth } = await baked("cerro-pizarras-a"); // a forest: 2.5 % exposed when baked
    const easy = applyDifficulty(scenario, truth, "easy");
    expect(easy.alterations).toEqual([]);
    expect(easy.cover.every((c) => c === COVER.rock)).toBe(true);
    const grid = buildGrid(easy);
    // Every cell is an outcrop, and its rock is the unit of the true map.
    expect(grid.outcrop.every((n) => n >= 0)).toBe(true);
    const map = expandTruthMap(truth, scenario.manifest);
    const made = easy.outcrops.slice(scenario.outcrops.length);
    for (const o of made.slice(0, 400)) {
      const [ix, iy] = o.cells[0]!;
      expect(easy.units[map[ix + scenario.manifest.grid.nx * iy]!]!.key).toBe(o.observation!.unit);
    }
    // Ids stay unique, and most of the made outcrops have a plane for the compass.
    expect(new Set(easy.outcrops.map((o) => o.id)).size).toBe(easy.outcrops.length);
    expect(made.filter((o) => measurable(o).length > 0).length / made.length).toBeGreaterThan(0.5);
  });

  it("shows the answers in free mode and at easy, and remembers the level in the save", async () => {
    const { scenario } = await baked("quebrada-los-litres-a");
    const state = newGame(scenario, buildGrid(scenario), 3, "campaign", "easy");
    expect(showsAnswers(state)).toBe(true);
    expect(showsAnswers({ mode: "campaign", difficulty: "medium" })).toBe(false);
    expect(showsAnswers({ mode: "free", difficulty: "hard" })).toBe(true);
    expect(deserialize(serialize(state), state.scenarioId, state.variant)!.difficulty).toBe("easy");
    const old = JSON.parse(serialize(state));
    delete old.difficulty;
    expect(deserialize(JSON.stringify(old), state.scenarioId, state.variant)!.difficulty).toBe("hard");
  });
});
