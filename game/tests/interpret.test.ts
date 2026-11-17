import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contourLines, contourSet, midpoint, pathLength } from "../src/interpret/contours";
import { toGeoJSON } from "../src/interpret/geojson";
import {
  type MapState, addLine, addPolygon, addUnit, clone, distanceToPath, emptyMap, nearestFeature, pointInPolygon, rasterize, removeFeature, removeUnit, signedArea, unitAt,
} from "../src/interpret/mapdata";
import { buildMapPdf, mapScaleDenominator } from "../src/interpret/mapPdf";
import { Content, buildPdf, latin1, textWidth } from "../src/interpret/pdf";
import {
  collect, eigen, fitOrientations, greatCircle, lineVector, planeOfPole, poleVector, project, trendPlunge, type Vec,
} from "../src/interpret/stereonet";
import { meanPlanes, strikeDipSymbol } from "../src/interpret/symbols";
import { expandTruthMap, loadPracticeTruth, loadScenario, loadTruth } from "../src/format/loader";
import { deserialize, serialize } from "../src/state/save";
import { newGame } from "../src/state/state";
import { generator, normal } from "../src/tools/random";
import { buildGrid } from "../src/world/blocks";
import { studentMapFromTruth } from "./helpers/studentMap";

const TOY = fileURLToPath(new URL("../../format/examples/toy/", import.meta.url));
const LITRES = fileURLToPath(new URL("../../baked/quebrada-los-litres-a/", import.meta.url));
const reader = (folder: string) => async (path: string) => new Uint8Array(await readFile(folder + path));
const square = (x: number, y: number, s: number) => [x, y, x + s, y, x + s, y + s, x, y + s];

describe("map data", () => {
  it("measures rings and tests points in them", () => {
    expect(signedArea(square(0, 0, 10))).toBe(100);
    expect(signedArea([...square(0, 0, 10)].reverse().flatMap((v, i, a) => (i % 2 ? [] : [a[i + 1]!, v])))).toBe(-100);
    const ring = square(0, 0, 10);
    expect(pointInPolygon(5, 5, ring)).toBe(true);
    expect(pointInPolygon(15, 5, ring)).toBe(false);
    expect(pointInPolygon(5, -0.1, ring)).toBe(false);
    const concave = [0, 0, 10, 0, 10, 10, 5, 4, 0, 10]; // a notch from the top
    expect(pointInPolygon(5, 8, concave)).toBe(false);
    expect(pointInPolygon(5, 2, concave)).toBe(true);
    expect(distanceToPath(5, 3, [0, 0, 10, 0], false)).toBe(3);
    expect(distanceToPath(13, 4, [0, 0, 10, 0], false)).toBe(5);
    expect(distanceToPath(5, 5, ring, true)).toBe(5);
  });

  it("keeps units, lines and polygons, and removes what belongs to a unit", () => {
    const map = emptyMap();
    const a = addUnit(map, "  andesita ");
    const b = addUnit(map, "arenisca");
    expect(a.name).toBe("andesita");
    expect(a.colour).not.toBe(b.colour);
    addPolygon(map, a.id, square(0, 0, 10));
    addPolygon(map, b.id, square(20, 0, 10));
    const fault = addLine(map, "fault", "dashed", [0, 0, 5, 5], "reverse");
    expect(fault.kinematics).toBe("reverse");
    expect(addLine(map, "contact", "solid", [0, 0, 5, 5], "normal").kinematics).toBeUndefined(); // only faults have kinematics
    expect(new Set([a.id, b.id, fault.id, ...map.polygons.map((p) => p.id), ...map.lines.map((l) => l.id)]).size).toBe(6);
    const copy = clone(map);
    removeUnit(map, a.id);
    expect(map.units.map((u) => u.name)).toEqual(["arenisca"]);
    expect(map.polygons).toHaveLength(1);
    expect(copy.polygons).toHaveLength(2); // the copy is independent
  });

  it("finds the feature nearest to a click, and lets the last polygon win where they overlap", () => {
    const map = emptyMap();
    const a = addUnit(map, "a"), b = addUnit(map, "b");
    const big = addPolygon(map, a.id, square(0, 0, 100));
    const small = addPolygon(map, b.id, square(40, 40, 20));
    const line = addLine(map, "contact", "solid", [0, 120, 100, 120]);
    expect(nearestFeature(map, 50, 124, 8)).toEqual({ type: "line", id: line.id });
    expect(nearestFeature(map, 50, 135, 8)).toBeNull();
    expect(nearestFeature(map, 0.5, 50, 8)).toEqual({ type: "polygon", id: big.id }); // its outline
    expect(nearestFeature(map, 70, 70, 3)).toEqual({ type: "polygon", id: big.id }); // inside the big one only
    expect(nearestFeature(map, 50, 50, 3)).toEqual({ type: "polygon", id: small.id }); // inside both: the later one
    expect(unitAt(map, 50, 50)).toBe(b.id);
    expect(unitAt(map, 10, 10)).toBe(a.id);
    expect(unitAt(map, 500, 500)).toBe(-1);
    removeFeature(map, { type: "polygon", id: small.id });
    expect(unitAt(map, 50, 50)).toBe(a.id);
  });

  it("turns polygons into a raster of units, later polygons over earlier ones", () => {
    const map = emptyMap();
    const a = addUnit(map, "a"), b = addUnit(map, "b");
    addPolygon(map, a.id, square(0, 0, 40));
    addPolygon(map, b.id, square(20, 20, 40));
    const grid = rasterize(map, 8, 8, 10); // cell centres at 5, 15, 25, ...
    const at = (ix: number, iy: number) => grid[ix + 8 * iy];
    expect(at(0, 0)).toBe(a.id);
    expect(at(3, 3)).toBe(b.id); // (35, 35) is in both: b was drawn last
    expect(at(1, 3)).toBe(a.id);
    expect(at(5, 5)).toBe(b.id);
    expect(at(7, 7)).toBe(-1);
    expect([...grid].filter((v) => v === a.id).length).toBe(16 - 4);
    expect([...grid].filter((v) => v === b.id).length).toBe(16);
  });
});

describe("contours", () => {
  const lattice = (n: number, f: (x: number, y: number) => number, cell = 10) => {
    const values = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) values[i + n * j] = f((i + 0.5) * cell, (j + 0.5) * cell);
    return values;
  };

  it("draws a straight line across a tilted plane, at exactly the right place", () => {
    const values = lattice(20, (x) => 0.1 * x); // 1 m of height per 10 m east
    const lines = contourLines(values, 20, 20, 5, 5, 10, 10, 8.5);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    for (let i = 0; i < line.length; i += 2) expect(line[i]).toBeCloseTo(85, 4);
    expect(Math.min(...line.filter((_, i) => i % 2))).toBeCloseTo(5, 4);
    expect(Math.max(...line.filter((_, i) => i % 2))).toBeCloseTo(195, 4);
    expect(contourLines(values, 20, 20, 5, 5, 10, 10, 50)).toEqual([]); // above everything
  });

  it("closes a loop around a hill, on the level asked for", () => {
    const values = lattice(40, (x, y) => 100 - Math.hypot(x - 200, y - 200) / 2); // a cone: 1 m per 2 m of radius
    const lines = contourLines(values, 40, 40, 5, 5, 10, 10, 70); // radius 60 m
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect([line[0], line[1]]).toEqual([line[line.length - 2], line[line.length - 1]]); // closed
    for (let i = 0; i < line.length; i += 2) expect(Math.hypot(line[i]! - 200, line[i + 1]! - 200)).toBeGreaterThan(58);
    for (let i = 0; i < line.length; i += 2) expect(Math.hypot(line[i]! - 200, line[i + 1]! - 200)).toBeLessThan(62);
    expect(pathLength(line)).toBeGreaterThan(2 * Math.PI * 58);
    const [mx, my] = midpoint(line);
    expect(Math.hypot(mx - 200, my - 200)).toBeGreaterThan(55);
  });

  it("joins every segment into one line, also across a saddle", () => {
    // Two hills 200 m apart: one closed loop where their 110 m circles overlap, two where 40 m circles do not.
    const f = (x: number, y: number) => 100 - Math.min(Math.hypot(x - 150, y - 250), Math.hypot(x - 350, y - 250)) / 2;
    const values = lattice(50, f);
    const joined = contourLines(values, 50, 50, 5, 5, 10, 10, 45);
    expect(joined).toHaveLength(1);
    expect([joined[0]![0], joined[0]![1]]).toEqual([joined[0]![joined[0]!.length - 2], joined[0]![joined[0]!.length - 1]]);
    expect(contourLines(values, 50, 50, 5, 5, 10, 10, 80)).toHaveLength(2);
    // The checkerboard case: a saddle in a single cell must still give two separate segments, not a crossing.
    const saddle = new Float32Array([1, 0, 0, 1]);
    expect(contourLines(saddle, 2, 2, 0, 0, 10, 10, 0.5)).toHaveLength(2);
  });

  it("makes a set of levels with index lines every fifth", () => {
    const set = contourSet(lattice(40, (x, y) => 100 + 400 - Math.hypot(x - 200, y - 200)), 40, 40, 10, 50);
    // The ground runs from about 224 m in the corners to 493 m on the summit.
    expect(set.map((l) => l.level)).toEqual([250, 300, 350, 400, 450]);
    expect(set.filter((l) => l.index).map((l) => l.level)).toEqual([250]);
  });
});

describe("stereonet", () => {
  const close = (a: [number, number], b: [number, number], tol = 1e-9) => {
    expect(a[0]).toBeCloseTo(b[0], -Math.log10(tol));
    expect(a[1]).toBeCloseTo(b[1], -Math.log10(tol));
  };

  it("projects with the right orientation and equal area", () => {
    close(project(lineVector(123, 90)), [0, 0]); // a vertical line is the centre
    close(project(poleVector(77, 0)), [0, 0]); // the pole of a horizontal plane
    close(project(poleVector(0, 90)), [-1, 0]); // a vertical N-S plane: its pole is a horizontal line pointing west
    close(project(lineVector(0, 0)), [0, 1]);
    close(project(lineVector(90, 0)), [1, 0]);
    // Equal area: the squared radius is proportional to the area of the cap, 1 - cos(angle from the centre).
    for (const plunge of [80, 60, 45, 20, 5]) {
      const [x, y] = project(lineVector(33, plunge));
      expect(x * x + y * y).toBeCloseTo(1 - Math.cos(((90 - plunge) * Math.PI) / 180), 9);
    }
    // A line and its opposite are the same line.
    close(project([0.3, 0.4, 0.5]), project([-0.3, -0.4, -0.5]));
  });

  it("converts between planes, poles and lines", () => {
    const pole = poleVector(0, 30); // strike north, dips east: the pole plunges 60 toward the west
    expect(trendPlunge(pole).trend).toBeCloseTo(270, 6);
    expect(trendPlunge(pole).plunge).toBeCloseTo(60, 6);
    const random = generator(4);
    for (let i = 0; i < 100; i++) {
      const strike = random() * 360, dip = 1 + random() * 88;
      const back = planeOfPole(poleVector(strike, dip));
      expect(back.dip).toBeCloseTo(dip, 6);
      expect(Math.abs(((back.strike - strike + 540) % 360) - 180)).toBeLessThan(1e-6);
    }
  });

  it("draws great circles through the strike line and the dip direction", () => {
    for (const [x] of greatCircle(0, 90)) expect(Math.abs(x)).toBeLessThan(1e-9); // vertical N-S plane: the N-S diameter
    const ys = greatCircle(0, 90).map(([, y]) => y);
    expect(Math.min(...ys)).toBeCloseTo(-1, 6);
    expect(Math.max(...ys)).toBeCloseTo(1, 6);
    for (const [x, y] of greatCircle(40, 0)) expect(Math.hypot(x, y)).toBeCloseTo(1, 9); // horizontal plane: the primitive circle
    const east = greatCircle(0, 45); // dips 45 east: bulges east to radius sqrt(2) sin(22.5 deg)
    expect(Math.max(...east.map(([x]) => x))).toBeCloseTo(Math.SQRT2 * Math.sin((22.5 * Math.PI) / 180), 6);
    expect(Math.min(...east.map(([x]) => x))).toBeGreaterThanOrEqual(-1e-9);
    close(east[0]!, [0, 1]);
    close(east[east.length - 1]!, [0, -1], 1e-6);
  });

  it("finds the axes of a symmetric matrix", () => {
    const { values, vectors } = eigen([[2, 0, 0], [0, 5, 0], [0, 0, 3]]);
    expect(values).toEqual([5, 3, 2]);
    expect(vectors[0]!.map(Math.abs)).toEqual([0, 1, 0]);
    const rotated = eigen([[3, 1, 0], [1, 3, 0], [0, 0, 1]]); // eigenvalues 4, 2, 1
    expect(rotated.values.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([4, 2, 1]);
    expect(Math.abs(rotated.vectors[0]![0]!)).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it("recognises a cluster and gives its mean plane", () => {
    const random = generator(8);
    const poles = Array.from({ length: 40 }, () => poleVector(355 + normal(random) * 4, 34 + normal(random) * 3));
    const fit = fitOrientations(poles)!;
    expect(fit.shape).toBe("cluster");
    expect(fit.values[0]).toBeGreaterThan(0.98);
    expect(Math.abs(((fit.meanPlane.strike - 355 + 540) % 360) - 180)).toBeLessThan(2);
    expect(fit.meanPlane.dip).toBeCloseTo(34, 0);
    expect(fitOrientations([poleVector(10, 20), poleVector(12, 22)])!.shape).toBe("too_few");
    expect(fitOrientations([])).toBeNull();
  });

  it("recovers the axis of a fold from the poles of its limbs", () => {
    // Planes that all contain the line trend 020, plunge 10: their poles lie on a great circle 90 deg from it.
    const axis = lineVector(20, 10);
    const u = [-axis[1], axis[0], 0].map((v) => v / Math.hypot(axis[0], axis[1])) as Vec; // horizontal, perpendicular to the axis
    const w: Vec = [axis[1] * u[2] - axis[2] * u[1], axis[2] * u[0] - axis[0] * u[2], axis[0] * u[1] - axis[1] * u[0]];
    const random = generator(21);
    const poles = (from: number, to: number, n: number) =>
      Array.from({ length: n }, (_, i) => {
        const phi = ((from + ((to - from) * i) / (n - 1)) * Math.PI) / 180;
        const noisy = ((phi * 180) / Math.PI + normal(random) * 2) * (Math.PI / 180);
        return [0, 1, 2].map((k) => Math.cos(noisy) * u[k]! + Math.sin(noisy) * w[k]!) as Vec;
      });
    const cases: [string, Vec[]][] = [["whole girdle", poles(0, 180, 30)], ["two limbs", [...poles(40, 60, 8), ...poles(120, 140, 8)]]];
    for (const [label, set] of cases) {
      const fit = fitOrientations(set)!;
      expect(fit.shape, label).toBe("girdle");
      const found = lineVector(fit.girdleAxis.trend, fit.girdleAxis.plunge);
      const angle = (Math.acos(Math.min(1, Math.abs(found[0] * axis[0] + found[1] * axis[1] + found[2] * axis[2]))) * 180) / Math.PI;
      expect(angle, label).toBeLessThan(1.5);
      expect(fit.girdleAxis.trend).toBeCloseTo(20, -1);
      expect(fit.girdleAxis.plunge).toBeCloseTo(10, -1);
    }
    expect(fitOrientations(Array.from({ length: 30 }, () => lineVector(random() * 360, Math.asin(random()) * (180 / Math.PI))))!.shape).toBe("scattered");
  });

  it("filters the student's measurements by feature, rock name and station", () => {
    const state = newGame({ manifest: { scenario_id: "x", variant: "a" } } as never, { nx: 2, ny: 2, cell: 10, cover: new Uint8Array(4) } as never, 1);
    const reading = (feature: string, type: "plane" | "line", a: number, b: number) => ({ feature, planeId: "p1", type, a, b, day: 1, minutes: 0 });
    const station = (number: number, rock: string, measurements: ReturnType<typeof reading>[]) =>
      ({ number, outcrop: `o${number}`, easting: 0, northing: 0, elevation: 0, day: 1, minutes: 0, rock, text: "", sketch: [], notes: [], measurements });
    state.stations = [
      station(1, "andesita", [reading("bedding", "plane", 355, 34), reading("bedding", "plane", 359, 36), reading("dyke", "plane", 300, 85)]),
      station(2, "arenisca", [reading("bedding", "plane", 350, 30), reading("striae", "line", 85, 34)]),
    ];
    expect(collect(state.stations)).toHaveLength(5);
    expect(collect(state.stations, { feature: "bedding" })).toHaveLength(3);
    expect(collect(state.stations, { rock: "andesita" })).toHaveLength(3);
    expect(collect(state.stations, { rock: "andesita", feature: "dyke" })).toHaveLength(1);
    expect(collect(state.stations, { stations: new Set([2]) }).map((d) => d.feature)).toEqual(["bedding", "striae"]);
    expect(collect(state.stations, { rock: "nada" })).toEqual([]);
    expect(meanPlanes(state.stations[0]!)).toEqual([{ feature: "bedding", strike: 357, dip: 35, n: 2 }, { feature: "dyke", strike: 300, dip: 85, n: 1 }]);
    expect(meanPlanes(state.stations[1]!)).toEqual([{ feature: "bedding", strike: 350, dip: 30, n: 1 }]); // lines have no strike and dip
  });
});

describe("strike and dip symbol", () => {
  it("runs along strike with the tick toward the dip", () => {
    const g = strikeDipSymbol(0, 34, 10); // north-south line, dipping east
    expect(g.strike[0]).toBeCloseTo(0, 9);
    expect(g.strike[1]).toBeCloseTo(-5, 9);
    expect(g.strike[3]).toBeCloseTo(5, 9);
    expect(g.tick[2]).toBeGreaterThan(0); // the tick points east
    expect(Math.abs(g.tick[3])).toBeLessThan(1e-9);
    expect(g.label[0]).toBeGreaterThan(g.tick[2]); // the number sits beyond the tick
    const southwest = strikeDipSymbol(135, 20, 10); // dips to 225: south-west
    expect(southwest.tick[2]).toBeLessThan(0);
    expect(southwest.tick[3]).toBeLessThan(0);
  });
});

describe("GeoJSON export", () => {
  it("writes the whole map in the scenario's grid with closed rings", async () => {
    const scenario = await loadScenario(reader(TOY));
    const state = newGame(scenario, buildGrid(scenario), 1);
    const a = addUnit(state.map, "lava"), b = addUnit(state.map, "brecha");
    addPolygon(state.map, a.id, square(0, 0, 80));
    addPolygon(state.map, b.id, square(80, 0, 80));
    addLine(state.map, "contact", "inferred", [80, 0, 85.5, 80, 80, 160]);
    addLine(state.map, "fault", "dashed", [10, 10, 70, 90], "sinistral");
    state.stations.push({ number: 1, outcrop: "o001", easting: 352040, northing: 5921050, elevation: 1042, day: 1, minutes: 5, rock: "lava", text: "nota", sketch: [], notes: [], measurements: [{ feature: "bedding", planeId: "p1", type: "plane", a: 358, b: 31, day: 1, minutes: 5 }] });

    const geo = toGeoJSON(scenario, state, new Date("2026-11-17T12:00:00Z"));
    expect(geo.type).toBe("FeatureCollection");
    expect(geo.geomapper).toMatchObject({ scenario: "toy-homocline", exported: "2026-11-17T12:00:00.000Z" });
    expect(JSON.parse(JSON.stringify(geo))).toEqual(geo); // plain JSON all the way down
    const byKind = (kind: string) => geo.features.filter((f) => f.properties.kind === kind);
    expect(byKind("unit")).toHaveLength(2);
    expect(byKind("contact")).toHaveLength(1);
    expect(byKind("fault")).toHaveLength(1);
    expect(byKind("station")).toHaveLength(1);
    expect(byKind("strike_dip")).toHaveLength(1);

    const polygon = byKind("unit")[0]!;
    const ring = (polygon.geometry.coordinates as number[][][])[0]!;
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
    expect(ring[0]).toEqual([352000, 5921000]); // model (0, 0) is the grid's origin
    expect(ring[2]).toEqual([352080, 5921080]);
    expect(polygon.properties).toMatchObject({ unit: "lava", colour: a.colour });
    expect(byKind("contact")[0]!.properties).toMatchObject({ style: "inferred", name_es: "Contacto inferido" });
    expect(byKind("fault")[0]!.properties).toMatchObject({ style: "dashed", name_es: "Falla aproximada", kinematics: "sinistral", kinematics_es: "sinistral" });
    expect(byKind("contact")[0]!.properties.kinematics).toBeUndefined();
    expect((byKind("contact")[0]!.geometry.coordinates as number[][])[1]).toEqual([352085.5, 5921080]);
    expect(byKind("strike_dip")[0]!.properties).toMatchObject({ station: 1, feature: "bedding", strike: 358, dip: 31 });
    expect(byKind("station")[0]!.geometry.coordinates).toEqual([352040, 5921050]);
  });
});

/** Checks the structure of a PDF the way a reader does: cross-reference table, offsets, lengths, trailer. */
function inspectPdf(bytes: Uint8Array) {
  const text = Buffer.from(bytes).toString("latin1");
  expect(text.startsWith("%PDF-1.4\n")).toBe(true);
  expect(text.endsWith("%%EOF\n")).toBe(true);
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)![1]);
  expect(text.slice(start, start + 5)).toBe("xref\n");
  const table = text.slice(start).split("\n");
  const [first, count] = table[1]!.split(" ").map(Number);
  expect(first).toBe(0);
  const offsets = table.slice(2, 2 + count!).map((row) => {
    expect(row).toMatch(/^\d{10} \d{5} [nf] $/);
    return Number(row.slice(0, 10));
  });
  offsets.slice(1).forEach((offset, i) => expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  expect(text).toContain(`/Size ${count}`);
  // Every declared stream length is the real one.
  for (const m of text.matchAll(/\/Length (\d+)[^>]*>>\nstream\n/g)) {
    const at = m.index! + m[0].length;
    expect(text.slice(at + Number(m[1]), at + Number(m[1]) + "\nendstream".length)).toBe("\nendstream");
  }
  return { text, objects: count! - 1, pages: (text.match(/\/Type \/Page /g) ?? []).length };
}

describe("PDF writer", () => {
  it("writes a valid file with text, vector graphics and an image, the same every time", () => {
    const c = new Content();
    c.save().clipRect(10, 10, 200, 100).alpha(0.5).fillColour("#ff8800").path([20, 20, 80, 20, 50, 70], true).fill().restore();
    c.save().strokeColour("#003366").lineWidth(1.5).dash([4, 2]).polyline([10, 10, 200, 110]).restore();
    c.circle(100, 60, 5).stroke();
    c.text(105, 40, "Año (m) \\ ¿qué? — ñandú", { size: 9, font: "bold", halo: 1.5 });
    c.image("Im1", 10, 10, 50, 50);
    const jpeg = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 1, height: 1 };
    const doc = { title: "Prueba (1)", pages: [{ width: 300, height: 200, content: c }], images: { Im1: jpeg } };
    const bytes = buildPdf(doc);
    const { text, objects, pages } = inspectPdf(bytes);
    expect(pages).toBe(1);
    expect(objects).toBe(5 + 1 + 2 + 1);
    expect(text).toContain("/MediaBox [0 0 300 200]");
    expect(text).toContain("/GA50 << /ca 0.5 /CA 0.5 >>");
    expect(text).toContain("/Filter /DCTDecode");
    expect(text).toContain("/Title (Prueba \\(1\\))");
    expect(text).toContain("(A\xf1o \\(m\\) \\\\ \xbfqu\xe9? ? \xf1and\xfa) Tj"); // Latin-1, with a "?" for the dash that does not fit it
    expect(text).toContain("1 0.53 0 rg"); // fill colour #ff8800 → 1, 0.53, 0
    expect(bytes).toEqual(buildPdf(doc));
    expect(textWidth("iiii", 10)).toBeLessThan(textWidth("MMMM", 10));
    expect(latin1("é€")).toEqual(new Uint8Array([233, 63]));
  });
});

describe("map PDF", () => {
  it("lays out title, frame, legend, scale bar and the student's drawing", async () => {
    const scenario = await loadScenario(reader(TOY));
    const state = newGame(scenario, buildGrid(scenario), 1);
    const a = addUnit(state.map, "lava gris"), b = addUnit(state.map, "una unidad con un nombre muy pero muy largo que no cabe en la columna");
    addPolygon(state.map, a.id, square(0, 0, 80));
    addPolygon(state.map, b.id, square(80, 0, 80));
    addLine(state.map, "contact", "solid", [80, 0, 80, 160]);
    addLine(state.map, "fault", "inferred", [10, 10, 70, 90], "reverse");
    state.stations.push({ number: 7, outcrop: "o001", easting: 352040, northing: 5921050, elevation: 1042, day: 1, minutes: 5, rock: "", text: "", sketch: [], notes: [], measurements: [{ feature: "bedding", planeId: "p1", type: "plane", a: 358, b: 31, day: 1, minutes: 5 }] });
    const elevation = Array.from({ length: 256 }, (_, i) => 1000 + (i % 16) * 3);
    const contours = contourSet(elevation, 16, 16, 10, 10);
    expect(contours.length).toBeGreaterThan(2);

    for (const paper of ["A4", "A3"] as const) {
      const { text, pages } = inspectPdf(buildMapPdf({ scenario, state, contours, paper, stamp: "17/11/2026" }));
      expect(pages).toBe(1);
      expect(text).toContain(paper === "A4" ? "/MediaBox [0 0 841.89 595.28]" : "/MediaBox [0 0 1190.55 841.84]".replace("841.84", "841.89"));
      for (const label of ["Homoclinal de juguete", "Mapa geol\xf3gico \xb7 17/11/2026", "Leyenda", "lava gris", "Contacto observado", "Falla inferida", "Escala gr\xe1fica", "Nombre:", "inversa", "(7) Tj"]) {
        expect(text, label).toContain(label);
      }
      expect(text).toContain("..."); // the long unit name is shortened
      expect(text).not.toContain("no cabe en la columna");
    }
    const withImage = inspectPdf(buildMapPdf({ scenario, state, contours, hillshade: { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 2, height: 2 } }));
    expect(withImage.text).toContain("/Im1 Do");
    expect(mapScaleDenominator(5.2)).toBe(14500);
  });
});

describe("saving the map", () => {
  it("keeps the map through a save and loads version 1 saves with an empty one", async () => {
    const scenario = await loadScenario(reader(TOY));
    const state = newGame(scenario, buildGrid(scenario), 1);
    const unit = addUnit(state.map, "lava");
    addPolygon(state.map, unit.id, square(0, 0, 50));
    addLine(state.map, "fault", "dashed", [0, 0, 10, 10, 20, 5], "thrust");
    const back = deserialize(serialize(state), state.scenarioId, state.variant)!;
    expect(back.map).toEqual(state.map);

    const old = JSON.parse(serialize(state));
    old.version = 1;
    delete old.map;
    const loaded = deserialize(JSON.stringify(old), state.scenarioId, state.variant)!;
    expect(loaded.map).toEqual(emptyMap());
    expect(loaded.stations).toEqual(state.stations);
    old.map = { units: "bad" };
    expect(deserialize(JSON.stringify(old), state.scenarioId, state.variant)!.map).toEqual(emptyMap());
    old.version = 3;
    expect(deserialize(JSON.stringify(old), state.scenarioId, state.variant)).toBeNull();
  });
});

describe("a complete map of Quebrada Los Litres", () => {
  it("can be drawn, scores against the true map and exports", async () => {
    const scenario = await loadScenario(reader(LITRES));
    const truth = (await loadPracticeTruth(reader(LITRES), scenario.manifest))!;
    expect(truth).not.toBeNull();
    const { nx, ny } = scenario.manifest.grid, cell = scenario.manifest.grid.cell_size_m.x;
    const trueMap = expandTruthMap(truth, scenario.manifest);

    const agreement = (map: MapState) => {
      const painted = rasterize(map, nx, ny, cell);
      const unitOfIndex = scenario.units.map((u) => map.units.find((m) => m.name === u.lithology)!.id);
      let same = 0;
      for (let i = 0; i < trueMap.length; i++) same += painted[i] === unitOfIndex[trueMap[i]!] ? 1 : 0;
      return same / trueMap.length;
    };

    const careful = studentMapFromTruth(scenario, truth, { jitter: 0, simplify: 3 });
    expect(careful.units).toHaveLength(scenario.units.length);
    expect(careful.polygons.length).toBeGreaterThanOrEqual(5);
    expect(careful.lines.length).toBe(truth.contacts.features.length);
    expect(agreement(careful)).toBeGreaterThan(0.99); // outlined from the true raster itself: a round trip

    const shaky = studentMapFromTruth(scenario, truth, { jitter: 12, simplify: 12, seed: 5 });
    expect(shaky.polygons.every((p) => p.points.length < 400)).toBe(true);
    expect(agreement(shaky)).toBeGreaterThan(0.95);
    expect(agreement(shaky)).toBeLessThan(agreement(careful));

    // An empty map agrees with nothing, and the wrong units agree with little.
    expect(agreement({ ...careful, polygons: [] })).toBe(0);

    const state = newGame(scenario, buildGrid(scenario), 3);
    state.map = careful;
    const geo = toGeoJSON(scenario, state);
    expect(geo.features.filter((f) => f.properties.kind === "unit").length).toBe(careful.polygons.length);
    const eastings = geo.features.flatMap((f) => (f.geometry.type === "Polygon" ? (f.geometry.coordinates as number[][][])[0]!.map((p) => p[0]!) : []));
    expect(Math.min(...eastings)).toBeGreaterThanOrEqual(scenario.manifest.grid.origin.easting - 1);
    expect(Math.max(...eastings)).toBeLessThanOrEqual(scenario.manifest.grid.origin.easting + nx * cell + 1);

    const { elevation } = buildGrid(scenario);
    const contours = contourSet(elevation, nx, ny, cell, 50);
    const bytes = buildMapPdf({ scenario, state, contours, stamp: "prueba" });
    const { pages } = inspectPdf(bytes);
    expect(pages).toBe(1);
    expect(bytes.length).toBeLessThan(2_000_000);
    const out = process.env.GEOMAPPER_OUT;
    if (out) {
      const { writeFile, mkdir } = await import("node:fs/promises");
      await mkdir(out, { recursive: true });
      await writeFile(`${out}/complete-map.pdf`, bytes);
      await writeFile(`${out}/complete-map.geojson`, JSON.stringify(geo));
      await writeFile(`${out}/complete-map.json`, JSON.stringify(careful));
    }
  });
});

describe("what the net says", () => {
  it("describes a cluster, a girdle and too little data in Spanish", async () => {
    const { describeFit } = await import("../src/interpret/stereonet");
    expect(describeFit(null)).toBe("No hay mediciones con estos filtros.");
    expect(describeFit(fitOrientations([poleVector(10, 20)]))).toBe("n = 1 planos. Se necesitan al menos 3 para ajustar.");
    const cluster = describeFit(fitOrientations([poleVector(355, 34), poleVector(358, 35), poleVector(352, 33), poleVector(356, 34)]));
    expect(cluster).toMatch(/^n = 4 planos, agrupados\. Plano medio 35\d\/3[34] [NE]+\./);
    const axis = lineVector(20, 10);
    const u = [-axis[1], axis[0], 0].map((v) => v / Math.hypot(axis[0], axis[1])) as Vec;
    const w: Vec = [axis[1] * u[2] - axis[2] * u[1], axis[2] * u[0] - axis[0] * u[2], axis[0] * u[1] - axis[1] * u[0]];
    const girdle = [30, 50, 70, 110, 130, 150].map((deg) => [0, 1, 2].map((k) => Math.cos((deg * Math.PI) / 180) * u[k]! + Math.sin((deg * Math.PI) / 180) * w[k]!) as Vec);
    expect(describeFit(fitOrientations(girdle))).toMatch(/en guirnalda\. Eje de pliegue \(π\) 10→020;/);
  });
});
