import { describe, expect, it } from "vitest";
import { screenDirection } from "../src/explore/gyro";

const close = (a: number, b: number, tol = 0.5) => expect(Math.abs(((a - b + 540) % 360) - 180)).toBeLessThan(tol);

describe("the gyroscope", () => {
  it("looks straight ahead with the tablet upright, and north when alpha is 0", () => {
    const d = screenDirection(0, 90, 0, 0);
    close(d.heading, 0);
    expect(Math.abs(d.pitch)).toBeLessThan(0.5);
  });
  it("turns clockwise on the compass when the tablet turns to the right (alpha falls)", () => {
    close(screenDirection(-90 + 360, 90, 0, 0).heading, 90);
    close(screenDirection(90, 90, 0, 0).heading, 270);
  });
  it("looks down when the tablet is tilted back and flat, and up when tilted forward", () => {
    expect(screenDirection(0, 60, 0, 0).pitch).toBeCloseTo(-30, 0);
    expect(screenDirection(0, 0, 0, 0).pitch).toBeCloseTo(-90, 0);
    expect(screenDirection(0, 120, 0, 0).pitch).toBeCloseTo(30, 0);
  });
  it("allows for a tablet held in landscape", () => {
    // Turned a quarter to the left (screen angle 90), standing upright on its long side: gamma is -90... or 90.
    const d = screenDirection(0, 0, -90, 90);
    expect(Math.abs(d.pitch)).toBeLessThan(0.5);
  });
});
