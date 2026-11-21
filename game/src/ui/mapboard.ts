// The map board: the topographic base and the fog of war, with the tools to draw the geological map on it.

import { type ContourLevel, contourSet, midpoint } from "../interpret/contours";
import { toGeoJSON } from "../interpret/geojson";
import {
  KINEMATICS_NAMES, type Kinematics, type LineKind, type LineStyle, type MapState, STYLE_NAMES,
  addLine, addPolygon, addUnit, nearestFeature, removeFeature, removeUnit,
} from "../interpret/mapdata";
import { type Paper, buildMapPdf } from "../interpret/mapPdf";
import { FEATURE_COLOURS } from "../interpret/stereonet";
import { DASH, type FaultMarks, LINE_LOOK, faultMarks, meanPlanes, strikeDipSymbol } from "../interpret/symbols";
import type { Scenario } from "../format/types";
import { rockNames } from "../state/state";
import { isTyping } from "../explore/controls";
import type { Field } from "../tools/fieldwork";
import { COVER, type Grid } from "../world/blocks";
import { capture, esc } from "./html";
import { type IconName, captionButton, icon, iconButton } from "./icons";
import { expandAlterationMap, expandTruthMap } from "../format/loader";
import { download } from "./notebook";

export type Tool = "pan" | "contact" | "fault" | "faultEdit" | "polygon" | "erase" | "section";

/** Each tool: its id, its tooltip, the caption under the icon and the icon. */
const TOOLS: [Tool, string, string, IconName][] = [
  ["pan", "Mover el mapa", "Mover", "move"], ["contact", "Dibujar un contacto", "Contacto", "contact"], ["fault", "Dibujar una falla", "Falla", "fault"],
  ["faultEdit", "Cambiar el movimiento de una falla", "Editar falla", "faultEdit"], ["polygon", "Pintar un área con la unidad elegida", "Área", "area"],
  ["erase", "Borrar una línea o un área", "Borrar", "erase"], ["section", "Trazar la línea del perfil A–A'", "Perfil A–A'", "profileLine"],
];
const HINTS: Record<Tool, string> = {
  pan: "Mover: arrastra el mapa; acerca con la rueda o con dos dedos. Con cualquier herramienta, un arrastre también mueve el mapa.",
  contact: "Contacto: toca o haz clic en cada punto; termina con «Listo», Enter o doble clic.",
  fault: "Falla: elige el movimiento y marca los puntos; los dientes o la barra quedan a la derecha del sentido en que dibujas. Termina con «Listo».",
  faultEdit: "Cambiar una falla: elige el movimiento y toca la falla para aplicarlo; tocarla otra vez pasa los dientes al otro lado. «Listo» vuelve a Mover.",
  polygon: "Área: marca cada vértice y ciérrala sobre el primer punto o con «Listo». Se pinta con la unidad elegida.",
  erase: "Borrar: toca una línea o un área. Deshacer la recupera. «Listo» vuelve a Mover.",
  section: "Línea del perfil: marca el comienzo y el final, de preferencia perpendicular al rumbo. Luego abre el perfil.",
};
const CONTOUR_M = 50;
const MAX_UNDO = 60;

/** Shaded relief of the true terrain, drawn once; `print` makes it lighter, to sit under ink. */
export function renderHillshade(scenario: Scenario, pxPerCell: number, print = false): HTMLCanvasElement {
  const { nx, ny, cell_size_m } = scenario.manifest.grid;
  const { scale_m, offset_m } = scenario.manifest.terrain;
  const z = (ix: number, iy: number) =>
    offset_m + scenario.terrain[Math.min(Math.max(ix, 0), nx - 1) + nx * Math.min(Math.max(iy, 0), ny - 1)]! * scale_m;
  const canvas = document.createElement("canvas");
  canvas.width = nx * pxPerCell;
  canvas.height = ny * pxPerCell;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let py = 0; py < canvas.height; py++) {
    for (let px = 0; px < canvas.width; px++) {
      // Sample between cell centres so that the relief is smooth at any magnification.
      const fx = (px + 0.5) / pxPerCell - 0.5, fy = ny - 1 - ((py + 0.5) / pxPerCell - 0.5);
      const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const at = (dx: number, dy: number) => {
        const gx = (z(ix + dx + 1, iy + dy) - z(ix + dx - 1, iy + dy)) / (2 * cell_size_m.x);
        const gy = (z(ix + dx, iy + dy + 1) - z(ix + dx, iy + dy - 1)) / (2 * cell_size_m.y);
        return 0.7 * gx - 0.7 * gy; // lit from the north-west
      };
      const lit = (at(0, 0) * (1 - tx) + at(1, 0) * tx) * (1 - ty) + (at(0, 1) * (1 - tx) + at(1, 1) * tx) * ty;
      const light = print ? Math.max(0.78, Math.min(1.03, 0.93 + 0.2 * lit)) : Math.max(0.45, Math.min(1.08, 0.86 + 0.45 * lit));
      const o = (py * canvas.width + px) * 4;
      image.data[o] = 226 * light;
      image.data[o + 1] = 219 * light;
      image.data[o + 2] = 196 * light;
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  drawFaultBreccia(ctx, scenario, pxPerCell, print);
  return canvas;
}

/**
 * The strip of crushed rock along a fault, as a geologist marks a breccia zone: a reddish tint with small open
 * triangles. It is what one sees on the ground or on an air photo, not the fault itself; drawing it is up to the student.
 */
function drawFaultBreccia(ctx: CanvasRenderingContext2D, scenario: Scenario, pxPerCell: number, print: boolean): void {
  const { nx, ny } = scenario.manifest.grid;
  const r = Math.max(pxPerCell * 0.42, 0.9);
  ctx.save();
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      if (scenario.cover[ix + nx * iy] !== COVER.faultZone) continue;
      const x = ix * pxPerCell, y = (ny - 1 - iy) * pxPerCell;
      ctx.fillStyle = print ? "rgba(176, 80, 50, 0.22)" : "rgba(170, 72, 40, 0.35)";
      ctx.fillRect(x, y, pxPerCell, pxPerCell);
      if (pxPerCell < 2 || (ix + 2 * iy) % 2) continue; // a triangle on every other cell, staggered
      const cx = x + pxPerCell / 2, cy = y + pxPerCell / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r * 0.87, cy + r * 0.5);
      ctx.lineTo(cx - r * 0.87, cy + r * 0.5);
      ctx.closePath();
      ctx.strokeStyle = print ? "rgba(120, 40, 20, 0.7)" : "rgba(110, 30, 14, 0.85)";
      ctx.lineWidth = Math.max(pxPerCell / 6, 0.6);
      ctx.stroke();
    }
  }
  ctx.restore();
}

const css = (colour: number) => `#${colour.toString(16).padStart(6, "0")}`;

export class MapBoard {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hillshade: HTMLCanvasElement;
  private contourCache: ContourLevel[] | null = null;
  private readonly extent: { x: number; y: number };
  private tool: Tool = "pan";
  private style: LineStyle = "solid";
  private kinematics: Kinematics | "" = "";
  private selectedUnit: number | null = null;
  private drawing: { tool: LineKind | "polygon"; points: number[] } | null = null;
  private hover: [number, number] | null = null;
  private view = { ox: 0, oy: 0, scale: 0.3, fit: 0.3 };
  private undoStack: string[] = [];
  private pointer: { x: number; y: number; ox: number; oy: number; panning: boolean; button: number } | null = null;
  private frame = 0;
  private hint = "";
  private opened = false;
  /** The units panel is folded into one line on small screens until the student opens it. */
  private sideFolded = window.innerWidth < 900;
  /** Fingers on the map, for pinch zoom. */
  private readonly touches = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; x: number; y: number } | null = null;
  private pinched = false;
  private lastTap: { t: number; x: number; y: number } | null = null;
  /** Free mode: the true geological map shown over the base, and its picture, drawn once. */
  private showSolution = false;
  private solution: HTMLCanvasElement | null = null;
  /** Since format 1.6.0: the solution can show the true alteration instead of the units. */
  private solutionLayer: "units" | "alteration" = "units";
  private alterationSolution: HTMLCanvasElement | null = null;

  /** `onNet` opens the stereonet; `changed` is called after every change to the map, so the caller can save. */
  constructor(
    private readonly root: HTMLElement,
    private readonly scenario: Scenario,
    private readonly grid: Grid,
    private readonly field: Field,
    private readonly changed: () => void,
    private readonly close: () => void,
    private readonly onNet: () => void,
    private readonly onSection: () => void = () => {},
  ) {
    root.innerHTML = `
      <canvas id="map-canvas"></canvas>
      <div class="panel toolbar" id="map-toolbar" role="toolbar" aria-label="Herramientas del mapa">
        ${TOOLS.map(([id, name, caption, ic]) => captionButton(ic, caption, name, `data-tool="${id}"`)).join("")}
        <label id="opt-style" class="opt"><span class="opt-name">Trazo</span> <select id="map-style" aria-label="Trazo">${(Object.keys(STYLE_NAMES) as LineStyle[]).map((s) => `<option value="${s}">${STYLE_NAMES[s]}</option>`).join("")}</select></label>
        <label id="opt-kin" class="opt"><span class="opt-name">Movimiento</span> <select id="map-kin" aria-label="Movimiento de la falla"><option value="">sin determinar</option>${(Object.keys(KINEMATICS_NAMES) as Kinematics[]).map((k) => `<option value="${k}">${KINEMATICS_NAMES[k]}</option>`).join("")}</select></label>
        ${captionButton("undo", "Deshacer", "Deshacer (Ctrl+Z)", 'id="map-undo"')}
        <span class="sep"></span>
        ${captionButton("zoomIn", "Acercar", "Acercar", 'id="map-zoom-in"')}
        ${captionButton("zoomOut", "Alejar", "Alejar", 'id="map-zoom-out"')}
        ${captionButton("fit", "Todo", "Ver toda el área", 'id="map-fit"')}
        <span class="sep"></span>
        ${captionButton("stereonet", "Red", "Red estereográfica (S)", 'id="map-net"')}
        ${captionButton("section", "Ver perfil", "Abrir el perfil (P)", 'id="map-section"')}
        ${captionButton("solution", "Solución", "Ver el mapa solución (solo en modo libre)", 'id="map-solution" aria-pressed="false" hidden')}
        <span class="sep"></span>
        <select id="map-paper" aria-label="Tamaño de papel" title="Tamaño de papel"><option>A4</option><option>A3</option></select>
        ${captionButton("pdf", "PDF", "Exportar el mapa en PDF", 'id="map-pdf"')}
        ${captionButton("geojson", "GeoJSON", "Exportar GeoJSON", 'id="map-geojson"')}
      </div>
      <button type="button" id="map-finish" class="done-btn" title="Terminar (Enter)" hidden>${icon("check", 22)}<span>Listo</span></button>
      <div class="panel" id="map-solution-legend" hidden></div>
      ${iconButton("close", "Volver (M)", 'id="map-close" class="icon-btn panel close-fixed"')}
      <div class="panel" id="map-hint"></div>
      <aside class="panel" id="map-side"></aside>`;
    this.canvas = root.querySelector("#map-canvas")!;
    this.ctx = this.canvas.getContext("2d")!;
    this.hillshade = renderHillshade(scenario, 4);
    this.extent = { x: grid.nx * grid.cell, y: grid.ny * grid.cell };
    const state = field.state;
    this.selectedUnit = state.map.units[0]?.id ?? null;

    const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
    root.addEventListener("click", (e) => {
      const tool = (e.target as HTMLElement).closest<HTMLElement>("[data-tool]")?.dataset.tool as Tool | undefined;
      if (tool) this.setTool(tool);
    });
    $<HTMLSelectElement>("#map-style").onchange = (e) => (this.style = (e.target as HTMLSelectElement).value as LineStyle);
    $<HTMLSelectElement>("#map-kin").onchange = (e) => (this.kinematics = (e.target as HTMLSelectElement).value as Kinematics | "");
    $("#map-finish").onclick = () => this.done();
    $("#map-solution").onclick = () => this.toggleSolution();
    $("#map-solution-legend").addEventListener("click", (e) => {
      const layer = (e.target as HTMLElement).closest<HTMLElement>("[data-layer]")?.dataset.layer as "units" | "alteration" | undefined;
      if (!layer || layer === this.solutionLayer) return;
      this.solutionLayer = layer;
      this.renderSolutionLegend();
      this.draw();
    });
    $("#map-undo").onclick = () => this.undo();
    $("#map-zoom-in").onclick = () => this.zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.4);
    $("#map-zoom-out").onclick = () => this.zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1 / 1.4);
    $("#map-fit").onclick = () => this.fit();
    $("#map-net").onclick = () => this.onNet();
    $("#map-section").onclick = () => this.onSection();
    $("#map-close").onclick = () => this.close();
    $("#map-geojson").onclick = () => this.exportGeoJSON();
    $("#map-pdf").onclick = () => void this.exportPdf();

    this.canvas.addEventListener("pointerdown", (e) => this.down(e));
    this.canvas.addEventListener("pointermove", (e) => this.move(e));
    this.canvas.addEventListener("pointerup", (e) => this.up(e));
    this.canvas.addEventListener("pointercancel", (e) => {
      this.pointer = null;
      this.touches.delete(e.pointerId);
      if (this.touches.size < 2) this.pinch = null;
      if (this.touches.size === 0) this.pinched = false;
    });
    this.canvas.addEventListener("pointerleave", () => ((this.hover = null), this.schedule()));
    this.canvas.addEventListener("dblclick", (e) => (e as PointerEvent).pointerType !== "touch" && this.doubleClick());
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.canvas.addEventListener("wheel", (e) => (e.preventDefault(), this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015))), { passive: false });
    window.addEventListener("resize", () => this.isOpen && (this.resize(), this.draw()));
    window.addEventListener("keydown", (e) => {
      if (!this.isOpen) return;
      const typing = isTyping(e.target);
      if (e.code === "Enter" && !typing && this.drawing) (e.preventDefault(), this.finish());
      if (e.code === "KeyZ" && (e.ctrlKey || e.metaKey) && !typing) (e.preventDefault(), this.undo());
    });
    this.setTool("pan");
    this.renderSide();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.root.hidden = false;
    const canSolve = this.field.state.mode === "free" && !!this.field.truth;
    this.root.querySelector<HTMLElement>("#map-solution")!.hidden = !canSolve;
    if (!canSolve) this.showSolution = false;
    this.renderSolutionLegend();
    this.resize();
    if (!this.opened) (this.fit(), (this.opened = true));
    this.renderSide();
    this.draw();
  }

  hide(): void {
    this.root.hidden = true;
    this.drawing = null;
    this.sectionStart = null;
  }

  /**
   * «Listo»: closes the line or area being drawn; with nothing being drawn, puts the tool away and goes back to
   * moving the map, so the student always has a clear way out of a tool.
   */
  done(): void {
    if (this.drawing) return this.finish();
    if (this.sectionStart) {
      this.sectionStart = null;
      this.say("Línea del perfil descartada.");
    }
    this.setTool("pan");
  }

  /** The «Listo» button shows while a drawing tool is in use. */
  private updateDone(): void {
    const button = this.root.querySelector<HTMLElement>("#map-finish")!;
    button.hidden = this.tool === "pan";
    const drawing = !!this.drawing || !!this.sectionStart;
    button.classList.toggle("ready", drawing);
    button.title = drawing ? "Terminar la línea (Enter)" : "Dejar la herramienta y volver a Mover";
  }

  /** Free mode: shows or hides the true geological map over the base. */
  toggleSolution(): void {
    if (this.field.state.mode !== "free" || !this.field.truth) return;
    this.showSolution = !this.showSolution;
    this.root.querySelector("#map-solution")!.setAttribute("aria-pressed", String(this.showSolution));
    this.say(this.showSolution
      ? "Mapa solución: las unidades y los contactos verdaderos del modelo. Compáralo con el tuyo; tócalo otra vez para ocultarlo."
      : "Mapa solución oculto.");
    this.renderSolutionLegend();
    this.draw();
  }

  get solutionShown(): boolean {
    return this.showSolution;
  }

  /** The true map, one pixel per cell, coloured as the scenario's units (or its alteration zones); drawn once. */
  private solutionImage(): HTMLCanvasElement | null {
    const truth = this.field.truth;
    if (!truth) return null;
    if (this.solutionLayer === "alteration") return this.alterationImage();
    if (this.solution) return this.solution;
    const { nx, ny } = this.scenario.manifest.grid;
    const map = expandTruthMap(truth, this.scenario.manifest);
    const canvas = document.createElement("canvas");
    canvas.width = nx;
    canvas.height = ny;
    const ctx = canvas.getContext("2d")!;
    const image = ctx.createImageData(nx, ny);
    const colours = this.scenario.units.map((u) => Number.parseInt(u.colour.slice(1), 16));
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const c = colours[map[ix + nx * iy]!] ?? 0xcccccc, o = (ix + nx * (ny - 1 - iy)) * 4;
        image.data[o] = (c >> 16) & 255;
        image.data[o + 1] = (c >> 8) & 255;
        image.data[o + 2] = c & 255;
        image.data[o + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    return (this.solution = canvas);
  }

  /** The true alteration: each zone in its colour, unaltered rock pale grey. Null without alteration. */
  private alterationImage(): HTMLCanvasElement | null {
    const truth = this.field.truth;
    if (this.alterationSolution) return this.alterationSolution;
    const map = truth && expandAlterationMap(truth, this.scenario.manifest);
    if (!map) return null;
    const { nx, ny } = this.scenario.manifest.grid;
    const canvas = document.createElement("canvas");
    canvas.width = nx;
    canvas.height = ny;
    const ctx = canvas.getContext("2d")!;
    const image = ctx.createImageData(nx, ny);
    const colours = [0xeeeeea, ...this.scenario.alterations.map((a) => Number.parseInt(a.colour.slice(1), 16))];
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const c = colours[map[ix + nx * iy]!] ?? 0xeeeeea, o = (ix + nx * (ny - 1 - iy)) * 4;
        image.data[o] = (c >> 16) & 255;
        image.data[o + 1] = (c >> 8) & 255;
        image.data[o + 2] = c & 255;
        image.data[o + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    return (this.alterationSolution = canvas);
  }

  /** The legend of the true map: each unit with its name and age, youngest first; or each alteration zone. */
  private renderSolutionLegend(): void {
    const box = this.root.querySelector<HTMLElement>("#map-solution-legend")!;
    const truth = this.field.truth;
    box.hidden = !this.showSolution || !truth;
    if (box.hidden || !truth) return;
    const switcher = truth.alteration
      ? `<p class="layers"><button data-layer="units" aria-pressed="${this.solutionLayer === "units"}">Unidades</button><button data-layer="alteration" aria-pressed="${this.solutionLayer === "alteration"}">Alteración</button></p>`
      : "";
    if (truth.alteration && this.solutionLayer === "alteration") {
      const zones = truth.alteration.zones
        .map((z, i) => `<div><i class="sw" style="background:${esc(this.scenario.alterations[i]?.colour ?? "#ccc")}"></i><b>${esc(z.name)}</b> <small>${esc(this.scenario.alterations[i]?.minerals.join(", ") ?? "")}</small></div>`)
        .join("");
      box.innerHTML = `<b>Alteración verdadera</b>${switcher}${zones}<div><i class="sw" style="background:#eeeeea"></i><b>Sin alteración hidrotermal</b></div><p class="tip">La alteración se superpone a las unidades: compárala con los contactos y las fallas.</p>`;
      return;
    }
    const present = new Set(expandTruthMap(truth, this.scenario.manifest));
    const dykes = new Set((truth.dykes ?? []).map((d) => d.unit));
    const rows = truth.units
      .map((t, i) => ({ t, i, unit: this.scenario.units[i]! }))
      .filter((r) => present.has(r.i) || dykes.has(r.t.key))
      .sort((a, b) => a.t.age.from_ma - b.t.age.from_ma)
      .map((r) => `<div><i class="sw" style="background:${esc(r.unit.colour)}"></i><b>${esc(r.t.name)}</b> <small>${esc(r.unit.lithology)} · ${esc(r.t.age.label)}${dykes.has(r.t.key) ? " · dique" : ""}</small></div>`)
      .join("");
    box.innerHTML = `<b>Mapa solución</b>${switcher}${rows}<p class="tip">Línea negra: contacto · roja: falla · verde: dique.</p>`;
  }

  /** Esc: drops the line or area being drawn. Returns false when there was nothing to drop. */
  cancelDrawing(): boolean {
    if (!this.drawing) return false;
    this.drawing = null;
    this.updateDone();
    this.say("Descartado.");
    this.draw();
    return true;
  }

  // --- view

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Fits the whole area into what the toolbar and the side panel leave free. */
  fit(): void {
    const toolbar = this.root.querySelector<HTMLElement>("#map-toolbar")!;
    const side = window.innerWidth > 900 ? this.root.querySelector<HTMLElement>("#map-side")!.offsetWidth + 20 : 0;
    const left = 12, top = toolbar.offsetTop + toolbar.offsetHeight + 10, right = side + 12, bottom = window.innerWidth > 900 ? 56 : window.innerHeight < 520 ? 14 : 64;
    const w = Math.max(window.innerWidth - left - right, 100), h = Math.max(window.innerHeight - top - bottom, 100);
    const scale = Math.min(w / this.extent.x, h / this.extent.y);
    this.view = { scale, fit: scale, ox: left + (w - this.extent.x * scale) / 2, oy: top + (h + this.extent.y * scale) / 2 };
    this.draw();
  }

  private zoomAt(sx: number, sy: number, factor: number): void {
    const v = this.view;
    const scale = Math.min(Math.max(v.scale * factor, v.fit * 0.6), 14);
    const f = scale / v.scale;
    v.ox = sx - (sx - v.ox) * f;
    v.oy = sy - (sy - v.oy) * f;
    v.scale = scale;
    this.schedule();
  }

  /** Where a point in metres is on the screen; for tests and for anything that has to point at the map. */
  toScreen(x: number, y: number): [number, number] {
    return [this.view.ox + x * this.view.scale, this.view.oy - y * this.view.scale];
  }

  private toModel(sx: number, sy: number): [number, number] {
    return [(sx - this.view.ox) / this.view.scale, (this.view.oy - sy) / this.view.scale];
  }

  private schedule(): void {
    if (this.frame || !this.isOpen) return;
    this.frame = requestAnimationFrame(() => ((this.frame = 0), this.draw()));
  }

  // --- tools

  private setTool(tool: Tool): void {
    this.sectionStart = null;
    if (this.drawing && this.drawing.tool !== tool) this.drawing = null;
    this.tool = tool;
    for (const b of Array.from(this.root.querySelectorAll<HTMLElement>("[data-tool]"))) b.setAttribute("aria-pressed", String(b.dataset.tool === tool));
    this.root.querySelector<HTMLElement>("#opt-style")!.hidden = !(tool === "contact" || tool === "fault");
    this.root.querySelector<HTMLElement>("#opt-kin")!.hidden = tool !== "fault" && tool !== "faultEdit";
    this.updateDone();
    this.canvas.style.cursor = tool === "pan" ? "grab" : tool === "erase" ? "pointer" : "crosshair";
    this.say(HINTS[tool]);
    this.draw();
  }

  private say(text: string): void {
    this.hint = text;
    this.root.querySelector("#map-hint")!.textContent = text;
  }

  private snapshot(): void {
    this.undoStack.push(JSON.stringify(this.field.state.map));
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (previous === undefined) return this.say("No hay nada que deshacer.");
    this.drawing = null;
    this.updateDone();
    this.field.state.map = JSON.parse(previous) as MapState;
    if (!this.field.state.map.units.some((u) => u.id === this.selectedUnit)) this.selectedUnit = this.field.state.map.units[0]?.id ?? null;
    this.changed();
    this.renderSide();
    this.draw();
  }

  private down(e: PointerEvent): void {
    capture(this.canvas, e.pointerId);
    if (e.pointerType === "touch") {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
        const [a, b] = [...this.touches.values()] as [{ x: number; y: number }, { x: number; y: number }];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this.pinched = true;
        this.pointer = null;
        return;
      }
    }
    this.pointer = { x: e.clientX, y: e.clientY, ox: this.view.ox, oy: this.view.oy, panning: this.tool === "pan" || e.button !== 0, button: e.button };
    if (this.pointer.panning) this.canvas.style.cursor = "grabbing";
  }

  private move(e: PointerEvent): void {
    if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.touches.size === 2) {
      const [a, b] = [...this.touches.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.hypot(a.x - b.x, a.y - b.y), x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
      this.view.ox += x - this.pinch.x;
      this.view.oy += y - this.pinch.y;
      this.zoomAt(x, y, d / Math.max(this.pinch.d, 1));
      this.pinch = { d, x, y };
      return;
    }
    if (this.pinched) return;
    this.hover = this.toModel(e.clientX, e.clientY);
    const p = this.pointer;
    if (p) {
      // A finger wanders a little during a tap: allow more than a mouse before it counts as dragging the map.
      const slop = e.pointerType === "touch" ? 16 : 6;
      if (!p.panning && Math.hypot(e.clientX - p.x, e.clientY - p.y) > slop) p.panning = true;
      if (p.panning) {
        this.view.ox = p.ox + (e.clientX - p.x);
        this.view.oy = p.oy + (e.clientY - p.y);
      }
    }
    this.schedule();
  }

  private up(e: PointerEvent): void {
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinch = null;
    if (this.pinched) {
      // A pinch is not a tap: nothing is drawn until every finger is lifted.
      if (this.touches.size === 0) this.pinched = false;
      this.pointer = null;
      return;
    }
    const p = this.pointer;
    this.pointer = null;
    this.canvas.style.cursor = this.tool === "pan" ? "grab" : this.tool === "erase" ? "pointer" : "crosshair";
    if (!p || p.panning || e.button !== 0) return;
    const [x, y] = this.toModel(e.clientX, e.clientY);
    // A double tap finishes a line, as a double click does: phones do not all send dblclick.
    if (e.pointerType === "touch" && this.drawing) {
      const last = this.lastTap;
      this.lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      if (last && e.timeStamp - last.t < 350 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) {
        this.lastTap = null;
        return this.finish();
      }
    }
    if (this.tool === "erase") return this.erase(x, y);
    if (this.tool === "faultEdit") return this.editFault(x, y);
    if (this.tool === "pan") return;
    if (this.tool === "section") return this.sectionPoint(x, y);
    this.addPoint(x, y);
  }

  private addPoint(x: number, y: number): void {
    const kind = this.tool as LineKind | "polygon";
    if (!this.drawing) this.drawing = { tool: kind, points: [] };
    const d = this.drawing;
    if (kind === "polygon" && d.points.length >= 6) {
      const closeTo = Math.hypot(this.view.scale * (x - d.points[0]!), this.view.scale * (y - d.points[1]!));
      if (closeTo < 12) return this.finish();
    }
    d.points.push(x, y);
    this.updateDone();
    this.draw();
  }

  private sectionStart: [number, number] | null = null;

  /** The first click starts the line of the profile, the second ends it. A new line clears the profile drawn on the old one. */
  private sectionPoint(x: number, y: number): void {
    if (!this.sectionStart) {
      this.sectionStart = [x, y];
      this.say("Ahora el final de la línea del perfil.");
      this.updateDone();
      return this.draw();
    }
    const [x1, y1] = this.sectionStart;
    this.sectionStart = null;
    this.updateDone();
    if (Math.hypot(x - x1, y - y1) < 100) return this.say("La línea del perfil debe medir al menos 100 m.");
    const section = this.field.state.section;
    const drawn = section.polygons.length + section.lines.length;
    if (drawn && !window.confirm("Una línea nueva borra el perfil que dibujaste sobre la anterior. ¿Seguir?")) return this.draw();
    this.field.state.section = { line: { x1, y1, x2: x, y2: y }, polygons: [], lines: [], nextId: 1 };
    this.changed();
    this.say(`Perfil de ${Math.round(Math.hypot(x - x1, y - y1))} m trazado. Ábrelo con «Ver perfil» (P), o «Listo» para volver a Mover.`);
    this.draw();
  }

  private doubleClick(): void {
    const d = this.drawing;
    if (!d) return;
    // The two clicks of a double click each added a point; keep one.
    const n = d.points.length;
    if (n >= 4 && Math.hypot(d.points[n - 2]! - d.points[n - 4]!, d.points[n - 1]! - d.points[n - 3]!) * this.view.scale < 8) d.points.length = n - 2;
    this.finish();
  }

  finish(): void {
    const d = this.drawing;
    if (!d) return;
    const need = d.tool === "polygon" ? 3 : 2;
    if (d.points.length / 2 < need) return this.say(`Faltan puntos: se necesitan al menos ${need}.`);
    if (d.tool === "polygon" && this.selectedUnit === null) return this.say("Elige o crea una unidad a la derecha antes de cerrar el área.");
    this.snapshot();
    const map = this.field.state.map;
    if (d.tool === "polygon") addPolygon(map, this.selectedUnit!, d.points);
    else addLine(map, d.tool, this.style, d.points, d.tool === "fault" && this.kinematics ? this.kinematics : undefined);
    this.drawing = null;
    this.updateDone();
    this.changed();
    this.renderSide();
    this.draw();
  }

  /** Gives a fault the chosen movement; on a fault that already has it, moves its marks to the other side. */
  private editFault(x: number, y: number): void {
    const map = this.field.state.map;
    const faults = { ...map, lines: map.lines.filter((l) => l.kind === "fault"), polygons: [] };
    const hit = nearestFeature(faults, x, y, 12 / this.view.scale);
    const line = hit && map.lines.find((l) => l.id === hit.id);
    if (!line) return this.say("Toca sobre una falla.");
    this.snapshot();
    const chosen = this.kinematics || undefined;
    if (line.kinematics === chosen) {
      line.flip = !line.flip;
      this.say("Los símbolos pasaron al otro lado de la falla.");
    } else {
      if (chosen) line.kinematics = chosen;
      else delete line.kinematics;
      this.say(chosen ? `Falla ${KINEMATICS_NAMES[chosen]}. Tócala otra vez si los símbolos van al otro lado.` : "Falla sin movimiento determinado.");
    }
    this.changed();
    this.draw();
  }

  private erase(x: number, y: number): void {
    const hit = nearestFeature(this.field.state.map, x, y, 10 / this.view.scale);
    if (!hit) return this.say("No hay nada cerca de ese punto.");
    this.snapshot();
    removeFeature(this.field.state.map, hit);
    this.changed();
    this.renderSide();
    this.draw();
  }

  // --- units

  renderSide(): void {
    const map = this.field.state.map;
    const names = rockNames(this.field.state).filter((n) => !map.units.some((u) => u.name.toLowerCase() === n.toLowerCase()));
    const rows = map.units
      .map((u) => {
        const count = map.polygons.filter((p) => p.unit === u.id).length;
        return `<div class="unit${u.id === this.selectedUnit ? " selected" : ""}" data-unit="${u.id}">
          <input type="color" value="${esc(u.colour)}" data-colour="${u.id}" aria-label="Color de ${esc(u.name)}">
          <input type="text" value="${esc(u.name)}" data-name="${u.id}" aria-label="Nombre de la unidad">
          <small>${count}</small>${iconButton("trash", `Quitar la unidad ${u.name}`, `data-remove="${u.id}"`)}</div>`;
      })
      .join("");
    const side = this.root.querySelector<HTMLElement>("#map-side")!;
    const current = map.units.find((u) => u.id === this.selectedUnit);
    side.classList.toggle("folded", this.sideFolded);
    side.innerHTML = `<button type="button" class="side-toggle" id="unit-toggle" aria-expanded="${!this.sideFolded}">
        ${current ? `<i class="sw" style="background:${esc(current.colour)}"></i>${esc(current.name || "sin nombre")}` : "Unidades"}
        <small>${map.units.length} ${map.units.length === 1 ? "unidad" : "unidades"}</small>${icon(this.sideFolded ? "up" : "down", 18)}</button>
      <div class="side-body"><b>Unidades del mapa</b>
      <p class="tip">Elige una para pintar con ella. Cada nombre es tuyo: la libreta guarda cómo llamaste a las rocas.</p>
      ${rows || "<p class='tip'><i>Aún no hay unidades.</i></p>"}
      <div class="add"><input type="text" id="unit-new" placeholder="Nueva unidad" autocomplete="off">${iconButton("add", "Agregar la unidad", 'id="unit-add"')}</div>
      ${names.length ? `<button type="button" id="unit-import">Traer de la libreta: ${names.map(esc).join(", ")}</button>` : ""}
      <p class="tip">${map.polygons.length} áreas · ${map.lines.length} líneas</p></div>`;
    side.onclick = (e) => {
      const t = e.target as HTMLElement;
      const remove = t.closest<HTMLElement>("[data-remove]")?.dataset.remove;
      const row = t.closest<HTMLElement>("[data-unit]")?.dataset.unit;
      if (t.closest("#unit-toggle")) {
        this.sideFolded = !this.sideFolded;
        return this.renderSide();
      }
      if (remove) {
        this.snapshot();
        removeUnit(map, Number(remove));
        if (this.selectedUnit === Number(remove)) this.selectedUnit = map.units[0]?.id ?? null;
        this.changed();
        this.renderSide();
        this.draw();
      } else if (t.closest("#unit-add")) this.addNamed((side.querySelector<HTMLInputElement>("#unit-new")!).value);
      else if (t.id === "unit-import") for (const name of names) this.addNamed(name);
      else if (row && t.tagName !== "INPUT") {
        this.selectedUnit = Number(row);
        this.renderSide();
      } else if (row && t.dataset.name) this.selectedUnit = Number(row);
    };
    side.onchange = (e) => {
      const t = e.target as HTMLInputElement;
      const unit = map.units.find((u) => u.id === Number(t.dataset.name ?? t.dataset.colour));
      if (!unit) return;
      this.snapshot();
      if (t.dataset.name) unit.name = t.value.trim();
      else unit.colour = t.value;
      this.changed();
      this.draw();
    };
    side.onkeydown = (e) => {
      if (e.key === "Enter" && (e.target as HTMLElement).id === "unit-new") this.addNamed((e.target as HTMLInputElement).value);
    };
  }

  private addNamed(name: string): void {
    if (!name.trim()) return;
    this.snapshot();
    this.selectedUnit = addUnit(this.field.state.map, name).id;
    this.changed();
    this.renderSide();
    this.draw();
  }

  // --- drawing

  contours(): ContourLevel[] {
    return (this.contourCache ??= contourSet(this.grid.elevation, this.grid.nx, this.grid.ny, this.grid.cell, CONTOUR_M));
  }

  draw(): void {
    if (!this.isOpen) return;
    const { ctx, view } = this;
    const W = window.innerWidth, H = window.innerHeight, s = view.scale;
    const sx = (x: number) => view.ox + x * s, sy = (y: number) => view.oy - y * s;
    const path = (points: number[], closed = false) => {
      ctx.beginPath();
      for (let i = 0; i < points.length; i += 2) (i === 0 ? ctx.moveTo : ctx.lineTo).call(ctx, sx(points[i]!), sy(points[i + 1]!));
      if (closed) ctx.closePath();
    };
    const state = this.field.state, map = state.map, origin = this.scenario.manifest.grid.origin;

    ctx.fillStyle = "#1d211f";
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.hillshade, sx(0), sy(this.extent.y), this.extent.x * s, this.extent.y * s);
    const solution = this.showSolution ? this.solutionImage() : null;
    if (solution) {
      // The true map multiplied over the relief, so the hills still read under the colours.
      ctx.globalAlpha = 0.8;
      ctx.globalCompositeOperation = "multiply";
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(solution, sx(0), sy(this.extent.y), this.extent.x * s, this.extent.y * s);
      ctx.imageSmoothingEnabled = true;
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    }

    const units = new Map(map.units.map((u) => [u.id, u]));
    for (const p of map.polygons) {
      path(p.points, true);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = units.get(p.unit)?.colour ?? "#cccccc";
      ctx.fill();
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    for (const level of this.contours()) {
      ctx.strokeStyle = level.index ? "rgba(110,80,40,0.85)" : "rgba(110,80,40,0.5)";
      ctx.lineWidth = level.index ? 1.1 : 0.6;
      for (const line of level.lines) (path(line), ctx.stroke());
    }
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center";
    if (s > view.fit * 0.9) {
      for (const level of this.contours().filter((l) => l.index)) {
        for (const line of level.lines) {
          if (line.length < 60) continue;
          const [x, y] = midpoint(line);
          const lx = sx(x), ly = sy(y);
          if (lx < 0 || lx > W || ly < 0 || ly > H) continue;
          ctx.lineWidth = 3;
          ctx.strokeStyle = "rgba(255,255,255,0.85)";
          ctx.strokeText(String(level.level), lx, ly);
          ctx.fillStyle = "#5a3f1c";
          ctx.fillText(String(level.level), lx, ly);
        }
      }
    }

    // 500 m grid with its coordinates, which stay at the edge of what is on the screen.
    ctx.strokeStyle = "rgba(30,60,140,0.45)";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#14285a";
    ctx.textAlign = "left";
    const top = Math.max(sy(this.extent.y), 70);
    for (let e = Math.ceil(origin.easting / 500) * 500; e < origin.easting + this.extent.x; e += 500) {
      const x = sx(e - origin.easting);
      ctx.beginPath(); ctx.moveTo(x + 0.5, sy(this.extent.y)); ctx.lineTo(x + 0.5, sy(0)); ctx.stroke();
      if (x > 0 && x < W) ctx.fillText(String(e), x + 3, top + 12);
    }
    for (let n = Math.ceil(origin.northing / 500) * 500; n < origin.northing + this.extent.y; n += 500) {
      const y = sy(n - origin.northing);
      ctx.beginPath(); ctx.moveTo(sx(0), y + 0.5); ctx.lineTo(sx(this.extent.x), y + 0.5); ctx.stroke();
      if (y > 70 && y < H) ctx.fillText(String(n), Math.max(sx(0), 0) + 4, y - 3);
    }

    // Outcrops that have been found: grey when sighted, the colour of the rock once visited.
    this.scenario.outcrops.forEach((outcrop, n) => {
      if (!state.found.sighted.has(n)) return;
      const visited = state.found.visited.has(n);
      for (const [ix, iy] of outcrop.cells) {
        const unit = this.grid.rock[ix + this.grid.nx * iy]!;
        ctx.fillStyle = visited && unit >= 0 ? css(this.grid.unitColours[unit]!) : "#6e6e6a";
        const size = Math.max(this.grid.cell * s, 2.5);
        ctx.fillRect(sx(ix * this.grid.cell), sy((iy + 1) * this.grid.cell), size, size);
      }
    });

    if (solution) this.drawTrueTraces(sx, sy);

    // The student's lines.
    for (const line of map.lines) this.stroke(path, line.points, line.kind, line.style);
    for (const line of map.lines) {
      if (line.kind !== "fault" || !line.kinematics) continue;
      // Marks are computed in a frame with y up, in screen pixels.
      const up: number[] = [];
      for (let i = 0; i + 1 < line.points.length; i += 2) up.push(sx(line.points[i]!), -sy(line.points[i + 1]!));
      this.drawFaultMarks(faultMarks(up, line.kinematics, 9, line.flip));
    }

    // Stations, with the mean strike and dip of each kind of plane measured there.
    ctx.textAlign = "center";
    for (const station of state.stations) {
      const x = sx(station.easting - origin.easting), y = sy(station.northing - origin.northing);
      for (const plane of meanPlanes(station)) {
        const g = strikeDipSymbol(plane.strike, plane.dip, 26);
        const colour = FEATURE_COLOURS[plane.feature] ?? "#1d1d1d";
        ctx.strokeStyle = colour;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(x + g.strike[0], y - g.strike[1]); ctx.lineTo(x + g.strike[2], y - g.strike[3]);
        ctx.moveTo(x, y); ctx.lineTo(x + g.tick[2], y - g.tick[3]);
        ctx.stroke();
        ctx.font = "bold 11px system-ui, sans-serif";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.strokeText(String(plane.dip), x + g.label[0], y - g.label[1] + 4);
        ctx.fillStyle = colour;
        ctx.fillText(String(plane.dip), x + g.label[0], y - g.label[1] + 4);
      }
      // The dot takes the colour of the unit the student assigned there; white while unassigned.
      const unit = map.units.find((u) => u.id === station.unit);
      ctx.beginPath();
      ctx.arc(x, y, unit ? 5.5 : 3.5, 0, 2 * Math.PI);
      ctx.fillStyle = unit?.colour ?? "#fff";
      ctx.fill();
      ctx.strokeStyle = unit ? "#111" : "#7a1f1f";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.strokeText(String(station.number), x + 6, y - 6);
      ctx.fillStyle = "#7a1f1f";
      ctx.fillText(String(station.number), x + 6, y - 6);
      ctx.textAlign = "center";
    }

    // The line of the profile, A to A'.
    const sl = state.section.line;
    const start = this.sectionStart;
    if (sl || start) {
      const [ax, ay] = sl ? [sl.x1, sl.y1] : start!;
      const [bx, by] = sl ? [sl.x2, sl.y2] : this.hover ?? start!;
      ctx.strokeStyle = "#6a1b9a";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([10, 5]);
      ctx.beginPath();
      ctx.moveTo(sx(ax), sy(ay));
      ctx.lineTo(sx(bx), sy(by));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "bold 14px system-ui, sans-serif";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.fillStyle = "#6a1b9a";
      for (const [label, px, py] of [["A", ax, ay], ["A'", bx, by]] as const) {
        ctx.strokeText(label, sx(px) + 6, sy(py) - 6);
        ctx.fillText(label, sx(px) + 6, sy(py) - 6);
      }
    }

    // The line or area being drawn, with a rubber band to the pointer.
    const d = this.drawing;
    if (d) {
      const points = this.hover && this.pointer?.panning !== true ? [...d.points, ...this.hover] : d.points;
      if (d.tool === "polygon") {
        path(points, points.length >= 6);
        ctx.fillStyle = (units.get(this.selectedUnit ?? -1)?.colour ?? "#cccccc") + "66";
        if (points.length >= 6) ctx.fill();
        ctx.strokeStyle = "#111";
        ctx.lineWidth = 1.6;
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else this.stroke(path, points, d.tool, this.style);
      for (let i = 0; i < d.points.length; i += 2) {
        ctx.beginPath();
        ctx.arc(sx(d.points[i]!), sy(d.points[i + 1]!), i === 0 && d.tool === "polygon" ? 6 : 3, 0, 2 * Math.PI);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.strokeStyle = "#111";
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }

    // The student.
    const wx = sx(state.walker.x), wy = sy(state.walker.y), a = (state.walker.heading * Math.PI) / 180;
    ctx.strokeStyle = "#000";
    ctx.fillStyle = "#ffe14a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(wx + Math.sin(a) * 14, wy - Math.cos(a) * 14);
    ctx.lineTo(wx + Math.sin(a + 2.5) * 8, wy - Math.cos(a + 2.5) * 8);
    ctx.lineTo(wx + Math.sin(a - 2.5) * 8, wy - Math.cos(a - 2.5) * 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  /** The true contacts, faults and dykes of the model, for the solution map. */
  private drawTrueTraces(sx: (x: number) => number, sy: (y: number) => number): void {
    const truth = this.field.truth;
    if (!truth) return;
    const { ctx } = this, o = this.scenario.manifest.grid.origin;
    const trace = (coords: [number, number][]) => {
      ctx.beginPath();
      coords.forEach(([e, n], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, sx(e - o.easting), sy(n - o.northing)));
      ctx.stroke();
    };
    ctx.lineJoin = "round";
    for (const f of truth.contacts.features) {
      const fault = f.properties.type === "fault";
      ctx.strokeStyle = fault ? "#c0161b" : f.properties.type === "gradational" ? "rgba(20,20,20,0.6)" : "#141414";
      ctx.lineWidth = fault ? 3 : 1.6;
      ctx.setLineDash(f.properties.type === "gradational" ? [5, 4] : f.properties.type === "unconformity" ? [10, 3, 2, 3] : []);
      trace(f.geometry.coordinates);
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = "#1f7a3a";
    ctx.lineWidth = 2.4;
    for (const d of truth.dykes ?? []) trace(d.trace.coordinates);
    ctx.lineJoin = "miter";
  }

  private drawFaultMarks(m: FaultMarks): void {
    const { ctx } = this;
    const colour = LINE_LOOK.fault.colour;
    ctx.fillStyle = ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    for (const t of m.teeth) {
      ctx.beginPath();
      ctx.moveTo(t[0]!, -t[1]!);
      ctx.lineTo(t[2]!, -t[3]!);
      ctx.lineTo(t[4]!, -t[5]!);
      ctx.closePath();
      ctx.fill();
    }
    for (const b of m.bars) {
      ctx.beginPath();
      ctx.moveTo(b[0]!, -b[1]!);
      ctx.lineTo(b[2]!, -b[3]!);
      ctx.stroke();
    }
    for (const [x, y, r] of m.balls) {
      ctx.beginPath();
      ctx.arc(x, -y, r + 1, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.lineWidth = 2.2;
    for (const a of m.arrows) {
      ctx.beginPath();
      ctx.moveTo(a[0]!, -a[1]!);
      for (let i = 2; i + 1 < a.length; i += 2) ctx.lineTo(a[i]!, -a[i + 1]!);
      ctx.stroke();
    }
  }

  private stroke(path: (points: number[]) => void, points: number[], kind: LineKind, style: LineStyle): void {
    const { ctx } = this;
    const look = LINE_LOOK[kind];
    path(points);
    ctx.strokeStyle = look.colour;
    ctx.lineWidth = look.width;
    ctx.lineCap = style === "inferred" ? "round" : "butt";
    ctx.setLineDash(DASH[style].map((v) => v * look.width));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = "butt";
  }

  // --- export

  exportGeoJSON(): void {
    const { scenario_id, variant } = this.scenario.manifest;
    download(`mapa-${scenario_id}-${variant}.geojson`, JSON.stringify(toGeoJSON(this.scenario, this.field.state), null, 1), "application/geo+json");
    this.say("GeoJSON exportado: coordenadas este y norte del sistema local del escenario.");
  }

  async exportPdf(): Promise<void> {
    const paper = this.root.querySelector<HTMLSelectElement>("#map-paper")!.value as Paper;
    this.say("Preparando el PDF…");
    const shade = renderHillshade(this.scenario, 3, true);
    const blob = await new Promise<Blob | null>((resolve) => shade.toBlob(resolve, "image/jpeg", 0.85));
    const hillshade = blob ? { bytes: new Uint8Array(await blob.arrayBuffer()), width: shade.width, height: shade.height } : undefined;
    const bytes = buildMapPdf({
      scenario: this.scenario,
      state: this.field.state,
      contours: this.contours(),
      hillshade,
      paper,
      stamp: new Date().toLocaleDateString("es-CL"),
    });
    const { scenario_id, variant } = this.scenario.manifest;
    download(`mapa-${scenario_id}-${variant}.pdf`, bytes as BlobPart, "application/pdf");
    this.say(`PDF exportado (${paper}).`);
  }
}
