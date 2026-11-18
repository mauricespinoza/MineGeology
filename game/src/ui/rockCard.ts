// Weathered rock and scree: loose pieces that cannot be measured, but can be looked at with the lens.
// They come from the rock nearby, so the card describes the nearest outcrop's rock.

import type { Outcrop, Scenario } from "../format/types";
import { esc } from "./html";
import { iconButton } from "./icons";
import { drawLupa } from "./lupa";
import { photosHtml } from "./photos";

export class RockCard {
  constructor(
    private readonly root: HTMLElement,
    private readonly scenario: Scenario,
    private readonly assetUrl: (path: string) => string,
    private readonly close: () => void,
  ) {
    root.addEventListener("click", (e) => (e.target as HTMLElement).closest('[data-do="close"]') && this.close());
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** The outcrop nearest to model point x, y within `within` metres, or null. */
  static nearest(scenario: Scenario, x: number, y: number, within = 120): Outcrop | null {
    const o = scenario.manifest.grid.origin;
    let best: Outcrop | null = null, bestD = within;
    for (const k of scenario.outcrops) {
      const d = Math.hypot(k.position.easting - o.easting - x, k.position.northing - o.northing - y);
      if (d < bestD) ((best = k), (bestD = d));
    }
    return best;
  }

  open(source: Outcrop | null, seed: string): void {
    const unit = source?.observation && this.scenario.units.find((u) => u.key === source.observation!.unit);
    this.root.innerHTML = `
      <div class="head"><b>Roca meteorizada y derrubios</b>${iconButton("close", "Volver (Esc)", 'data-do="close" class="x"')}</div>
      <p>Fragmentos sueltos, alterados por la meteorización: no están en su lugar, así que aquí no se puede medir ni muestrear. Vienen de la roca de los alrededores, sobre todo ladera arriba.</p>
      ${
        unit
          ? `<div class="lupa"><canvas id="rock-lupa" width="240" height="240" aria-label="Vista con lupa"></canvas>
               <div><div class="entry"><b>Martillo y lupa</b><br>${esc(unit.description.field)}<br>Con lupa: ${esc(unit.description.hand_lens)}</div></div></div>
             ${photosHtml(unit, ["hand_sample"], this.assetUrl)}
             <p class="tip">Para describirla en su lugar, medirla y muestrearla, busca el afloramiento cercano.</p>`
          : `<p>No hay roca reconocible cerca: solo suelo y fragmentos demasiado alterados.</p>`
      }`;
    this.root.hidden = false;
    const canvas = this.root.querySelector<HTMLCanvasElement>("#rock-lupa");
    if (canvas && unit) drawLupa(canvas, unit, seed);
  }
}
