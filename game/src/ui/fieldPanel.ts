// The panel that opens at an outcrop: the field tools and the notebook page of that station.

import type { Outcrop } from "../format/types";
import type { Measurement, Note, Sample, Station } from "../state/state";
import { rockNames } from "../state/state";
import { formatLine, formatPlane } from "../tools/compass";
import {
  COST,
  type CompassReading,
  type Field,
  LINE_NAMES,
  PLANE_NAMES,
  checkWayUp,
  describeRock,
  inspectContact,
  measurable,
  readCompass,
  record,
  sampleTargets,
  samplesLeft,
  stationAt,
  takeSample,
} from "../tools/fieldwork";
import { PLANE_NOTATIONS, type PlaneNotation, angleBetweenLines, angleBetweenPlanes, parseLine, parsePlaneNumbers, parseQuadrant } from "../tools/notation";
import { drawCompass } from "./compassDial";
import { esc, when } from "./html";
import { drawLupa } from "./lupa";
import { photosHtml } from "./photos";

const NOTATION_SHORT: Record<NonNullable<Measurement["notation"]>, string> = {
  rhr: "rumbo/manteo, mano derecha",
  dipdir: "dirección de manteo/manteo",
  quadrant: "cuadrantes",
  trend_plunge: "dirección/inclinación",
};
/** How long the hammer swings before the lens comes out, in milliseconds. */
const HAMMER_MS = 950;

const TOOL_NAMES = { lens: "Martillo y lupa", way_up: "Polaridad", contact: "Contacto" } as const;

/** A measurement as the student wrote it, with the notation; older entries without one in the right-hand rule. */
export function measurementText(m: Measurement): string {
  const name = m.type === "plane" ? PLANE_NAMES[m.feature as keyof typeof PLANE_NAMES] : LINE_NAMES[m.feature as keyof typeof LINE_NAMES];
  if (m.entered && m.notation) return `${name ?? m.feature}: ${m.entered} (${NOTATION_SHORT[m.notation]})`;
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
  /** The compass reading on screen, waiting for the student to write it down. */
  private pending: CompassReading | null = null;
  private compassError = "";
  private hammering = false;

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
    /** Plays the hammer in the 3D view, with chips of the given colour. */
    private readonly hammer: (colour: string) => void = () => {},
  ) {
    root.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.target as HTMLElement).closest(".compass-entry")) (e.preventDefault(), this.annotate());
    });
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
    this.pending = null;
    this.compassError = "";
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

  /** The reading on screen, for the end-to-end test. */
  get pendingReading(): CompassReading | null {
    return this.pending;
  }

  private get free(): boolean {
    return this.field.state.mode === "free";
  }

  private cost(minutes: number): string {
    return this.free ? "" : ` <small>${minutes} min</small>`;
  }

  /** Reads what the student typed in the notation chosen, and writes it in the notebook. */
  annotate(): void {
    const reading = this.pending, outcrop = this.outcrop;
    if (!reading || !outcrop) return;
    const value = (id: string) => this.root.querySelector<HTMLInputElement>(`#${id}`)?.value ?? "";
    if (reading.type === "plane") {
      const notation = this.field.state.notation;
      const parsed = notation === "quadrant" ? parseQuadrant(value("c-text")) : parsePlaneNumbers(notation, value("c-first"), value("c-second"));
      if ("error" in parsed) return ((this.compassError = parsed.error), this.render());
      const text = notation === "quadrant" ? value("c-text").trim().toUpperCase() : `${value("c-first").trim()}/${value("c-second").trim()}`;
      record(this.field, outcrop, reading, { a: parsed.strike, b: parsed.dip, notation, text });
      const off = angleBetweenPlanes(parsed, { strike: reading.a, dip: reading.b });
      this.message = this.free && off > 6 ? `Anotado. Ojo: lo que escribiste se aparta ${Math.round(off)}° de lo que marca la brújula. ¿Revisaste la notación?` : "Anotado en la libreta.";
    } else {
      const parsed = parseLine(value("c-first"), value("c-second"));
      if ("error" in parsed) return ((this.compassError = parsed.error), this.render());
      record(this.field, outcrop, reading, { a: parsed.trend, b: parsed.plunge, notation: "trend_plunge", text: `${value("c-first").trim()}/${value("c-second").trim()}` });
      const off = angleBetweenLines(parsed, { trend: reading.a, plunge: reading.b });
      this.message = this.free && off > 6 ? `Anotado. Ojo: lo que escribiste se aparta ${Math.round(off)}° de lo que marca la brújula.` : "Anotado en la libreta.";
    }
    this.pending = null;
    this.compassError = "";
    this.changed();
    this.render();
  }

  private click(event: Event): void {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-do]");
    const outcrop = this.outcrop;
    if (!button || !outcrop) return;
    const action = button.dataset.do!;
    this.message = "";
    if (action === "close") return this.close();
    if (this.hammering) return;
    if (action === "lens") {
      // The hammer first, in the 3D view; the lens comes out when it is done.
      const unit = this.field.scenario.units.find((u) => u.key === outcrop.observation?.unit);
      this.hammer(unit?.colour ?? "#8d8d86");
      this.hammering = true;
      this.render();
      setTimeout(() => {
        this.hammering = false;
        if (this.outcrop !== outcrop) return;
        this.act(describeRock(this.field, outcrop).minutes);
      }, HAMMER_MS);
      return;
    }
    if (action === "annotate") return this.annotate();
    if (action === "discard") {
      this.pending = null;
      this.compassError = "";
      return this.render();
    }
    if (action === "way_up") return this.act(checkWayUp(this.field, outcrop).minutes);
    if (action === "contact") return this.act(inspectContact(this.field, outcrop).minutes);
    if (action === "measure") {
      const done = readCompass(this.field, outcrop, button.dataset.plane!, button.dataset.type as "plane" | "line");
      if (!done) return;
      this.pending = done.result;
      this.compassError = "";
      if (this.spend(done.minutes)) this.render();
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
        this.message = this.free
          ? `Muestra ${done.result.number} enviada al laboratorio. El resultado ya está en la libreta.`
          : `Muestra ${done.result.number} enviada al laboratorio. El resultado llega el próximo día de terreno.`;
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
    else if (target.name === "c-notation") {
      this.field.state.notation = target.value as PlaneNotation;
      this.compassError = "";
      this.changed();
      return this.render();
    } else return;
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
      .map((m) => `<button type="button" data-do="measure" data-plane="${esc(m.planeId)}" data-type="${m.type}">Medir ${esc(m.label)}${this.cost(COST.compass)}</button>`)
      .join("");
    const lens = [...station.notes].reverse().find((n) => n.tool === "lens");
    const unit = field.scenario.units.find((u) => u.key === obs?.unit);
    const entries = [
      ...station.notes.map((n) => ({ at: n.day * 10000 + n.minutes, html: noteHtml(n) })),
      ...station.measurements.map((m) => ({ at: m.day * 10000 + m.minutes, html: `<div class="entry"><b>Brújula</b> <small>${when(m.day, m.minutes)}</small><br>${esc(measurementText(m))}</div>` })),
    ].sort((a, b) => b.at - a.at);
    const focus = document.activeElement?.id;

    this.root.innerHTML = `
      <div class="head"><b>Estación ${station.number}</b> · E ${station.easting} · N ${station.northing} · ${station.elevation} m
        <button type="button" data-do="close" class="x" aria-label="Cerrar">Volver (Esc)</button></div>
      ${this.message ? `<p class="message">${esc(this.message)}</p>` : ""}
      ${this.pending ? this.compassHtml(this.pending) : ""}
      <h3>Herramientas</h3>
      <div class="tools">
        <button type="button" data-do="lens"${this.hammering ? " disabled" : ""}>${this.hammering ? "Golpeando la roca…" : "Martillo y lupa"}${this.cost(COST.lens)}</button>
        ${compass || (obs ? "" : "<p>Sin planos medibles.</p>")}
        <button type="button" data-do="way_up">Buscar criterios de polaridad${this.cost(COST.way_up)}</button>
        <button type="button" data-do="contact">Inspeccionar contacto${this.cost(COST.contact)}</button>
      </div>
      ${lens && unit && !this.hammering ? `<div class="lupa"><canvas id="lupa" width="240" height="240" aria-label="Vista con lupa"></canvas><div>${noteHtml(lens)}</div></div>${photosHtml(unit, ["hand_sample", "outcrop"], field.assetUrl)}` : ""}
      <h3>Muestra <small>${left === Infinity ? "sin límite" : `quedan ${left}`}</small></h3>
      ${
        targets.length && left > 0
          ? `<div class="tools"><select id="sample-target">${targets.map((t) => `<option value="${esc(t.unit)}">${esc(t.label)}</option>`).join("")}</select>
             <select id="sample-analysis"><option value="thin_section">corte delgado</option><option value="age">edad radiométrica</option></select>
             <button type="button" data-do="sample">Tomar muestra${this.cost(COST.sample)}</button></div>`
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
    const dial = this.root.querySelector<HTMLCanvasElement>("#compass-dial");
    if (dial && this.pending) {
      const p = this.pending;
      drawCompass(dial, p.type === "plane" ? { kind: "plane", azimuth: (p.a + 90) % 360, inclination: p.b } : { kind: "line", azimuth: p.a, inclination: p.b });
    }
    const lupa = this.root.querySelector<HTMLCanvasElement>("#lupa");
    if (lupa && unit) drawLupa(lupa, unit, outcrop.id);
    if (focus) this.root.querySelector<HTMLElement>(`#${focus}`)?.focus();
    else if (this.pending) this.root.querySelector<HTMLElement>(".compass-entry input:not([type=radio])")?.focus();
  }

  /** The compass on screen and the fields where the student writes the reading down. */
  private compassHtml(p: CompassReading): string {
    const name = p.type === "plane" ? PLANE_NAMES[p.feature as keyof typeof PLANE_NAMES] : LINE_NAMES[p.feature as keyof typeof LINE_NAMES];
    const notation = this.field.state.notation;
    const field = (id: string, label: string, placeholder: string) =>
      `<label>${label}<input id="${id}" inputmode="decimal" autocomplete="off" placeholder="${placeholder}"></label>`;
    let inputs: string;
    if (p.type === "line") inputs = `<div class="pair">${field("c-first", "Dirección (trend)", "085")}${field("c-second", "Inclinación (plunge)", "34")}</div>`;
    else if (notation === "quadrant") inputs = `<label>Rumbo y manteo<input id="c-text" autocomplete="off" placeholder="${PLANE_NOTATIONS.quadrant.example}"></label>`;
    else {
      const n = PLANE_NOTATIONS[notation];
      const [a, b] = n.example.split("/");
      inputs = `<div class="pair">${field("c-first", n.first!, a!)}${field("c-second", n.second!, b!)}</div>`;
    }
    const choices = (Object.keys(PLANE_NOTATIONS) as PlaneNotation[])
      .map((k) => `<label class="choice"><input type="radio" name="c-notation" value="${k}"${k === notation ? " checked" : ""}> ${PLANE_NOTATIONS[k].name}</label>`)
      .join("");
    return `<section class="compass-entry">
      <h3>Brújula: ${esc(name ?? p.feature)}</h3>
      <canvas id="compass-dial" width="720" height="380"></canvas>
      ${p.type === "plane" ? `<div class="choices">${choices}</div>` : ""}
      ${inputs}
      ${this.compassError ? `<p class="message">${esc(this.compassError)}</p>` : ""}
      <div class="tools"><button type="button" data-do="annotate">Anotar (Enter)</button><button type="button" data-do="discard">Descartar</button></div>
    </section>`;
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
