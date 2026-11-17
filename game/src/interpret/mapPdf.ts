// The student's map as a print-ready PDF: map frame with coordinate grid, legend, scale bar and north arrow.

import type { Scenario } from "../format/types";
import type { GameState } from "../state/state";
import type { ContourLevel } from "./contours";
import { midpoint, pathLength } from "./contours";
import { KINEMATICS_NAMES, type LineKind, type LineStyle, lineName } from "./mapdata";
import { Content, type Jpeg, buildPdf, textWidth } from "./pdf";
import { DASH, LINE_LOOK, meanPlanes, strikeDipSymbol } from "./symbols";
import { FEATURE_COLOURS } from "./stereonet";

export type Paper = "A4" | "A3";
const PAPER: Record<Paper, [number, number]> = { A4: [841.89, 595.28], A3: [1190.55, 841.89] };
const METRES_PER_POINT_AT_1 = 0.000352778; // one point on paper, in metres

export interface MapPdfInput {
  scenario: Scenario;
  state: GameState;
  contours: ContourLevel[];
  /** Shaded relief behind the map; the map is drawn without it where absent. */
  hillshade?: Jpeg;
  paper?: Paper;
  /** Printed under the title, e.g. the date of the export. */
  stamp?: string;
}

/** Shortens text with an ellipsis so that it fits a width. */
function fit(text: string, size: number, width: number): string {
  if (textWidth(text, size) <= width) return text;
  let t = text;
  while (t.length > 1 && textWidth(`${t}...`, size) > width) t = t.slice(0, -1);
  return `${t}...`;
}

export function mapScaleDenominator(metresPerPoint: number): number {
  return Math.round(metresPerPoint / METRES_PER_POINT_AT_1 / 500) * 500;
}

export function buildMapPdf(input: MapPdfInput): Uint8Array {
  const { scenario, state } = input;
  const paper = input.paper ?? "A4";
  const [W, H] = PAPER[paper];
  const k = paper === "A3" ? 1.35 : 1;
  const grid = scenario.manifest.grid;
  const extentX = grid.nx * grid.cell_size_m.x, extentY = grid.ny * grid.cell_size_m.y;
  const origin = grid.origin;

  const margin = 30 * k, header = 48 * k, left = 36 * k, bottom = 16 * k;
  const scale = Math.min((W - margin - left - 240 * k - margin) / extentX, (H - margin - header - margin - bottom) / extentY);
  const frameW = extentX * scale, frameH = extentY * scale;
  const fx = margin + left, fy = margin + bottom;
  const px = (x: number) => fx + x * scale, py = (y: number) => fy + y * scale;
  const flat = (points: number[]) => points.map((v, i) => (i % 2 === 0 ? px(v) : py(v)));
  const c = new Content();

  // --- header
  c.text(margin, H - margin - 14 * k, scenario.manifest.title, { size: 16 * k, font: "bold" });
  c.text(margin, H - margin - 28 * k, `Mapa geológico${input.stamp ? ` · ${input.stamp}` : ""}`, { size: 9.5 * k, colour: "#444444" });
  const nameX = W - margin - 260 * k;
  c.text(nameX, H - margin - 14 * k, "Nombre:", { size: 9 * k });
  c.text(nameX, H - margin - 28 * k, "Fecha:", { size: 9 * k });
  c.save().lineWidth(0.5).strokeColour("#777777");
  c.polyline([nameX + 40 * k, H - margin - 15 * k, W - margin, H - margin - 15 * k]);
  c.polyline([nameX + 40 * k, H - margin - 29 * k, W - margin, H - margin - 29 * k]);
  c.restore();

  // --- map
  c.save().clipRect(fx, fy, frameW, frameH);
  if (input.hillshade) c.image("Im1", fx, fy, frameW, frameH);
  else c.fillColour("#f5f1e6").rect(fx, fy, frameW, frameH).fill();

  const units = new Map(state.map.units.map((u) => [u.id, u]));
  for (const polygon of state.map.polygons) {
    const unit = units.get(polygon.unit);
    c.save().alpha(0.62).fillColour(unit?.colour ?? "#cccccc").path(flat(polygon.points), true).fill().restore();
    c.save().alpha(0.55).strokeColour("#333333").lineWidth(0.35).path(flat(polygon.points), true).stroke().restore();
  }

  for (const level of input.contours) {
    c.save().strokeColour("#8a6a3a").lineWidth(level.index ? 0.55 : 0.22);
    for (const line of level.lines) c.polyline(flat(line));
    c.restore();
  }
  for (const level of input.contours.filter((l) => l.index)) {
    for (const line of level.lines) {
      if (pathLength(line) < 350) continue;
      const [x, y] = midpoint(line);
      c.text(px(x), py(y) - 1.8 * k, String(level.level), { size: 5.5 * k, colour: "#6b4e2a", align: "center", halo: 1.6 * k });
    }
  }

  c.save().strokeColour("#3c5a9a").lineWidth(0.35).alpha(0.6);
  for (let e = Math.ceil(origin.easting / 500) * 500; e < origin.easting + extentX; e += 500) c.polyline([px(e - origin.easting), fy, px(e - origin.easting), fy + frameH]);
  for (let n = Math.ceil(origin.northing / 500) * 500; n < origin.northing + extentY; n += 500) c.polyline([fx, py(n - origin.northing), fx + frameW, py(n - origin.northing)]);
  c.restore();

  for (const line of state.map.lines) {
    const look = LINE_LOOK[line.kind];
    const width = look.width * 0.7 * k;
    c.save().strokeColour(look.colour).lineWidth(width).cap(line.style === "inferred");
    if (line.style !== "solid") c.dash(DASH[line.style].map((d) => d * width));
    c.polyline(flat(line.points)).restore();
    if (line.kind === "fault" && line.kinematics) {
      const [mx, my] = midpoint(line.points);
      c.text(px(mx), py(my) + 3 * k, KINEMATICS_NAMES[line.kinematics], { size: 6 * k, font: "italic", colour: LINE_LOOK.fault.colour, align: "center", halo: 1.8 * k });
    }
  }

  for (const station of state.stations) {
    const x = px(station.easting - origin.easting), y = py(station.northing - origin.northing);
    c.save().fillColour("#ffffff").strokeColour("#7a1f1f").lineWidth(0.7).circle(x, y, 2.2 * k).fillStroke().restore();
    for (const plane of meanPlanes(station)) {
      const g = strikeDipSymbol(plane.strike, plane.dip, 13 * k);
      const colour = FEATURE_COLOURS[plane.feature] ?? "#1d1d1d";
      c.save().strokeColour(colour).lineWidth(1.0 * k);
      c.polyline([x + g.strike[0], y + g.strike[1], x + g.strike[2], y + g.strike[3]]);
      c.polyline([x + g.tick[0], y + g.tick[1], x + g.tick[2], y + g.tick[3]]);
      c.restore();
      c.text(x + g.label[0], y + g.label[1] - 2 * k, String(plane.dip), { size: 6 * k, colour, align: "center", halo: 1.4 * k });
    }
    c.text(x + 3.5 * k, y - 6.5 * k, String(station.number), { size: 6 * k, font: "bold", colour: "#7a1f1f", halo: 1.4 * k });
  }
  c.restore();

  // --- frame, ticks and coordinates
  c.save().strokeColour("#000000").lineWidth(0.9).rect(fx, fy, frameW, frameH).stroke().restore();
  c.save().strokeColour("#000000").lineWidth(0.5);
  for (let e = Math.ceil(origin.easting / 500) * 500; e < origin.easting + extentX; e += 500) {
    const x = px(e - origin.easting);
    c.polyline([x, fy, x, fy - 3 * k]);
    c.text(x, fy - 10 * k, String(e), { size: 6.5 * k, align: "center" });
  }
  for (let n = Math.ceil(origin.northing / 500) * 500; n < origin.northing + extentY; n += 500) {
    const y = py(n - origin.northing);
    c.polyline([fx, y, fx - 3 * k, y]);
    c.text(fx - 5 * k, y - 2.3 * k, String(n), { size: 6.5 * k, align: "right" });
  }
  c.restore();

  // --- right column: legend, scale, north arrow, notes
  const colX = fx + frameW + 26 * k, colW = W - margin - colX;
  let y = fy + frameH - 4 * k;
  c.text(colX, y - 8 * k, "Leyenda", { size: 11 * k, font: "bold" });
  y -= 24 * k;
  if (state.map.units.length === 0) {
    c.text(colX, y, "(sin unidades definidas)", { size: 8 * k, font: "italic", colour: "#777777" });
    y -= 14 * k;
  }
  for (const unit of state.map.units) {
    c.save().alpha(0.62).fillColour(unit.colour).rect(colX, y - 1.5 * k, 20 * k, 10 * k).fill().restore();
    c.save().strokeColour("#333333").lineWidth(0.5).rect(colX, y - 1.5 * k, 20 * k, 10 * k).stroke().restore();
    c.text(colX + 27 * k, y + 1 * k, fit(unit.name || "(sin nombre)", 8.5 * k, colW - 27 * k), { size: 8.5 * k });
    y -= 15 * k;
  }

  const used = new Set(state.map.lines.map((l) => `${l.kind}:${l.style}`));
  const kinds: LineKind[] = ["contact", "fault"];
  const styles: LineStyle[] = ["solid", "dashed", "inferred"];
  y -= 6 * k;
  for (const kind of kinds) {
    for (const style of styles) {
      if (!used.has(`${kind}:${style}`)) continue;
      const look = LINE_LOOK[kind], width = look.width * 0.7 * k;
      c.save().strokeColour(look.colour).lineWidth(width).cap(style === "inferred");
      if (style !== "solid") c.dash(DASH[style].map((d) => d * width));
      c.polyline([colX, y + 3 * k, colX + 20 * k, y + 3 * k]).restore();
      c.text(colX + 27 * k, y, lineName(kind, style), { size: 8.5 * k });
      y -= 14 * k;
    }
  }
  const symbol = strikeDipSymbol(0, 30, 13 * k);
  c.save().strokeColour("#1d1d1d").lineWidth(1.0 * k);
  c.polyline([colX + 10 * k + symbol.strike[0], y + 3 * k + symbol.strike[1], colX + 10 * k + symbol.strike[2], y + 3 * k + symbol.strike[3]]);
  c.polyline([colX + 10 * k, y + 3 * k, colX + 10 * k + symbol.tick[2], y + 3 * k + symbol.tick[3]]);
  c.restore();
  c.text(colX + 27 * k, y, "Rumbo y manteo (estratificación)", { size: 8.5 * k });
  y -= 14 * k;
  c.save().fillColour("#ffffff").strokeColour("#7a1f1f").lineWidth(0.7).circle(colX + 10 * k, y + 3 * k, 2.2 * k).fillStroke().restore();
  c.text(colX + 27 * k, y, "Estación de terreno", { size: 8.5 * k });
  y -= 30 * k;

  // Scale bar: the longest of 250, 500 or 1000 m that fits the column.
  const metres = [1000, 500, 250].find((m) => m * scale <= colW * 0.9) ?? 250;
  const barW = metres * scale, bar = 5 * k;
  c.text(colX, y + 10 * k, "Escala gráfica", { size: 8.5 * k, font: "bold" });
  for (let i = 0; i < 2; i++) {
    c.save().fillColour(i === 0 ? "#000000" : "#ffffff").strokeColour("#000000").lineWidth(0.6).rect(colX + (barW / 2) * i, y - bar, barW / 2, bar).fillStroke().restore();
  }
  for (const [at, label] of [[0, "0"], [0.5, String(metres / 2)], [1, `${metres} m`]] as const) {
    c.text(colX + barW * at, y - bar - 8 * k, label, { size: 7 * k, align: "center" });
  }
  y -= bar + 52 * k;

  // North arrow
  const ax = colX + 12 * k;
  c.save().fillColour("#000000").strokeColour("#000000").lineWidth(0.8);
  c.polyline([ax, y - 24 * k, ax, y + 8 * k]);
  c.path([ax, y + 14 * k, ax - 4.5 * k, y + 3 * k, ax + 4.5 * k, y + 3 * k], true).fill();
  c.restore();
  c.text(ax, y + 18 * k, "N", { size: 9 * k, font: "bold", align: "center" });
  y -= 42 * k;

  const interval = input.contours.length > 1 ? Math.round(input.contours[1]!.level - input.contours[0]!.level) : 50;
  const notes = [
    `Escala aproximada 1:${mapScaleDenominator(1 / scale).toLocaleString("en-US").replace(/,/g, " ")} (${paper})`,
    `Curvas de nivel cada ${interval} m; las curvas índice, cada ${interval * 5} m.`,
    "Cuadrícula cada 500 m. Coordenadas en el sistema local ficticio del escenario.",
  ];
  for (const note of notes) {
    // wrap by words
    let line = "";
    for (const word of note.split(" ")) {
      if (textWidth(`${line} ${word}`, 7.5 * k) > colW && line) {
        c.text(colX, y, line, { size: 7.5 * k, colour: "#444444" });
        y -= 9.5 * k;
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    c.text(colX, y, line, { size: 7.5 * k, colour: "#444444" });
    y -= 12 * k;
  }

  return buildPdf({
    title: `${scenario.manifest.title}: mapa geológico`,
    pages: [{ width: W, height: H, content: c }],
    images: input.hillshade ? { Im1: input.hillshade } : undefined,
  });
}
