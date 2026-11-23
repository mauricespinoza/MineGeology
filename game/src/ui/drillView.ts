// The drill-hole sheet: plan a hole from where the student stands (or anywhere, in free mode), drill it, and read
// the core logs drawn side by side at their true elevations, for correlation between holes.
//
// Campaign mode: each hole costs money from a fixed budget and field time to set up the rig and log the core,
// and the core is described as the hand lens shows it; the student names the units. Free mode: no cost, no
// time, collars anywhere, and, where the solutions can be seen, the model's units by name and age.

import { remaining } from "../explore/clock";
import type { Manifest, Unit } from "../format/types";
import {
  DRILL, type DrillHole, type DrillState, affordableLength, drillCsv, elevationAt, emptyDrill, holeCost, holeMinutes, holeName, lengthInBlock, logHole,
} from "../interpret/drill";
import { showsAnswers } from "../state/difficulty";
import type { Field } from "../tools/fieldwork";
import { type Grid, surfaceElevation } from "../world/blocks";
import { esc, when } from "./html";
import { iconButton, labelledButton } from "./icons";
import { download } from "./notebook";

const usd = (v: number) => `US$ ${Math.round(v).toLocaleString("es-CL")}`;
const num = (v: number, d = 0) => v.toLocaleString("es-CL", { minimumFractionDigits: d, maximumFractionDigits: d });

export interface DrillContext {
  /** Where the student stands now, local metres, and where they look. */
  position: () => { x: number; y: number; heading: number };
  /** Spends field time in campaign mode; false when the day ended. */
  charge: (minutes: number) => boolean;
  changed: () => void;
  close: () => void;
  /** Opens the 3D model centred on a hole. */
  show3d: (holeId: number) => void;
}

export class DrillView {
  private plan = { x: 0, y: 0, azimuth: 0, inclination: 90, length: 150, custom: false };
  private selected: number | null = null;
  private message = "";

  constructor(
    private readonly root: HTMLElement,
    private readonly field: Field,
    private readonly grid: Grid,
    /** The model's lithology block; without it (graded bundles) there is nothing to drill into. */
    private readonly litho: Uint8Array | null,
    private readonly ctx: DrillContext,
  ) {
    root.addEventListener("click", (e) => this.click(e));
    root.addEventListener("change", (e) => this.edit(e));
    root.addEventListener("input", (e) => this.input(e));
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  hide(): void {
    this.root.hidden = true;
  }

  get drill(): DrillState {
    return (this.field.state.drill ??= emptyDrill());
  }

  private get manifest(): Manifest {
    return this.field.scenario.manifest;
  }

  private get free(): boolean {
    return this.field.state.mode === "free";
  }

  private get answers(): boolean {
    return showsAnswers(this.field.state) && !!this.field.truth;
  }

  /** Opens the sheet; a collar picked elsewhere (the 3D view, free mode) replaces the student's position. */
  open(collar?: { x: number; y: number }): void {
    const here = this.ctx.position();
    if (collar && this.free) Object.assign(this.plan, { x: collar.x, y: collar.y, custom: true });
    else if (!this.plan.custom || !this.free) Object.assign(this.plan, { x: here.x, y: here.y, azimuth: Math.round(here.heading) % 360 });
    this.message = "";
    this.root.hidden = false;
    this.render();
  }

  private unit(key: string): Unit | undefined {
    return this.field.scenario.units.find((u) => u.key === key);
  }

  /** What the log calls an interval: the model's unit with its age where answers show, otherwise the rock. */
  private label(key: string, dyke?: string): string {
    const unit = this.unit(key);
    if (this.answers) {
      const t = this.field.truth!.units.find((u) => u.key === key);
      return `${t?.name ?? unit?.lithology ?? key}${dyke ? " (dique)" : ""}`;
    }
    return unit ? unit.lithology : key;
  }

  private collarZ(): number {
    return surfaceElevation(this.grid, this.plan.x, this.plan.y);
  }

  /** The hole as planned, and why it cannot be drilled, if it cannot. */
  private check(): { length: number; cost: number; minutes: number; inBlock: number; problem: string | null } {
    const p = this.plan;
    const inBlock = lengthInBlock(this.manifest, p.x, p.y, this.collarZ(), p.azimuth, p.inclination);
    const length = Math.min(p.length, inBlock);
    const cost = this.free ? 0 : holeCost(length), minutes = this.free ? 0 : holeMinutes(length);
    const g = this.manifest.grid;
    let problem: string | null = null;
    if (!this.litho) problem = "Este escenario no trae el bloque del modelo: no hay sondajes.";
    else if (p.x < 0 || p.y < 0 || p.x > g.nx * g.cell_size_m.x || p.y > g.ny * g.cell_size_m.y) problem = "El collar queda fuera del área.";
    else if (this.field.state.flight.on && this.field.state.flight.height > 3 && !this.plan.custom) problem = "Aterriza para instalar la sonda.";
    else if (length < DRILL.minLength) problem = `El sondaje sale del bloque del modelo antes de ${DRILL.minLength} m: cambia la inclinación o el azimut.`;
    else if (!this.free) {
      const rules = this.manifest.rules;
      const left = rules.minutes_per_day - this.field.state.clock.minutes;
      if (cost > DRILL.budget - this.drill.spent) problem = `No alcanza el presupuesto: cuesta ${usd(cost)} y quedan ${usd(DRILL.budget - this.drill.spent)} (hasta ${affordableLength(this.drill.spent)} m).`;
      else if (minutes > left) problem = `No alcanza el día: instalar la sonda y describir el testigo toma ${minutes} min y quedan ${remaining(this.field.state.clock, rules)}.`;
    }
    return { length, cost, minutes, inBlock, problem };
  }

  private drillNow(): void {
    const c = this.check();
    if (c.problem || !this.litho) return ((this.message = c.problem ?? ""), this.render());
    const p = this.plan, d = this.drill, state = this.field.state;
    const z = this.collarZ();
    const shape = { x: p.x, y: p.y, z, azimuth: p.azimuth, inclination: p.inclination, length: c.length };
    const intervals = logHole(this.litho, this.manifest, this.field.scenario.units, shape, this.field.truth?.dykes ?? [], this.grid);
    const hole: DrillHole = { id: d.nextId++, name: "", ...shape, cost: c.cost, day: state.clock.day, minutes: state.clock.minutes, intervals };
    hole.name = holeName(hole.id);
    d.holes.push(hole);
    d.spent += c.cost;
    this.selected = hole.id;
    this.message = `${hole.name} perforado: ${num(hole.length)} m${this.free ? "" : `, ${usd(c.cost)} y ${c.minutes} min`}.`;
    this.ctx.changed();
    const still = this.ctx.charge(c.minutes);
    if (still) this.render();
  }

  private click(e: Event): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-do]");
    if (!el) return;
    const action = el.dataset.do!, id = Number(el.dataset.id);
    if (action === "close") return this.ctx.close();
    if (action === "drill") return this.drillNow();
    if (action === "here") {
      const here = this.ctx.position();
      Object.assign(this.plan, { x: here.x, y: here.y, custom: false });
    } else if (action === "select") this.selected = this.selected === id ? null : id;
    else if (action === "remove") {
      const d = this.drill, i = d.holes.findIndex((h) => h.id === id);
      if (i < 0 || !this.free) return;
      d.holes.splice(i, 1);
      if (this.selected === id) this.selected = null;
      this.ctx.changed();
    } else if (action === "view3d") return this.ctx.show3d(id);
    else if (action === "csv") return this.exportCsv();
    else return;
    this.render();
  }

  private input(e: Event): void {
    const el = e.target as HTMLInputElement;
    const key = el.dataset.plan as keyof DrillView["plan"] | undefined;
    if (!key) return;
    const o = this.manifest.grid.origin;
    const v = Number(el.value);
    if (!Number.isFinite(v)) return;
    if (key === "x") Object.assign(this.plan, { x: v - o.easting, custom: true });
    else if (key === "y") Object.assign(this.plan, { y: v - o.northing, custom: true });
    else if (key === "azimuth") this.plan.azimuth = ((Math.round(v) % 360) + 360) % 360;
    else if (key === "inclination") this.plan.inclination = Math.min(Math.max(Math.round(v), DRILL.minInclination), 90);
    else if (key === "length") this.plan.length = Math.min(Math.max(Math.round(v), DRILL.minLength), DRILL.maxLength);
    const box = this.root.querySelector<HTMLElement>("#drill-preview");
    if (box) box.innerHTML = this.preview();
    const go = this.root.querySelector<HTMLButtonElement>('[data-do="drill"]');
    if (go) go.disabled = !!this.check().problem;
  }

  private edit(e: Event): void {
    const el = e.target as HTMLSelectElement;
    if (el.dataset.interval === undefined) return;
    const hole = this.drill.holes.find((h) => h.id === Number(el.dataset.hole));
    const r = hole?.intervals[Number(el.dataset.interval)];
    if (!r) return;
    if (el.value === "") delete r.mapUnit;
    else r.mapUnit = Number(el.value);
    this.ctx.changed();
    this.render();
  }

  private exportCsv(): void {
    const units = this.field.state.map.units;
    const text = drillCsv(this.drill.holes, this.manifest, (key) => this.label(key), (id) => units.find((u) => u.id === id)?.name ?? "");
    download(`sondajes-${this.manifest.scenario_id}-${this.manifest.variant}.csv`, text, "text/csv");
  }

  private preview(): string {
    const c = this.check();
    const p = this.plan, z = this.collarZ();
    const end = z - c.length * Math.sin((p.inclination * Math.PI) / 180);
    const parts = [`Collar a ${num(z)} m s.n.m.; el fondo queda a ${num(end)} m s.n.m.`];
    if (c.length < p.length) parts.push(`El bloque del modelo termina a ${num(c.inBlock)} m: se perforan ${num(c.length)} m.`);
    if (!this.free) parts.push(`Costo: <b>${usd(c.cost)}</b> (${usd(DRILL.mobilisation)} de instalación + ${usd(DRILL.perMetre)}/m) · tiempo: <b>${c.minutes} min</b>.`);
    if (c.problem) parts.push(`<span class="drill-problem">${esc(c.problem)}</span>`);
    return parts.map((t) => `<div>${t}</div>`).join("");
  }

  private render(): void {
    const d = this.drill, o = this.manifest.grid.origin, p = this.plan;
    const c = this.check();
    const budget = this.free
      ? `<p class="drill-budget free">Modo libre: sondajes sin costo ni tiempo, con el collar donde quieras.</p>`
      : `<p class="drill-budget">Presupuesto: <b>${usd(DRILL.budget - d.spent)}</b> disponibles de ${usd(DRILL.budget)} <span class="bar"><i style="width:${Math.min((100 * d.spent) / DRILL.budget, 100).toFixed(1)}%"></i></span></p>`;
    const coord = (key: "x" | "y", value: number) =>
      this.free
        ? `<input type="number" step="10" data-plan="${key}" value="${Math.round(value)}">`
        : `<input type="number" value="${Math.round(value)}" readonly title="En modo campaña la sonda se instala donde estás">`;
    const form = this.litho
      ? `<h3>Nuevo sondaje <small>${this.free ? "elige el collar o usa tu posición" : "se instala donde estás"}</small></h3>
        <div class="drill-form">
          <label>Este (m)${coord("x", o.easting + p.x)}</label>
          <label>Norte (m)${coord("y", o.northing + p.y)}</label>
          <label>Azimut (°)<input type="number" min="0" max="359" data-plan="azimuth" value="${p.azimuth}"></label>
          <label>Inclinación (°)<input type="number" min="${DRILL.minInclination}" max="90" data-plan="inclination" value="${p.inclination}" title="90 = vertical"></label>
          <label>Largo (m)<input type="number" min="${DRILL.minLength}" max="${DRILL.maxLength}" step="10" data-plan="length" value="${p.length}"></label>
        </div>
        <div id="drill-preview" class="entry">${this.preview()}</div>
        <div class="tools">
          ${labelledButton("drill", "Perforar", `data-do="drill"${c.problem ? " disabled" : ""}`)}
          ${this.free ? labelledButton("person", "Usar mi posición", 'data-do="here"') : ""}
        </div>`
      : `<p class="message">Este escenario no trae el bloque del modelo (modo evaluado): los sondajes no están disponibles.</p>`;
    const list = d.holes.length
      ? `<table class="drill-table"><thead><tr><th>Sondaje</th><th>Este</th><th>Norte</th><th>Cota</th><th>Az/Incl.</th><th>Largo</th>${this.free ? "" : "<th>Costo</th>"}<th></th></tr></thead><tbody>${d.holes
          .map(
            (h) => `<tr class="${h.id === this.selected ? "on" : ""}">
              <td><button type="button" class="link" data-do="select" data-id="${h.id}" title="Ver el registro">${esc(h.name)}</button></td>
              <td>${Math.round(o.easting + h.x)}</td><td>${Math.round(o.northing + h.y)}</td><td>${Math.round(h.z)}</td>
              <td>${Math.round(h.azimuth)}°/${Math.round(h.inclination)}°</td><td>${num(h.length)} m</td>${this.free ? "" : `<td>${usd(h.cost)}</td>`}
              <td class="row-tools">${iconButton("cube", "Ver en el modelo 3D", `data-do="view3d" data-id="${h.id}"`)}${this.free ? iconButton("trash", "Borrar el sondaje", `data-do="remove" data-id="${h.id}"`) : ""}</td></tr>`,
          )
          .join("")}</tbody></table>`
      : `<p>Aún no hay sondajes.</p>`;
    this.root.innerHTML = `
      <div class="head"><b>Sondajes</b>${labelledButton("download", "CSV", `data-do="csv"${d.holes.length ? "" : " disabled"}`, "Exportar los registros (collar, survey y litología)")}
        ${iconButton("close", "Volver (K)", 'class="x" data-do="close"')}</div>
      ${budget}
      ${this.message ? `<p class="entry">${esc(this.message)}</p>` : ""}
      ${form}
      <h3>Sondajes perforados <small>${d.holes.length}</small></h3>
      ${list}
      ${d.holes.length ? `<h3>Registros <small>a su cota real, para correlacionar${this.answers ? "; líneas: techo de cada unidad" : ""}</small></h3><div class="drill-logs">${this.logsSvg()}</div>` : ""}
      ${this.detail()}`;
  }

  /** The table of one hole's intervals, with the student's map unit for each. */
  private detail(): string {
    const hole = this.drill.holes.find((h) => h.id === this.selected);
    if (!hole) return this.drill.holes.length ? `<p class="hint">Toca el nombre de un sondaje para ver su registro detallado.</p>` : "";
    const mapUnits = this.field.state.map.units;
    const rows = hole.intervals
      .map((r, i) => {
        const unit = this.unit(r.unit);
        const desc = this.answers ? `${esc(this.label(r.unit, r.dyke))} <small>${esc(unit?.lithology ?? "")} · ${esc(this.field.truth!.units.find((u) => u.key === r.unit)?.age.label ?? "")}</small>` : `${esc(unit?.description.field ?? r.unit)}${unit ? ` <small>Con lupa: ${esc(unit.description.hand_lens)}</small>` : ""}`;
        const select = `<select data-hole="${hole.id}" data-interval="${i}" aria-label="Unidad del mapa"><option value="">—</option>${mapUnits.map((u) => `<option value="${u.id}"${u.id === r.mapUnit ? " selected" : ""}>${esc(u.name)}</option>`).join("")}</select>`;
        return `<tr><td>${num(r.from, 1)}</td><td>${num(r.to, 1)}</td><td>${num(r.to - r.from, 1)}</td><td><i class="sw" style="background:${esc(unit?.colour ?? "#888")}"></i></td><td>${desc}</td><td>${select}</td></tr>`;
      })
      .join("");
    return `<h3>${esc(hole.name)} <small>${when(hole.day, hole.minutes)} · ${Math.round(hole.azimuth)}°/${Math.round(hole.inclination)}° · ${num(hole.length)} m</small></h3>
      <p class="hint">Profundidades a lo largo del sondaje. Los contactos tienen la resolución del modelo (celdas de ${this.manifest.grid.cell_size_m.z} m).${mapUnits.length ? "" : " Crea unidades en el mapa (M) para asignarlas a los tramos."}</p>
      <table class="drill-table intervals"><thead><tr><th>Desde</th><th>Hasta</th><th>Largo</th><th></th><th>${this.answers ? "Unidad" : "Descripción del testigo"}</th><th>Unidad del mapa</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  /** The logs side by side, each at its elevation, with depth ticks along the hole. */
  logsSvg(): string {
    const holes = this.drill.holes;
    const top = Math.max(...holes.map((h) => h.z)), bottom = Math.min(...holes.map((h) => elevationAt(h, h.length)));
    const span = Math.max(top - bottom, 50);
    const H = 460, padTop = 34, padBottom = 18, left = 56, colW = 34, gap = 92;
    const W = left + holes.length * (colW + gap);
    const y = (z: number) => padTop + ((top - z) / span) * H;
    const mapUnits = this.field.state.map.units;
    const out: string[] = [`<svg viewBox="0 0 ${W} ${H + padTop + padBottom}" width="${W}" height="${H + padTop + padBottom}" class="drill-svg" font-family="system-ui,sans-serif" font-size="10">`];
    // Elevation axis.
    const stepZ = [10, 20, 50, 100, 200, 500].find((s) => span / s <= 10) ?? 1000;
    for (let z = Math.ceil(bottom / stepZ) * stepZ; z <= top; z += stepZ) {
      out.push(`<line x1="${left - 6}" x2="${W}" y1="${y(z).toFixed(1)}" y2="${y(z).toFixed(1)}" stroke="#4a5157" stroke-width="0.6"/><text x="${left - 9}" y="${(y(z) + 3).toFixed(1)}" text-anchor="end" fill="#c9c4b5">${z}</text>`);
    }
    out.push(`<text x="4" y="12" fill="#c9c4b5">m s.n.m.</text>`);
    const tops: { x: number; unit: string; z: number }[][] = [];
    holes.forEach((h, k) => {
      const x = left + 14 + k * (colW + gap);
      out.push(`<text x="${x + colW / 2}" y="${padTop - 18}" text-anchor="middle" fill="#f2d16b" font-weight="700" font-size="11">${esc(h.name)}</text>`);
      out.push(`<text x="${x + colW / 2}" y="${padTop - 6}" text-anchor="middle" fill="#c9c4b5">${Math.round(h.azimuth)}°/${Math.round(h.inclination)}°</text>`);
      const mine: { x: number; unit: string; z: number }[] = [];
      for (const r of h.intervals) {
        const unit = this.unit(r.unit);
        const y1 = y(elevationAt(h, r.from)), y2 = y(elevationAt(h, r.to));
        const mapUnit = mapUnits.find((u) => u.id === r.mapUnit);
        out.push(`<rect x="${x}" y="${y1.toFixed(1)}" width="${colW}" height="${Math.max(y2 - y1, 0.5).toFixed(1)}" fill="${esc(unit?.colour ?? "#888")}" stroke="#000" stroke-width="0.5"><title>${esc(`${num(r.from, 1)}–${num(r.to, 1)} m: ${this.label(r.unit, r.dyke)}`)}</title></rect>`);
        if (mapUnit) out.push(`<rect x="${x + colW}" y="${y1.toFixed(1)}" width="6" height="${Math.max(y2 - y1, 0.5).toFixed(1)}" fill="${esc(mapUnit.colour)}" stroke="#000" stroke-width="0.4"/>`);
        if (y2 - y1 >= 11) {
          const name = mapUnit?.name ?? (this.answers ? this.label(r.unit, r.dyke) : "");
          if (name) out.push(`<text x="${x + colW + 9}" y="${((y1 + y2) / 2 + 3).toFixed(1)}" fill="#f4f1e8">${esc(name.length > 16 ? `${name.slice(0, 15)}…` : name)}</text>`);
        }
        if (r.from > 0 && y2 - y1 >= 0) out.push(`<text x="${x - 3}" y="${(y1 + 3).toFixed(1)}" text-anchor="end" fill="#9aa0a6" font-size="8.5">${Math.round(r.from)}</text>`);
        if (!r.dyke && !mine.some((t) => t.unit === r.unit)) mine.push({ x, unit: r.unit, z: elevationAt(h, r.from) });
      }
      out.push(`<text x="${x - 3}" y="${(y(elevationAt(h, h.length)) + 3).toFixed(1)}" text-anchor="end" fill="#9aa0a6" font-size="8.5">${Math.round(h.length)}</text>`);
      tops.push(mine);
    });
    // Where answers show: the top of each unit joined between neighbouring holes, a first correlation. A top at
    // the collar is the ground, not a contact, and is left out.
    if (this.answers) {
      for (let k = 0; k + 1 < tops.length; k++) {
        for (const a of tops[k]!) {
          const b = tops[k + 1]!.find((t) => t.unit === a.unit);
          if (b && a.z < holes[k]!.z - 0.5 && b.z < holes[k + 1]!.z - 0.5) {
            out.push(`<line x1="${a.x + colW}" y1="${y(a.z).toFixed(1)}" x2="${b.x}" y2="${y(b.z).toFixed(1)}" stroke="${esc(this.unit(a.unit)?.colour ?? "#ccc")}" stroke-width="1.4" stroke-dasharray="4 3"/>`);
          }
        }
      }
    }
    out.push("</svg>");
    return out.join("");
  }
}
