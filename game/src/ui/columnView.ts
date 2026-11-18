// The stratigraphic column and the geological history: the student orders their map units, gives them a
// thickness and the kind of contact at their base, and arranges the events in time.

import { BASE_NAMES, type BaseContact, EVENT_HAS_UNIT, EVENT_NAMES, type EventType, move } from "../interpret/column";
import type { Field } from "../tools/fieldwork";
import { iconButton, labelledButton } from "./icons";
import { esc } from "./html";

export class ColumnView {
  constructor(
    private readonly root: HTMLElement,
    private readonly field: Field,
    private readonly changed: () => void,
    private readonly close: () => void,
  ) {
    root.addEventListener("click", (e) => this.click(e));
    root.addEventListener("change", (e) => this.edit(e));
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  hide(): void {
    this.root.hidden = true;
  }

  open(): void {
    this.root.hidden = false;
    this.render();
  }

  private get column() {
    return this.field.state.column;
  }

  private click(e: Event): void {
    const button = (e.target as HTMLElement).closest<HTMLElement>("[data-do]");
    if (!button) return;
    const action = button.dataset.do!, i = Number(button.dataset.i);
    const { rows, events } = this.column;
    const units = this.field.state.map.units;
    if (action === "close") return this.close();
    if (action === "add-row") {
      const free = units.find((u) => !rows.some((r) => r.unit === u.id)) ?? units[0];
      if (!free) return;
      rows.push({ unit: free.id, base: "depositional" });
    } else if (action === "row-up") move(rows, i, +1);
    else if (action === "row-down") move(rows, i, -1);
    else if (action === "row-remove") rows.splice(i, 1);
    else if (action === "add-event") events.push({ id: this.column.nextId++, type: "deposition", unit: units[0]?.id });
    else if (action === "event-up") move(events, i, -1);
    else if (action === "event-down") move(events, i, +1);
    else if (action === "event-remove") events.splice(i, 1);
    else return;
    this.changed();
    this.render();
  }

  private edit(e: Event): void {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const i = Number(t.dataset.i);
    const { rows, events } = this.column;
    if (t.dataset.field === "unit") rows[i]!.unit = Number(t.value);
    else if (t.dataset.field === "thickness") {
      const v = Number(t.value.replace(",", "."));
      if (t.value.trim() && v > 0) rows[i]!.thickness = v;
      else delete rows[i]!.thickness;
    } else if (t.dataset.field === "base") rows[i]!.base = t.value as BaseContact;
    else if (t.dataset.field === "event-type") {
      events[i]!.type = t.value as EventType;
      if (!EVENT_HAS_UNIT[events[i]!.type]) delete events[i]!.unit;
      else events[i]!.unit ??= this.field.state.map.units[0]?.id;
    } else if (t.dataset.field === "event-unit") events[i]!.unit = Number(t.value);
    else return;
    this.changed();
    this.render();
  }

  render(): void {
    const { rows, events } = this.column;
    const units = this.field.state.map.units;
    const unitOptions = (selected?: number) => units.map((u) => `<option value="${u.id}"${u.id === selected ? " selected" : ""}>${esc(u.name)}</option>`).join("");
    const colour = (id: number) => units.find((u) => u.id === id)?.colour ?? "#999";
    // Youngest at the top, as a column is drawn; stored oldest first.
    const rowHtml = rows
      .map((r, i) => ({ r, i }))
      .reverse()
      .map(
        ({ r, i }) => `<div class="crow">
          <span class="sw" style="background:${colour(r.unit)}"></span>
          <select data-field="unit" data-i="${i}" aria-label="Unidad">${unitOptions(r.unit)}</select>
          <input data-field="thickness" data-i="${i}" inputmode="decimal" placeholder="espesor (m)" value="${r.thickness ?? ""}" aria-label="Espesor en metros">
          <select data-field="base" data-i="${i}" aria-label="Contacto basal">${(Object.keys(BASE_NAMES) as BaseContact[]).map((b) => `<option value="${b}"${b === r.base ? " selected" : ""}>base ${BASE_NAMES[b]}</option>`).join("")}</select>
          ${iconButton("up", "Más joven", `data-do="row-up" data-i="${i}"`)}${iconButton("down", "Más antigua", `data-do="row-down" data-i="${i}"`)}${iconButton("trash", "Quitar", `data-do="row-remove" data-i="${i}"`)}
        </div>`,
      )
      .join("");
    const eventHtml = events
      .map(
        (e, i) => `<div class="crow">
          <b>${i + 1}.</b>
          <select data-field="event-type" data-i="${i}" aria-label="Tipo de evento">${(Object.keys(EVENT_NAMES) as EventType[]).map((t) => `<option value="${t}"${t === e.type ? " selected" : ""}>${EVENT_NAMES[t]}</option>`).join("")}</select>
          ${EVENT_HAS_UNIT[e.type] ? `<select data-field="event-unit" data-i="${i}" aria-label="Unidad">${unitOptions(e.unit)}</select>` : ""}
          ${iconButton("up", "Antes", `data-do="event-up" data-i="${i}"`)}${iconButton("down", "Después", `data-do="event-down" data-i="${i}"`)}${iconButton("trash", "Quitar", `data-do="event-remove" data-i="${i}"`)}
        </div>`,
      )
      .join("");
    // A drawn column: heights by thickness (100 m where none is given), wavy lines at unconformities.
    const total = rows.reduce((sum, r) => sum + (r.thickness ?? 100), 0) || 1;
    let y = 0;
    const bars = [...rows]
      .reverse()
      .map((r) => {
        const h = Math.max(((r.thickness ?? 100) / total) * 260, 14);
        const name = units.find((u) => u.id === r.unit)?.name ?? "";
        const bar = `<rect x="0" y="${y}" width="70" height="${h}" fill="${colour(r.unit)}" stroke="#222"/>
          <text x="78" y="${y + h / 2 + 4}" font-size="11" fill="#f4f1e8">${esc(name)}${r.thickness ? ` · ${r.thickness} m` : ""}</text>
          ${r.base === "unconformity" ? `<path d="M0 ${y + h} q 9 -5 17.5 0 t 17.5 0 t 17.5 0 t 17.5 0" stroke="#c0392b" stroke-width="2.5" fill="none"/>` : ""}`;
        y += h;
        return bar;
      })
      .join("");
    this.root.innerHTML = `
      <div class="head"><b>Columna estratigráfica e historia geológica</b>
        ${iconButton("close", "Volver (C)", 'data-do="close" class="x"')}</div>
      ${units.length ? "" : `<p class="message">Primero define las unidades en el mapa (M): la columna usa las mismas.</p>`}
      <div class="column-layout">
        <section>
          <h3>Columna <small>la más joven arriba</small></h3>
          ${rowHtml || "<p class='tip'>Aún no hay capas.</p>"}
          ${labelledButton("add", "Agregar unidad", `data-do="add-row"${units.length ? "" : " disabled"}`)}
        </section>
        ${rows.length ? `<svg class="column-drawing" width="230" height="${Math.max(y, 20)}" viewBox="0 0 230 ${Math.max(y, 20)}" aria-label="Dibujo de la columna">${bars}</svg>` : ""}
      </div>
      <h3>Historia <small>de lo más antiguo a lo más reciente</small></h3>
      ${eventHtml || "<p class='tip'>Aún no hay eventos.</p>"}
      ${labelledButton("add", "Agregar evento", 'data-do="add-event"')}`;
  }
}
