// Weathered rock and scree: loose pieces that cannot be measured, but can be looked at with the lens.
// They come from the rock nearby, so the card describes the nearest outcrop's rock.
// The strip of crushed rock along a fault trace has a card of its own: it tells of a fault, not of a unit.

import type { Outcrop, Scenario } from "../format/types";
import { alterationAt, alterationLines, partialDescription } from "../tools/fieldwork";
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

  /** `fault`: the rock hammered lies in the strip of crushed rock along a fault trace. */
  open(source: Outcrop | null, seed: string, fault = false): void {
    const unit = source?.observation && this.scenario.units.find((u) => u.key === source.observation!.unit);
    const altered = alterationAt(this.scenario, source);
    const lines = unit ? [...partialDescription(unit), ...(altered ? alterationLines(altered.zone, altered.intensity, true) : [])] : [];
    const head = fault ? "Zona de falla: roca triturada" : "Roca meteorizada y derrubios";
    const message = fault
      ? `<p class="message poor">Roca molida y fracturada en una franja angosta: brecha de falla con clastos angulosos de todos los tamaños, en una matriz arcillosa (salbanda) teñida de rojo y ocre por óxidos de hierro. Nada crece sobre ella y se erosiona más rápido que la roca de los lados. Es la huella de una <b>falla</b>: síguela en el paisaje (una franja rojiza, un escarpe, collados y quebradas alineados) y busca un afloramiento bueno que la cruce para medir el plano y su sentido de movimiento.</p>`
      : `<p class="message poor">Afloramiento de mala calidad: fragmentos sueltos, alterados por la meteorización, que no están en su lugar. La descripción es solo parcial, y aquí no se puede medir ni muestrear. Vienen de la roca de los alrededores, sobre todo ladera arriba.</p>`;
    this.root.innerHTML = `
      <div class="head"><b>${head}</b>${iconButton("close", "Volver (Esc)", 'data-do="close" class="x"')}</div>
      ${message}
      ${
        unit
          ? `<div class="lupa">${lupaHtml("rock-lupa")}
               <div><div class="entry"><b>Martillo y lupa</b> <small>${fault ? "un clasto de la brecha" : "descripción parcial"}</small><br>${lines.map(esc).join("<br>")}</div></div></div>
             ${photosHtml(unit, ["hand_sample"], this.assetUrl)}
             <p class="tip">Para describirla completa, medir estratificación, fallas o polaridad y muestrearla, busca un afloramiento de buena calidad cerca.</p>`
          : `<p>No hay roca reconocible cerca: solo suelo y fragmentos demasiado alterados.</p>`
      }`;
    this.root.hidden = false;
    if (unit) wireLupa(this.root, "rock-lupa", unit, seed, `${LUPA_CAPTION} ${fault ? "Clasto de la brecha de falla." : "Superficie meteorizada."}`, altered);
  }
}
