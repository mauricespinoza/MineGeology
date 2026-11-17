// How a geologist writes a plane or a line down, and how to read it back.
// Internally a plane is strike (right-hand rule) and dip; a line is trend and plunge.

export type PlaneNotation = "rhr" | "dipdir" | "quadrant";

export const PLANE_NOTATIONS: Record<PlaneNotation, { name: string; example: string; first?: string; second?: string }> = {
  rhr: { name: "Rumbo/manteo, regla de la mano derecha", example: "355/34", first: "Rumbo", second: "Manteo" },
  dipdir: { name: "Dirección de manteo/manteo", example: "085/34", first: "Dirección de manteo", second: "Manteo" },
  quadrant: { name: "Cuadrantes", example: "N5W/34NE" },
};

export interface Plane {
  strike: number;
  dip: number;
}
export interface Line {
  trend: number;
  plunge: number;
}
export type Parsed<T> = T | { error: string };

const mod360 = (a: number) => ((a % 360) + 360) % 360;

function number(text: string, min: number, max: number, what: string): number | string {
  const t = text.trim().replace(",", ".").replace(/°$/, "");
  if (!/^\d{1,3}(\.\d+)?$/.test(t)) return `Escribe ${what} como un número.`;
  const v = Number(t);
  if (v < min || v > max) return `${what[0]!.toUpperCase()}${what.slice(1)} va de ${min} a ${max}.`;
  return v;
}

/** A plane written with two numbers: right-hand-rule strike and dip, or dip direction and dip. */
export function parsePlaneNumbers(notation: "rhr" | "dipdir", first: string, second: string): Parsed<Plane> {
  const azimuth = number(first, 0, 360, notation === "rhr" ? "el rumbo" : "la dirección de manteo");
  if (typeof azimuth === "string") return { error: azimuth };
  const dip = number(second, 0, 90, "el manteo");
  if (typeof dip === "string") return { error: dip };
  return { strike: mod360(notation === "rhr" ? azimuth : azimuth - 90), dip };
}

const LETTER: Record<string, [number, number]> = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0], O: [-1, 0] };

/**
 * Quadrant notation: the strike as a bearing from north or south, then the dip and the quadrant it dips
 * toward, as in N35E/40SE or S20W 60NW. W and O (oeste) are both accepted.
 */
export function parseQuadrant(text: string): Parsed<Plane> {
  const m = /^\s*([NS])\s*(\d{1,2}(?:[.,]\d+)?)\s*°?\s*([EWO])\s*[/,;\s]\s*(\d{1,2}(?:[.,]\d+)?)\s*°?\s*([NS]?[EWO]?)\s*$/i.exec(text.replace(/\s+/g, " "));
  if (!m) return { error: "Escribe el rumbo y el manteo así: N35E/40SE." };
  const [, from, bearingText, toward, dipText, quadrant] = m.map((v) => (v ?? "").toUpperCase());
  const bearing = Number(bearingText!.replace(",", "."));
  const dip = Number(dipText!.replace(",", "."));
  if (bearing > 90) return { error: "El ángulo del rumbo en cuadrantes va de 0 a 90." };
  if (dip > 90) return { error: "El manteo va de 0 a 90." };
  // Bearing to azimuth: N a E = a, N a W = 360 - a, S a E = 180 - a, S a W = 180 + a.
  const east = toward === "E";
  const line = from === "N" ? (east ? bearing : 360 - bearing) : east ? 180 - bearing : 180 + bearing;
  if (dip === 0) return { strike: mod360(line), dip: 0 };
  if (!quadrant) return { error: "Falta hacia dónde mantea, por ejemplo 40SE." };
  // Of the two directions perpendicular to the strike, keep the one in the quadrant written.
  const fits = [line + 90, line - 90].filter((dd) => {
    const e = Math.sin((dd * Math.PI) / 180), n = Math.cos((dd * Math.PI) / 180);
    return [...quadrant].every((c) => {
      const [le, ln] = LETTER[c]!;
      return le * e + ln * n > 1e-9;
    });
  });
  if (fits.length !== 1) return { error: `Un plano de rumbo ${from}${bearing}${toward} no puede mantear hacia el ${quadrant}.` };
  return { strike: mod360(fits[0]! - 90), dip };
}

/** A line: trend (the azimuth it plunges toward) and plunge. */
export function parseLine(trend: string, plunge: string): Parsed<Line> {
  const t = number(trend, 0, 360, "la dirección");
  if (typeof t === "string") return { error: t };
  const p = number(plunge, 0, 90, "la inclinación");
  if (typeof p === "string") return { error: p };
  return { trend: mod360(t), plunge: p };
}

const pad = (v: number, width: number) => String(Math.round(v)).padStart(width, "0");

/** Writes a plane the way a student would in the given notation. */
export function writePlane(notation: PlaneNotation, plane: Plane): string {
  const strike = mod360(Math.round(plane.strike)), dip = Math.round(plane.dip);
  if (notation === "rhr") return `${pad(strike, 3)}/${pad(dip, 2)}`;
  if (notation === "dipdir") return `${pad(mod360(strike + 90), 3)}/${pad(dip, 2)}`;
  const half = strike % 180; // the end of the strike line in the northern half
  const bearing = half <= 90 ? `N${half}E` : `N${180 - half}W`;
  const dd = mod360(strike + 90);
  const quadrant = dd === 0 ? "N" : dd === 90 ? "E" : dd === 180 ? "S" : dd === 270 ? "W" : dd < 90 ? "NE" : dd < 180 ? "SE" : dd < 270 ? "SW" : "NW";
  return `${bearing}/${dip}${dip === 0 ? "" : quadrant}`;
}

export function writeLine(line: Line): string {
  return `${pad(line.plunge, 2)}→${pad(mod360(Math.round(line.trend)), 3)}`;
}

/** Angle in degrees between two planes (between their poles), from 0 to 90. */
export function angleBetweenPlanes(a: Plane, b: Plane): number {
  const pole = (p: Plane): [number, number, number] => {
    const d = ((p.strike + 90) * Math.PI) / 180, i = (p.dip * Math.PI) / 180;
    return [Math.sin(i) * Math.sin(d), Math.sin(i) * Math.cos(d), Math.cos(i)];
  };
  const [x, y] = [pole(a), pole(b)];
  return (Math.acos(Math.min(1, Math.abs(x[0] * y[0] + x[1] * y[1] + x[2] * y[2]))) * 180) / Math.PI; // a plane, or a line, and its opposite are the same
}

/** Angle in degrees between two lines, from 0 to 90. */
export function angleBetweenLines(a: Line, b: Line): number {
  const v = (l: Line): [number, number, number] => {
    const t = (l.trend * Math.PI) / 180, p = (l.plunge * Math.PI) / 180;
    return [Math.cos(p) * Math.sin(t), Math.cos(p) * Math.cos(t), -Math.sin(p)];
  };
  const [x, y] = [v(a), v(b)];
  return (Math.acos(Math.min(1, Math.abs(x[0] * y[0] + x[1] * y[1] + x[2] * y[2]))) * 180) / Math.PI; // a plane, or a line, and its opposite are the same
}
