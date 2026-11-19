// The panel that opens at an outcrop: the field tools and the notebook page of that station.

import type { Outcrop } from "../format/types";
import type { Measurement, Note, Sample, Station } from "../state/state";
import { rockNames } from "../state/state";
import { addUnit } from "../interpret/mapdata";
import { formatLine, formatPlane } from "../tools/compass";
import {
  COST,
  type CompassReading,
  POOR_OUTCROP,
  POOR_TOOLS,
  type Field,
  LINE_NAMES,
  PLANE_NAMES,
  checkWayUp,
  describeRock,
  inspectContact,
  lookForKinematics,
  measurable,
  readCompass,
  record,
  sampleTargets,
  samplesLeft,
  stationAt,
  takeSample,
  wellExposed,
} from "../tools/fieldwork";
import { PLANE_NOTATIONS, type PlaneNotation, angleBetweenLines, angleBetweenPlanes, parseLine, parsePlaneNumbers, parseQuadrant } from "../tools/notation";
import { drawCompass } from "./compassDial";
import { iconButton, labelledButton } from "./icons";
import { capture, esc, when } from "./html";
import { LUPA_CAPTION, lupaHtml, wireLupa } from "./lupa";
import { photosHtml } from "./photos";
import { SENSE_NAMES, kinematicSvg, sketchView } from "./kinematicSketch";

const NOTATION_SHORT: Record<NonNullable<Measurement["notation"]>, string> = {
  rhr: "rumbo/manteo, mano derecha",
  dipdir: "dirección de manteo/manteo",
  quadrant: "cuadrantes",
  trend_plunge: "dirección/inclinación",
};
/** How long the hammer swings before the lens comes out, in milliseconds. */
const HAMMER_MS = 950;

const TOOL_NAMES = { lens: "Martillo y lupa", way_up: "Polaridad", contact: "Contacto", kinematics: "Indicadores cinemáticos" } as const;

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
  /** The map unit of this station: the dot of the station takes its colour on the map and in the field. */
  private unitHtml(station: Station): string {
    const units = this.field.state.map.units;
    const current = units.find((u) => u.id === station.unit);
    const options = [`<option value="">(sin asignar)</option>`, ...units.map((u) => `<option value="${u.id}"${u.id === station.unit ? " selected" : ""}>${esc(u.name || "sin nombre")}</option>`)].join("");
    return `<div class="station-unit"><label>Unidad del mapa
        <span class="unit-pick"><i class="sw" style="background:${current ? esc(current.colour) : "transparent"}"></i><select id="station-unit">${options}</select></span></label>
      <div class="add"><input id="station-unit-new" placeholder="o una unidad nueva" autocomplete="off">${iconButton("add", "Crear la unidad y asignarla", 'data-do="unit-add"')}</div></div>`;
  }

  /** The indicator sketch and the sense the student reads from it, once they have looked. */
  private kinematicHtml(outcrop: Outcrop, station: Station): string {
    const k = outcrop.observation?.kinematic;
    if (!k || !station.notes.some((n) => n.tool === "kinematics")) return "";
    const plane = outcrop.observation!.planes.find((p) => p.id === k.plane);
    if (!plane) return "";
    const v = sketchView(k.sense, plane.strike, plane.dip);
    const options = (["", "normal", "reverse", "dextral", "sinistral", "unknown"] as const)
      .map((o) => `<option value="${o}"${(station.sense ?? "") === o ? " selected" : ""}>${o === "" ? "(elige)" : o === "unknown" ? "no lo puedo decidir" : SENSE_NAMES[o]}</option>`)
      .join("");
    let feedback = "";
    if (this.field.state.mode === "free" && station.sense && station.sense !== "unknown")
      feedback = station.sense === k.sense
        ? `<p class="message">Correcto: el movimiento es ${SENSE_NAMES[k.sense]}.</p>`
        : `<p class="message">Revisa el croquis: ese no es el sentido que muestran los indicadores. Fíjate hacia dónde se mueve el bloque de arriba.</p>`;
    return `<div class="kinematic-box">${kinematicSvg(k, plane.strike, plane.dip)}<p><small>${esc(v.caption)}</small></p>
      <label>Sentido de movimiento de la falla <select id="station-sense">${options}</select></label>${feedback}</div>`;
  }

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

  /**
   * Opens the station of an outcrop. With `lens`, the rock has just been hammered in the 3D view, so the panel
   * opens with the hand-lens description already written down.
   */
  open(outcrop: Outcrop, lens = false): void {
    this.outcrop = outcrop;
    this.station = stationAt(this.field, outcrop);
    this.message = "";
    this.pending = null;
    this.compassError = "";
    this.hammering = false;
    this.root.hidden = false;
    this.root.scrollTop = 0;
    this.changed();
    if (lens) this.act(describeRock(this.field, outcrop).minutes);
    else this.render();
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
    if (action === "lens") {
      if (this.hammering) return;
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
    if (action === "kinematics") return this.act(lookForKinematics(this.field, outcrop).minutes);
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
    if (action === "unit-add" && this.station) {
      const input = this.root.querySelector<HTMLInputElement>("#station-unit-new")!;
      const name = input.value.trim() || this.station.rock;
      if (!name) {
        this.message = "Escribe el nombre de la unidad nueva (o primero cómo llamas a la roca).";
        return this.render();
      }
      const map = this.field.state.map;
      const unit = map.units.find((u) => u.name.toLowerCase() === name.toLowerCase()) ?? addUnit(map, name);
      this.station.unit = unit.id;
      this.message = "";
      this.changed();
      return this.render();
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
    else if (target.id === "station-unit") {
      this.station.unit = target.value ? Number(target.value) : undefined;
      this.changed();
      return this.render();
    } else if (target.id === "station-sense") {
      this.station.sense = target.value ? (target.value as NonNullable<Station["sense"]>) : undefined;
      this.changed();
      return this.render();
    }
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
      capture(canvas, event.pointerId);
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
    const good = wellExposed(outcrop);
    const targets = sampleTargets(field, outcrop);
    const left = samplesLeft(field);
    const names = rockNames(field.state);
    const compass = measurable(outcrop)
      .map((m) => labelledButton("compass", `Medir ${esc(m.label)}${this.cost(COST.compass)}`, `data-do="measure" data-plane="${esc(m.planeId)}" data-type="${m.type}"`))
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
        ${iconButton("close", "Volver (Esc)", 'data-do="close" class="x"')}</div>
      ${this.message ? `<p class="message">${esc(this.message)}</p>` : ""}
      ${this.pending ? this.compassHtml(this.pending) : ""}
      <h3>Herramientas</h3>
      ${good ? "" : `<p class="message poor">${esc(POOR_OUTCROP)} ${esc(POOR_TOOLS)}</p>`}
      <div class="tools">
        ${labelledButton("hammer", `${this.hammering ? "Golpeando la roca…" : "Martillo y lupa"}${this.cost(COST.lens)}`, `data-do="lens"${this.hammering ? " disabled" : ""}`)}
        ${good ? `${compass || (obs ? "<p>Sin planos medibles.</p>" : "")}
        ${labelledButton("wayUp", `Polaridad${this.cost(COST.way_up)}`, 'data-do="way_up"', "Buscar criterios de polaridad")}
        ${labelledButton("inspect", `Contacto${this.cost(COST.contact)}`, 'data-do="contact"', "Inspeccionar contacto")}
        ${labelledButton("kinematics", `Indicadores cinemáticos${this.cost(COST.kinematics)}`, 'data-do="kinematics"', "Buscar indicadores cinemáticos")}` : ""}
      </div>
      ${this.kinematicHtml(outcrop, station)}
      ${lens && unit && !this.hammering ? `<div class="lupa">${lupaHtml("lupa")}<div>${noteHtml(lens)}</div></div>${photosHtml(unit, ["hand_sample", "outcrop"], field.assetUrl)}` : ""}
      <h3>Muestra <small>${left === Infinity ? "sin límite" : `quedan ${left}`}</small></h3>
      ${
        targets.length && left > 0
          ? `<div class="tools"><select id="sample-target">${targets.map((t) => `<option value="${esc(t.unit)}">${esc(t.label)}</option>`).join("")}</select>
             <select id="sample-analysis"><option value="thin_section">corte delgado</option><option value="age">edad radiométrica</option></select>
             ${labelledButton("sample", `Tomar muestra${this.cost(COST.sample)}`, 'data-do="sample"')}</div>`
          : `<p>${left === 0 ? "No quedan muestras en esta campaña." : "La roca está demasiado meteorizada para muestrear."}</p>`
      }
      <h3>Libreta</h3>
      <label>¿Cómo llamas a esta roca?
        <input id="station-rock" list="rock-names" value="${esc(station.rock)}" placeholder="p. ej. andesita verde" autocomplete="off"></label>
      <datalist id="rock-names">${names.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
      ${this.unitHtml(station)}
      <label>Notas<textarea id="station-text" rows="3" placeholder="Tus observaciones">${esc(station.text)}</textarea></label>
      <div class="sketch-head">Croquis ${iconButton("trash", "Borrar el croquis", 'data-do="clear-sketch"')}</div>
      <canvas id="station-sketch" width="360" height="220"></canvas>
      <div class="log">${entries.map((e) => e.html).join("") || "<p>Aún no hay observaciones en esta estación.</p>"}</div>`;
    drawSketch(this.root.querySelector<HTMLCanvasElement>("#station-sketch")!, station.sketch);
    const dial = this.root.querySelector<HTMLCanvasElement>("#compass-dial");
    if (dial && this.pending) {
      const p = this.pending;
      drawCompass(dial, p.type === "plane" ? { kind: "plane", azimuth: (p.a + 90) % 360, inclination: p.b } : { kind: "line", azimuth: p.a, inclination: p.b });
    }
    if (unit) wireLupa(this.root, "lupa", unit, outcrop.id, LUPA_CAPTION);
    // Only the field the student was typing in gets the focus back: opening the compass must not pop up a keyboard.
    if (focus) this.root.querySelector<HTMLElement>(`#${focus}`)?.focus();
  }

  /** The compass on screen and the fields where the student writes the reading down. */
  private compassHtml(p: CompassReading): string {
    const name = p.type === "plane" ? PLANE_NAMES[p.feature as keyof typeof PLANE_NAMES] : LINE_NAMES[p.feature as keyof typeof LINE_NAMES];
    const notation = this.field.state.notation;
    const field = (id: string, label: string, placeholder: string) =>
      `<label>${label}<input id="${id}" inputmode="decimal" autocomplete="off" placeholder="${placeholder}"></label>`;
    let inputs: string;
    // The placeholders show the form of the answer, never numbers that could pass for a reading.
    if (p.type === "line") inputs = `<div class="pair">${field("c-first", "Dirección (trend)", "000 a 359")}${field("c-second", "Inclinación (plunge)", "0 a 90")}</div>`;
    else if (notation === "quadrant") inputs = `<label>Rumbo y manteo<input id="c-text" autocomplete="off" placeholder="N__E/__SE"></label>`;
    else {
      const n = PLANE_NOTATIONS[notation];
      inputs = `<div class="pair">${field("c-first", n.first!, "000 a 359")}${field("c-second", n.second!, "0 a 90")}</div>`;
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
      <div class="tools">${labelledButton("check", "Anotar", 'data-do="annotate" class="primary"', "Anotar (Enter)")}${labelledButton("close", "Descartar", 'data-do="discard"')}</div>
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
