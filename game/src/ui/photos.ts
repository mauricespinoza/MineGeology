// Reference photos of a similar rock, with their credit. They show what the rock type looks like; they were
// not taken at the scenario's place.

import type { Photo, Unit } from "../format/types";
import { esc } from "./html";

const KIND_NAMES: Record<Photo["kind"], string> = {
  hand_sample: "Muestra de mano",
  thin_section_ppl: "Corte delgado, nícoles paralelos",
  thin_section_xpl: "Corte delgado, nícoles cruzados",
  outcrop: "Afloramiento",
};

export function photosHtml(unit: Unit | undefined, kinds: Photo["kind"][], url: ((path: string) => string) | undefined): string {
  if (!unit?.photos || !url) return "";
  return unit.photos
    .filter((p) => kinds.includes(p.kind))
    .map(
      (p) => `<figure class="photo"><img src="${esc(url(p.path))}" alt="${KIND_NAMES[p.kind]} de referencia" loading="lazy">
        <figcaption>${KIND_NAMES[p.kind]} de una roca similar, como referencia: no es de este lugar.
        Foto: ${esc(p.credit)}, ${esc(p.licence)}${p.source ? ` · <a href="${esc(p.source)}" target="_blank" rel="noopener">fuente</a>` : ""}.</figcaption></figure>`,
    )
    .join("");
}
