// Weathered rock and scree: loose pieces that cannot be measured, but can be looked at with the lens.
// They come from the rock nearby, so the card describes the nearest outcrop's rock.

import type { Outcrop, Scenario } from "../format/types";
import { partialDescription } from "../tools/fieldwork";
import { esc } from "./html";
import { iconButton } from "./icons";
import { LUPA_CAPTION, lupaHtml, wireLupa } from "./lupa";
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
      <p class="message poor">Afloramiento de mala calidad: fragmentos sueltos, alterados por la meteorización, que no están en su lugar. La descripción es solo parcial, y aquí no se puede medir ni muestrear. Vienen de la roca de los alrededores, sobre todo ladera arriba.</p>
      ${
        unit
          ? `<div class="lupa">${lupaHtml("rock-lupa")}
               <div><div class="entry"><b>Martillo y lupa</b> <small>descripción parcial</small><br>${partialDescription(unit).map(esc).join("<br>")}</div></div></div>
             ${photosHtml(unit, ["hand_sample"], this.assetUrl)}
             <p class="tip">Para describirla completa, medir estratificación, fallas o polaridad y muestrearla, busca un afloramiento de buena calidad cerca.</p>`
          : `<p>No hay roca reconocible cerca: solo suelo y fragmentos demasiado alterados.</p>`
      }`;
    this.root.hidden = false;
    if (unit) wireLupa(this.root, "rock-lupa", unit, seed, `${LUPA_CAPTION} Superficie meteorizada.`);
  }
}
