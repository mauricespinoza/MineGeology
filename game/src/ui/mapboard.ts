// The map board: the topographic base and the fog of war, with the tools to draw the geological map on it.

import { type ContourLevel, contourSet, midpoint } from "../interpret/contours";
import { toGeoJSON } from "../interpret/geojson";
import {
  KINEMATICS_NAMES, type Kinematics, type LineKind, type LineStyle, type MapState, STYLE_NAMES,
  addLine, addPolygon, addUnit, nearestFeature, removeFeature, removeUnit,
} from "../interpret/mapdata";
import { type Paper, buildMapPdf } from "../interpret/mapPdf";
import { FEATURE_COLOURS } from "../interpret/stereonet";
import { DASH, LINE_LOOK, meanPlanes, strikeDipSymbol } from "../interpret/symbols";
import type { Scenario } from "../format/types";
import { rockNames } from "../state/state";
import { isTyping } from "../explore/controls";
import type { Field } from "../tools/fieldwork";
import type { Grid } from "../world/blocks";
import { capture, esc } from "./html";
import { type IconName, icon, iconButton } from "./icons";
import { download } from "./notebook";

export type Tool = "pan" | "contact" | "fault" | "polygon" | "erase" | "section";

const TOOLS: [Tool, string, IconName][] = [
  ["pan", "Mover", "move"], ["contact", "Contacto", "contact"], ["fault", "Falla", "fault"],
  ["polygon", "Área", "area"], ["erase", "Borrar", "erase"], ["section", "Línea del perfil", "profileLine"],
];
const HINTS: Record<Tool, string> = {
  pan: "Mover: arrastra el mapa; acerca con la rueda o con dos dedos. Con cualquier herramienta, un arrastre también mueve el mapa.",
  contact: "Contacto: toca o haz clic en cada punto; termina con ✓, Enter o doble clic.",
  fault: "Falla: toca o haz clic en cada punto; termina con ✓, Enter o doble clic.",
  polygon: "Área: marca cada vértice y ciérrala sobre el primer punto o con ✓. Se pinta con la unidad elegida.",
  erase: "Borrar: toca una línea o un área. Deshacer la recupera.",
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
  return canvas;
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
        ${TOOLS.map(([id, name, ic]) => iconButton(ic, name, `data-tool="${id}"`)).join("")}
        <label id="opt-style" class="opt"><span class="opt-name">Trazo</span> <select id="map-style" aria-label="Trazo">${(Object.keys(STYLE_NAMES) as LineStyle[]).map((s) => `<option value="${s}">${STYLE_NAMES[s]}</option>`).join("")}</select></label>
        <label id="opt-kin" class="opt"><span class="opt-name">Movimiento</span> <select id="map-kin" aria-label="Movimiento de la falla"><option value="">sin determinar</option>${(Object.keys(KINEMATICS_NAMES) as Kinematics[]).map((k) => `<option value="${k}">${KINEMATICS_NAMES[k]}</option>`).join("")}</select></label>
        ${iconButton("check", "Terminar (Enter)", 'id="map-finish" class="icon-btn accent"')}
        ${iconButton("undo", "Deshacer (Ctrl+Z)", 'id="map-undo"')}
        <span class="sep"></span>
        ${iconButton("zoomIn", "Acercar", 'id="map-zoom-in"')}
        ${iconButton("zoomOut", "Alejar", 'id="map-zoom-out"')}
        ${iconButton("fit", "Ver toda el área", 'id="map-fit"')}
        <span class="sep"></span>
        ${iconButton("stereonet", "Red estereográfica (S)", 'id="map-net"')}
        ${iconButton("section", "Abrir el perfil (P)", 'id="map-section"')}
        <span class="sep"></span>
        <select id="map-paper" aria-label="Tamaño de papel" title="Tamaño de papel"><option>A4</option><option>A3</option></select>
        ${iconButton("pdf", "Exportar el mapa en PDF", 'id="map-pdf"')}
        ${iconButton("geojson", "Exportar GeoJSON", 'id="map-geojson"')}
      </div>
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
    $("#map-finish").onclick = () => this.finish();
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
    this.canvas.addEventListener("dblclick", () => this.doubleClick());
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
    this.resize();
    if (!this.opened) (this.fit(), (this.opened = true));
    this.renderSide();
    this.draw();
  }

  hide(): void {
    this.root.hidden = true;
    this.drawing = null;
  }

  /** Esc: drops the line or area being drawn. Returns false when there was nothing to drop. */
  cancelDrawing(): boolean {
    if (!this.drawing) return false;
    this.drawing = null;
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
    this.root.querySelector<HTMLElement>("#opt-kin")!.hidden = tool !== "fault";
    this.root.querySelector<HTMLElement>("#map-finish")!.hidden = !(tool === "contact" || tool === "fault" || tool === "polygon");
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
      if (!p.panning && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6) p.panning = true;
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
    if (this.tool === "erase") return this.erase(x, y);
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
    this.draw();
  }

  private sectionStart: [number, number] | null = null;

  /** The first click starts the line of the profile, the second ends it. A new line clears the profile drawn on the old one. */
  private sectionPoint(x: number, y: number): void {
    if (!this.sectionStart) {
      this.sectionStart = [x, y];
      this.say("Ahora el final de la línea del perfil.");
      return this.draw();
    }
    const [x1, y1] = this.sectionStart;
    this.sectionStart = null;
    if (Math.hypot(x - x1, y - y1) < 100) return this.say("La línea del perfil debe medir al menos 100 m.");
    const section = this.field.state.section;
    const drawn = section.polygons.length + section.lines.length;
    if (drawn && !window.confirm("Una línea nueva borra el perfil que dibujaste sobre la anterior. ¿Seguir?")) return this.draw();
    this.field.state.section = { line: { x1, y1, x2: x, y2: y }, polygons: [], lines: [], nextId: 1 };
    this.changed();
    this.say(`Perfil de ${Math.round(Math.hypot(x - x1, y - y1))} m trazado. Ábrelo con Abrir perfil (P).`);
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
    this.changed();
    this.renderSide();
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

    // The student's lines.
    for (const line of map.lines) this.stroke(path, line.points, line.kind, line.style);
    for (const line of map.lines) {
      if (line.kind !== "fault" || !line.kinematics) continue;
      const [mx, my] = midpoint(line.points);
      ctx.font = "italic 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.strokeText(KINEMATICS_NAMES[line.kinematics], sx(mx), sy(my) - 6);
      ctx.fillStyle = LINE_LOOK.fault.colour;
      ctx.fillText(KINEMATICS_NAMES[line.kinematics], sx(mx), sy(my) - 6);
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
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, 2 * Math.PI);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = "#7a1f1f";
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
