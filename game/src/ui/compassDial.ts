// The compass the student reads: an azimuth dial with the strike-and-dip symbol of a plane (or an arrow
// on the trend of a line) and a clinometer with the dip (or plunge). No numbers are printed: reading them is the exercise.

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
  ctx.fillText(reading.kind === "plane" ? "símbolo: rumbo y, corta, hacia el manteo" : "flecha: dirección de la línea", cx, 186);

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
