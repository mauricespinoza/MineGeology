// The panel that opens at an outcrop: the field tools and the notebook page of that station.

import type { Outcrop } from "../format/types";
import type { Measurement, Note, Sample, Station } from "../state/state";
import { rockNames } from "../state/state";
import { formatLine, formatPlane } from "../tools/compass";
import {
  COST,
  type Field,
  LINE_NAMES,
  PLANE_NAMES,
  checkWayUp,
  describeRock,
  inspectContact,
  measurable,
  measure,
  sampleTargets,
  samplesLeft,
  stationAt,
  takeSample,
} from "../tools/fieldwork";
import { esc, when } from "./html";

const TOOL_NAMES = { lens: "Martillo y lupa", way_up: "Polaridad", contact: "Contacto" } as const;

export function measurementText(m: Measurement): string {
  const name = m.type === "plane" ? PLANE_NAMES[m.feature as keyof typeof PLANE_NAMES] : LINE_NAMES[m.feature as keyof typeof LINE_NAMES];
  const value = m.type === "plane" ? formatPlane({ strike: m.a, dip: m.b }) : formatLine({ trend: m.a, plunge: m.b });
  return `${name ?? m.feature}: ${value}`;
}

export function noteHtml(n: Note): string {
  return `<div class="entry"><b>${TOOL_NAMES[n.tool]}</b> <small>${when(n.day, n.minutes)}</small><br>${n.lines.map(esc).join("<br>")}</div>`;
}

export class FieldPanel {
  private outcrop: Outcrop | null = null;
  private station: Station | null = null;
  private message = "";
  private drawing: number[] | null = null;

  /**
   * `spend` charges field minutes and reports whether the day goes on; `changed` is called after
   * anything is written in the notebook, so the caller can save.
   */
  constructor(
    private readonly root: HTMLElement,
    private readonly field: Field,
    private readonly spend: (minutes: number) => boolean,
    private readonly changed: () => void,
    private readonly close: () => void,
  ) {
    root.addEventListener("click", (e) => this.click(e));
    root.addEventListener("change", (e) => this.edit(e));
    root.addEventListener("pointerdown", (e) => this.stroke(e));
    root.addEventListener("pointermove", (e) => this.stroke(e));
    root.addEventListener("pointerup", (e) => this.stroke(e));
    root.addEventListener("pointercancel", (e) => this.stroke(e));
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(outcrop: Outcrop): void {
    this.outcrop = outcrop;
    this.station = stationAt(this.field, outcrop);
    this.message = "";
    this.root.hidden = false;
    this.changed();
    this.render();
  }

  hide(): void {
    this.root.hidden = true;
    this.outcrop = null;
  }

  private act(minutes: number): void {
    this.changed();
    if (this.spend(minutes)) this.render();
  }

  private click(event: Event): void {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-do]");
    const outcrop = this.outcrop;
    if (!button || !outcrop) return;
    const action = button.dataset.do!;
    this.message = "";
    if (action === "close") return this.close();
    if (action === "lens") return this.act(describeRock(this.field, outcrop).minutes);
    if (action === "way_up") return this.act(checkWayUp(this.field, outcrop).minutes);
    if (action === "contact") return this.act(inspectContact(this.field, outcrop).minutes);
    if (action === "measure") {
      const done = measure(this.field, outcrop, button.dataset.plane!, button.dataset.type as "plane" | "line");
      if (done) this.act(done.minutes);
      return;
    }
    if (action === "sample") {
      const unit = this.root.querySelector<HTMLSelectElement>("#sample-target")!.value;
      const analysis = this.root.querySelector<HTMLSelectElement>("#sample-analysis")!.value as Sample["analysis"];
      const done = takeSample(this.field, outcrop, unit, analysis);
      if (typeof done === "string") {
        this.message = done;
        this.render();
      } else {
        this.message = `Muestra ${done.result.number} enviada al laboratorio. El resultado llega el próximo día de terreno.`;
        this.act(done.minutes);
      }
      return;
    }
    if (action === "clear-sketch" && this.station) {
      this.station.sketch = [];
      this.changed();
      this.render();
    }
  }

  private edit(event: Event): void {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement;
    if (!this.station) return;
    if (target.id === "station-rock") this.station.rock = target.value.trim();
    else if (target.id === "station-text") this.station.text = target.value;
    else return;
    this.changed();
  }

  /** Free-hand sketch: strokes are stored as fractions of the sketch area. */
  private stroke(event: PointerEvent): void {
    const canvas = event.target as HTMLCanvasElement;
    if (canvas.id !== "station-sketch" || !this.station) return;
    const box = canvas.getBoundingClientRect();
    const x = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1);
    const y = Math.min(Math.max((event.clientY - box.top) / box.height, 0), 1);
    if (event.type === "pointerdown") {
      canvas.setPointerCapture(event.pointerId);
      this.drawing = [x, y];
      this.station.sketch.push(this.drawing);
    } else if (event.type === "pointermove" && this.drawing) {
      this.drawing.push(Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000);
      drawSketch(canvas, this.station.sketch);
    } else if (this.drawing) {
      this.drawing = null;
      this.changed();
    }
  }

  render(): void {
    const { outcrop, station, field } = this;
    if (!outcrop || !station) return;
    const obs = outcrop.observation;
    const targets = sampleTargets(field, outcrop);
    const left = samplesLeft(field);
    const names = rockNames(field.state);
    const compass = measurable(outcrop)
      .map((m) => `<button type="button" data-do="measure" data-plane="${esc(m.planeId)}" data-type="${m.type}">Medir ${esc(m.label)} <small>${COST.compass} min</small></button>`)
      .join("");
    const entries = [
      ...station.notes.map((n) => ({ at: n.day * 10000 + n.minutes, html: noteHtml(n) })),
      ...station.measurements.map((m) => ({ at: m.day * 10000 + m.minutes, html: `<div class="entry"><b>Brújula</b> <small>${when(m.day, m.minutes)}</small><br>${esc(measurementText(m))}</div>` })),
    ].sort((a, b) => b.at - a.at);
    const focus = document.activeElement?.id;

    this.root.innerHTML = `
      <div class="head"><b>Estación ${station.number}</b> · E ${station.easting} · N ${station.northing} · ${station.elevation} m
        <button type="button" data-do="close" class="x" aria-label="Cerrar">Volver (Esc)</button></div>
      ${this.message ? `<p class="message">${esc(this.message)}</p>` : ""}
      <h3>Herramientas</h3>
      <div class="tools">
        <button type="button" data-do="lens">Martillo y lupa <small>${COST.lens} min</small></button>
        ${compass || (obs ? "" : "<p>Sin planos medibles.</p>")}
        <button type="button" data-do="way_up">Buscar criterios de polaridad <small>${COST.way_up} min</small></button>
        <button type="button" data-do="contact">Inspeccionar contacto <small>${COST.contact} min</small></button>
      </div>
      <h3>Muestra <small>quedan ${left}</small></h3>
      ${
        targets.length && left > 0
          ? `<div class="tools"><select id="sample-target">${targets.map((t) => `<option value="${esc(t.unit)}">${esc(t.label)}</option>`).join("")}</select>
             <select id="sample-analysis"><option value="thin_section">corte delgado</option><option value="age">edad radiométrica</option></select>
             <button type="button" data-do="sample">Tomar muestra <small>${COST.sample} min</small></button></div>`
          : `<p>${left === 0 ? "No quedan muestras en esta campaña." : "La roca está demasiado meteorizada para muestrear."}</p>`
      }
      <h3>Libreta</h3>
      <label>¿Cómo llamas a esta roca?
        <input id="station-rock" list="rock-names" value="${esc(station.rock)}" placeholder="p. ej. andesita verde" autocomplete="off"></label>
      <datalist id="rock-names">${names.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
      <label>Notas<textarea id="station-text" rows="3" placeholder="Tus observaciones">${esc(station.text)}</textarea></label>
      <div class="sketch-head">Croquis <button type="button" data-do="clear-sketch">Borrar</button></div>
      <canvas id="station-sketch" width="360" height="220"></canvas>
      <div class="log">${entries.map((e) => e.html).join("") || "<p>Aún no hay observaciones en esta estación.</p>"}</div>`;
    drawSketch(this.root.querySelector<HTMLCanvasElement>("#station-sketch")!, station.sketch);
    if (focus) this.root.querySelector<HTMLElement>(`#${focus}`)?.focus();
  }
}

export function drawSketch(canvas: HTMLCanvasElement, strokes: number[][]): void {
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f6f1df";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#2b2b2b";
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "round";
  for (const stroke of strokes) {
    ctx.beginPath();
    for (let i = 0; i + 1 < stroke.length; i += 2) {
      const x = stroke[i]! * canvas.width, y = stroke[i + 1]! * canvas.height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    if (stroke.length === 2) ctx.lineTo(stroke[0]! * canvas.width + 0.5, stroke[1]! * canvas.height + 0.5);
    ctx.stroke();
  }
}
