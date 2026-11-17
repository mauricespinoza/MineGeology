import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pace, slopeAt, speedFactor, step } from "../src/explore/movement";
import { loadScenario, loadTruth } from "../src/format/loader";
import { deserialize, serialize } from "../src/state/save";
import { newGame } from "../src/state/state";
import { measure, readCompass, record, sampleResult, samplesLeft, takeSample } from "../src/tools/fieldwork";
import {
  angleBetweenLines, angleBetweenPlanes, parseLine, parsePlaneNumbers, parseQuadrant, writeLine, writePlane, type Plane,
} from "../src/tools/notation";
import { COVER, type Grid, buildGrid } from "../src/world/blocks";

const TOY = fileURLToPath(new URL("../../format/examples/toy/", import.meta.url));
const fromDisk = async (path: string) => new Uint8Array(await readFile(TOY + path));

function hill(n = 20, rise = 0.5): Grid {
  // Ground rising east: `rise` metres per metre.
  const elevation = new Float32Array(n * n);
  for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) elevation[ix + n * iy] = 100 + rise * (ix + 0.5) * 10;
  return { nx: n, ny: n, cell: 10, elevation, cover: new Uint8Array(n * n).fill(COVER.soil), rock: new Int16Array(n * n).fill(-1), outcrop: new Int32Array(n * n).fill(-1), unitColours: [] };
}

describe("notation", () => {
  const same = (got: Plane | { error: string }, want: Plane) => {
    expect("error" in got ? got.error : null).toBeNull();
    expect((got as Plane).strike).toBeCloseTo(want.strike, 9);
    expect((got as Plane).dip).toBeCloseTo(want.dip, 9);
  };

  it("reads right-hand rule and dip direction into the same plane", () => {
    same(parsePlaneNumbers("rhr", "355", "34"), { strike: 355, dip: 34 });
    same(parsePlaneNumbers("dipdir", "085", "34"), { strike: 355, dip: 34 });
    same(parsePlaneNumbers("dipdir", "10", "60"), { strike: 280, dip: 60 });
    same(parsePlaneNumbers("rhr", "360", "0"), { strike: 0, dip: 0 });
    same(parsePlaneNumbers("rhr", " 12,5° ", "7"), { strike: 12.5, dip: 7 });
    expect(parsePlaneNumbers("rhr", "abc", "34")).toEqual({ error: "Escribe el rumbo como un número." });
    expect(parsePlaneNumbers("rhr", "400", "34")).toEqual({ error: "El rumbo va de 0 a 360." });
    expect(parsePlaneNumbers("dipdir", "85", "95")).toEqual({ error: "El manteo va de 0 a 90." });
  });

  it("reads quadrant notation, with W or O, and checks that the dip quadrant fits the strike", () => {
    same(parseQuadrant("N35E/40SE"), { strike: 35, dip: 40 });
    same(parseQuadrant("N35E/40NW"), { strike: 215, dip: 40 });
    same(parseQuadrant("n 35 e 40 se"), { strike: 35, dip: 40 });
    same(parseQuadrant("N5W/34NE"), { strike: 355, dip: 34 });
    same(parseQuadrant("N5O/34NE"), { strike: 355, dip: 34 });
    same(parseQuadrant("S20W, 60NW"), { strike: 200, dip: 60 });
    same(parseQuadrant("N0E/30E"), { strike: 0, dip: 30 });
    same(parseQuadrant("N90E/20S"), { strike: 90, dip: 20 });
    same(parseQuadrant("N45W/0"), { strike: 315, dip: 0 });
    expect(parseQuadrant("N35E/40NE")).toEqual({ error: "Un plano de rumbo N35E no puede mantear hacia el NE." });
    expect(parseQuadrant("N35E/40")).toEqual({ error: "Falta hacia dónde mantea, por ejemplo 40SE." });
    expect(parseQuadrant("355/34")).toEqual({ error: "Escribe el rumbo y el manteo así: N35E/40SE." });
    expect(parseQuadrant("N95E/40SE")).toEqual({ error: "El ángulo del rumbo en cuadrantes va de 0 a 90." });
  });

  it("writes every notation in a form it reads back", () => {
    for (let strike = 0; strike < 360; strike += 7) {
      for (const dip of [0, 12, 45, 90]) {
        if (dip === 0 && strike !== 0) continue;
        same(parsePlaneNumbers("rhr", ...(writePlane("rhr", { strike, dip }).split("/") as [string, string])), { strike, dip });
        same(parsePlaneNumbers("dipdir", ...(writePlane("dipdir", { strike, dip }).split("/") as [string, string])), { strike, dip });
        const q = parseQuadrant(writePlane("quadrant", { strike, dip }));
        if (dip > 0) same(q, { strike, dip });
      }
    }
    expect(writePlane("rhr", { strike: 355, dip: 34 })).toBe("355/34");
    expect(writePlane("dipdir", { strike: 355, dip: 34 })).toBe("085/34");
    expect(writePlane("quadrant", { strike: 355, dip: 34 })).toBe("N5W/34NE");
    expect(writePlane("quadrant", { strike: 200, dip: 60 })).toBe("N20E/60NW");
    expect(writeLine({ trend: 85, plunge: 34 })).toBe("34→085");
  });

  it("reads lines and measures angles between orientations", () => {
    expect(parseLine("085", "34")).toEqual({ trend: 85, plunge: 34 });
    expect(parseLine("85", "-3")).toEqual({ error: "Escribe la inclinación como un número." });
    expect(angleBetweenPlanes({ strike: 355, dip: 34 }, { strike: 355, dip: 34 })).toBeCloseTo(0, 6);
    expect(angleBetweenPlanes({ strike: 0, dip: 30 }, { strike: 180, dip: 30 })).toBeCloseTo(60, 6); // dipping east vs west
    expect(angleBetweenPlanes({ strike: 0, dip: 90 }, { strike: 180, dip: 90 })).toBeCloseTo(0, 6); // the same vertical plane
    expect(angleBetweenPlanes({ strike: 85, dip: 34 }, { strike: 355, dip: 34 })).toBeGreaterThan(40); // a dip direction written as a strike
    expect(angleBetweenLines({ trend: 85, plunge: 34 }, { trend: 85, plunge: 40 })).toBeCloseTo(6, 6);
  });
});

describe("slope and effort", () => {
  it("measures the slope of the true surface in any direction", () => {
    const grid = hill(20, 0.5);
    const east = slopeAt(grid, 100, 100, 90), west = slopeAt(grid, 100, 100, 270), north = slopeAt(grid, 100, 100, 0);
    expect(east.along).toBeCloseTo(0.5, 6);
    expect(east.degrees).toBeCloseTo((Math.atan(0.5) * 180) / Math.PI, 6);
    expect(west.along).toBeCloseTo(-0.5, 6);
    expect(north.along).toBeCloseTo(0, 6);
    expect(north.steepest).toBeCloseTo(0.5, 6);
    expect(slopeAt(grid, 100, 100, 45).along).toBeCloseTo(0.5 * Math.SQRT1_2, 6);
  });

  it("slows and charges uphill in a campaign, and not at all in free mode", () => {
    const grid = hill(20, 0.5);
    const walker = () => ({ x: 60, y: 100, heading: 90, pitch: 0 });
    const flat = step(walker(), hill(20, 0), 1, 0, 0.2);
    const up = step(walker(), grid, 1, 0, 0.2);
    const free = step(walker(), grid, 1, 0, 0.2, false);
    expect(up.factor).toBeCloseTo(speedFactor(0.5, COVER.soil), 6);
    expect(up.distance).toBeLessThan(flat.distance);
    expect(up.minutes / up.distance).toBeGreaterThan(4 * (flat.minutes / flat.distance));
    expect(free).toEqual({ distance: flat.distance, minutes: 0, factor: 1 });
    expect(pace(0, COVER.soil)).toBeCloseTo(5.04, 2);
    expect(pace(0.5, COVER.soil)).toBeLessThan(1);
    expect(pace(0, COVER.vegetation)).toBeCloseTo(0.6 * 5.04, 2);
  });
});

describe("modes", () => {
  it("lets free mode sample without limit and get lab results at once", async () => {
    const scenario = await loadScenario(fromDisk);
    const truth = await loadTruth(fromDisk, scenario.manifest);
    const rules = scenario.manifest.rules; // the toy allows one sample
    const lava = scenario.outcrops[0]!;
    const free = { scenario, truth, state: newGame(scenario, buildGrid(scenario), 1, "free") };
    expect(free.state.mode).toBe("free");
    expect(samplesLeft(free)).toBe(Infinity);
    for (let i = 0; i < 3; i++) expect(typeof takeSample(free, lava, "u07", "age")).toBe("object");
    expect(sampleResult(free, free.state.samples[0]!, rules)).toBe("Edad U-Pb en circón: 153,2 ± 1,1 Ma.");

    const campaign = { scenario, truth, state: newGame(scenario, buildGrid(scenario), 1) };
    expect(campaign.state.mode).toBe("campaign");
    takeSample(campaign, lava, "u07", "age");
    expect(takeSample(campaign, lava, "u07", "age")).toContain("No quedan muestras");
    expect(sampleResult(campaign, campaign.state.samples[0]!, rules)).toBeNull();
  });

  it("keeps the mode and the notation through a save, and reads older saves as campaigns", async () => {
    const scenario = await loadScenario(fromDisk);
    const state = newGame(scenario, buildGrid(scenario), 1, "free");
    state.notation = "quadrant";
    const back = deserialize(serialize(state), state.scenarioId, state.variant)!;
    expect(back.mode).toBe("free");
    expect(back.notation).toBe("quadrant");
    const old = JSON.parse(serialize(state));
    delete old.mode;
    delete old.notation;
    const loaded = deserialize(JSON.stringify(old), state.scenarioId, state.variant)!;
    expect(loaded.mode).toBe("campaign");
    expect(loaded.notation).toBe("rhr");
  });
});

describe("compass and notebook", () => {
  it("shows a reading, and writes down what the student enters next to it", async () => {
    const scenario = await loadScenario(fromDisk);
    const field = { scenario, truth: null, state: newGame(scenario, buildGrid(scenario), 9) };
    const lava = scenario.outcrops[0]!;
    const first = readCompass(field, lava, "p1", "plane")!;
    expect(first.minutes).toBe(3);
    expect(readCompass(field, lava, "p1", "plane")!.result).toEqual(first.result); // nothing written yet: same reading
    expect(field.state.stations[0]!.measurements).toHaveLength(0);

    // The student writes it as a dip direction, one degree off.
    const r = first.result;
    const parsed = parsePlaneNumbers("dipdir", String((r.a + 90 + 1) % 360), String(r.b));
    expect("error" in parsed).toBe(false);
    const m = record(field, lava, r, { a: (parsed as Plane).strike, b: (parsed as Plane).dip, notation: "dipdir", text: "x" });
    expect(m).toMatchObject({ feature: "bedding", planeId: "p1", type: "plane", read: { a: r.a, b: r.b }, notation: "dipdir", entered: "x" });
    expect(m.a).toBeCloseTo((r.a + 1) % 360, 9);
    expect(readCompass(field, lava, "p1", "plane")!.result).not.toEqual(first.result); // the next reading is a new one

    const exact = measure(field, lava, "p1", "plane")!.result;
    expect(exact.read).toEqual({ a: exact.a, b: exact.b });
    expect(exact.entered).toMatch(/^\d{3}\/\d{2}$/);
    expect(readCompass(field, lava, "p9", "plane")).toBeNull();
  });
});

describe("flying in free mode", () => {
  it("sights outcrops from the air but visits them only near the ground", async () => {
    const { discover, VISIT_CEILING_M } = await import("../src/explore/discovery");
    const scenario = await loadScenario(fromDisk);
    const grid = buildGrid(scenario);
    const origin = scenario.manifest.grid.origin;
    const first = scenario.outcrops[0]!;
    const x = first.position.easting - origin.easting, y = first.position.northing - origin.northing;
    const found = { sighted: new Set<number>(), visited: new Set<number>() };
    discover(scenario, grid, found, x, y, 120);
    expect(found.visited.size).toBe(0);
    expect(found.sighted.has(0)).toBe(true);
    discover(scenario, grid, found, x, y, VISIT_CEILING_M - 1);
    expect(found.visited.has(0)).toBe(true);
  });

  it("moves at the speed asked for, without effort, and keeps flight only in free mode", async () => {
    const { FLY_SPEED } = await import("../src/explore/movement");
    const grid = hill(40, 0.5);
    const fly = step({ x: 60, y: 200, heading: 90, pitch: 0 }, grid, 1, 0, 0.1, false, FLY_SPEED);
    expect(fly.distance).toBeCloseTo(FLY_SPEED * 0.1, 6);
    expect(fly.minutes).toBe(0);
    const scenario = await loadScenario(fromDisk);
    const state = newGame(scenario, buildGrid(scenario), 1, "free");
    expect(state.flight).toEqual({ on: false, height: 0 });
    state.flight = { on: true, height: 140 };
    expect(deserialize(serialize(state), state.scenarioId, state.variant)!.flight).toEqual({ on: true, height: 140 });
    const campaign = JSON.parse(serialize(state));
    campaign.mode = "campaign";
    expect(deserialize(JSON.stringify(campaign), state.scenarioId, state.variant)!.flight).toEqual({ on: false, height: 0 });
  });
});
