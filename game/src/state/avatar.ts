// The student's field geologist: one figure, the geologist, with a skin tone, a haircut and field gear.
// Kept in this browser for every scenario, apart from the attempts.

export const SKIN_TONES = ["#f5d6c1", "#ecbf9d", "#dca47c", "#c58a61", "#a66d48", "#875234", "#673d26", "#47291a"] as const;
export const HAIR_COLOURS = ["#1f1a17", "#4a3020", "#7a4a26", "#b7863f", "#d9c08a", "#8e8e8e"] as const;
export const GEAR_COLOURS = ["#f08a24", "#e8e23a", "#d9d4c6", "#c23b2b", "#3d6b8f", "#6b7a46"] as const;

export type Hat = "casco" | "sombrero" | "jockey" | "ninguno";
export type Hammer = "punta" | "cincel";
export type HairLength = "rapado" | "corto" | "medio" | "largo";
export type HairStyle = "suelto" | "raya" | "flequillo" | "cresta" | "afro" | "coleta" | "colitas" | "trenza" | "trenzas" | "mono";

export interface Avatar {
  skin: number; // index in SKIN_TONES
  hair: number; // index in HAIR_COLOURS
  hairLength: HairLength;
  hairStyle: HairStyle; // one of HAIR_STYLES[hairLength]
  hat: Hat;
  hatColour: number; // index in GEAR_COLOURS
  vest: boolean;
  vestColour: number;
  shirtColour: string;
  backpack: boolean;
  lens: boolean; // hand lens on a cord round the neck
  hammer: Hammer;
}

export const HAT_NAMES: Record<Hat, string> = { casco: "Casco", sombrero: "Sombrero de ala ancha", jockey: "Jockey", ninguno: "Sin sombrero" };
export const HAMMER_NAMES: Record<Hammer, string> = { punta: "Martillo de punta", cincel: "Martillo de cincel" };

export const HAIR_LENGTH_NAMES: Record<HairLength, string> = { rapado: "Rapado", corto: "Corto", medio: "Hasta los hombros", largo: "Largo" };
export const HAIR_STYLE_NAMES: Record<HairStyle, string> = {
  suelto: "Suelto", raya: "Raya al lado", flequillo: "Flequillo", cresta: "Cresta", afro: "Afro",
  coleta: "Cola de caballo", colitas: "Dos colitas", trenza: "Trenza", trenzas: "Dos trenzas", mono: "Moño",
};
/** The styles each length allows: a crest wants short hair, a braid or a bun long hair. */
export const HAIR_STYLES: Record<HairLength, readonly HairStyle[]> = {
  rapado: ["suelto"],
  corto: ["suelto", "raya", "flequillo", "cresta", "afro"],
  medio: ["suelto", "raya", "flequillo", "afro", "coleta", "colitas", "mono"],
  largo: ["suelto", "raya", "flequillo", "coleta", "trenza", "trenzas", "mono"],
};
const HAIR_LENGTHS = Object.keys(HAIR_LENGTH_NAMES) as HairLength[];

/** The style kept when the length changes: the same one if that length allows it, otherwise loose. */
export function fitHairStyle(length: HairLength, style: unknown): HairStyle {
  return HAIR_STYLES[length].includes(style as HairStyle) ? (style as HairStyle) : "suelto";
}

export function defaultAvatar(): Avatar {
  return { skin: 2, hair: 1, hairLength: "corto", hairStyle: "suelto", hat: "casco", hatColour: 0, vest: true, vestColour: 0, shirtColour: "#3d6b8f", backpack: true, lens: true, hammer: "punta" };
}

const KEY = "geomapper:avatar";
const clampIndex = (v: unknown, n: number, fallback: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < n ? (v as number) : fallback);

/** Reads a saved avatar, keeping only valid values; anything missing or wrong falls back to the default. A figure saved by older versions is ignored. */
export function parseAvatar(text: string | null): Avatar {
  const d = defaultAvatar();
  if (!text) return d;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return d;
  }
  if (!raw || typeof raw !== "object") return d;
  const hairLength = HAIR_LENGTHS.includes(raw.hairLength as HairLength) ? (raw.hairLength as HairLength) : d.hairLength;
  return {
    skin: clampIndex(raw.skin, SKIN_TONES.length, d.skin),
    hair: clampIndex(raw.hair, HAIR_COLOURS.length, d.hair),
    hairLength,
    hairStyle: fitHairStyle(hairLength, raw.hairStyle),
    hat: (["casco", "sombrero", "jockey", "ninguno"] as const).includes(raw.hat as Hat) ? (raw.hat as Hat) : d.hat,
    hatColour: clampIndex(raw.hatColour, GEAR_COLOURS.length, d.hatColour),
    vest: typeof raw.vest === "boolean" ? raw.vest : d.vest,
    vestColour: clampIndex(raw.vestColour, GEAR_COLOURS.length, d.vestColour),
    shirtColour: typeof raw.shirtColour === "string" && /^#[0-9a-f]{6}$/i.test(raw.shirtColour) ? raw.shirtColour : d.shirtColour,
    backpack: typeof raw.backpack === "boolean" ? raw.backpack : d.backpack,
    lens: typeof raw.lens === "boolean" ? raw.lens : d.lens,
    hammer: raw.hammer === "cincel" || raw.hammer === "punta" ? raw.hammer : d.hammer,
  };
}

export function loadAvatar(): Avatar {
  try {
    return parseAvatar(window.localStorage.getItem(KEY));
  } catch {
    return defaultAvatar();
  }
}

export function saveAvatar(a: Avatar): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    // Private windows may refuse; the choice then lasts until the page closes.
  }
}

/** True once the student has chosen, so the start screen offers the choice the first time only. */
export function hasSavedAvatar(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}
