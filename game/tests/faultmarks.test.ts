import { describe, expect, it } from "vitest";
import { faultMarks } from "../src/interpret/symbols";

// A fault drawn northward along x = 0, in a frame with y up: its right is the east (x > 0).
const north = [0, 0, 0, 100];
const side = (pts: number[]) => Math.sign(pts.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0));

describe("fault symbols", () => {
  it("puts the teeth of a reverse fault on the right of the drawing direction, or the left when flipped", () => {
    const m = faultMarks(north, "reverse", 10);
    expect(m.teeth.length).toBeGreaterThan(1);
    for (const t of m.teeth) expect(t[4]).toBeGreaterThan(0); // the tip of each tooth is east
    for (const t of faultMarks(north, "reverse", 10, true).teeth) expect(t[4]).toBeLessThan(0);
    expect(faultMarks(north, "thrust", 10).teeth.length).toBeGreaterThan(m.teeth.length); // closer teeth
  });

  it("draws the bar and ball of a normal fault on the downthrown side", () => {
    const m = faultMarks(north, "normal", 10);
    expect(m.bars.length).toBe(m.balls.length);
    for (const [x] of m.balls) expect(x).toBeGreaterThan(0);
  });

  it("shows the sense of strike-slip with half arrows that do not depend on the side", () => {
    for (const flip of [false, true]) {
      const [a, b] = faultMarks(north, "dextral", 10, flip).arrows as [number[], number[]];
      // Dextral: the western block moves north, the eastern one south.
      const west = side(a) < 0 ? a : b, east = side(a) < 0 ? b : a;
      expect(west[3]! - west[1]!).toBeGreaterThan(0);
      expect(east[3]! - east[1]!).toBeLessThan(0);
    }
    const [s1] = faultMarks(north, "sinistral", 10).arrows as [number[]];
    const [d1] = faultMarks(north, "dextral", 10).arrows as [number[]];
    expect(Math.sign(s1[3]! - s1[1]!)).toBe(-Math.sign(d1[3]! - d1[1]!));
  });

  it("draws nothing for a fault without a known movement", () => {
    const m = faultMarks(north, undefined, 10);
    expect(m.teeth.length + m.bars.length + m.arrows.length).toBe(0);
  });
});
