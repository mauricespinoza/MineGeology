// The notebook: every station, its measurements and notes, the lab results, and export to a file.

import type { ClockRules } from "../explore/clock";
import type { GameState } from "../state/state";
import { type Field, sampleResult } from "../tools/fieldwork";
import { drawSketch, measurementText, noteHtml } from "./fieldPanel";
import { iconButton, labelledButton } from "./icons";
import { esc, when } from "./html";
import { photosHtml } from "./photos";
import { DIFFICULTY_NAMES, difficultyOf } from "../state/difficulty";

/** Measurements as CSV: one row per reading, for a spreadsheet or a stereonet program. */
export function measurementsCsv(state: GameState): string {
  // The two angles are the student's entry read back: strike (right-hand rule) and dip, or trend and plunge.
  const rows = [["estacion", "este", "norte", "cota", "roca", "tipo", "elemento", "rumbo_o_direccion", "manteo_o_buzamiento", "dia", "minuto", "anotado", "notacion"]];
  for (const s of state.stations) {
    for (const m of s.measurements) {
      rows.push([s.number, s.easting, s.northing, s.elevation, s.rock, m.type === "plane" ? "plano" : "linea", m.feature, Math.round(m.a * 10) / 10, Math.round(m.b * 10) / 10, m.day, Math.floor(m.minutes), m.entered ?? "", m.notation ?? ""].map(String));
    }
  }
  return rows.map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(",")).join("\n") + "\n";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export class Notebook {
  constructor(
    private readonly root: HTMLElement,
    private readonly field: Field,
    private readonly rules: ClockRules,
    private readonly serialize: () => string,
    private readonly close: () => void,
  ) {
    root.addEventListener("click", (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>("[data-do]")?.dataset.do;
      const { scenarioId, variant } = field.state;
      if (action === "close") this.close();
      if (action === "csv") download(`mediciones-${scenarioId}-${variant}.csv`, measurementsCsv(field.state), "text/csv");
      if (action === "json") download(`libreta-${scenarioId}-${variant}.json`, this.serialize(), "application/json");
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  hide(): void {
    this.root.hidden = true;
  }

  open(): void {
    const { state } = this.field;
    const samples = state.samples
      .map((s) => {
        const result = sampleResult(this.field, s, this.rules);
        const kind = s.analysis === "age" ? "edad radiométrica" : s.analysis === "assay" ? "análisis químico" : "corte delgado";
        const unit = this.field.scenario.units.find((u) => u.key === s.unit);
        const photo = result && s.analysis === "thin_section" ? photosHtml(unit, ["thin_section_ppl", "thin_section_xpl"], this.field.assetUrl) : "";
        return `<div class="entry"><b>Muestra ${s.number}</b> · estación ${s.station} · ${kind} <small>día ${s.day}</small><br>${result ? esc(result) : "<i>En el laboratorio: el resultado llega el próximo día de terreno.</i>"}${photo}</div>`;
      })
      .join("");
    const stations = [...state.stations]
      .reverse()
      .map(
        (s) => `<section class="station">
          <div class="printed-row"><span class="printed">Estación</span><b class="hand big">${s.number}</b>
            <span class="printed">Fecha</span><span class="hand">${when(s.day, s.minutes)}</span></div>
          <div class="printed-row"><span class="printed">Lugar</span><span class="hand">E ${s.easting} · N ${s.northing} · ${s.elevation} m</span></div>
          <p><span class="printed">Roca</span> ${s.rock ? `<span class="hand under">${esc(s.rock)}</span>` : '<i class="hand faint">sin nombre</i>'}</p>
          ${s.text ? `<p class="hand">${esc(s.text).replace(/\n/g, "<br>")}</p>` : ""}
          ${s.measurements.length ? `<p class="hand readings">${s.measurements.map((m) => esc(measurementText(m))).join("<br>")}</p>` : ""}
          ${s.sketch.length ? `<canvas class="thumb" width="360" height="220" data-station="${s.number}"></canvas>` : ""}
          ${s.notes.map(noteHtml).join("")}
        </section>`,
      )
      .join("");
    const level = DIFFICULTY_NAMES[difficultyOf(state)].toLowerCase();
    this.root.classList.add("field-book");
    this.root.innerHTML = `
      <div class="head"><b class="cover-title">Libreta de terreno</b><span class="cover-sub">todo clima · ${state.mode === "free" ? "modo libre" : "modo campaña"} · nivel ${level}</span>
        ${iconButton("close", "Volver (N)", 'data-do="close" class="x"')}</div>
      <div class="page">
        <div class="printed-row page-top"><span class="printed">${plural(state.stations.length, "estación", "estaciones")} · ${plural(state.stations.reduce((n, s) => n + s.measurements.length, 0), "medición", "mediciones")}</span></div>
        <div class="tools">${labelledButton("table", "Mediciones (CSV)", 'data-do="csv"', "Exportar mediciones (CSV)")}${labelledButton("download", "Libreta (JSON)", 'data-do="json"', "Exportar libreta (JSON)")}</div>
        ${samples ? `<h3>Laboratorio</h3>${samples}` : ""}
        ${stations || '<p class="hand">Aún no has abierto ninguna estación. Acércate a un afloramiento y pulsa E.</p>'}
      </div>`;
    for (const canvas of Array.from(this.root.querySelectorAll<HTMLCanvasElement>("canvas.thumb"))) {
      drawSketch(canvas, state.stations.find((s) => s.number === Number(canvas.dataset.station))!.sketch);
    }
    this.root.hidden = false;
    this.root.scrollTop = 0;
  }
}
