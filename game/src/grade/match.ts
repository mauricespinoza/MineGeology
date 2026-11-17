// Matching the student's units to the true ones. Students name units freely, so before anything can be
// compared, each student unit is paired with the true unit (or the group of units the scenario allows to
// be lumped) that it overlaps most, one to one, maximising the total overlap.

/** Maximum-weight assignment on a rectangular matrix (Hungarian algorithm). Returns the column of each row, or -1. */
export function assign(weights: number[][]): number[] {
  const rows = weights.length, cols = rows ? weights[0]!.length : 0;
  const n = Math.max(rows, cols);
  if (n === 0) return [];
  let max = 0;
  for (const row of weights) for (const w of row) max = Math.max(max, w);
  // Minimise cost = max - weight on a square matrix padded with zeros of weight.
  const cost = (i: number, j: number) => max - (i < rows && j < cols ? weights[i]![j]! : 0);
  const u = new Float64Array(n + 1), v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1), way = new Int32Array(n + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(Infinity);
    const used = new Uint8Array(n + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0]!;
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost(i0 - 1, j - 1) - u[i0]! - v[j]!;
        if (cur < minv[j]!) ((minv[j] = cur), (way[j] = j0));
        if (minv[j]! < delta) ((delta = minv[j]!), (j1 = j));
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) ((u[p[j]!] = u[p[j]!]! + delta), (v[j] = v[j]! - delta));
        else minv[j] = minv[j]! - delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0);
  }
  const out = new Array<number>(rows).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j]! - 1 < rows && j - 1 < cols) out[p[j]! - 1] = j - 1;
  // A pairing with no overlap at all is no pairing.
  return out.map((j, i) => (j >= 0 && weights[i]![j]! > 0 ? j : -1));
}

export interface Matching {
  /** For each student unit id, the true unit indices it stands for (one, or a lumped group); absent when unmatched. */
  classes: Map<number, number[]>;
  /** The true classes considered, after lumping. */
  trueClasses: number[][];
}

/**
 * Pairs student units with true units by overlap on the map. `lumpable` lists groups of true unit indices
 * that may be mapped as one; every combination of lumping them or not is tried and the best kept.
 */
export function matchUnits(student: Int32Array, truth: ArrayLike<number>, studentUnits: number[], trueCount: number, lumpable: number[][]): Matching {
  const overlap = studentUnits.map(() => new Float64Array(trueCount));
  const index = new Map(studentUnits.map((u, i) => [u, i]));
  for (let c = 0; c < student.length; c++) {
    const s = index.get(student[c]!);
    if (s !== undefined) overlap[s]![truth[c]!] = overlap[s]![truth[c]!]! + 1;
  }
  let best: Matching = { classes: new Map(), trueClasses: [] };
  let bestTotal = -1;
  for (let mask = 0; mask < 1 << lumpable.length; mask++) {
    const merged = lumpable.filter((_, g) => mask & (1 << g));
    const inGroup = new Set(merged.flat());
    const classes: number[][] = [...merged];
    for (let t = 0; t < trueCount; t++) if (!inGroup.has(t)) classes.push([t]);
    const weights = studentUnits.map((_, s) => classes.map((cls) => cls.reduce((sum, t) => sum + overlap[s]![t]!, 0)));
    const pick = assign(weights);
    const total = pick.reduce((sum, j, s) => sum + (j >= 0 ? weights[s]![j]! : 0), 0);
    if (total > bestTotal) {
      bestTotal = total;
      const map = new Map<number, number[]>();
      pick.forEach((j, s) => j >= 0 && map.set(studentUnits[s]!, classes[j]!));
      best = { classes: map, trueClasses: classes };
    }
  }
  return best;
}

/**
 * Agreement corrected for chance (Cohen's kappa), weighted per cell: 1 is perfect, 0 what blind guessing
 * with the same proportions would give; negative values are returned as 0.
 */
export function kappa(student: ArrayLike<number>, truth: ArrayLike<number>, matching: Matching, weight?: ArrayLike<number>): number {
  const classOf = new Map<number, number>();
  matching.trueClasses.forEach((cls, k) => cls.forEach((t) => classOf.set(t, k)));
  const k = matching.trueClasses.length;
  const pStudent = new Float64Array(k), pTruth = new Float64Array(k);
  let agree = 0, total = 0;
  for (let c = 0; c < truth.length; c++) {
    if (truth[c]! < 0) continue;
    const w = weight ? weight[c]! : 1;
    if (w <= 0) continue;
    total += w;
    const tc = classOf.get(truth[c]!)!;
    pTruth[tc] = pTruth[tc]! + w;
    const cls = matching.classes.get(student[c]!);
    if (cls) {
      const sc = matching.trueClasses.indexOf(cls);
      pStudent[sc] = pStudent[sc]! + w;
      if (sc === tc) agree += w;
    }
  }
  if (total === 0) return 0;
  let chance = 0;
  for (let j = 0; j < k; j++) chance += (pStudent[j]! / total) * (pTruth[j]! / total);
  const po = agree / total;
  return chance >= 1 ? (po >= 1 ? 1 : 0) : Math.max(0, (po - chance) / (1 - chance));
}
