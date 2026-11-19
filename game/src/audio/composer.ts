// The music's score, written as it plays: an endless, slowly changing piece for the field.
// Pure: it only chooses notes (as MIDI numbers) and times; sound.ts turns them into sound.
//
// The piece never stops. A bed of sustained chords follows a progression, each chord fading into the next, with a
// soft bass under it. Over the bed a melody plays short phrases on the major pentatonic scale, which sounds well
// over every chord of the key. Every two or three minutes a new section begins: another key, another progression,
// another pace, register and instrument, so the music keeps varying without ever falling silent.

/** Steps of the major scale, in semitones from the key note. */
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
/** The major pentatonic scale: no fourth and no seventh, so no note clashes with the chords below. */
const PENTATONIC = [0, 2, 4, 7, 9];
/** Keys a section may take, as MIDI numbers of the key note in the octave of the chords (D3 = 50). */
const KEYS = [50, 55, 57, 48, 52, 53];
/** Progressions as scale degrees (0 = I, 5 = vi, 3 = IV, 4 = V, 1 = ii, 2 = iii). */
export const PROGRESSIONS: number[][] = [
  [0, 5, 3, 4],
  [0, 3, 5, 4],
  [5, 3, 0, 4],
  [0, 2, 3, 3],
  [0, 4, 5, 3],
  [3, 0, 4, 5],
  [0, 1, 3, 4],
];
export type Instrument = "pluck" | "bell" | "flute";
const INSTRUMENTS: Instrument[] = ["pluck", "bell", "flute"];

export interface Section {
  /** MIDI number of the key note. */
  key: number;
  progression: number[];
  /** Seconds each chord lasts. */
  chordSeconds: number;
  /** Seconds of one beat of the melody. */
  beat: number;
  /** Transposition of the melody in semitones (0 or 12). */
  register: number;
  instrument: Instrument;
  /** How likely a phrase is to follow the last one soon, in [0, 1]. */
  density: number;
  /** Brightness of the chord bed: the cut-off of its filter in hertz. */
  brightness: number;
  /** How long the section lasts, in seconds. */
  seconds: number;
}

export interface Note {
  midi: number;
  /** Start, in seconds from the beginning of the phrase. */
  at: number;
  /** Length in seconds. */
  length: number;
  /** Loudness in [0, 1]. */
  velocity: number;
}

const pick = <T>(random: () => number, items: T[]) => items[Math.floor(random() * items.length)]!;

/** A new section, unlike the previous one in key or progression where possible. */
export function newSection(random: () => number, previous?: Section): Section {
  let key = pick(random, KEYS), progression = pick(random, PROGRESSIONS);
  for (let tries = 0; previous && tries < 6 && (key === previous.key || progression === previous.progression); tries++) {
    key = pick(random, KEYS);
    progression = pick(random, PROGRESSIONS);
  }
  return {
    key,
    progression,
    chordSeconds: 9 + Math.floor(random() * 4) * 2,
    beat: 0.42 + random() * 0.3,
    register: random() < 0.6 ? 12 : 0,
    instrument: pick(random, INSTRUMENTS),
    density: 0.45 + random() * 0.45,
    brightness: 700 + random() * 900,
    seconds: 110 + random() * 80,
  };
}

/** The notes of the chord on scale degree `degree`: bass, then the triad spread over an octave, sometimes with a ninth. */
export function chordNotes(section: Section, degree: number, random: () => number): { bass: number; tones: number[] } {
  const step = (d: number) => section.key + MAJOR[((d % 7) + 7) % 7]! + 12 * Math.floor(d / 7);
  const root = step(degree);
  const tones = [root, step(degree + 2), step(degree + 4)];
  // Open voicing: the third up an octave now and then, and a ninth for colour.
  if (random() < 0.5) tones[1]! += 12;
  if (random() < 0.35) tones.push(step(degree + 8));
  return { bass: root - 12, tones };
}

/**
 * A short phrase of the melody: a walk up and down the pentatonic scale, ending on a long note.
 * `from` is the MIDI note the last phrase ended on, so phrases join smoothly.
 */
export function phrase(section: Section, random: () => number, from?: number): { notes: Note[]; seconds: number; last: number } {
  const scale: number[] = [];
  for (let octave = 0; octave < 3; octave++) for (const s of PENTATONIC) scale.push(section.key + section.register + 12 * octave + s);
  let i = from === undefined ? 5 + Math.floor(random() * 4) : nearestIndex(scale, from);
  const count = 3 + Math.floor(random() * 6);
  const notes: Note[] = [];
  let at = 0;
  for (let n = 0; n < count; n++) {
    const last = n === count - 1;
    const beats = last ? pick(random, [2, 3, 4]) : pick(random, [0.5, 1, 1, 1, 1.5, 2]);
    const length = beats * section.beat;
    notes.push({ midi: scale[i]!, at, length: last ? length * 1.6 : length * 1.3, velocity: last ? 0.8 : 0.55 + random() * 0.35 });
    at += length;
    // Mostly steps, now and then a leap; kept within the scale's range.
    const move = random() < 0.8 ? pick(random, [-1, 1, 1, -1, 2, -2]) : pick(random, [3, -3, 4, -4]);
    i = Math.min(Math.max(i + move, 2), scale.length - 3);
  }
  return { notes, seconds: at, last: notes[notes.length - 1]!.midi };
}

function nearestIndex(scale: number[], midi: number): number {
  let best = 0;
  scale.forEach((m, k) => Math.abs(m - midi) < Math.abs(scale[best]! - midi) && (best = k));
  return best;
}

/** The rest after a phrase, in seconds: short when the section is dense, never so long that the melody is missed. */
export function restAfter(section: Section, random: () => number): number {
  return section.beat * (random() < section.density ? 1 + random() * 3 : 4 + random() * 6);
}

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}
