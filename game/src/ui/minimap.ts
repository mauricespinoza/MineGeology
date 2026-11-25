// The minimap, always in a corner: the relief and its streams, the outcrops found, the student's lines and areas,
// the stations in the colour of their unit, and where the student stands and looks.
// North is up; it shows a window around the student, and a tap opens the full map.

import type { Scenario } from "../format/types";
import type { GameState } from "../state/state";
import type { Grid } from "../world/blocks";
import { renderHillshade } from "./mapboard";

const css = (colour: number) => `#${colour.toString(16).padStart(6, "0")}`;

export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly relief: HTMLCanvasElement;
  /** Metres shown across the minimap. */
  private span = 700;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly scenario: Scenario,
    private readonly grid: Grid,
    private readonly state: GameState,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.relief = renderHillshade(scenario, 1);
    this.paintRivers();
  }

  /** The streams in blue over the relief, as on a topographic sheet. */
  private paintRivers(): void {
    const { grid, relief } = this;
    const g = relief.getContext("2d");
    if (!grid.river || !g || relief.width !== grid.nx) return;
    g.fillStyle = "#3a7fc0";
    for (let iy = 0; iy < grid.ny; iy++) {
      for (let ix = 0; ix < grid.nx; ix++) if (grid.river[ix + grid.nx * iy]) g.fillRect(ix, grid.ny - 1 - iy, 1, 1);
    }
  }

  draw(): void {
    const { ctx, canvas, grid, state } = this;
    const size = canvas.clientWidth || 140;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(size * dpr)) {
      canvas.width = canvas.height = Math.round(size * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = state.walker, extent = grid.nx * grid.cell;
    const k = size / this.span; // pixels per metre
    const sx = (x: number) => size / 2 + (x - w.x) * k, sy = (y: number) => size / 2 - (y - w.y) * k;
    ctx.fillStyle = "#2a2f2c";
    ctx.fillRect(0, 0, size, size);
    // The relief image has one pixel per cell, northern row first.
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.relief, sx(0), sy(grid.ny * grid.cell), extent * k, grid.ny * grid.cell * k);

    // Outcrops found: grey, or the colour of the rock once visited.
    const cell = Math.max(grid.cell * k, 1.2);
    this.scenario.outcrops.forEach((o, n) => {
      if (!state.found.sighted.has(n)) return;
      const visited = state.found.visited.has(n);
      for (const [ix, iy] of o.cells) {
        const unit = grid.rock[ix + grid.nx * iy]!;
        ctx.fillStyle = visited && unit >= 0 ? css(grid.unitColours[unit]!) : "#6e6e6a";
        ctx.fillRect(sx(ix * grid.cell), sy((iy + 1) * grid.cell), cell, cell);
      }
    });

    // The student's areas and lines.
    const map = state.map, origin = this.scenario.manifest.grid.origin;
    const path = (pts: number[], closed: boolean) => {
      ctx.beginPath();
      for (let i = 0; i + 1 < pts.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, sx(pts[i]!), sy(pts[i + 1]!));
      if (closed) ctx.closePath();
    };
    ctx.globalAlpha = 0.45;
    for (const p of map.polygons) {
      ctx.fillStyle = map.units.find((u) => u.id === p.unit)?.colour ?? "#999";
      path(p.points, true);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const l of map.lines) {
      ctx.strokeStyle = l.kind === "fault" ? "#b01c1c" : "#1a1a1a";
      ctx.lineWidth = l.kind === "fault" ? 2 : 1.2;
      path(l.points, false);
      ctx.stroke();
    }
    for (const st of state.stations) {
      const unit = map.units.find((u) => u.id === st.unit);
      ctx.beginPath();
      ctx.arc(sx(st.easting - origin.easting), sy(st.northing - origin.northing), unit ? 3.2 : 2.4, 0, 2 * Math.PI);
      ctx.fillStyle = unit?.colour ?? "#fff";
      ctx.fill();
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // The student: an arrow in the middle, pointing where they look.
    const a = (w.heading * Math.PI) / 180, c = size / 2;
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.fillStyle = "#f2d16b";
    ctx.fill();
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
    // The heading in degrees, as on the compass.
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    const heading = `${String(Math.round(w.heading) % 360).padStart(3, "0")}°`;
    ctx.strokeText(heading, size - 5, size - 6);
    ctx.fillStyle = "#f2d16b";
    ctx.fillText(heading, size - 5, size - 6);
    // North, and the scale.
    ctx.fillStyle = "#f4f1e8";
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("N", size - 10, 13);
    const bar = 200 * k;
    ctx.fillRect(6, size - 8, bar, 3);
    ctx.font = "9px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("200 m", 6, size - 12);
  }
}
