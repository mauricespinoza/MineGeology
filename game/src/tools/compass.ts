// The compass: true orientations go in, readings with scatter come out.

import type { Manifest, Observation, Plane } from "../format/types";
import { generator, hash, normal } from "./random";

export interface PlaneReading {
  strike: number;
  dip: number;
}

export interface LineReading {
  trend: number;
  plunge: number;
}

type Scatter = Manifest["rules"]["scatter"];

const mod360 = (a: number) => ((Math.round(a) % 360) + 360) % 360;

/** Scatter multiplier for an outcrop of the given quality. */
export function qualityFactor(quality: Observation["quality"], scatter: Scatter): number {
  return quality === "poor" ? scatter.poor_quality_factor : 1;
}

/**
 * One reading of a plane. Strike is harder to read on gently dipping planes, so its scatter grows as the
 * dip falls below 30 degrees. `seed` fixes the reading: the same seed always gives the same numbers.
 */
export function readPlane(plane: Pick<Plane, "strike" | "dip">, quality: Observation["quality"], scatter: Scatter, seed: number): PlaneReading {
  const random = generator(seed);
  const k = qualityFactor(quality, scatter);
  const gentle = Math.min(Math.max(0.5 / Math.max(Math.sin((plane.dip * Math.PI) / 180), 1e-6), 1), 4);
  let strike = plane.strike + normal(random) * scatter.strike_sigma_deg * k * gentle;
  let dip = plane.dip + normal(random) * scatter.dip_sigma_deg * k;
  if (dip < 0) {
    dip = -dip; // the plane dips the other way
    strike += 180;
  } else if (dip > 90) {
    dip = 180 - dip;
    strike += 180;
  }
  return { strike: mod360(strike), dip: Math.round(dip) };
}

/** One reading of a line (striae, a fold hinge). */
export function readLine(line: { trend: number; plunge: number }, quality: Observation["quality"], scatter: Scatter, seed: number): LineReading {
  const random = generator(seed);
  const k = qualityFactor(quality, scatter);
  let trend = line.trend + normal(random) * scatter.strike_sigma_deg * k;
  let plunge = line.plunge + normal(random) * scatter.dip_sigma_deg * k;
  if (plunge < 0) {
    plunge = -plunge;
    trend += 180;
  } else if (plunge > 90) {
    plunge = 180 - plunge;
    trend += 180;
  }
  return { trend: mod360(trend), plunge: Math.round(plunge) };
}

/** Seed of the n-th reading of one feature at one outcrop by one student. */
export function readingSeed(studentSeed: number, outcropId: string, feature: string, n: number): number {
  return hash(studentSeed, outcropId, feature, n);
}

const WINDS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
const wind = (azimuth: number) => WINDS[Math.round((((azimuth % 360) + 360) % 360) / 45) % 8]!;
const pad = (n: number, width: number) => String(n).padStart(width, "0");

/** "355/34 E": strike by the right-hand rule, dip, and the direction the plane dips toward. */
export function formatPlane(reading: PlaneReading): string {
  return `${pad(reading.strike, 3)}/${pad(reading.dip, 2)} ${wind(reading.strike + 90)}`;
}

/** "34→085": plunge and trend. */
export function formatLine(reading: LineReading): string {
  return `${pad(reading.plunge, 2)}→${pad(reading.trend, 3)}`;
}
