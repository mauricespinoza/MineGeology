// Seeded random numbers, so that a student's readings are theirs and survive a reload.

/** A 32-bit hash of any mix of strings and numbers. */
export function hash(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const ch of parts.join("\u0001")) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  return (h ^ (h >>> 13)) >>> 0;
}

/** mulberry32: a small generator of numbers in [0, 1). */
export function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A standard normal deviate (Box-Muller). */
export function normal(random: () => number): number {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}
