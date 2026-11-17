import { describe, expect, it } from "vitest";
import { INDICATOR_TEXT, kinematicSvg, sketchView } from "../src/ui/kinematicSketch";

describe("kinematic sketches", () => {
  it("shows dip-slip faults in section, looking along strike, dipping to the right", () => {
    const v = sketchView("normal", 20, 60);
    expect(v.plan).toBe(false);
    expect(v.angle).toBe(60);
    expect(v.right).toContain("110"); // the dip direction is on the right
    expect(v.left).toContain("290");
    expect(v.caption).toContain("020");
    expect(v.shear).toBe(1); // the hanging wall (upper block) goes down the dip, to the right
    expect(sketchView("reverse", 20, 60).shear).toBe(-1);
  });

  it("shows strike-slip faults from above, with the strike to the right", () => {
    const v = sketchView("dextral", 300, 88);
    expect(v.plan).toBe(true);
    expect(v.angle).toBe(0);
    expect(v.right).toContain("300");
    expect(v.top).toContain("210"); // the upper block is the one to the left of the strike
    expect(v.shear).toBe(1); // dextral: the far block moves to the right
    expect(sketchView("sinistral", 300, 88).shear).toBe(-1);
  });

  it("mirrors the drawing for the opposite sense and never writes the sense", () => {
    for (const indicator of Object.keys(INDICATOR_TEXT) as (keyof typeof INDICATOR_TEXT)[]) {
      const a = kinematicSvg({ indicator, plane: "p2", sense: "dextral" }, 0, 90);
      const b = kinematicSvg({ indicator, plane: "p2", sense: "sinistral" }, 0, 90);
      expect(a).not.toContain("scale(-1 1)");
      expect(b).toContain("scale(-1 1)");
      for (const word of ["dextral", "sinistral", "normal", "invers"]) expect(a + b).not.toContain(word);
    }
  });
});
