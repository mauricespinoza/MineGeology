import { describe, expect, it } from "vitest";
import { PROGRESSIONS, chordNotes, midiToHz, newSection, phrase, restAfter } from "../src/audio/composer";
import { generator } from "../src/tools/random";

const MAJOR = new Set([0, 2, 4, 5, 7, 9, 11]);
const PENTATONIC = new Set([0, 2, 4, 7, 9]);
const degreeOf = (midi: number, key: number) => (((midi - key) % 12) + 12) % 12;

describe("the music", () => {
  it("plays chords of the section's key, with a bass below", () => {
    const random = generator(1);
    for (let k = 0; k < 40; k++) {
      const s = newSection(random);
      for (const degree of s.progression) {
        const { bass, tones } = chordNotes(s, degree, random);
        for (const m of [bass, ...tones]) expect(MAJOR.has(degreeOf(m, s.key))).toBe(true);
        expect(bass).toBeLessThan(Math.min(...tones));
        expect(tones.length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("keeps the melody on the pentatonic scale, in a singable range, and joins phrases", () => {
    const random = generator(2);
    const s = newSection(random);
    let last: number | undefined;
    for (let k = 0; k < 50; k++) {
      const p = phrase(s, random, last);
      if (last !== undefined) expect(Math.abs(p.notes[0]!.midi - last)).toBeLessThanOrEqual(3);
      for (const n of p.notes) {
        expect(PENTATONIC.has(degreeOf(n.midi, s.key))).toBe(true);
        expect(midiToHz(n.midi)).toBeGreaterThan(100);
        expect(midiToHz(n.midi)).toBeLessThan(1400);
      }
      expect(p.seconds).toBeGreaterThan(0);
      last = p.last;
    }
  });

  it("never falls silent: chords overlap and rests between phrases stay short", () => {
    const random = generator(3);
    for (let k = 0; k < 100; k++) {
      const s = newSection(random);
      // Each chord holds for chordSeconds and fades over 6 s, while the next one swells: no gap in the bed.
      expect(s.chordSeconds).toBeGreaterThanOrEqual(9);
      expect(restAfter(s, random)).toBeLessThanOrEqual(10 * s.beat + 1e-9);
    }
  });

  it("varies: new sections change key or progression, and every progression gets used", () => {
    const random = generator(4);
    let s = newSection(random);
    const used = new Set<number[]>();
    let changed = 0;
    for (let k = 0; k < 200; k++) {
      const next = newSection(random, s);
      if (next.key !== s.key || next.progression !== s.progression) changed++;
      used.add(next.progression);
      s = next;
    }
    expect(changed).toBe(200);
    expect(used.size).toBe(PROGRESSIONS.length);
  });
});
