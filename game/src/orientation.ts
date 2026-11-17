// Plane and line geometry shared by the world, the compass and (later) the stereonet.
// Vectors are [east, north, up].

export type Vec3 = [number, number, number];

const RAD = Math.PI / 180;

/** Unit normal of a plane, pointing up. Right-hand rule: the plane dips toward strike + 90. */
export function poleFromStrikeDip(strike: number, dip: number): Vec3 {
  const direction = (strike + 90) * RAD;
  const d = dip * RAD;
  return [Math.sin(d) * Math.sin(direction), Math.sin(d) * Math.cos(direction), Math.cos(d)];
}

/** Slope (rise over run) of the trace of a plane on a vertical face, along the horizontal direction t. */
export function apparentSlope(pole: Vec3, t: [number, number]): number {
  return -(pole[0] * t[0] + pole[1] * t[1]) / pole[2];
}

/** Apparent dip in degrees, 0 to 90, of a plane seen on a vertical face that runs along azimuth `faceAzimuth`. */
export function apparentDip(strike: number, dip: number, faceAzimuth: number): number {
  const a = faceAzimuth * RAD;
  return Math.abs(Math.atan(apparentSlope(poleFromStrikeDip(strike, dip), [Math.sin(a), Math.cos(a)]))) / RAD;
}
