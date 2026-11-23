import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPracticeLitho, loadPracticeTruth, loadScenario } from "../src/format/loader";
import {
  DRILL, affordableLength, direction, drillCsv, elevationAt, holeCost, holeMinutes, insideDyke, lengthInBlock, logHole, pointAt, trueThickness,
} from "../src/interpret/drill";
import { deserialize, serialize } from "../src/state/save";
import { newGame } from "../src/state/state";
import { buildGrid, surfaceElevation } from "../src/world/blocks";

const LITRES = fileURLToPath(new URL("../../baked/quebrada-los-litres-a/", import.meta.url));
const reader = (folder: string) => async (path: string) => new Uint8Array(await readFile(folder + path));

async function litres() {
  const read = reader(LITRES);
  const scenario = await loadScenario(read);
  const truth = (await loadPracticeTruth(read, scenario.manifest))!;
  const litho = (await loadPracticeLitho(read, scenario.manifest))!;
  return { scenario, truth, litho, grid: buildGrid(scenario) };
}

describe("drill-hole geometry", () => {
  it("points the hole by azimuth and inclination", () => {
    const v = direction(0, 90);
    expect(v[0]).toBeCloseTo(0);
    expect(v[1]).toBeCloseTo(0);
    expect(v[2]).toBeCloseTo(-1);
    const e = direction(90, 45);
    expect(e[0]).toBeCloseTo(Math.SQRT1_2);
    expect(e[1]).toBeCloseTo(0);
    expect(e[2]).toBeCloseTo(-Math.SQRT1_2);
    const p = pointAt({ x: 100, y: 100, z: 1000, azimuth: 180, inclination: 30 }, 200);
    expect(p[0]).toBeCloseTo(100);
    expect(p[1]).toBeCloseTo(100 - 200 * Math.cos(Math.PI / 6));
    expect(p[2]).toBeCloseTo(900);
    expect(elevationAt({ z: 1000, inclination: 30 }, 200)).toBeCloseTo(900);
  });

  it("gives the true thickness from the angle between the hole and the bed", () => {
    expect(trueThickness(50, 0, 90, 0, 0)).toBeCloseTo(50); // vertical hole, flat bed
    expect(trueThickness(50, 0, 90, 0, 30)).toBeCloseTo(50 * Math.cos(Math.PI / 6));
    // A hole drilled square to a bed dipping 40° east: inclined 50° toward the west.
    expect(trueThickness(50, 270, 50, 0, 40)).toBeCloseTo(50);
    expect(trueThickness(50, 0, 0, 0, 90)).toBeCloseTo(0); // along the strike of a vertical bed
  });

  it("prices holes and the budget", () => {
    expect(holeCost(100)).toBe(DRILL.mobilisation + 100 * DRILL.perMetre);
    expect(holeMinutes(100)).toBe(Math.round(DRILL.setupMinutes + 100 * DRILL.logMinutesPerMetre));
    expect(affordableLength(0)).toBe(Math.floor((DRILL.budget - DRILL.mobilisation) / DRILL.perMetre));
    expect(affordableLength(DRILL.budget)).toBe(0);
    expect(holeCost(affordableLength(37_000))).toBeLessThanOrEqual(DRILL.budget - 37_000);
  });
});

describe("drill-hole logs from the model", () => {
  it("stops a hole at the sides and base of the block", async () => {
    const { scenario } = await litres();
    const g = scenario.manifest.grid;
    const z = 1500;
    expect(lengthInBlock(scenario.manifest, 500, 500, z, 0, 90)).toBeCloseTo(z - g.origin.elevation, 0);
    // Toward the west from 100 m in, at 45°: out through the west side after 100 / cos 45° metres.
    expect(lengthInBlock(scenario.manifest, 100, 500, z + 10_000, 270, 45)).toBeCloseTo(100 / Math.SQRT1_2, 0);
  });

  it("reads a vertical hole straight from the block's column", async () => {
    const { scenario, litho, grid } = await litres();
    const g = scenario.manifest.grid, cell = g.cell_size_m.x, dz = g.cell_size_m.z;
    const ix = Math.floor(g.nx / 2), iy = Math.floor(g.ny / 3);
    const x = (ix + 0.5) * cell, y = (iy + 0.5) * cell, z = surfaceElevation(grid, x, y);
    const length = Math.min(300, lengthInBlock(scenario.manifest, x, y, z, 0, 90));
    const log = logHole(litho, scenario.manifest, scenario.units, { x, y, z, azimuth: 0, inclination: 90, length });
    expect(log[0]!.from).toBe(0);
    expect(log[log.length - 1]!.to).toBeCloseTo(length, 1);
    for (let i = 1; i < log.length; i++) {
      expect(log[i]!.from).toBeCloseTo(log[i - 1]!.to, 5);
      expect(log[i]!.unit).not.toBe(log[i - 1]!.unit);
    }
    // Every metre of the log is the unit of the cell it falls in.
    for (let d = 0.5; d < length; d += 7) {
      const k = Math.floor((z - d - g.origin.elevation) / dz);
      const expected = scenario.units[litho[ix + g.nx * (iy + g.ny * k)]!]!.key;
      expect(log.find((r) => r.from <= d && d < r.to)!.unit).toBe(expected);
    }
  });

  it("finds a dyke where the hole crosses its plane", async () => {
    const { scenario, grid } = await litres();
    const o = scenario.manifest.grid.origin;
    // A vertical dyke 10 m thick along the north-south line x = 500.
    const dyke = { id: "d1", unit: "dk", strike: 0, dip: 90, thickness_m: 10, trace: { type: "LineString" as const, coordinates: [[o.easting + 500, o.northing + 100], [o.easting + 500, o.northing + 900]] as [number, number][] } };
    expect(insideDyke(dyke, grid, o, 503, 500, 1000)).toBe(true);
    expect(insideDyke(dyke, grid, o, 510, 500, 1000)).toBe(false);
    // The same dyke dipping 45° east: 100 m below the ground it lies 100 m east of its trace.
    const dipping = { ...dyke, dip: 45, thickness_m: 30 };
    const ground = surfaceElevation(grid, 500, 500); // at the trace
    expect(insideDyke(dipping, grid, o, 600, 500, ground - 100)).toBe(true);
    expect(insideDyke(dipping, grid, o, 500, 500, ground - 100)).toBe(false);
  });

  it("saves the holes with the attempt and writes them as CSV", async () => {
    const { scenario, litho, grid } = await litres();
    const state = newGame(scenario, grid, 7, "campaign", "medium");
    const x = 640, y = 700, z = surfaceElevation(grid, x, y);
    const intervals = logHole(litho, scenario.manifest, scenario.units, { x, y, z, azimuth: 45, inclination: 60, length: 120 });
    state.drill!.holes.push({ id: 1, name: "DDH-01", x, y, z, azimuth: 45, inclination: 60, length: 120, cost: holeCost(120), day: 1, minutes: 30, intervals });
    state.drill!.spent = holeCost(120);
    const back = deserialize(serialize(state), state.scenarioId, state.variant)!;
    expect(back.drill!.holes[0]!.intervals).toEqual(intervals);
    expect(back.drill!.spent).toBe(holeCost(120));
    const csv = drillCsv(back.drill!.holes, scenario.manifest, (k) => k, () => "").trim().split("\n");
    expect(csv[0]).toMatch(/^HOLE_ID,EAST,NORTH,RL,AZIMUTH,DIP,LENGTH,FROM,TO/);
    expect(csv.length).toBe(intervals.length + 1);
    expect(csv[1]).toContain("DDH-01");
    expect(csv[1]).toContain(",-60,");
    // Saves from before drilling load with no holes.
    const old = JSON.parse(serialize(state));
    delete old.drill;
    expect(deserialize(JSON.stringify(old), state.scenarioId, state.variant)!.drill!.holes).toEqual([]);
  });
});
