import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPracticeLitho, loadPracticeTruth, loadScenario } from "../src/format/loader";
import type { Scenario, Truth } from "../src/format/types";
import { grade, samples, tau } from "../src/grade/grade";
import { assign, kappa, matchUnits } from "../src/grade/match";
import { apparentDipOnSection, profile, projectStations, rasterizeSection, sectionAzimuth, trueSection } from "../src/interpret/section";
import { newGame } from "../src/state/state";
import { type Grid, buildGrid } from "../src/world/blocks";
import { middleLine, perfectAttempt, randomAttempt } from "./helpers/studentAttempt";

const LITRES = fileURLToPath(new URL("../../baked/quebrada-los-litres-a/", import.meta.url));
const read = async (path: string) => new Uint8Array(await readFile(LITRES + path));
let scenario: Scenario, truth: Truth, litho: Uint8Array, grid: Grid;

beforeAll(async () => {
  scenario = await loadScenario(read);
  truth = (await loadPracticeTruth(read, scenario.manifest))!;
  litho = (await loadPracticeLitho(read, scenario.manifest))!;
  grid = buildGrid(scenario);
});

describe("matching", () => {
  it("finds the best one-to-one assignment", () => {
    expect(assign([[1, 9], [8, 2]])).toEqual([1, 0]);
    expect(assign([[5, 1, 0], [6, 1, 0]])).toEqual([1, 0]); // 1 + 6 beats 5 + 1
    expect(assign([[0, 0], [3, 0], [2, 4]])).toEqual([-1, 0, 1]); // more rows than columns; no overlap, no pair
    expect(assign([])).toEqual([]);
  });

  it("pairs units by overlap, lumps where allowed, and corrects agreement for chance", () => {
    const truthMap = [0, 0, 1, 1, 2, 2, 2, 2];
    const student = Int32Array.from([7, 7, 8, 8, 9, 9, 9, 9]);
    const exact = matchUnits(student, truthMap, [7, 8, 9], 3, []);
    expect([...exact.classes]).toEqual([[7, [0]], [8, [1]], [9, [2]]]);
    expect(kappa(student, truthMap, exact)).toBeCloseTo(1, 9);
    // One student unit over true units 0 and 1: allowed to count only if they are lumpable.
    const lumped = Int32Array.from([7, 7, 7, 7, 9, 9, 9, 9]);
    expect(kappa(lumped, truthMap, matchUnits(lumped, truthMap, [7, 9], 3, [[0, 1]]))).toBeCloseTo(1, 9);
    expect(kappa(lumped, truthMap, matchUnits(lumped, truthMap, [7, 9], 3, []))).toBeLessThan(0.8);
    // Everything painted one colour agrees with the biggest unit, but no better than chance.
    const flat = Int32Array.from(truthMap.map(() => 5));
    expect(kappa(flat, truthMap, matchUnits(flat, truthMap, [5], 3, []))).toBe(0);
  });

  it("measures order agreement and samples lines", () => {
    expect(tau([1, 2, 3, 4], [10, 20, 30, 40])).toBe(1);
    expect(tau([1, 2, 3, 4], [40, 30, 20, 10])).toBe(-1);
    expect(tau([1], [5])).toBe(0);
    expect(samples([0, 0, 100, 0], 10)).toHaveLength(11);
  });
});

describe("cross-section geometry", () => {
  it("draws the ground, projects stations with their apparent dip, and cuts the true block", () => {
    const line = middleLine(grid);
    expect(sectionAzimuth(line)).toBeCloseTo(90, 9);
    const ground = profile(grid, line, 10);
    expect(ground.length / 2).toBeGreaterThan(200);
    expect(apparentDipOnSection(0, 30, 90)).toBeCloseTo(30, 9); // dips east, section runs east: true dip, downward ahead
    expect(apparentDipOnSection(0, 30, 270)).toBeCloseTo(-30, 9);
    expect(apparentDipOnSection(0, 30, 0)).toBeCloseTo(0, 9);
    expect(apparentDipOnSection(45, 30, 90)).toBeCloseTo((Math.atan(Math.tan(Math.PI / 6) * Math.cos(Math.PI / 4)) * 180) / Math.PI, 9);

    const state = newGame(scenario, grid, 1);
    const o = scenario.outcrops[0]!;
    state.stations.push({ number: 1, outcrop: o.id, easting: scenario.manifest.grid.origin.easting + 1000, northing: scenario.manifest.grid.origin.northing + line.y1 + 40, elevation: 700, day: 1, minutes: 0, rock: "", text: "", sketch: [], notes: [], measurements: [{ feature: "bedding", planeId: "p1", type: "plane", a: 355, b: 34, day: 1, minutes: 0 }] });
    const projected = projectStations(state.stations, scenario.manifest, line, 150);
    expect(projected).toHaveLength(1);
    expect(projected[0]!.offset).toBeCloseTo(40, 6);
    expect(projected[0]!.planes[0]!.apparent).toBeGreaterThan(30);
    expect(projectStations(state.stations, scenario.manifest, line, 30)).toHaveLength(0);

    const t = trueSection(litho, scenario.manifest, grid, line);
    const units = new Set([...t.cells].filter((v) => v >= 0));
    expect(units.size).toBeGreaterThanOrEqual(4); // the section crosses most of the pile
    // Deeper is older across a homocline dipping east: in the middle column the units young upward.
    expect(t.cells[Math.floor(t.nd / 2)]).not.toBe(-1);
    const covered = rasterizeSection({ line, polygons: [{ id: 1, unit: 3, points: [0, 0, 1e5, 0, 1e5, 1e5, 0, 1e5] }], lines: [], nextId: 2 }, t.nd, t.nz, 2457, t.z0, t.dz);
    expect([...covered].every((v) => v === 3)).toBe(true);
  });
});

describe("the grade", () => {
  it("gives the true map, section, column and history more than 95 %", () => {
    const result = grade({ scenario, truth, litho, grid, state: perfectAttempt(scenario, truth, litho, grid) });
    const by = Object.fromEntries(result.parts.map((p) => [p.key, p.score]));
    expect(by.structures).toBeNull(); // no faults or folds in Quebrada Los Litres
    expect(by.map).toBeGreaterThan(0.95);
    expect(by.section).toBeGreaterThan(0.95);
    expect(by.column).toBeGreaterThan(0.95);
    expect(by.field).toBeGreaterThan(0.95);
    expect(result.total).toBeGreaterThan(0.95);
    expect(result.pairs).toHaveLength(5); // the dyke rock is not a map unit
  });

  it("gives random maps less than 20 %", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const result = grade({ scenario, truth, litho, grid, state: randomAttempt(scenario, grid, seed) });
      expect(result.total, `seed ${seed}: ${result.parts.map((p) => `${p.key} ${p.score?.toFixed(2)}`).join(", ")}`).toBeLessThan(0.2);
    }
  });

  it("gives an empty attempt nothing, and leaves out the section when the block is missing", () => {
    const empty = grade({ scenario, truth, litho, grid, state: newGame(scenario, grid, 1) });
    expect(empty.total).toBe(0);
    const noBlock = grade({ scenario, truth, litho: null, grid, state: perfectAttempt(scenario, truth, litho, grid) });
    expect(noBlock.parts.find((p) => p.key === "section")!.score).toBeNull();
    expect(noBlock.total).toBeGreaterThan(0.95);
  });

  it("credits inferred lines more than confident ones in the wrong place", () => {
    const shift = (style: "solid" | "inferred") => {
      const state = perfectAttempt(scenario, truth, litho, grid);
      state.map.lines = state.map.lines.map((l) => ({ ...l, style, points: l.points.map((v, i) => (i % 2 === 0 ? v + 35 : v)) }));
      return grade({ scenario, truth, litho, grid, state }).parts.find((p) => p.key === "map")!.score!;
    };
    expect(shift("inferred")).toBeGreaterThan(shift("solid"));
  });

  it("says when faults are drawn where there are none", () => {
    const state = perfectAttempt(scenario, truth, litho, grid);
    state.map.lines.push({ id: 999, kind: "fault", style: "solid", points: [100, 100, 900, 900] });
    const structures = grade({ scenario, truth, litho, grid, state }).parts.find((p) => p.key === "structures")!;
    expect(structures.score).toBe(0);
    expect(structures.notes[0]).toContain("donde el modelo no tiene ninguna");
  });
});

describe("the grade on the other scenarios", () => {
  for (const folder of ["estero-las-tobas-a", "cerro-pizarras-a", "valle-del-yeso-blanco-a", "cerro-amarillo-a"]) {
    const root = fileURLToPath(new URL(`../../baked/${folder}/`, import.meta.url));
    const readHere = async (path: string) => new Uint8Array(await readFile(root + path));
    it.skipIf(!existsSync(root))(`gives the true ${folder} more than 95 % and random attempts less than 20 %`, async () => {
      const sc = await loadScenario(readHere);
      const tr = (await loadPracticeTruth(readHere, sc.manifest))!;
      const li = (await loadPracticeLitho(readHere, sc.manifest))!;
      const g = buildGrid(sc);
      const perfect = grade({ scenario: sc, truth: tr, litho: li, grid: g, state: perfectAttempt(sc, tr, li, g) });
      expect(perfect.total, perfect.parts.map((p) => `${p.key} ${p.score?.toFixed(3)} ${p.notes.join(" ")}`).join(" | ")).toBeGreaterThan(0.95);
      for (let seed = 1; seed <= 4; seed++) {
        const r = grade({ scenario: sc, truth: tr, litho: li, grid: g, state: randomAttempt(sc, g, seed) });
        expect(r.total, `seed ${seed}`).toBeLessThan(0.2);
      }
    });
  }
});
