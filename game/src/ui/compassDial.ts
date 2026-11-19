// The compass the student reads: an azimuth dial with the strike-and-dip symbol of a plane (or an arrow
// on the trend of a line) and a clinometer with the dip (or plunge). No numbers are printed: reading them is the exercise.

import { greatCircle, lineVector, poleVector, project } from "../interpret/stereonet";

const RAD = Math.PI / 180;
const DIAL_LABELS: Record<number, string> = { 0: "N", 90: "E", 180: "S", 270: "O" };

export interface DialReading {
  /** Azimuth the arrow points to, degrees from north. */
  azimuth: number;
  /** Angle below the horizontal, degrees. */
  inclination: number;
  kind: "plane" | "line";
}

/** Draws on a canvas of any size with a 2:1 shape; drawing units are 360 x 190. */
export function drawCompass(canvas: HTMLCanvasElement, reading: DialReading): void {
  const ctx = canvas.getContext("2d")!;
  const k = canvas.width / 360;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.fillStyle = "#20252a";
  ctx.fillRect(0, 0, 360, 190);

  // --- azimuth dial
  const cx = 96, cy = 92, R = 80;
  ctx.fillStyle = "#f4efdc";
  ctx.beginPath();
  ctx.arc(cx, cy, R + 6, 0, 2 * Math.PI);
  ctx.fill();
  ctx.strokeStyle = "#1c1c1c";
  ctx.lineWidth = 2;
  ctx.stroke();
  for (let a = 0; a < 360; a += 2) {
    const long = a % 10 === 0, label = a % 30 === 0;
    const r0 = R - (label ? 11 : long ? 8 : 4);
    const s = Math.sin(a * RAD), c = Math.cos(a * RAD);
    ctx.strokeStyle = "#1c1c1c";
    ctx.lineWidth = long ? 1.2 : 0.6;
    ctx.beginPath();
    ctx.moveTo(cx + s * r0, cy - c * r0);
    ctx.lineTo(cx + s * R, cy - c * R);
    ctx.stroke();
    if (label) {
      ctx.fillStyle = DIAL_LABELS[a] ? "#a3241b" : "#1c1c1c";
      ctx.font = `${DIAL_LABELS[a] ? "bold 13" : "10"}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(DIAL_LABELS[a] ?? String(a), cx + s * (R - 20), cy - c * (R - 20));
    }
  }
  const s = Math.sin(reading.azimuth * RAD), c = Math.cos(reading.azimuth * RAD);
  ctx.strokeStyle = "#a3241b";
  ctx.fillStyle = "#a3241b";
  if (reading.kind === "plane") {
    // The strike-and-dip symbol of a geological map: a long line along strike and a short tick toward the dip.
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - c * (R - 6), cy - s * (R - 6));
    ctx.lineTo(cx + c * (R - 6), cy + s * (R - 6));
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + s * 30, cy - c * 30);
    ctx.stroke();
    ctx.lineCap = "butt";
  } else {
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(cx - s * 30, cy + c * 30);
    ctx.lineTo(cx + s * (R - 4), cy - c * (R - 4));
    ctx.stroke();
    const tip = [cx + s * (R - 1), cy - c * (R - 1)], left = [cx + s * (R - 15) - c * 6, cy - c * (R - 15) - s * 6], right = [cx + s * (R - 15) + c * 6, cy - c * (R - 15) + s * 6];
    ctx.beginPath();
    ctx.moveTo(tip[0]!, tip[1]!);
    ctx.lineTo(left[0]!, left[1]!);
    ctx.lineTo(right[0]!, right[1]!);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = "#1c1c1c";
  ctx.beginPath();
  ctx.arc(cx, cy, 3.5, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = "#e8e2cc";
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(reading.kind === "plane" ? "símbolo: rumbo; corta: manteo" : "flecha: dirección de la línea", cx, 186);

  // --- clinometer: a quarter circle from horizontal (0) to vertical (90)
  const ox = 210, oy = 168, r = 136;
  ctx.fillStyle = "#f4efdc";
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.arc(ox, oy, r + 6, -Math.PI / 2, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#1c1c1c";
  ctx.lineWidth = 2;
  ctx.stroke();
  for (let a = 0; a <= 90; a += 2) {
    const long = a % 10 === 0;
    const r0 = r - (long ? 10 : 5);
    const x = Math.cos(a * RAD), y = Math.sin(a * RAD);
    ctx.lineWidth = long ? 1.2 : 0.6;
    ctx.beginPath();
    ctx.moveTo(ox + x * r0, oy - y * r0);
    ctx.lineTo(ox + x * r, oy - y * r);
    ctx.stroke();
    if (long) {
      ctx.fillStyle = "#1c1c1c";
      ctx.font = "10px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(a), ox + x * (r - 19), oy - y * (r - 19));
    }
  }
  const i = reading.inclination * RAD;
  ctx.strokeStyle = "#a3241b";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(ox + Math.cos(i) * (r - 2), oy - Math.sin(i) * (r - 2));
  ctx.stroke();
  ctx.fillStyle = "#e8e2cc";
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(reading.kind === "plane" ? "clinómetro: manteo" : "clinómetro: inclinación", 214, 186);
}

export interface NetReading {
  kind: "plane" | "line";
  /** Strike (right-hand rule) and dip, or trend and plunge. */
  a: number;
  b: number;
}

/**
 * A small lower-hemisphere equal-area net with the reading on screen: the great circle of a plane and its pole,
 * or the point of a line. Earlier measurements at the station are drawn faint, to compare. No numbers.
 */
export function drawNetReading(canvas: HTMLCanvasElement, reading: NetReading, earlier: NetReading[] = []): void {
  const ctx = canvas.getContext("2d")!;
  const size = canvas.width, c = size / 2, R = size / 2 - 26;
  const at = ([x, y]: [number, number]): [number, number] => [c + x * R, c - y * R];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#20252a";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#fbf8ee";
  ctx.beginPath();
  ctx.arc(c, c, R, 0, 2 * Math.PI);
  ctx.fill();
  // A light grid of great circles every 30 degrees of dip, striking north, to read the net by eye.
  ctx.strokeStyle = "rgba(0,0,0,0.13)";
  ctx.lineWidth = 1;
  for (const dip of [30, 60]) {
    for (const strike of [0, 180]) {
      ctx.beginPath();
      greatCircle(strike, dip, 60).forEach((p, i) => (i ? ctx.lineTo(...at(p)) : ctx.moveTo(...at(p))));
      ctx.stroke();
    }
  }
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.moveTo(c - R, c); ctx.lineTo(c + R, c);
  ctx.moveTo(c, c - R); ctx.lineTo(c, c + R);
  ctx.stroke();
  ctx.strokeStyle = "#1c1c1c";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(c, c, R, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.fillStyle = "#f4efdc";
  ctx.font = "bold 15px system-ui, sans-serif";
  ctx.textAlign = "center";
  for (const [label, x, y] of [["N", c, c - R - 8], ["E", c + R + 13, c + 5], ["S", c, c + R + 19], ["O", c - R - 13, c + 5]] as const) ctx.fillText(label, x, y);

  const draw = (r: NetReading, colour: string, width: number) => {
    if (r.kind === "plane") {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.beginPath();
      greatCircle(r.a, r.b).forEach((p, i) => (i ? ctx.lineTo(...at(p)) : ctx.moveTo(...at(p))));
      ctx.stroke();
      const [x, y] = at(project(poleVector(r.a, r.b)));
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(x, y, width + 2.5, 0, 2 * Math.PI);
      ctx.fill();
    } else {
      const [x, y] = at(project(lineVector(r.a, r.b)));
      const k = width + 4;
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.moveTo(x, y - k); ctx.lineTo(x + k * 0.9, y + k * 0.7); ctx.lineTo(x - k * 0.9, y + k * 0.7);
      ctx.closePath();
      ctx.fill();
    }
  };
  for (const r of earlier) draw(r, "rgba(60,90,130,0.35)", 1.2);
  draw(reading, "#b03a2e", 2.6);
}
