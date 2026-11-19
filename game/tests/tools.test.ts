import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { spend } from "../src/explore/clock";
import { loadPracticeTruth, loadScenario, loadTruth } from "../src/format/loader";
import type { Scenario, Truth } from "../src/format/types";
import { type Store, clear, deserialize, load, save, saveKey, serialize } from "../src/state/save";
import { newGame, rockNames } from "../src/state/state";
import { formatLine, formatPlane, readLine, readPlane, readingSeed } from "../src/tools/compass";
import { COST, type Field, POOR_OUTCROP, checkWayUp, describeRock, inspectContact, lookForKinematics, measurable, measure, readCompass, sampleResult, sampleTargets, samplesLeft, stationAt, takeSample, wellExposed } from "../src/tools/fieldwork";
import { generator, hash, normal } from "../src/tools/random";
import { measurementsCsv } from "../src/ui/notebook";
import { buildGrid } from "../src/world/blocks";

const TOY = fileURLToPath(new URL("../../format/examples/toy/", import.meta.url));
const fromDisk = async (path: string) => new Uint8Array(await readFile(TOY + path));
const SCATTER = { strike_sigma_deg: 5, dip_sigma_deg: 3, poor_quality_factor: 2 };

async function toyField(seed = 42): Promise<Field & { scenario: Scenario; truth: Truth }> {
  const scenario = await loadScenario(fromDisk);
  const truth = await loadTruth(fromDisk, scenario.manifest);
  return { scenario, truth, state: newGame(scenario, buildGrid(scenario), seed) };
}

function memoryStore(): Store & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

const stats = (values: number[]) => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return { mean, sd: Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) };
};

describe("random", () => {
  it("is repeatable and roughly normal", () => {
    expect(hash("a", 1)).toBe(hash("a", 1));
    expect(hash("a", 1)).not.toBe(hash("a", 2));
    expect(hash("ab", "c")).not.toBe(hash("a", "bc"));
    const a = generator(7), b = generator(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    const random = generator(99);
    const { mean, sd } = stats(Array.from({ length: 4000 }, () => normal(random)));
    expect(Math.abs(mean)).toBeLessThan(0.06);
    expect(sd).toBeGreaterThan(0.94);
    expect(sd).toBeLessThan(1.06);
  });
});

describe("compass", () => {
  const plane = { strike: 40, dip: 50 };
  const many = (quality: "good" | "poor", p = plane) => Array.from({ length: 3000 }, (_, i) => readPlane(p, quality, SCATTER, readingSeed(1, "o001", "p1:plane", i)));

  it("scatters readings around the true value by the scenario's sigmas", () => {
    const readings = many("good");
    const strike = stats(readings.map((r) => r.strike)), dip = stats(readings.map((r) => r.dip));
    expect(strike.mean).toBeCloseTo(40, 0);
    expect(dip.mean).toBeCloseTo(50, 0);
    expect(strike.sd).toBeGreaterThan(4.3);
    expect(strike.sd).toBeLessThan(5.7);
    expect(dip.sd).toBeGreaterThan(2.6);
    expect(dip.sd).toBeLessThan(3.4);
    expect(readings.every((r) => Number.isInteger(r.strike) && Number.isInteger(r.dip))).toBe(true);
  });

  it("is worse on poor outcrops and on gently dipping planes", () => {
    expect(stats(many("poor").map((r) => r.dip)).sd).toBeGreaterThan(1.7 * stats(many("good").map((r) => r.dip)).sd);
    const gentle = many("good", { strike: 40, dip: 10 });
    expect(stats(gentle.map((r) => r.strike)).sd).toBeGreaterThan(2 * stats(many("good").map((r) => r.strike)).sd);
  });

  it("gives the same reading for the same seed and a new one for the next reading", () => {
    const seed = readingSeed(5, "o010", "p1:plane", 0);
    expect(readPlane(plane, "good", SCATTER, seed)).toEqual(readPlane(plane, "good", SCATTER, seed));
    const all = new Set(Array.from({ length: 12 }, (_, i) => JSON.stringify(readPlane(plane, "good", SCATTER, readingSeed(5, "o010", "p1:plane", i)))));
    expect(all.size).toBeGreaterThan(6);
    expect(readingSeed(5, "o010", "p1:plane", 0)).not.toBe(readingSeed(6, "o010", "p1:plane", 0)); // another student
  });

  it("keeps readings in range for vertical and horizontal planes", () => {
    for (let i = 0; i < 500; i++) {
      for (const p of [{ strike: 350, dip: 89 }, { strike: 5, dip: 1 }]) {
        const r = readPlane(p, "poor", SCATTER, i);
        expect(r.strike).toBeGreaterThanOrEqual(0);
        expect(r.strike).toBeLessThan(360);
        expect(r.dip).toBeGreaterThanOrEqual(0);
        expect(r.dip).toBeLessThanOrEqual(90);
      }
      const l = readLine({ trend: 358, plunge: 88 }, "poor", SCATTER, i);
      expect(l.trend).toBeGreaterThanOrEqual(0);
      expect(l.trend).toBeLessThan(360);
      expect(l.plunge).toBeLessThanOrEqual(90);
    }
  });

  it("writes orientations the way a notebook does", () => {
    expect(formatPlane({ strike: 355, dip: 34 })).toBe("355/34 E");
    expect(formatPlane({ strike: 20, dip: 5 })).toBe("020/05 E");
    expect(formatPlane({ strike: 135, dip: 60 })).toBe("135/60 SO");
    expect(formatLine({ trend: 85, plunge: 34 })).toBe("34→085");
  });
});

describe("field tools", () => {
  it("opens one station per outcrop, at the outcrop's coordinates", async () => {
    const field = await toyField();
    const [o1, o2] = field.scenario.outcrops;
    const first = stationAt(field, o1!);
    expect(first).toMatchObject({ number: 1, outcrop: "o001", easting: Math.round(o1!.position.easting), rock: "", notes: [], measurements: [] });
    expect(stationAt(field, o1!)).toBe(first);
    expect(stationAt(field, o2!).number).toBe(2);
    expect(field.state.stations).toHaveLength(2);
  });

  it("describes the rock without ever naming the formation", async () => {
    const field = await toyField();
    const all: string[] = [];
    for (const outcrop of field.scenario.outcrops) {
      const done = describeRock(field, outcrop);
      expect(done.minutes).toBe(COST.lens);
      all.push(...done.result.lines, ...checkWayUp(field, outcrop).result.lines, ...inspectContact(field, outcrop).result.lines);
    }
    // The toy has no outcrop of the fossil-bearing sandstone, so look at one as if it were.
    const sandstone = structuredClone(field.scenario.outcrops[0]!);
    sandstone.observation!.unit = "u11";
    all.push(...describeRock({ ...field, state: newGame(field.scenario, buildGrid(field.scenario)) }, sandstone).result.lines);
    const text = all.join(" ");
    expect(text).toContain("Fenocristales de plagioclasa");
    expect(text).toContain("Fósiles: bivalvos trigónidos, fragmentos de amonites.");
    for (const unit of field.truth.units) {
      expect(text).not.toContain(unit.name);
      expect(text).not.toContain(unit.age.label);
    }
    expect(field.state.stations.every((s) => s.rock === "")).toBe(true); // naming is left to the student
  });

  it("measures bedding near the truth, differently each time, and the same after a reload", async () => {
    const field = await toyField(7);
    const outcrop = field.scenario.outcrops[0]!; // good quality, bedding 000/30
    expect(measurable(outcrop)).toEqual([{ planeId: "p1", type: "plane", feature: "bedding", label: "estratificación" }]);
    const readings = Array.from({ length: 30 }, () => measure(field, outcrop, "p1", "plane")!.result);
    expect(new Set(readings.map((r) => `${r.a}/${r.b}`)).size).toBeGreaterThan(10);
    const strikes = readings.map((r) => (r.a > 180 ? r.a - 360 : r.a));
    expect(Math.abs(stats(strikes).mean)).toBeLessThan(4);
    expect(Math.abs(stats(readings.map((r) => r.b)).mean - 30)).toBeLessThan(2.5);
    expect(field.state.stations[0]!.measurements).toHaveLength(30);

    const again = await toyField(7);
    expect(measure(again, again.scenario.outcrops[0]!, "p1", "plane")!.result).toMatchObject({ a: readings[0]!.a, b: readings[0]!.b });
    const other = await toyField(8);
    const theirs = Array.from({ length: 5 }, () => measure(other, other.scenario.outcrops[0]!, "p1", "plane")!.result);
    expect(theirs.map((r) => `${r.a}/${r.b}`)).not.toEqual(readings.slice(0, 5).map((r) => `${r.a}/${r.b}`));
    expect(measure(field, outcrop, "p9", "plane")).toBeNull();
    expect(measure(field, outcrop, "p1", "line")).toBeNull(); // bedding has no lineation
  });

  it("reports way-up and contacts only where the outcrop shows them", async () => {
    const field = await toyField();
    const [lava, breccia, contact] = field.scenario.outcrops;
    expect(checkWayUp(field, lava!).result.lines[0]).toBe("Vesículas concentradas hacia el techo de la colada.");
    expect(checkWayUp(field, lava!).result.lines[1]).toContain("posición normal");
    const none = inspectContact(field, breccia!); // a poor outcrop: nothing to see at a contact
    expect(none.result.lines[0]).toContain("no se distingue ningún contacto");
    expect(none.minutes).toBe(COST.lens);
    const seen = inspectContact(field, contact!);
    expect(seen.minutes).toBe(COST.contact);
    expect(seen.result.lines[0]).toBe("Contacto depositacional concordante.");
    expect(seen.result.lines).toContain("Al otro lado: arenisca calcárea.");
    expect(measurable(contact!).map((m) => m.label)).toEqual(["estratificación", "plano de contacto"]);
  });

  it("describes a poor outcrop only in part, but still measures its planes", async () => {
    const field = await toyField();
    const [lava, breccia] = field.scenario.outcrops;
    expect(breccia!.observation!.quality).toBe("poor");
    expect(wellExposed(lava!)).toBe(true);
    expect(wellExposed(breccia!)).toBe(false);
    const unit = field.scenario.units.find((u) => u.key === breccia!.observation!.unit)!;
    const lines = describeRock(field, breccia!).result.lines;
    expect(lines[0]).toBe(POOR_OUTCROP);
    expect(lines).toHaveLength(3);
    expect(lines.join(" ")).not.toContain(unit.description.hand_lens); // only part of what the lens shows
    expect(lines.some((l) => l.startsWith("Calidad del afloramiento"))).toBe(false);
    expect(measurable(breccia!)).toEqual([{ planeId: "p1", type: "plane", feature: "bedding", label: "estratificación" }]);
    expect(readCompass(field, breccia!, "p1", "plane")).not.toBeNull();
    expect(readCompass(field, breccia!, "p1", "line")).toBeNull();
    expect(checkWayUp(field, breccia!).result.lines[0]).toContain("meteorizada");
    expect(lookForKinematics(field, breccia!).minutes).toBe(COST.lens);
    // A good outcrop is described in full.
    const full = describeRock(field, lava!).result.lines;
    expect(full).toContain(`Con lupa: ${field.scenario.units.find((u) => u.key === lava!.observation!.unit)!.description.hand_lens}`);
  });

  it("limits samples and returns lab results the next field day", async () => {
    const field = await toyField();
    const rules = field.scenario.manifest.rules; // one sample, one field day in the toy
    const [lava, breccia] = field.scenario.outcrops;
    expect(samplesLeft(field)).toBe(1);
    expect(sampleTargets(field, breccia!)).toEqual([]); // poor outcrop
    expect(takeSample(field, breccia!, "u02", "age")).toContain("meteorizada");
    expect(takeSample(field, lava!, "u11", "age")).toContain("no se puede muestrear");

    const taken = takeSample(field, lava!, "u07", "age");
    expect(taken).toMatchObject({ minutes: COST.sample, result: { number: 1, station: 1, unit: "u07", analysis: "age", day: 1 } });
    expect(samplesLeft(field)).toBe(0);
    expect(takeSample(field, lava!, "u07", "thin_section")).toContain("No quedan muestras");

    const sample = field.state.samples[0]!;
    expect(sampleResult(field, sample, rules)).toBeNull(); // still at the lab
    field.state.clock.day = 2;
    expect(sampleResult(field, sample, rules)).toBe("Edad U-Pb en circón: 153,2 ± 1,1 Ma.");
    expect(sampleResult(field, { ...sample, analysis: "thin_section" }, rules)).toContain("Textura porfídica");
    expect(sampleResult(field, { ...sample, unit: "u02" }, rules)).toBe("La muestra no contenía material datable.");
    expect(sampleResult({ ...field, truth: null }, sample, rules)).toContain("no está disponible");

    // On the last day the result still arrives once the campaign is over.
    field.state.clock = { day: 1, minutes: 0 };
    expect(sampleResult(field, sample, rules)).toBeNull();
    spend(field.state.clock, rules.minutes_per_day, rules);
    expect(sampleResult(field, sample, rules)).not.toBeNull();
  });
});

describe("local save", () => {
  async function traverse(): Promise<Field> {
    const field = await toyField(3);
    const { state, scenario } = field;
    const [lava, breccia, contact] = scenario.outcrops;
    describeRock(field, lava!);
    measure(field, lava!, "p1", "plane");
    measure(field, lava!, "p1", "plane");
    takeSample(field, lava!, "u07", "thin_section");
    Object.assign(stationAt(field, lava!), { rock: "andesita morada", text: "Coladas gruesas.\nAmígdalas.", sketch: [[0.1, 0.2, 0.5, 0.6], [0.3, 0.3]] });
    checkWayUp(field, breccia!);
    stationAt(field, breccia!).rock = "brecha parda";
    inspectContact(field, contact!);
    measure(field, contact!, "p2", "plane");
    stationAt(field, contact!).rock = "brecha parda";
    state.walker = { x: 81.5, y: 33.25, heading: 271, pitch: -12 };
    state.clock = { day: 1, minutes: 187.5 };
    state.walked = 1234.5;
    state.found.visited.add(0).add(2);
    state.found.sighted.add(0).add(1).add(2);
    return field;
  }

  it("brings back a whole traverse with nothing lost", async () => {
    const { state } = await traverse();
    const store = memoryStore();
    expect(save(store, state)).toBe(true);
    const back = load(store, state.scenarioId, state.variant)!;
    expect(back).toEqual(state);
    expect(back.found.visited).toBeInstanceOf(Set);
    expect(back.stations).toHaveLength(3);
    expect(back.stations[0]!.measurements).toHaveLength(2);
    expect(back.stations[0]!.sketch).toEqual([[0.1, 0.2, 0.5, 0.6], [0.3, 0.3]]);
    expect(rockNames(back)).toEqual(["brecha parda", "andesita morada"]);
    // Saving again after the reload changes nothing but the time stamp.
    const strip = (text: string) => JSON.stringify({ ...JSON.parse(text), savedAt: "" });
    expect(strip(serialize(back))).toBe(strip(serialize(state)));
  });

  it("continues the same series of readings after a reload", async () => {
    const field = await traverse();
    const back = { ...field, state: deserialize(serialize(field.state), field.state.scenarioId, field.state.variant)! };
    const lava = field.scenario.outcrops[0]!;
    expect(measure(back, lava, "p1", "plane")!.result).toMatchObject({ a: measure(field, lava, "p1", "plane")!.result.a });
  });

  it("refuses saves it cannot trust and survives a browser that will not store", async () => {
    const { state } = await traverse();
    const text = serialize(state);
    expect(deserialize(text, "another-scenario", state.variant)).toBeNull();
    expect(deserialize(text, state.scenarioId, "b")).toBeNull();
    expect(deserialize("{not json", state.scenarioId, state.variant)).toBeNull();
    expect(deserialize(text.replace('"version":2', '"version":99'), state.scenarioId, state.variant)).toBeNull();
    expect(deserialize(JSON.stringify({ ...JSON.parse(text), stations: undefined }), state.scenarioId, state.variant)).toBeNull();

    const store = memoryStore();
    expect(load(store, state.scenarioId, state.variant)).toBeNull();
    save(store, state);
    expect([...store.data.keys()]).toEqual([saveKey(state.scenarioId, state.variant)]);
    clear(store, state.scenarioId, state.variant);
    expect(store.data.size).toBe(0);
    const full: Store = { getItem: () => null, removeItem: () => {}, setItem: () => { throw new Error("quota"); } };
    expect(save(full, state)).toBe(false);
  });

  it("exports measurements as CSV", async () => {
    const { state } = await traverse();
    const lines = measurementsCsv(state).trim().split("\n");
    expect(lines[0]).toBe("estacion,este,norte,cota,roca,tipo,elemento,rumbo_o_direccion,manteo_o_buzamiento,dia,minuto,anotado,notacion");
    expect(lines).toHaveLength(1 + 3);
    expect(lines[1]).toMatch(/^1,\d+,\d+,\d+,andesita morada,plano,bedding,\d+,\d+,1,\d+,\d{3}\/\d{2},rhr$/);
    expect(lines[3]).toContain("brecha parda,plano,contact");
  });
});

describe("practice answer key", () => {
  it("loads practice.bin and rejects one that does not match the manifest", async () => {
    const scenario = await loadScenario(fromDisk);
    const truthBytes = await fromDisk("truth.json");
    const hex = createHash("sha256").update(truthBytes).digest("hex");
    expect(hex).toBe(scenario.manifest.files.truth.sha256);
    const key = Buffer.from(hex, "hex");
    const pack = (bytes: Uint8Array) => new Uint8Array(gzipSync(bytes)).map((b, i) => b ^ key[i % 32]!);
    const withPractice = (packed: Uint8Array) => async (path: string) => (path === "practice.bin" ? packed : fromDisk(path));

    const truth = await loadPracticeTruth(withPractice(pack(truthBytes)), scenario.manifest);
    expect(truth).toEqual(await loadTruth(fromDisk, scenario.manifest));
    expect(await loadPracticeTruth(fromDisk, scenario.manifest)).toBeNull(); // the toy folder has no practice.bin
    const tampered = new TextEncoder().encode(new TextDecoder().decode(truthBytes).replace("153.2", "999.9"));
    await expect(loadPracticeTruth(withPractice(pack(tampered)), scenario.manifest)).rejects.toThrow(/does not match/);
  });
});
