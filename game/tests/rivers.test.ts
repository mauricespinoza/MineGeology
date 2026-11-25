import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadScenario } from "../src/format/loader";
import { COVER, COVER_COLOURS, type Grid, RIVER_DEPTH_M, SUB, blockHeight, buildGrid } from "../src/world/blocks";
import { buildChunk } from "../src/world/mesher";
import { PATTERN } from "../src/world/rockPattern";
import { RIVER_AREA_M2, distanceToWater, drainage, riverMask } from "../src/world/rivers";
import { SUN_DIRECTION } from "../src/world/sun";

/** A valley running north, its floor along ix = n / 2, falling to the south edge. */
function valley(n = 64, cell = 10): { nx: number; ny: number; cell: number; elevation: Float32Array; environment: "temperate" } {
  const elevation = new Float32Array(n * n);
  for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) elevation[ix + n * iy] = 100 + Math.abs(ix - n / 2) * 4 + iy * 1.5;
  return { nx: n, ny: n, cell, elevation, environment: "temperate" };
}

describe("rivers", () => {
  it("gather the water of the whole area at the outlet", () => {
    const v = valley();
    const { area, receiver } = drainage(v.nx, v.ny, v.elevation);
    const outlet = v.nx / 2; // the valley floor on the south edge
    expect(receiver[outlet]).toBe(-1);
    expect(Math.max(...area)).toBe(area[outlet]);
    expect(area[outlet]!).toBeGreaterThan(v.nx * v.ny * 0.5);
  });

  it("run along the valley floor, wider downstream, and nowhere on the slopes", () => {
    const v = valley(96, 20);
    const mask = riverMask(v);
    const floor = v.nx / 2;
    expect(mask[floor]).toBe(2); // a river at the outlet
    for (let iy = 0; iy < v.ny; iy++) {
      for (let ix = 0; ix < v.nx; ix++) if (Math.abs(ix - floor) > 1) expect(mask[ix + v.nx * iy]).toBe(0);
    }
    // Upstream it narrows to nothing, where too little rain drains to the floor.
    expect(mask[floor + v.nx * (v.ny - 2)]).toBe(0);
  });

  it("leave fewer courses wet in the desert", () => {
    expect(RIVER_AREA_M2.desert).toBeGreaterThan(RIVER_AREA_M2.temperate);
    const wet = (m: Uint8Array) => m.reduce((n, x) => n + (x ? 1 : 0), 0);
    const v = valley(96, 20);
    expect(wet(riverMask({ ...v, environment: "desert" } as never))).toBeLessThan(wet(riverMask(v)));
  });

  it("are joined side to side, never only at a corner", async () => {
    const TOY = fileURLToPath(new URL("../../baked/quebrada-los-litres-a/", import.meta.url));
    const scenario = await loadScenario(async (path) => new Uint8Array(await readFile(TOY + path)));
    const started = performance.now();
    const grid = buildGrid(scenario);
    expect(performance.now() - started).toBeLessThan(2000);
    const { nx, ny, river } = grid;
    expect(river).toBeDefined();
    let wet = 0;
    for (let iy = 1; iy < ny - 1; iy++) {
      for (let ix = 1; ix < nx - 1; ix++) {
        if (!river![ix + nx * iy]) continue;
        wet++;
        for (const [dx, dy] of [[1, 1], [1, -1]] as const) {
          if (!river![ix + dx + nx * (iy + dy)]) continue;
          expect(river![ix + dx + nx * iy] || river![ix + nx * (iy + dy)]).toBeTruthy();
        }
      }
    }
    expect(wet / (nx * ny)).toBeGreaterThan(0.002);
    expect(wet / (nx * ny)).toBeLessThan(0.03);
  });

  it("lie below their banks, drawn as water, and are heard near by", () => {
    const n = 8;
    const grid = {
      nx: n, ny: n, cell: 10, elevation: new Float32Array(n * n).fill(100),
      cover: new Uint8Array(n * n).fill(COVER.soil), rock: new Int16Array(n * n).fill(-1), outcrop: new Int32Array(n * n).fill(-1),
      unitColours: [0xff0000], coverColours: COVER_COLOURS, dirtColour: 0x8a7352, environment: "temperate",
      river: new Uint8Array(n * n),
    } as Grid;
    grid.river![3 + n * 3] = 1;
    expect(blockHeight(grid, 3 * SUB, 3 * SUB, SUB)).toBeCloseTo(100 - RIVER_DEPTH_M[1]!);
    expect(blockHeight(grid, 5 * SUB, 3 * SUB, SUB)).toBeCloseTo(100);
    const mesh = buildChunk(grid, 0, 0, SUB);
    expect(Array.from(mesh.patterns)).toContain(PATTERN.water);
    expect(distanceToWater(grid, 35, 35, 70)).toBe(0);
    expect(distanceToWater(grid, 60, 35, 70)).toBeCloseTo(20);
    expect(distanceToWater(grid, 79, 79, 30)).toBe(Infinity);
  });
});

describe("the sun", () => {
  it("shines from the northern sky, as it does in Chile", () => {
    expect(SUN_DIRECTION.z).toBeLessThan(0); // north is -z
    expect(Math.abs(SUN_DIRECTION.z)).toBeGreaterThan(Math.abs(SUN_DIRECTION.x));
  });
});
