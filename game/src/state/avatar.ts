// The student's field geologist: one figure, the geologist, with a skin tone, hair and field gear.
// Kept in this browser for every scenario, apart from the attempts.

export const SKIN_TONES = ["#f5d6c1", "#ecbf9d", "#dca47c", "#c58a61", "#a66d48", "#875234", "#673d26", "#47291a"] as const;
export const HAIR_COLOURS = ["#1f1a17", "#4a3020", "#7a4a26", "#b7863f", "#d9c08a", "#8e8e8e"] as const;
export const GEAR_COLOURS = ["#f08a24", "#e8e23a", "#d9d4c6", "#c23b2b", "#3d6b8f", "#6b7a46"] as const;

export type Hat = "casco" | "sombrero" | "jockey" | "ninguno";
export type Hammer = "punta" | "cincel";

export interface Avatar {
  skin: number; // index in SKIN_TONES
  hair: number; // index in HAIR_COLOURS
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

export function defaultAvatar(): Avatar {
  return { skin: 2, hair: 1, hat: "casco", hatColour: 0, vest: true, vestColour: 0, shirtColour: "#3d6b8f", backpack: true, lens: true, hammer: "punta" };
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
  return {
    skin: clampIndex(raw.skin, SKIN_TONES.length, d.skin),
    hair: clampIndex(raw.hair, HAIR_COLOURS.length, d.hair),
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
