import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type Clock, dayState, nextDay, remaining, spend, timeOfDay } from "../src/explore/clock";
import { SIGHT_RADIUS_M, VISIT_RADIUS_M, discover, lineOfSight, outcropInReach } from "../src/explore/discovery";
import { fieldMinutes, hikingSpeedKmh, speedFactor, step } from "../src/explore/movement";
import { loadScenario } from "../src/format/loader";
import type { Scenario } from "../src/format/types";
import { apparentDip, poleFromStrikeDip } from "../src/orientation";
import { newGame, startPosition } from "../src/state/state";
import { BED_SPACING_M, beddingSegments, planeTraces } from "../src/world/bedding";
import { COVER, COVER_COLOURS, type Grid, STEP_M, SUB, blockHeight, blockIndex, buildGrid, heightAt } from "../src/world/blocks";
import { CHUNK, buildChunk } from "../src/world/mesher";

const TOY = fileURLToPath(new URL("../../format/examples/toy/", import.meta.url));
const toy = (): Promise<Scenario> => loadScenario(async (path) => new Uint8Array(await readFile(TOY + path)));

/** A hand-made grid: flat at 100 m, with what the test needs changed. */
function flatGrid(n = 8, cell = 10): Grid {
  return {
    nx: n,
    ny: n,
    cell,
    elevation: new Float32Array(n * n).fill(100),
    cover: new Uint8Array(n * n).fill(COVER.soil),
    rock: new Int16Array(n * n).fill(-1),
    outcrop: new Int32Array(n * n).fill(-1),
    unitColours: [0xff0000],
    coverColours: COVER_COLOURS,
    dirtColour: 0x8a7352,
    environment: "temperate",
  };
}

describe("orientation", () => {
  it("gives poles that lean toward the dip direction", () => {
    const [e, n, u] = poleFromStrikeDip(0, 30); // dips east
    expect(e).toBeCloseTo(0.5, 6);
    expect(n).toBeCloseTo(0, 6);
    expect(u).toBeCloseTo(Math.cos(Math.PI / 6), 6);
  });

  it("gives the true dip across strike and none along strike", () => {
    expect(apparentDip(0, 30, 90)).toBeCloseTo(30, 6);
    expect(apparentDip(0, 30, 0)).toBeCloseTo(0, 6);
    // tan(apparent) = tan(true) * cos(angle from the dip direction)
    expect(Math.tan((apparentDip(0, 30, 45) * Math.PI) / 180)).toBeCloseTo(Math.tan(Math.PI / 6) * Math.SQRT1_2, 6);
  });
});

describe("blocks", () => {
  it("steps the ground and keeps the student on it", async () => {
    const grid = buildGrid(await toy());
    expect(grid.nx).toBe(16);
    for (const [x, y] of [[5, 5], [80, 75], [155, 155], [-20, 500]]) {
      expect(heightAt(grid, x!, y!) % 2.5).toBe(0);
    }
    // Near blocks follow the true surface within half a step plus the interpolation between cell centres.
    expect(Math.abs(blockHeight(grid, 9, 1, SUB) - grid.elevation[4 + 16 * 0]!)).toBeLessThan(2.5);
    // The stream valley is lower than the slopes beside it.
    expect(heightAt(grid, 85, 75)).toBeLessThan(heightAt(grid, 85, 5));
  });

  it("marks rock only where an outcrop is", async () => {
    const scenario = await toy();
    const grid = buildGrid(scenario);
    const rockCells = [...grid.rock].filter((u) => u >= 0).length;
    expect(rockCells).toBe(scenario.outcrops.reduce((n, o) => n + o.cells.length, 0));
    grid.cover.forEach((c, i) => expect(c === COVER.rock).toBe(grid.outcrop[i]! >= 0));
  });
});

describe("mesher", () => {
  it("draws one top per block on flat ground, plus the skirt at the edge of the map", () => {
    const grid = flatGrid();
    for (const sub of [1, 2]) {
      const mesh = buildChunk(grid, 0, 0, sub);
      const blocks = (8 * sub) ** 2, edgeFaces = 4 * 8 * sub;
      expect(mesh.indices.length / 6).toBe(blocks + edgeFaces);
      expect(mesh.positions.length).toBe((blocks + edgeFaces) * 4 * 3);
      expect(Math.max(...mesh.positions.filter((_, i) => i % 3 === 1))).toBe(100);
    }
  });

  it("adds a wall where the ground drops, facing the low side", () => {
    const grid = flatGrid();
    for (let iy = 0; iy < 8; iy++) for (let ix = 4; ix < 8; ix++) grid.elevation[ix + 8 * iy] = 120; // a 20 m scarp facing west
    const flat = buildChunk(flatGrid(), 0, 0, 1), scarp = buildChunk(grid, 0, 0, 1);
    expect(scarp.indices.length / 6 - flat.indices.length / 6).toBe(8);
    let walls = 0;
    for (let q = 0; q < scarp.normals.length / 12; q++) {
      const x = scarp.positions[q * 12]!, nx = scarp.normals[q * 12]!;
      if (x === 40 && nx !== 0) {
        expect(nx).toBe(-1);
        walls += 1;
      }
    }
    expect(walls).toBe(8);
  });

  it("winds every triangle to face along its normal", async () => {
    const mesh = buildChunk(buildGrid(await toy()), 0, 0, SUB);
    const p = mesh.positions, n = mesh.normals;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [a, b, c] = [mesh.indices[t]! * 3, mesh.indices[t + 1]! * 3, mesh.indices[t + 2]! * 3];
      const u = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!];
      const v = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!];
      const cross = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      expect(cross[0]! * n[a]! + cross[1]! * n[a + 1]! + cross[2]! * n[a + 2]!).toBeGreaterThan(0);
    }
  });

  it("colours outcrops by their rock and covers the whole grid in chunks", async () => {
    const scenario = await toy();
    const grid = buildGrid(scenario);
    expect(CHUNK).toBeGreaterThanOrEqual(grid.nx); // the toy fits in one chunk
    const mesh = buildChunk(grid, 0, 0, 1);
    const colours = new Set<string>();
    for (let i = 0; i < mesh.colours.length; i += 3) colours.add([0, 1, 2].map((k) => mesh.colours[i + k]!.toFixed(1)).join());
    expect(colours.size).toBeGreaterThan(4);
    expect(buildChunk(grid, 32, 0, 1).indices.length).toBe(0); // beyond the grid: nothing
  });
});

describe("bedding lines", () => {
  it("draws strike lines on a top face, spaced by the bed spacing over sin(dip)", () => {
    const pole = poleFromStrikeDip(0, 30); // strike north, dip east
    const traces = planeTraces([0, 0, 50], [1, 0, 0], [0, 1, 0], 10, 10, pole, BED_SPACING_M);
    expect(traces.length).toBeGreaterThan(2);
    for (const [s1, t1, s2, t2] of traces) {
      expect(s1).toBeCloseTo(s2!, 6); // constant easting: the line runs north
      expect(Math.abs(t2! - t1!)).toBeCloseTo(10, 6);
    }
    const xs = traces.map((t) => t[0]!).sort((a, b) => a - b);
    expect(xs[1]! - xs[0]!).toBeCloseTo(BED_SPACING_M / Math.sin(Math.PI / 6), 6);
  });

  it("shows the true dip on a face across strike and level lines on a face along strike", () => {
    const pole = poleFromStrikeDip(0, 30);
    const across = planeTraces([0, 0, 50], [1, 0, 0], [0, 0, 1], 10, 10, pole, BED_SPACING_M); // face running east
    for (const [s1, t1, s2, t2] of across) {
      expect((t2! - t1!) / (s2! - s1!)).toBeCloseTo(-Math.tan(Math.PI / 6), 6); // down to the east at 30 degrees
    }
    const along = planeTraces([0, 0, 50], [0, 1, 0], [0, 0, 1], 10, 10, pole, BED_SPACING_M); // face running north
    expect(along.length).toBeGreaterThan(2);
    for (const [, t1, , t2] of along) expect(t1).toBeCloseTo(t2!, 6);
  });

  it("keeps every line on its bed", async () => {
    const scenario = await toy();
    const segments = beddingSegments(scenario, buildGrid(scenario));
    expect(segments.length).toBeGreaterThan(0);
    const pole = poleFromStrikeDip(0, 30);
    for (let i = 0; i < segments.length; i += 3) {
      // three.js axes back to east, north, up
      const height = (segments[i]! * pole[0] - segments[i + 2]! * pole[1] + segments[i + 1]! * pole[2]) / BED_SPACING_M;
      expect(Math.abs(height - Math.round(height))).toBeLessThan(0.06); // within the lift off the face
    }
  });
});

describe("walking", () => {
  it("follows Tobler: fastest on a gentle descent, slow on steep ground either way", () => {
    expect(hikingSpeedKmh(0)).toBeCloseTo(5.04, 1);
    expect(hikingSpeedKmh(-0.05)).toBeCloseTo(6, 6);
    expect(speedFactor(0.5, COVER.soil)).toBeLessThan(0.25);
    expect(speedFactor(-0.5, COVER.soil)).toBeLessThan(0.3);
    expect(speedFactor(0, COVER.vegetation)).toBeCloseTo(0.6, 6);
    expect(fieldMinutes(1000, 1)).toBeCloseTo(60 / hikingSpeedKmh(0), 6); // about 12 minutes per kilometre
  });

  it("moves along the heading, costs time, and stays inside the area", () => {
    const grid = flatGrid(8, 10);
    const walker = { x: 40, y: 40, heading: 90, pitch: 0 };
    const moved = step(walker, grid, 1, 0, 0.5);
    expect(walker.x).toBeGreaterThan(40);
    expect(walker.y).toBeCloseTo(40, 6);
    expect(moved.distance).toBeCloseTo(walker.x - 40, 6);
    expect(moved.minutes).toBeCloseTo(fieldMinutes(moved.distance, 1), 6);
    for (let i = 0; i < 100; i++) step(walker, grid, 1, 0, 0.1);
    expect(walker.x).toBeLessThan(80);
    expect(step(walker, grid, 0, 0, 1)).toMatchObject({ distance: 0, minutes: 0 });
  });

  it("charges more field time uphill for the same distance", () => {
    const flat = flatGrid(), hill = flatGrid();
    for (let iy = 0; iy < 8; iy++) for (let ix = 0; ix < 8; ix++) hill.elevation[ix + 8 * iy] = 100 + 5 * ix; // rises east at 0.5
    const a = step({ x: 20, y: 40, heading: 90, pitch: 0 }, flat, 1, 0, 0.2);
    const b = step({ x: 20, y: 40, heading: 90, pitch: 0 }, hill, 1, 0, 0.2);
    expect(b.distance).toBeLessThan(a.distance);
    expect(b.minutes / b.distance).toBeGreaterThan(3 * (a.minutes / a.distance));
  });
});

describe("field clock", () => {
  const rules = { field_days: 2, minutes_per_day: 480 };

  it("runs through the days and stops at the end of the campaign", () => {
    const clock: Clock = { day: 1, minutes: 0 };
    expect(timeOfDay(clock)).toBe("08:00");
    expect(spend(clock, 90.5, rules)).toBe("working");
    expect(timeOfDay(clock)).toBe("09:30");
    expect(remaining(clock, rules)).toBe("6 h 30 min");
    expect(nextDay(clock, rules)).toBe(false); // the day is not over yet
    expect(spend(clock, 1000, rules)).toBe("day_over");
    expect(clock.minutes).toBe(480);
    expect(nextDay(clock, rules)).toBe(true);
    expect(clock).toEqual({ day: 2, minutes: 0 });
    expect(spend(clock, 480, rules)).toBe("campaign_over");
    expect(nextDay(clock, rules)).toBe(false);
    expect(dayState(clock, rules)).toBe("campaign_over");
  });
});

describe("fog of war", () => {
  it("sees over open ground but not through a ridge", () => {
    const grid = flatGrid(40, 10);
    expect(lineOfSight(grid, 20, 200, 103, 380, 200, 100.5)).toBe(true);
    for (let iy = 0; iy < 40; iy++) grid.elevation[20 + 40 * iy] = 130; // a ridge running north across the middle
    expect(lineOfSight(grid, 20, 200, 103, 380, 200, 100.5)).toBe(false);
    expect(lineOfSight(grid, 20, 200, 103, 150, 200, 100.5)).toBe(true); // same side of the ridge
  });

  it("starts with no outcrops, visits the near ones and sights the far ones", async () => {
    const scenario = await toy();
    const grid = buildGrid(scenario);
    const state = newGame(scenario, grid);
    expect(state.found.visited.size + state.found.sighted.size).toBe(0);
    expect(state.clock).toEqual({ day: 1, minutes: 0 });

    const origin = scenario.manifest.grid.origin;
    const first = scenario.outcrops[0]!;
    const x = first.position.easting - origin.easting, y = first.position.northing - origin.northing;
    const fresh = discover(scenario, grid, state.found, x, y);
    expect(state.found.visited.has(0)).toBe(true);
    expect(fresh).toContain(0);
    // Everything in the toy is within sighting range; what is visited is also within the visit radius.
    scenario.outcrops.forEach((o, n) => {
      const d = Math.hypot(o.position.easting - origin.easting - x, o.position.northing - origin.northing - y);
      expect(d).toBeLessThan(SIGHT_RADIUS_M);
      expect(state.found.visited.has(n)).toBe(d <= VISIT_RADIUS_M);
    });
    expect(discover(scenario, grid, state.found, x, y)).toEqual([]); // nothing new the second time
    expect(outcropInReach(scenario, grid, x, y)).toBe(0);
    expect(outcropInReach(scenario, grid, 5, 155)).toBe(-1);
  });

  it("makes camp on the valley floor", async () => {
    const grid = buildGrid(await toy());
    const camp = startPosition(grid);
    expect(grid.cover[Math.floor(camp.x / 10) + 16 * Math.floor(camp.y / 10)]).toBe(COVER.alluvium);
  });
});

describe("blocks broken with the hammer", () => {
  it("lower the near block struck by one step a blow, and the ground with it", () => {
    const grid = flatGrid();
    const { bx, by, index } = blockIndex(grid, 23, 17);
    expect([bx, by]).toEqual([Math.floor(23 / (grid.cell / SUB)), Math.floor(17 / (grid.cell / SUB))]);
    const before = blockHeight(grid, bx, by, SUB), ground = heightAt(grid, 23, 17);
    grid.dug = new Uint8Array(grid.nx * grid.ny * SUB * SUB);
    grid.dug[index] = 2;
    expect(blockHeight(grid, bx, by, SUB)).toBeCloseTo(before - 2 * STEP_M);
    expect(heightAt(grid, 23, 17)).toBeCloseTo(ground - 2 * STEP_M); // the student can step down into the hole
    expect(blockHeight(grid, bx + 1, by, SUB)).toBeCloseTo(before); // the neighbours stay
    expect(blockHeight(grid, Math.floor(bx / SUB), Math.floor(by / SUB), 1)).toBeCloseTo(blockHeight({ ...grid, dug: undefined }, Math.floor(bx / SUB), Math.floor(by / SUB), 1)); // far away it does not show
    const chunk = buildChunk(grid, 0, 0, SUB);
    const flat = buildChunk({ ...grid, dug: undefined }, 0, 0, SUB);
    expect(chunk.indices.length).toBeGreaterThan(flat.indices.length); // the walls of the hole
  });
});
