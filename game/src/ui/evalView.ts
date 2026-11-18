// The practice evaluation: the automatic score, part by part, then the true map with the student's lines and
// mistakes over it, and the true cross-section next to the student's. It reveals the answer, so it asks first.

import { expandTruthMap } from "../format/loader";
import { type Grade, PART_NAMES, grade } from "../grade/grade";
import { rasterize } from "../interpret/mapdata";
import { rasterizeSection, sectionLength, trueSection } from "../interpret/section";
import type { Field } from "../tools/fieldwork";
import type { Grid } from "../world/blocks";
import { iconButton, labelledButton } from "./icons";
import { esc } from "./html";

const pct = (v: number) => `${Math.round(v * 100)} %`;

export class EvalView {
  private confirmed = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly field: Field,
    private readonly grid: Grid,
    private readonly litho: Uint8Array | null,
    private readonly close: () => void,
  ) {
    root.addEventListener("click", (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>("[data-do]")?.dataset.do;
      if (action === "close") this.close();
      if (action === "confirm") ((this.confirmed = true), this.render());
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  hide(): void {
    this.root.hidden = true;
  }

  open(): void {
    this.root.hidden = false;
    this.root.scrollTop = 0;
    this.render();
  }

  /** The grade of the attempt as it stands; null where the answer key is not in the browser. */
  compute(): Grade | null {
    const { truth, scenario, state } = this.field;
    return truth ? grade({ scenario, truth, litho: this.litho, grid: this.grid, state }) : null;
  }

  private render(): void {
    const head = `<div class="head"><b>Evaluación de práctica</b>${iconButton("close", "Volver", 'data-do="close" class="x"')}</div>`;
    if (!this.field.truth) {
      this.root.innerHTML = `${head}<p>En este modo el mapa se entrega al profesor: la evaluación no está disponible aquí.</p>`;
      return;
    }
    if (!this.confirmed) {
      this.root.innerHTML = `${head}
        <p>La evaluación compara tu mapa, tu perfil, tu columna y tu historia con el modelo y <b>te muestra el mapa verdadero</b>.
        Después de verlo, seguir mapeando ya no es un ejercicio a ciegas.</p>
        <p class="tip">Es una nota automática de práctica: en un curso, tu profesor la revisa antes de calificar.</p>
        <div class="tools">${labelledButton("evaluate", "Ver mi evaluación", 'data-do="confirm" class="primary"')}${labelledButton("back", "Todavía no", 'data-do="close"')}</div>`;
      return;
    }
    const g = this.compute()!;
    const { scenario, truth, state } = this.field;
    const units = new Map(state.map.units.map((u) => [u.id, u]));
    const rows = g.parts
      .map((p) => `<tr><td><b>${PART_NAMES[p.key]}</b><br><small>${Math.round(p.weight * 100)} % de la nota</small></td>
        <td>${p.score === null ? "no aplica" : pct(p.score)}</td><td>${p.notes.map(esc).join("<br>")}</td></tr>`)
      .join("");
    const pairs = g.pairs
      .map((p) => {
        const names = p.trueUnits.map((t) => `${esc(truth!.units[t]!.name)} (${esc(scenario.units[t]!.lithology)}; ${esc(truth!.units[t]!.age.label)})`).join(" + ");
        return `<li><span class="sw" style="background:${units.get(p.student)?.colour}"></span>Tu unidad «${esc(units.get(p.student)?.name ?? "")}» corresponde a ${names}.</li>`;
      })
      .join("");
    this.root.innerHTML = `${head}
      <p><span class="grade-total">${pct(g.total)}</span> <span class="tip">nota automática de práctica, sobre 100 %</span></p>
      <table class="grade-table"><tr><th>Producto</th><th>Puntaje</th><th>Detalle</th></tr>${rows}</table>
      <h3>Tus unidades</h3><ul class="pairs">${pairs || "<li>No pintaste áreas en el mapa.</li>"}</ul>
      <h3>Comparación</h3>
      <div class="grade-figures">
        <figure><canvas id="eval-map"></canvas><figcaption>Mapa verdadero, con tus líneas encima. En rojo, donde tu mapa dice otra unidad.</figcaption></figure>
        <figure><canvas id="eval-section"></canvas><figcaption>Arriba, el corte verdadero bajo tu línea A–A'; abajo, el tuyo.</figcaption></figure>
      </div>`;
    this.drawMap(g);
    this.drawSections();
  }

  private drawMap(g: Grade): void {
    const { scenario, truth, state } = this.field;
    const { nx, ny, cell } = this.grid;
    const px = Math.max(1, Math.floor(512 / Math.max(nx, ny)));
    const canvas = this.root.querySelector<HTMLCanvasElement>("#eval-map")!;
    canvas.width = nx * px;
    canvas.height = ny * px;
    const ctx = canvas.getContext("2d")!;
    const trueMap = expandTruthMap(truth!, scenario.manifest);
    const painted = rasterize(state.map, nx, ny, cell);
    const classes = new Map(g.pairs.map((p) => [p.student, p.trueUnits]));
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const i = ix + nx * iy, t = trueMap[i]!;
        ctx.fillStyle = scenario.units[t]!.colour;
        ctx.fillRect(ix * px, (ny - 1 - iy) * px, px, px);
        if (!(classes.get(painted[i]!) ?? []).includes(t)) {
          ctx.fillStyle = "rgba(220,30,30,0.45)";
          ctx.fillRect(ix * px, (ny - 1 - iy) * px, px, px);
        }
      }
    }
    const s = px / cell;
    for (const l of state.map.lines) {
      ctx.strokeStyle = l.kind === "fault" ? "#b01c1c" : "#111";
      ctx.lineWidth = l.kind === "fault" ? 2.5 : 1.6;
      ctx.beginPath();
      for (let i = 0; i < l.points.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, l.points[i]! * s, canvas.height - l.points[i + 1]! * s);
      ctx.stroke();
    }
    const line = state.section.line;
    if (line) {
      ctx.strokeStyle = "#6a1b9a";
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 4]);
      ctx.beginPath();
      ctx.moveTo(line.x1 * s, canvas.height - line.y1 * s);
      ctx.lineTo(line.x2 * s, canvas.height - line.y2 * s);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawSections(): void {
    const canvas = this.root.querySelector<HTMLCanvasElement>("#eval-section")!;
    const { scenario, state } = this.field;
    const line = state.section.line;
    if (!line || !this.litho) {
      canvas.width = 300;
      canvas.height = 60;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#f4f1e8";
      ctx.font = "13px system-ui, sans-serif";
      ctx.fillText(line ? "Sin el bloque del modelo." : "No trazaste un perfil.", 10, 34);
      return;
    }
    const t = trueSection(this.litho, scenario.manifest, this.grid, line);
    const mine = rasterizeSection(state.section, t.nd, t.nz, sectionLength(line), t.z0, t.dz);
    const px = Math.max(1, Math.floor(500 / t.nd)), py = Math.max(1, Math.round((px * t.dz) / (sectionLength(line) / t.nd)));
    canvas.width = t.nd * px;
    canvas.height = 2 * t.nz * py + 10;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#cfe0ea";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const units = new Map(state.map.units.map((u) => [u.id, u.colour]));
    for (let k = 0; k < t.nz; k++) {
      for (let i = 0; i < t.nd; i++) {
        const v = t.cells[i + t.nd * k]!;
        if (v < 0) continue;
        ctx.fillStyle = scenario.units[v]!.colour;
        ctx.fillRect(i * px, (t.nz - 1 - k) * py, px, py);
        const m = mine[i + t.nd * k]!;
        ctx.fillStyle = m >= 0 ? units.get(m) ?? "#999" : "#e8e2cc";
        ctx.fillRect(i * px, t.nz * py + 10 + (t.nz - 1 - k) * py, px, py);
      }
    }
  }
}
