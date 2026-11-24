import { describe, expect, it } from "vitest";
import { COVER, COVER_COLOURS, type Grid } from "../src/world/blocks";
import { CLOUD_BASE_M, CLOUD_TILE_M, cloudShapes, wrap } from "../src/world/clouds";

function grid(environment: Grid["environment"]): Grid {
  const n = 8;
  const elevation = new Float32Array(n * n).fill(100);
  elevation[5] = 900;
  return {
    nx: n, ny: n, cell: 10, elevation,
    cover: new Uint8Array(n * n).fill(COVER.soil), rock: new Int16Array(n * n).fill(-1), outcrop: new Int32Array(n * n).fill(-1),
    unitColours: [0xff0000], coverColours: COVER_COLOURS, dirtColour: 0x8a7352, environment,
  } as unknown as Grid;
}

describe("clouds", () => {
  it("float over the highest ground, on the tile, the same every time", () => {
    const a = cloudShapes(grid("temperate")), b = cloudShapes(grid("temperate"));
    expect(a).toEqual(b);
    for (const s of a) {
      expect(s.z).toBeGreaterThanOrEqual(900 + CLOUD_BASE_M);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThan(CLOUD_TILE_M);
      expect(s.cells.length).toBeGreaterThan(0);
    }
  });

  it("are fewer over the desert than over the forest", () => {
    expect(cloudShapes(grid("desert")).length).toBeLessThan(cloudShapes(grid("temperate")).length);
    expect(cloudShapes(grid("temperate")).length).toBeLessThan(cloudShapes(grid("forest")).length);
  });

  it("wrap about the camera", () => {
    expect(wrap(0, 100)).toBe(0);
    expect(wrap(60, 100)).toBe(-40);
    expect(wrap(-60, 100)).toBe(40);
    expect(wrap(1049, 100)).toBe(49);
  });
});
