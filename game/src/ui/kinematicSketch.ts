// Field sketches of shear-sense indicators, drawn from the fault plane and the sense of slip.
//
// Every indicator is drawn for one case, the upper block moving to the right, in the
// plane that holds the slip line and the pole of the fault. A mirror gives the other
// sense. Dip-slip faults are seen in a vertical section across strike, looking along
// strike, so the fault dips to the right; strike-slip faults are seen from above with
// the strike pointing to the right.

import type { Kinematic } from "../format/types";

export const INDICATOR_TEXT: Record<Kinematic["indicator"], string> = {
  steps: "Escalones de calcita fibrosa sobre el plano de falla, vistos de perfil (el bloque de arriba fue removido por la erosión)",
  riedel: "Fracturas de Riedel junto al plano principal de falla",
  drag: "Capas curvadas por arrastre junto a la falla",
  tension_gashes: "Grietas de tensión en échelon, rellenas de cuarzo y calcita",
  sc_fabric: "Fábrica S–C en la roca de falla",
  sigma_clast: "Porfiroclasto sigma con colas de recristalización",
};

export const SENSE_NAMES = { normal: "normal", reverse: "inverso", dextral: "dextral", sinistral: "sinistral" } as const;
export type Sense = keyof typeof SENSE_NAMES;

const WINDS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
const wind = (az: number) => `${WINDS[Math.round((((az % 360) + 360) % 360) / 45) % 8]} (${String(Math.round(((az % 360) + 360) % 360)).padStart(3, "0")}°)`;

/** The view of a fault: strike-slip faults from above, the others in section. */
export function sketchView(sense: Sense, strike: number, dip: number) {
  const plan = sense === "dextral" || sense === "sinistral";
  return {
    plan,
    /** Rotation of the fault in the drawing, in degrees clockwise. */
    angle: plan ? 0 : Math.min(dip, 85),
    /** +1 when the upper block of the drawing moves to the right. */
    shear: sense === "normal" || sense === "dextral" ? 1 : -1,
    left: plan ? wind(strike + 180) : wind(strike + 270),
    right: plan ? wind(strike) : wind(strike + 90),
    top: plan ? wind(strike + 270) : "arriba",
    bottom: plan ? wind(strike + 90) : "abajo",
    caption: plan
      ? "Vista en planta, desde arriba, de la zona de falla."
      : `Corte vertical perpendicular al rumbo, mirando hacia el ${wind(strike)}.`,
  };
}

/** Shapes for the upper block moving right, with the fault along y = 0 (y grows downward). */
function shapes(indicator: Kinematic["indicator"]): string {
  const ink = 'stroke="#2b2622" fill="none" stroke-linecap="round"';
  const fault = `<line x1="-170" y1="0" x2="170" y2="0" stroke="#7a1d12" stroke-width="3"/>`;
  switch (indicator) {
    case "sc_fabric": {
      let s = "";
      for (const y of [-48, -24, 0, 24, 48]) s += `<line x1="-170" y1="${y}" x2="170" y2="${y}" stroke="#2b2622" stroke-width="1.6"/>`;
      for (let band = -48; band < 48; band += 24)
        for (let x = -160; x < 160; x += 18) s += `<path d="M${x} ${band + 22} C ${x + 6} ${band + 16}, ${x + 12} ${band + 8}, ${x + 20} ${band + 2}" ${ink} stroke-width="1.2"/>`;
      return s;
    }
    case "sigma_clast": {
      let s = "";
      for (const y of [-50, -30, 30, 50]) s += `<path d="M-170 ${y} C -60 ${y + (y < 0 ? 4 : -4)}, 60 ${y + (y < 0 ? 4 : -4)}, 170 ${y}" ${ink} stroke-width="1"/>`;
      s += `<path d="M-170 10 C -100 10, -60 12, -32 8 M32 -8 C 60 -12, 100 -10, 170 -10" ${ink} stroke-width="2.2"/>`;
      s += `<path d="M-32 8 C -30 18, 10 12, 32 -8 C 30 -18, -10 -12, -32 8 Z" fill="#d8cfbd" stroke="#2b2622" stroke-width="1.5"/>`;
      s += `<ellipse cx="0" cy="0" rx="18" ry="9" transform="rotate(-30)" fill="#efe8d8" stroke="#2b2622" stroke-width="1.5"/>`;
      return s;
    }
    case "tension_gashes": {
      let s = `<line x1="-170" y1="-34" x2="170" y2="-34" stroke="#2b2622" stroke-dasharray="6 5"/><line x1="-170" y1="34" x2="170" y2="34" stroke="#2b2622" stroke-dasharray="6 5"/>`;
      for (let x = -120; x <= 120; x += 40) s += `<path d="M-22 0 Q 0 -6 22 0 Q 0 6 -22 0 Z" transform="translate(${x} 0) rotate(45)" fill="#f4f1ea" stroke="#2b2622" stroke-width="1.3"/>`;
      return s;
    }
    case "riedel": {
      let s = fault;
      for (let x = -130; x <= 130; x += 52) s += `<line x1="-28" y1="0" x2="28" y2="0" transform="translate(${x} ${x % 104 === 0 ? -14 : 14}) rotate(15)" stroke="#2b2622" stroke-width="1.8"/>`;
      return s;
    }
    case "drag": {
      let s = fault;
      for (const dx of [-24, 0, 24]) {
        s += `<path d="M${40 + dx} -80 C ${40 + dx} -40, ${36 + dx} -16, ${10 + dx} -2" ${ink} stroke-width="1.8"/>`;
        s += `<path d="M${-40 + dx} 80 C ${-40 + dx} 40, ${-36 + dx} 16, ${-10 + dx} 2" ${ink} stroke-width="1.8"/>`;
      }
      return s;
    }
    case "steps": {
      let d = "M-170 4";
      for (let x = -170; x < 170; x += 48) d += ` L${x + 44} -10 L${x + 44} 4 L${x + 48} 4`;
      let fibres = "";
      for (let x = -160; x < 170; x += 8) fibres += `<line x1="${x}" y1="12" x2="${x + 6}" y2="12" stroke="#b9ad97" stroke-width="1"/>`;
      return `<path d="${d} L170 30 L-170 30 Z" fill="#cdbfa5" stroke="#2b2622" stroke-width="1.6"/>${fibres}`;
    }
  }
}

/** An SVG field sketch of the indicator. */
export function kinematicSvg(k: Kinematic, strike: number, dip: number): string {
  const v = sketchView(k.sense, strike, dip);
  const mirror = v.shear < 0 ? "scale(-1 1)" : "";
  const label = (x: number, y: number, text: string, anchor: string) =>
    `<text x="${x}" y="${y}" font-size="12" text-anchor="${anchor}" fill="#2b2622">${text}</text>`;
  return `<svg class="kinematic" viewBox="-240 -125 480 250" width="480" height="250" role="img" aria-label="Croquis del indicador cinemático">
    <rect x="-240" y="-125" width="480" height="250" fill="#f6f2e8"/>
    <clipPath id="kclip"><rect x="-150" y="-100" width="300" height="200"/></clipPath>
    <rect x="-150" y="-100" width="300" height="200" fill="none" stroke="#b7ad99"/>
    <g clip-path="url(#kclip)"><g transform="rotate(${v.angle}) ${mirror}">${shapes(k.indicator)}</g></g>
    ${label(-236, 4, v.left, "start")}${label(236, 4, v.right, "end")}
    ${label(0, -108, v.top, "middle")}${label(0, 118, v.bottom, "middle")}
  </svg>`;
}
