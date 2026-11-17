// The map view: a topographic base known from the start, with outcrops appearing as they are found.

import type { Scenario } from "../format/types";
import type { GameState } from "../state/state";
import type { Grid } from "../world/blocks";

const PX = 3; // pixels per cell
const CONTOUR_M = 50;

function css(colour: number): string {
  return `#${colour.toString(16).padStart(6, "0")}`;
}

/** Shaded relief with contour lines, drawn once. Uses the true elevations, not the stepped ones. */
export function drawBase(scenario: Scenario): HTMLCanvasElement {
  const { nx, ny, cell_size_m } = scenario.manifest.grid;
  const { scale_m, offset_m } = scenario.manifest.terrain;
  const z = (ix: number, iy: number) =>
    offset_m + scenario.terrain[Math.min(Math.max(ix, 0), nx - 1) + nx * Math.min(Math.max(iy, 0), ny - 1)]! * scale_m;
  const canvas = document.createElement("canvas");
  canvas.width = nx * PX;
  canvas.height = ny * PX;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let py = 0; py < canvas.height; py++) {
    for (let px = 0; px < canvas.width; px++) {
      const ix = Math.floor(px / PX), iy = ny - 1 - Math.floor(py / PX);
      const here = z(ix, iy);
      const gx = (z(ix + 1, iy) - z(ix - 1, iy)) / (2 * cell_size_m.x);
      const gy = (z(ix, iy + 1) - z(ix, iy - 1)) / (2 * cell_size_m.y);
      const light = Math.max(0.45, Math.min(1.08, 0.86 + 0.45 * (0.7 * gx - 0.7 * gy))); // lit from the north-west
      // A contour passes where the level changes toward the east or the south pixel's cell.
      const level = Math.floor(here / CONTOUR_M);
      const contour = level !== Math.floor(z(ix + 1, iy) / CONTOUR_M) || level !== Math.floor(z(ix, iy - 1) / CONTOUR_M);
      const onEdge = contour && (px % PX === PX - 1 || py % PX === PX - 1);
      const o = (py * canvas.width + px) * 4;
      const tint = onEdge ? 0.55 : 1;
      image.data[o] = 226 * light * tint;
      image.data[o + 1] = 219 * light * tint;
      image.data[o + 2] = 196 * light * tint;
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export class MapView {
  private readonly base: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly legend: HTMLElement,
    private readonly scenario: Scenario,
    private readonly grid: Grid,
  ) {
    this.base = drawBase(scenario);
    canvas.width = this.base.width;
    canvas.height = this.base.height + 22;
    this.ctx = canvas.getContext("2d")!;
    this.fit();
    window.addEventListener("resize", () => this.fit());
  }

  /** Scale the canvas to the window, keeping its shape. */
  private fit(): void {
    const scale = Math.min(window.innerWidth / this.canvas.width, window.innerHeight / this.canvas.height);
    this.canvas.style.width = `${Math.floor(this.canvas.width * scale)}px`;
    this.canvas.style.height = `${Math.floor(this.canvas.height * scale)}px`;
  }

  draw(state: GameState): void {
    const { ctx, grid, scenario } = this;
    const { nx, ny, cell } = grid;
    const origin = scenario.manifest.grid.origin;
    const h = this.base.height;
    ctx.fillStyle = "#1d211f";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base, 0, 0);

    // Grid lines and coordinates every 500 m of the fictional grid.
    ctx.strokeStyle = "rgba(20, 40, 90, 0.35)";
    ctx.fillStyle = "#dfe6f5";
    ctx.font = "11px system-ui, sans-serif";
    ctx.lineWidth = 1;
    for (let e = Math.ceil(origin.easting / 500) * 500; e < origin.easting + nx * cell; e += 500) {
      const px = ((e - origin.easting) / cell) * PX;
      ctx.beginPath();
      ctx.moveTo(px + 0.5, 0);
      ctx.lineTo(px + 0.5, h);
      ctx.stroke();
      ctx.fillText(String(e), px + 2, h + 15);
    }
    for (let n = Math.ceil(origin.northing / 500) * 500; n < origin.northing + ny * cell; n += 500) {
      const py = h - ((n - origin.northing) / cell) * PX;
      ctx.beginPath();
      ctx.moveTo(0, py + 0.5);
      ctx.lineTo(this.base.width, py + 0.5);
      ctx.stroke();
      ctx.save();
      ctx.fillStyle = "#14285a";
      ctx.fillText(String(n), 3, py - 3);
      ctx.restore();
    }

    const seenUnits = new Set<number>();
    scenario.outcrops.forEach((outcrop, n) => {
      if (!state.found.sighted.has(n)) return;
      const visited = state.found.visited.has(n);
      for (const [ix, iy] of outcrop.cells) {
        const unit = grid.rock[ix + nx * iy]!;
        if (visited && unit >= 0) seenUnits.add(unit);
        ctx.fillStyle = visited && unit >= 0 ? css(grid.unitColours[unit]!) : "#6e6e6a";
        ctx.fillRect(ix * PX, h - (iy + 1) * PX, PX, PX);
      }
    });

    // Stations, with the mean bedding of each as a strike-and-dip symbol.
    ctx.font = "bold 11px system-ui, sans-serif";
    for (const station of state.stations) {
      const sx = ((station.easting - origin.easting) / cell) * PX, sy = h - ((station.northing - origin.northing) / cell) * PX;
      const beds = station.measurements.filter((m) => m.type === "plane" && m.feature === "bedding");
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1.6;
      if (beds.length) {
        const strike = Math.atan2(beds.reduce((t, m) => t + Math.sin((m.a * Math.PI) / 180), 0), beds.reduce((t, m) => t + Math.cos((m.a * Math.PI) / 180), 0));
        const dip = Math.round(beds.reduce((t, m) => t + m.b, 0) / beds.length);
        ctx.beginPath();
        ctx.moveTo(sx - Math.sin(strike) * 9, sy + Math.cos(strike) * 9);
        ctx.lineTo(sx + Math.sin(strike) * 9, sy - Math.cos(strike) * 9);
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + Math.cos(strike) * 5, sy + Math.sin(strike) * 5); // tick toward the dip direction
        ctx.stroke();
        ctx.fillStyle = "#000";
        ctx.fillText(String(dip), sx + Math.cos(strike) * 8 + 2, sy + Math.sin(strike) * 8 + 4);
      } else {
        ctx.beginPath();
        ctx.arc(sx, sy, 3, 0, 2 * Math.PI);
        ctx.stroke();
      }
      ctx.fillStyle = "#7a1f1f";
      ctx.fillText(String(station.number), sx + 5, sy - 6);
    }

    // The student: a dot and a heading arrow.
    const px = (state.walker.x / cell) * PX, py = h - (state.walker.y / cell) * PX;
    const a = (state.walker.heading * Math.PI) / 180;
    ctx.strokeStyle = "#000";
    ctx.fillStyle = "#ffe14a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px + Math.sin(a) * 14, py - Math.cos(a) * 14);
    ctx.lineTo(px + Math.sin(a + 2.5) * 8, py - Math.cos(a + 2.5) * 8);
    ctx.lineTo(px + Math.sin(a - 2.5) * 8, py - Math.cos(a - 2.5) * 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const rows = [...seenUnits]
      .sort((p, q) => p - q)
      .map((u) => `<div><span class="sw" style="background:${css(grid.unitColours[u]!)}"></span>${scenario.units[u]!.lithology}</div>`);
    this.legend.innerHTML =
      `<b>${scenario.manifest.title}</b><br>Curvas de nivel cada ${CONTOUR_M} m · cuadrícula cada 500 m<br>` +
      `Afloramientos visitados: ${state.found.visited.size} · avistados: ${state.found.sighted.size - state.found.visited.size} · estaciones: ${state.stations.length}` +
      (rows.length ? `<hr style="border-color:#555">${rows.join("")}` : "") +
      `<div><span class="sw" style="background:#6e6e6a"></span>roca vista de lejos</div>`;
  }
}
