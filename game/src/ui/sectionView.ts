// The cross-section screen: the ground along the student's line, their stations projected onto it with the
// apparent dip, the map's units at the surface, and the tools to draw the units and faults at depth.

import { type LineStyle, type MapState, STYLE_NAMES, nearestFeature, removeFeature, unitAt } from "../interpret/mapdata";
import { type SectionState, along, profile, projectStations, sectionAzimuth, sectionLength } from "../interpret/section";
import { FEATURE_COLOURS } from "../interpret/stereonet";
import { DASH, LINE_LOOK } from "../interpret/symbols";
import { isTyping } from "../explore/controls";
import type { Field } from "../tools/fieldwork";
import type { Grid } from "../world/blocks";
import { esc } from "./html";
import { type IconName, iconButton } from "./icons";

type Tool = "polygon" | "contact" | "fault" | "erase";
const TOOLS: [Tool, string, IconName][] = [["polygon", "Área", "area"], ["contact", "Contacto", "contact"], ["fault", "Falla", "fault"], ["erase", "Borrar", "erase"]];
const HINTS: Record<Tool, string> = {
  polygon: "Área: marca los vértices del cuerpo y ciérralo sobre el primer punto o con ✓. Se pinta con la unidad elegida.",
  contact: "Contacto: marca los puntos del contacto en profundidad; termina con ✓, Enter o doble clic.",
  fault: "Falla: marca los puntos de la falla; termina con ✓, Enter o doble clic.",
  erase: "Borrar: toca una línea o un cuerpo. Deshacer lo recupera.",
};
const WINDS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];

export class SectionView {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private tool: Tool = "polygon";
  private style: LineStyle = "solid";
  private unit: number | null = null;
  private exaggeration = 1;
  private drawing: { tool: Exclude<Tool, "erase">; points: number[] } | null = null;
  private hover: [number, number] | null = null;
  private undo: string[] = [];
  private view = { left: 60, bottom: 0, sx: 1, sy: 1, zmin: 0 };

  constructor(
    private readonly root: HTMLElement,
    private readonly field: Field,
    private readonly grid: Grid,
    private readonly changed: () => void,
    private readonly close: () => void,
  ) {
    root.innerHTML = `
      <canvas id="section-canvas"></canvas>
      <div class="panel toolbar" id="section-toolbar" role="toolbar" aria-label="Herramientas del perfil">
        ${TOOLS.map(([id, name, ic]) => iconButton(ic, name, `data-stool="${id}"`)).join("")}
        <label class="opt"><span class="opt-name">Unidad</span> <select id="section-unit" aria-label="Unidad"></select></label>
        <label id="section-style-box" class="opt"><span class="opt-name">Trazo</span> <select id="section-style" aria-label="Trazo">${(Object.keys(STYLE_NAMES) as LineStyle[]).map((s) => `<option value="${s}">${STYLE_NAMES[s]}</option>`).join("")}</select></label>
        ${iconButton("check", "Terminar (Enter)", 'id="section-finish" class="accent"')}
        ${iconButton("undo", "Deshacer (Ctrl+Z)", 'id="section-undo"')}
        <span class="sep"></span>
        <label class="opt" title="Exageración vertical"><span class="opt-name">Exageración vertical</span> <select id="section-ve" aria-label="Exageración vertical"><option value="1">1×</option><option value="2">2×</option><option value="3">3×</option></select></label>
      </div>
      ${iconButton("close", "Volver (P)", 'id="section-close" class="panel close-fixed"')}
      <div class="panel" id="section-hint"></div>
      <div class="panel" id="section-empty" hidden>Traza primero la línea del perfil en el mapa: herramienta <b>Línea del perfil</b>, dos toques.</div>`;
    this.canvas = root.querySelector("#section-canvas")!;
    this.ctx = this.canvas.getContext("2d")!;
    const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
    root.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-stool]")?.dataset.stool as Tool | undefined;
      if (t) this.setTool(t);
    });
    $<HTMLSelectElement>("#section-unit").onchange = (e) => (this.unit = Number((e.target as HTMLSelectElement).value));
    $<HTMLSelectElement>("#section-style").onchange = (e) => (this.style = (e.target as HTMLSelectElement).value as LineStyle);
    $<HTMLSelectElement>("#section-ve").onchange = (e) => ((this.exaggeration = Number((e.target as HTMLSelectElement).value)), this.draw());
    $("#section-finish").onclick = () => this.finish();
    $("#section-undo").onclick = () => this.undoLast();
    $("#section-close").onclick = () => this.close();
    this.canvas.addEventListener("click", (e) => this.click(e));
    this.canvas.addEventListener("dblclick", () => this.doubleClick());
    this.canvas.addEventListener("mousemove", (e) => ((this.hover = this.toSection(e.clientX, e.clientY)), this.drawing && this.draw()));
    window.addEventListener("resize", () => this.isOpen && this.draw());
    window.addEventListener("keydown", (e) => {
      if (!this.isOpen) return;
      const typing = isTyping(e.target);
      if (e.code === "Enter" && !typing && this.drawing) (e.preventDefault(), this.finish());
      if (e.code === "KeyZ" && (e.ctrlKey || e.metaKey) && !typing) (e.preventDefault(), this.undoLast());
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  private get section(): SectionState {
    return this.field.state.section;
  }

  open(): void {
    this.root.hidden = false;
    const units = this.field.state.map.units;
    if (!units.some((u) => u.id === this.unit)) this.unit = units[0]?.id ?? null;
    this.root.querySelector<HTMLSelectElement>("#section-unit")!.innerHTML = units.length
      ? units.map((u) => `<option value="${u.id}"${u.id === this.unit ? " selected" : ""}>${esc(u.name)}</option>`).join("")
      : `<option value="">(crea unidades en el mapa)</option>`;
    this.root.querySelector<HTMLElement>("#section-empty")!.hidden = !!this.section.line;
    this.setTool(this.tool);
  }

  hide(): void {
    this.root.hidden = true;
    this.drawing = null;
  }

  cancelDrawing(): boolean {
    if (!this.drawing) return false;
    this.drawing = null;
    this.draw();
    return true;
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    this.drawing = null;
    for (const b of Array.from(this.root.querySelectorAll<HTMLElement>("[data-stool]"))) b.setAttribute("aria-pressed", String(b.dataset.stool === tool));
    this.root.querySelector<HTMLElement>("#section-style-box")!.hidden = !(tool === "contact" || tool === "fault");
    this.root.querySelector<HTMLElement>("#section-finish")!.hidden = tool === "erase";
    this.root.querySelector("#section-hint")!.textContent = HINTS[tool];
    this.draw();
  }

  private snapshot(): void {
    this.undo.push(JSON.stringify(this.section));
    if (this.undo.length > 60) this.undo.shift();
  }

  private undoLast(): void {
    const last = this.undo.pop();
    if (!last) return;
    this.field.state.section = JSON.parse(last);
    this.drawing = null;
    this.changed();
    this.draw();
  }

  /** Where a point of the section (distance along the line, elevation) is on the screen; for tests. */
  toScreen(d: number, z: number): [number, number] {
    const v = this.view;
    return [v.left + d * v.sx, v.bottom - (z - v.zmin) * v.sy];
  }

  private toSection(sx: number, sy: number): [number, number] {
    const v = this.view;
    return [(sx - v.left) / v.sx, v.zmin + (v.bottom - sy) / v.sy];
  }

  private click(e: MouseEvent): void {
    if (!this.section.line) return;
    const [d, z] = this.toSection(e.clientX, e.clientY);
    if (this.tool === "erase") {
      const hit = nearestFeature(this.section as unknown as MapState, d, z, 10 / this.view.sx);
      if (!hit) return;
      this.snapshot();
      removeFeature(this.section as unknown as MapState, hit);
      this.changed();
      return this.draw();
    }
    if (!this.drawing) this.drawing = { tool: this.tool, points: [] };
    const p = this.drawing.points;
    if (this.drawing.tool === "polygon" && p.length >= 6 && Math.hypot((d - p[0]!) * this.view.sx, (z - p[1]!) * this.view.sy) < 12) return this.finish();
    p.push(d, z);
    this.draw();
  }

  private doubleClick(): void {
    const d = this.drawing;
    if (!d) return;
    const n = d.points.length;
    if (n >= 4 && Math.hypot((d.points[n - 2]! - d.points[n - 4]!) * this.view.sx, (d.points[n - 1]! - d.points[n - 3]!) * this.view.sy) < 8) d.points.length = n - 2;
    this.finish();
  }

  private finish(): void {
    const d = this.drawing;
    if (!d) return;
    const need = d.tool === "polygon" ? 3 : 2;
    if (d.points.length / 2 < need) return;
    if (d.tool === "polygon" && this.unit === null) {
      this.root.querySelector("#section-hint")!.textContent = "Crea primero las unidades en el mapa.";
      return;
    }
    this.snapshot();
    const s = this.section;
    if (d.tool === "polygon") s.polygons.push({ id: s.nextId++, unit: this.unit!, points: d.points });
    else s.lines.push({ id: s.nextId++, kind: d.tool, style: this.style, points: d.points });
    this.drawing = null;
    this.changed();
    this.draw();
  }

  draw(): void {
    if (!this.isOpen) return;
    const { canvas, ctx } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth, H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#cfe0ea";
    ctx.fillRect(0, 0, W, H);
    const line = this.section.line;
    if (!line) return;

    const { state, scenario } = this.field;
    const ground = profile(this.grid, line, 10);
    const length = sectionLength(line);
    const z0 = scenario.manifest.grid.origin.elevation;
    let top = -Infinity;
    for (let i = 1; i < ground.length; i += 2) top = Math.max(top, ground[i]!);
    top += 60;
    const toolbar = this.root.querySelector<HTMLElement>("#section-toolbar")!.offsetHeight;
    const left = 60, right = 20, upper = toolbar + 30, lower = 70;
    const sx = (W - left - right) / length;
    let sy = sx * this.exaggeration;
    if ((top - z0) * sy > H - upper - lower) sy = (H - upper - lower) / (top - z0); // keep it on screen
    this.view = { left, bottom: H - lower, sx, sy, zmin: z0 };
    const X = (d: number) => left + d * sx, Y = (z: number) => H - lower - (z - z0) * sy;

    // Rock below the ground.
    ctx.beginPath();
    ctx.moveTo(X(0), Y(z0));
    for (let i = 0; i < ground.length; i += 2) ctx.lineTo(X(ground[i]!), Y(ground[i + 1]!));
    ctx.lineTo(X(length), Y(z0));
    ctx.closePath();
    ctx.fillStyle = "#efe6cf";
    ctx.fill();
    ctx.save();
    ctx.clip();
    const units = new Map(state.map.units.map((u) => [u.id, u]));
    for (const p of this.section.polygons) {
      ctx.beginPath();
      for (let i = 0; i < p.points.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(p.points[i]!), Y(p.points[i + 1]!));
      ctx.closePath();
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = units.get(p.unit)?.colour ?? "#ccc";
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    ctx.restore();

    // Grid and axes.
    ctx.strokeStyle = "rgba(60,80,110,0.25)";
    ctx.fillStyle = "#1d2a3a";
    ctx.font = "11px system-ui, sans-serif";
    ctx.lineWidth = 1;
    for (let z = Math.ceil(z0 / 100) * 100; z <= top; z += 100) {
      ctx.beginPath(); ctx.moveTo(X(0), Y(z)); ctx.lineTo(X(length), Y(z)); ctx.stroke();
      ctx.textAlign = "right";
      ctx.fillText(`${z} m`, left - 6, Y(z) + 4);
    }
    for (let d = 0; d <= length; d += 250) {
      ctx.beginPath(); ctx.moveTo(X(d), Y(z0)); ctx.lineTo(X(d), Y(top)); ctx.stroke();
      ctx.textAlign = "center";
      ctx.fillText(`${d} m`, X(d), H - lower + 16);
    }
    const az = sectionAzimuth(line);
    ctx.font = "bold 14px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(WINDS[Math.round(((az + 180) % 360) / 45) % 8]!, X(0), upper - 8);
    ctx.textAlign = "right";
    ctx.fillText(WINDS[Math.round(az / 45) % 8]!, X(length), upper - 8);
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "center";
    const ve = sy / sx;
    ctx.fillText(`Rumbo del perfil ${String(Math.round(az)).padStart(3, "0")}° · exageración vertical ${ve.toFixed(1).replace(".", ",")}×`, W / 2, H - lower + 34);

    // The map's units at the surface, as a strip on the ground.
    const step = Math.max(length / 400, 2);
    for (let d = 0; d < length; d += step) {
      const [x, y] = along(line, d + step / 2);
      const u = units.get(unitAt(state.map, x, y));
      if (!u) continue;
      const i = Math.min(Math.round((d + step / 2) / 10) * 2, ground.length - 2);
      ctx.fillStyle = u.colour;
      ctx.fillRect(X(d), Y(ground[i + 1]!) - 7, step * sx + 0.5, 6);
    }
    ctx.strokeStyle = "#3b2a17";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < ground.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(ground[i]!), Y(ground[i + 1]!));
    ctx.stroke();

    // The student's lines.
    const stroke = (points: number[], kind: "contact" | "fault", style: LineStyle) => {
      const look = LINE_LOOK[kind];
      ctx.beginPath();
      for (let i = 0; i < points.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(points[i]!), Y(points[i + 1]!));
      ctx.strokeStyle = look.colour;
      ctx.lineWidth = look.width;
      ctx.setLineDash(DASH[style].map((v) => v * look.width));
      ctx.stroke();
      ctx.setLineDash([]);
    };
    for (const l of this.section.lines) stroke(l.points, l.kind, l.style);

    // Stations within 150 m of the line, with the apparent dip of each mean plane.
    for (const s of projectStations(state.stations, scenario.manifest, line, 150)) {
      const x = X(s.d), y = Y(s.z);
      for (const p of s.planes) {
        const angle = Math.atan(Math.tan((p.apparent * Math.PI) / 180) * ve);
        ctx.strokeStyle = FEATURE_COLOURS[p.feature] ?? "#111";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(angle) * 22, y - Math.sin(angle) * 22);
        ctx.lineTo(x + Math.cos(angle) * 22, y + Math.sin(angle) * 22);
        ctx.stroke();
      }
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#7a1f1f";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#7a1f1f";
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(String(s.number), x + 6, y - 8);
    }

    const d = this.drawing;
    if (d) {
      const pts = this.hover ? [...d.points, ...this.hover] : d.points;
      if (d.tool === "polygon") {
        ctx.beginPath();
        for (let i = 0; i < pts.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(pts[i]!), Y(pts[i + 1]!));
        ctx.closePath();
        ctx.fillStyle = (units.get(this.unit ?? -1)?.colour ?? "#cccccc") + "66";
        if (pts.length >= 6) ctx.fill();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = "#111";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      } else stroke(pts, d.tool, this.style);
      for (let i = 0; i < d.points.length; i += 2) {
        ctx.beginPath();
        ctx.arc(X(d.points[i]!), Y(d.points[i + 1]!), 3.5, 0, 2 * Math.PI);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.strokeStyle = "#111";
        ctx.stroke();
      }
    }
  }
}

