// One end-to-end walk: load the scenario, walk, open the map. Run with the dev or preview server up:
//   node e2e/walk.mjs [url] [screenshot folder]
import { createRequire } from "node:module";

// Playwright may be installed globally rather than in this package.
const { chromium } = createRequire(import.meta.url)("playwright");

const url = process.argv[2] ?? "http://localhost:5173/";
const shots = process.argv[3];
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const check = (ok, message) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else console.log(`ok: ${message}`);
};

await page.goto(url);
await page.waitForFunction(() => window.__geomapper && !document.getElementById("overlay-button").hidden, null, { timeout: 60000 });
const title = await page.textContent("#overlay-title");
check(title && title.length > 0 && !title.startsWith("No se pudo"), `scenario loaded: ${title}`);
await page.click("#overlay-button");

const read = () =>
  page.evaluate(() => {
    const g = window.__geomapper;
    return { x: g.state.walker.x, y: g.state.walker.y, minutes: g.state.clock.minutes, stations: g.state.stations.length, walked: g.state.walked, fps: g.fps(), visited: g.state.found.visited.size, sighted: g.state.found.sighted.size, chunks: g.world.chunksLoaded, triangles: g.world.renderer.info.render.triangles };
  });

const before = await read();
check(before.chunks === Math.ceil(await page.evaluate(() => window.__geomapper.grid.nx) / 32) ** 2, `${before.chunks} chunks meshed`);
if (shots) await page.screenshot({ path: `${shots}/1-start.png` });

await page.keyboard.down("KeyW");
await page.waitForFunction(() => window.__geomapper.state.walked > 15, null, { timeout: 30000 }).catch(() => {});
await page.keyboard.up("KeyW");
const after = await read();
check(after.walked > 15, `walked ${after.walked.toFixed(0)} m`);
check(after.minutes > before.minutes, `field clock advanced ${after.minutes.toFixed(1)} min`);
check(await page.textContent("#clock").then((t) => t.startsWith("Día 1")), "clock shown");
if (shots) await page.screenshot({ path: `${shots}/2-walked.png` });

// Look around from the nearest outcrop, so the screenshot shows rock and bedding.
await page.evaluate(() => {
  const g = window.__geomapper, o = g.scenario.outcrops, org = g.scenario.manifest.grid.origin, w = g.state.walker;
  let best = o[0], bd = Infinity;
  for (const k of o) {
    const d = Math.hypot(k.position.easting - org.easting - w.x, k.position.northing - org.northing - w.y);
    if (d < bd && k.cells.length >= 6) { bd = d; best = k; }
  }
  const tx = best.position.easting - org.easting, ty = best.position.northing - org.northing;
  // Stand a few blocks away on the lowest side, so the outcrop's faces are in view.
  let low = Infinity;
  for (let a = 0; a < 360; a += 30) {
    const px = tx + 22 * Math.sin((a * Math.PI) / 180), py = ty + 22 * Math.cos((a * Math.PI) / 180);
    const h = g.heightAt(px, py);
    if (h < low) { low = h; w.x = px; w.y = py; }
  }
  w.heading = ((Math.atan2(tx - w.x, ty - w.y) * 180) / Math.PI + 360) % 360;
  w.pitch = 6;
});
await page.waitForTimeout(1500);
const near = await read();
check(near.visited >= 1, `${near.visited} outcrops visited, ${near.sighted} sighted`);
if (shots) await page.screenshot({ path: `${shots}/3-outcrop.png` });

// Work the outcrop: open the panel, use the tools, name the rock.
await page.waitForFunction(() => !document.getElementById("work-button").hidden, null, { timeout: 5000 });
await page.keyboard.press("KeyE");
await page.waitForSelector("#field-panel:not([hidden])");
await page.click('[data-do="lens"]');
for (let i = 0; i < 8; i++) await page.click('[data-do="measure"][data-type="plane"]');
await page.click('[data-do="way_up"]');
await page.fill("#station-rock", "roca de prueba");
await page.fill("#station-text", "Nota de la caminata automática.");
await page.dispatchEvent("#station-text", "change");
const box = await page.locator("#station-sketch").boundingBox();
await page.mouse.move(box.x + 30, box.y + 30);
await page.mouse.down();
await page.mouse.move(box.x + 120, box.y + 80, { steps: 5 });
await page.mouse.up();
if (shots) await page.screenshot({ path: `${shots}/5-panel.png` });
await page.keyboard.press("Escape");
const worked = await page.evaluate(() => structuredClone({ stations: window.__geomapper.state.stations, clock: window.__geomapper.state.clock, walker: window.__geomapper.state.walker, visited: window.__geomapper.state.found.visited.size }));
check(worked.stations.length === 1 && worked.stations[0].measurements.length === 8 && worked.stations[0].notes.length === 2, "station recorded: 8 measurements, 2 notes");
check(worked.stations[0].rock === "roca de prueba" && worked.stations[0].sketch.length === 1, "rock name and sketch recorded");
check(worked.clock.minutes > near.minutes + 15, "tools cost field time");

// Draw a map: units, an area, two contacts and a fault, with undo and erase; then export it.
const fs = await import("node:fs/promises");
const os = await import("node:os");
const outDir = shots ?? (await fs.mkdtemp(`${os.tmpdir()}/geomapper-`));
await page.keyboard.press("KeyM");
await page.waitForSelector("#map-canvas", { state: "visible" });
check(await page.isVisible("#map-toolbar"), "map board opens with its toolbar");
await page.fill("#unit-new", "andesita");
await page.click("#unit-add");
await page.fill("#unit-new", "arenisca");
await page.press("#unit-new", "Enter");
const at = (x, y) => page.evaluate(([x, y]) => window.__geomapper.board.toScreen(x, y), [x, y]);
const clickAt = async (x, y, options) => {
  const [sx, sy] = await at(x, y);
  await page.mouse.click(sx, sy, options);
};
await page.click('[data-tool="contact"]');
await clickAt(900, 900);
await page.keyboard.press("Escape"); // drops the line being drawn and stays in the map
check((await page.isVisible("#map-canvas")) && (await page.textContent("#map-hint")) === "Descartado." && (await page.evaluate(() => window.__geomapper.state.map.lines.length)) === 0, "Esc drops a line in progress and stays in the map");
await page.click('[data-tool="polygon"]');
// The area surrounds the station, so that the stereonet can filter by map unit.
const [stx, sty] = await page.evaluate(() => {
  const g = window.__geomapper, st = g.state.stations[0], o = g.scenario.manifest.grid.origin;
  return [st.easting - o.easting, st.northing - o.northing];
});
for (const [x, y] of [[stx - 600, sty - 700], [stx + 600, sty - 700], [stx + 600, sty + 600], [stx - 600, sty + 600]]) await clickAt(x, y);
await page.keyboard.press("Enter");
await page.click('[data-tool="contact"]');
await page.selectOption("#map-style", "dashed");
for (const [x, y] of [[1100, 300], [1250, 800]]) await clickAt(x, y);
await clickAt(1100, 1300, { clickCount: 2 }); // a double click finishes the line
await page.click('[data-tool="fault"]');
await page.selectOption("#map-style", "inferred");
await page.selectOption("#map-kin", "reverse");
for (const [x, y] of [[1500, 400], [1600, 1500]]) await clickAt(x, y);
await page.keyboard.press("Enter");
let map = await page.evaluate(() => structuredClone(window.__geomapper.state.map));
check(map.units.length === 2 && map.polygons.length === 1 && map.lines.length === 2, `drawn: ${map.units.length} units, ${map.polygons.length} area, ${map.lines.length} lines`);
check(map.polygons[0].points.length === 8 && map.polygons[0].unit === map.units[1].id, "the area has 4 vertices and uses the unit chosen last");
check(map.lines[0].style === "dashed" && map.lines[0].kind === "contact" && map.lines[0].points.length === 6, "the dashed contact has 3 points (the double click added none)");
check(map.lines[1].kind === "fault" && map.lines[1].style === "inferred" && map.lines[1].kinematics === "reverse", "the fault keeps its style and kinematics");
await page.keyboard.press("Control+z");
check((await page.evaluate(() => window.__geomapper.state.map.lines.length)) === 1, "Ctrl+Z removes the fault");
await page.click('[data-tool="erase"]');
await clickAt(1175, 550);
check((await page.evaluate(() => window.__geomapper.state.map.lines.length)) === 0, "erase removes the contact it clicks on");
await page.click("#map-undo");
await page.click('[data-tool="fault"]');
await page.selectOption("#map-style", "solid");
for (const [x, y] of [[1500, 400], [1600, 1500]]) await clickAt(x, y);
await page.keyboard.press("Enter");
await page.keyboard.press("Escape"); // nothing is being drawn, so Esc leaves the map
check(!(await page.isVisible("#map-canvas")), "Esc leaves the map");
await page.keyboard.press("KeyM");
if (shots) await page.screenshot({ path: `${shots}/7-board.png` });

const [geoDownload] = await Promise.all([page.waitForEvent("download"), page.click("#map-geojson")]);
await geoDownload.saveAs(`${outDir}/mapa.geojson`);
const geo = JSON.parse(await fs.readFile(`${outDir}/mapa.geojson`, "utf8"));
const kinds = geo.features.map((f) => f.properties.kind);
check(geoDownload.suggestedFilename().endsWith(".geojson") && geo.type === "FeatureCollection", `GeoJSON downloaded: ${geoDownload.suggestedFilename()}`);
check(kinds.includes("unit") && kinds.includes("contact") && kinds.includes("fault") && kinds.includes("station"), `GeoJSON holds ${[...new Set(kinds)].join(", ")}`);
const ring = geo.features.find((f) => f.properties.kind === "unit").geometry.coordinates[0];
check(ring.length === 5 && ring[0][0] > 300000, "GeoJSON coordinates are in the scenario grid, with a closed ring");

await page.selectOption("#map-paper", "A4");
const [pdfDownload] = await Promise.all([page.waitForEvent("download"), page.click("#map-pdf")]);
await pdfDownload.saveAs(`${outDir}/mapa.pdf`);
const pdf = await fs.readFile(`${outDir}/mapa.pdf`);
check(pdf.subarray(0, 8).toString() === "%PDF-1.4\n" || pdf.subarray(0, 5).toString() === "%PDF-", `PDF downloaded: ${pdfDownload.suggestedFilename()}, ${(pdf.length / 1024).toFixed(0)} kB`);
check(pdf.includes(Buffer.from("/DCTDecode")), "the PDF carries the shaded relief");

await page.keyboard.press("KeyS");
await page.waitForSelector("#stereonet:not([hidden])");
const stats = await page.textContent("#net-stats");
const trueBedding = await page.evaluate(() => {
  const g = window.__geomapper;
  const station = g.state.stations[0];
  return g.scenario.outcrops.find((o) => o.id === station.outcrop).observation.planes.find((p) => p.kind === "bedding");
});
const fitted = /n = 8 planos, agrupados\. Plano medio (\d{3})\/(\d{2})/.exec(stats);
check(fitted !== null, `stereonet: ${stats.slice(0, 80)}`);
const dStrike = Math.abs((((Number(fitted[1]) - trueBedding.strike) % 360) + 540) % 360 - 180);
check(dStrike < 10 && Math.abs(Number(fitted[2]) - trueBedding.dip) < 5, `the mean plane ${fitted[1]}/${fitted[2]} is close to the outcrop's true ${Math.round(trueBedding.strike)}/${Math.round(trueBedding.dip)}`);
await page.selectOption("#net-filter", { label: "roca de prueba" });
check(/n = 8 planos/.test(await page.textContent("#net-stats")), "stereonet filters by the rock name");
const unitOptions = await page.$$eval("#net-filter optgroup[label^='Por unidad'] option", (o) => o.map((x) => x.textContent));
check(unitOptions.length === 1 && unitOptions[0] === "arenisca", `only a unit with an area is offered as a filter: ${unitOptions}`);
await page.selectOption("#net-filter", { label: "arenisca" });
check(/n = 8 planos, agrupados/.test(await page.textContent("#net-stats")), "the stations inside the area of a map unit are selected by position");
await page.check('input[name="net-mode"][value="circles"]');
if (shots) await page.screenshot({ path: `${shots}/8-net.png` });
await page.keyboard.press("KeyS");
const drawn = await page.evaluate(() => structuredClone(window.__geomapper.state.map));

// Close and reopen: nothing may be lost. The page saves again as it closes, so compare with the state at
// that moment; the view direction is left out because the mouse may still turn the camera until then.
const snapshot = () => {
  const s = window.__geomapper.state;
  return structuredClone({ map: s.map, stations: s.stations, samples: s.samples, clock: s.clock, x: s.walker.x, y: s.walker.y, walked: s.walked, seed: s.seed, visited: [...s.found.visited].sort(), sighted: [...s.found.sighted].sort() });
};
const closing = await page.evaluate(snapshot);
await page.reload();
await page.waitForFunction(() => window.__geomapper && !document.getElementById("overlay-button").hidden, null, { timeout: 60000 });
check((await page.textContent("#overlay-button")) === "Continuar", "a saved attempt is offered on reopening");
await page.click("#overlay-button");
const reopened = await page.evaluate(snapshot);
check(JSON.stringify(reopened) === JSON.stringify(closing), "reopened attempt is identical: stations, samples, clock, position, discoveries");
for (const k of Object.keys(closing)) if (JSON.stringify(closing[k]) !== JSON.stringify(reopened[k])) console.error(`  ${k}: ${JSON.stringify(closing[k]).slice(0, 300)}\n  -> ${JSON.stringify(reopened[k]).slice(0, 300)}`);
check(reopened.stations.length === 1 && reopened.stations[0].measurements.length === 8 && reopened.stations[0].rock === "roca de prueba", "the station survived the reload");
check(JSON.stringify(reopened.map) === JSON.stringify(drawn) && reopened.map.polygons.length === 1, "the drawn map survived the reload");
await page.keyboard.press("KeyN");
await page.waitForSelector("#notebook:not([hidden])");
check((await page.textContent("#notebook")).includes("roca de prueba"), "notebook shows the station");
if (shots) await page.screenshot({ path: `${shots}/6-notebook.png` });
await page.keyboard.press("KeyN");

await page.keyboard.press("KeyM");
await page.waitForTimeout(400);
check(await page.isVisible("#map-canvas"), "map view opens");
if (shots) await page.screenshot({ path: `${shots}/4-map.png` });
await page.keyboard.press("KeyM");
await page.waitForTimeout(3000);
const end = await read();
console.log(`frame rate in this browser: ${end.fps.toFixed(0)} fps, ${end.triangles} triangles drawn`);
check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
await browser.close();
