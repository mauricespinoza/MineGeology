// The stereonet screen: the student's own measurements, filtered, with the fit read off the net.

import { unitAt } from "../interpret/mapdata";
import { FEATURE_COLOURS, collect, describeFit, drawStereonet, type Datum } from "../interpret/stereonet";
import { type Field, LINE_NAMES, PLANE_NAMES } from "../tools/fieldwork";
import { download } from "./notebook";
import { iconButton, labelledButton } from "./icons";
import { esc } from "./html";

const SIZE = 460;
const FEATURE_NAMES: Record<string, string> = { ...PLANE_NAMES, ...LINE_NAMES };

export class NetView {
  private filter = "all";
  private feature = "";
  private mode: "poles" | "circles" = "poles";
  private fit = true;

  constructor(
    private readonly root: HTMLElement,
    private readonly field: Field,
    private readonly close: () => void,
  ) {
    root.addEventListener("click", (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>("[data-do]")?.dataset.do;
      if (action === "close") this.close();
      if (action === "png") this.png();
    });
    root.addEventListener("change", (e) => {
      const t = e.target as HTMLInputElement | HTMLSelectElement;
      if (t.id === "net-filter") this.filter = t.value;
      else if (t.id === "net-feature") this.feature = t.value;
      else if (t.name === "net-mode") this.mode = t.value as "poles" | "circles";
      else if (t.id === "net-fit") this.fit = (t as HTMLInputElement).checked;
      else return;
      this.update();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** The measurements the filters select. */
  data(): Datum[] {
    const { state, scenario } = this.field;
    const origin = scenario.manifest.grid.origin;
    const [kind, value] = this.filter.split(":");
    let stations: Set<number> | undefined;
    if (kind === "unit") {
      const id = Number(value);
      stations = new Set(state.stations.filter((s) => unitAt(state.map, s.easting - origin.easting, s.northing - origin.northing) === id).map((s) => s.number));
    }
    return collect(state.stations, {
      rock: kind === "rock" ? this.filter.slice(5) : undefined,
      stations,
      feature: this.feature || undefined,
    });
  }

  open(): void {
    const { state } = this.field;
    const rocks = [...new Set(state.stations.map((s) => s.rock).filter(Boolean))].sort();
    const features = [...new Set(state.stations.flatMap((s) => s.measurements.map((m) => m.feature)))];
    const units = state.map.units.filter((u) => state.map.polygons.some((p) => p.unit === u.id));
    if (this.filter !== "all" && !(this.filter.startsWith("rock:") ? rocks.includes(this.filter.slice(5)) : units.some((u) => `unit:${u.id}` === this.filter))) this.filter = "all";
    if (this.feature && !features.includes(this.feature)) this.feature = "";
    const option = (value: string, label: string, current: string) => `<option value="${esc(value)}"${value === current ? " selected" : ""}>${esc(label)}</option>`;
    this.root.innerHTML = `
      <div class="head"><b>Red estereográfica</b> <small>equiareal, hemisferio inferior</small>
        ${iconButton("close", "Volver (S)", 'data-do="close" class="x"')}</div>
      <div class="net-layout">
        <canvas id="net-canvas" width="${SIZE}" height="${SIZE}"></canvas>
        <div class="net-controls">
          <label>Estaciones<select id="net-filter">
            ${option("all", "Todas", this.filter)}
            ${rocks.length ? `<optgroup label="Por nombre de roca (libreta)">${rocks.map((r) => option(`rock:${r}`, r, this.filter)).join("")}</optgroup>` : ""}
            ${units.length ? `<optgroup label="Por unidad del mapa (áreas)">${units.map((u) => option(`unit:${u.id}`, u.name, this.filter)).join("")}</optgroup>` : ""}
          </select></label>
          <label>Elemento<select id="net-feature">
            ${option("", "Todos", this.feature)}${features.map((f) => option(f, FEATURE_NAMES[f] ?? f, this.feature)).join("")}
          </select></label>
          <div class="row">
            <label><input type="radio" name="net-mode" value="poles"${this.mode === "poles" ? " checked" : ""}> Polos</label>
            <label><input type="radio" name="net-mode" value="circles"${this.mode === "circles" ? " checked" : ""}> Círculos máximos</label>
          </div>
          <label class="row"><input type="checkbox" id="net-fit"${this.fit ? " checked" : ""}> Mostrar el ajuste</label>
          <p id="net-stats"></p>
          <div id="net-legend"></div>
          <p class="tip">Los planos se dibujan por su polo; las líneas (estrías, charnelas) por su punto. Un eje de pliegue aparece cuando los polos de los flancos forman una guirnalda.</p>
          ${labelledButton("download", "Imagen PNG", 'data-do="png"', "Descargar PNG")}
        </div>
      </div>`;
    this.root.hidden = false;
    this.root.scrollTop = 0;
    this.update();
  }

  private update(): void {
    const data = this.data();
    const canvas = this.root.querySelector<HTMLCanvasElement>("#net-canvas")!;
    const fit = drawStereonet(canvas.getContext("2d")!, SIZE, data, { mode: this.mode, fit: this.fit });
    const planes = data.filter((d) => d.kind === "plane").length, lines = data.length - planes;
    this.root.querySelector("#net-stats")!.textContent = `${describeFit(fit)}${lines ? ` Además, ${lines} ${lines === 1 ? "línea" : "líneas"}.` : ""}`;
    const present = [...new Set(data.map((d) => d.feature))];
    this.root.querySelector("#net-legend")!.innerHTML = present
      .map((f) => `<span><i style="background:${FEATURE_COLOURS[f] ?? "#333"}"></i>${esc(FEATURE_NAMES[f] ?? f)}</span>`)
      .join("");
  }

  private png(): void {
    const canvas = this.root.querySelector<HTMLCanvasElement>("#net-canvas")!;
    canvas.toBlob((blob) => blob && download(`estereograma-${this.field.state.scenarioId}.png`, blob, "image/png"), "image/png");
  }
}
