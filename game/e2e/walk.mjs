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
check((await page.textContent("#overlay-button")) === "Modo campaña (con tiempo)" && (await page.textContent("#overlay-second")) === "Modo libre (sin tiempo)", "the two modes are offered");
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
const slopeText = await page.textContent("#slope");
check(/^Pendiente hacia donde miras: \d+° \(\d+ %\) (↑ sube|↓ baja|plano) · ritmo [\d,]+ km\/h · [\d,]+ min cada 100 m$/.test(slopeText), `slope shown: ${slopeText}`);

// The on-screen cross walks and lights up; the stick turns the view.
const centre = async (selector) => {
  const b = await page.locator(selector).boundingBox();
  return [b.x + b.width / 2, b.y + b.height / 2];
};
{
  await page.keyboard.down("KeyW");
  const lightsUp = await page.waitForFunction(() => document.querySelector('#pad-move [data-dir="forward"]').classList.contains("on"), null, { timeout: 2000 }).then(() => true, () => false);
  check(lightsUp, "the W key lights the cross's forward button");
  await page.keyboard.up("KeyW");
  await page.evaluate(() => document.exitPointerLock());
  const [fx, fy] = await centre('#pad-move [data-dir="forward"]');
  const walkedBefore = await page.evaluate(() => window.__geomapper.state.walked);
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  await page.waitForTimeout(900);
  const lit = await page.$eval('#pad-move [data-dir="forward"]', (e) => e.classList.contains("on"));
  await page.mouse.up();
  const walkedAfter = await page.evaluate(() => window.__geomapper.state.walked);
  check(lit && walkedAfter > walkedBefore + 3, `holding the cross's forward button walks ${(walkedAfter - walkedBefore).toFixed(0)} m`);
  const [lx, ly] = await centre("#pad-look .ring");
  const headingBefore = await page.evaluate(() => window.__geomapper.state.walker.heading);
  await page.mouse.move(lx, ly);
  await page.mouse.down();
  await page.mouse.move(lx + 45, ly, { steps: 4 });
  await page.waitForTimeout(700);
  const knob = await page.$eval("#pad-look .knob", (e) => e.style.transform);
  await page.mouse.up();
  const headingAfter = await page.evaluate(() => window.__geomapper.state.walker.heading);
  const turned = (((headingAfter - headingBefore) % 360) + 360) % 360;
  check(turned > 20 && turned < 180 && /translate\(\d/.test(knob), `dragging the stick to the right turns the view right by ${turned.toFixed(0)}°`);
}
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
check((await page.textContent('[data-do="lens"]')).startsWith("Golpeando la roca"), "the hammer swings before the lens");
await page.waitForTimeout(350);
if (shots) await page.screenshot({ path: `${shots}/5a-hammer.png` });
await page.waitForSelector("#lupa", { timeout: 3000 });
check(await page.isVisible("#lupa"), "the hand-lens view appears after the hammer");
const photo = await page.waitForFunction(() => { const i = document.querySelector("#field-panel .photo img"); return i && i.complete && i.naturalWidth > 0 ? { w: i.naturalWidth, caption: i.closest("figure").textContent } : null; }, null, { timeout: 8000 }).then((h) => h.jsonValue(), () => null);
check(photo && photo.w > 100 && /no es de este lugar/.test(photo.caption) && /Foto: .+, (CC|dominio)/.test(photo.caption), `a reference photo loads with its credit (${photo ? photo.w + " px" : "none"})`);

// The compass shows the reading; the student writes it down, in three notations.
const mod = (a) => ((a % 360) + 360) % 360;
const quadrant = (strike, dip) => {
  const half = mod(strike) % 180, dd = mod(strike + 90);
  const bearing = half <= 90 ? `N${half}E` : `N${180 - half}W`;
  const q = dd === 0 ? "N" : dd === 90 ? "E" : dd === 180 ? "S" : dd === 270 ? "W" : dd < 90 ? "NE" : dd < 180 ? "SE" : dd < 270 ? "SW" : "NW";
  return `${bearing}/${dip}${q}`;
};
await page.click('[data-do="measure"][data-type="plane"]');
await page.waitForSelector("#compass-dial");
await page.fill("#c-first", "abc");
await page.click('[data-do="annotate"]');
check((await page.textContent(".compass-entry .message")) === "Escribe el rumbo como un número.", "a bad entry is refused with a reason");
for (let i = 0; i < 8; i++) {
  if (i > 0) await page.click('[data-do="measure"][data-type="plane"]');
  await page.waitForSelector("#compass-dial");
  const r = await page.evaluate(() => window.__geomapper.panel.pendingReading);
  const notation = i === 1 ? "dipdir" : i === 2 ? "quadrant" : "rhr";
  if ((await page.$eval(`input[name="c-notation"][value="${notation}"]`, (e) => e.checked)) === false) {
    await page.check(`input[name="c-notation"][value="${notation}"]`);
  }
  if (notation === "quadrant") await page.fill("#c-text", quadrant(r.a, r.b));
  else {
    await page.fill("#c-first", String(notation === "rhr" ? r.a : mod(r.a + 90)));
    await page.fill("#c-second", String(r.b));
  }
  if (i === 0 && shots) await page.screenshot({ path: `${shots}/5b-compass.png` });
  if (i % 2) await page.click('[data-do="annotate"]');
  else await page.press("#c-second, #c-text >> nth=0", "Enter");
}
await page.check('input[name="c-notation"][value="rhr"]').catch(() => {});
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
const ms = worked.stations[0].measurements;
check(ms.every((m) => m.read && Math.abs(((m.a - m.read.a + 540) % 360) - 180) < 0.5 && m.b === m.read.b), "every entry reads back to what the compass showed");
check(ms[0].notation === "rhr" && ms[1].notation === "dipdir" && ms[2].notation === "quadrant" && /^N\d+[EW]\/\d+[NSEW]+$/.test(ms[2].entered), `notations kept as written: ${ms.slice(0, 3).map((m) => m.entered).join(", ")}`);

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

// Free mode: start over, walk, and the clock does not move.
await page.reload();
await page.waitForFunction(() => window.__geomapper && !document.getElementById("overlay-button").hidden, null, { timeout: 60000 });
await page.click("#overlay-second"); // start over
await page.waitForFunction(() => document.getElementById("overlay-second").textContent === "Modo libre (sin tiempo)");
await page.click("#overlay-second");
await page.keyboard.down("KeyW");
await page.waitForFunction(() => window.__geomapper.state.walked > 15, null, { timeout: 30000 }).catch(() => {});
await page.keyboard.up("KeyW");
const free = await page.evaluate(() => ({ mode: window.__geomapper.state.mode, walked: window.__geomapper.state.walked, minutes: window.__geomapper.state.clock.minutes, stations: window.__geomapper.state.stations.length }));
check(free.mode === "free" && free.walked > 15 && free.minutes === 0 && free.stations === 0, `free mode: a new attempt, ${free.walked.toFixed(0)} m walked and no time spent`);
check((await page.textContent("#clock")) === "Modo libre · sin límite de tiempo" && !/ritmo/.test(await page.textContent("#slope")), "free mode shows no clock and no pace");

// Flying, free mode only: F takes off, Space climbs, travel is fast and does not count as walking, F lands.
await page.keyboard.press("KeyF");
await page.keyboard.down("Space");
await page.waitForTimeout(1500);
await page.keyboard.up("Space");
const up = await page.evaluate(() => structuredClone({ flight: window.__geomapper.state.flight, walked: window.__geomapper.state.walked, x: window.__geomapper.state.walker.x, y: window.__geomapper.state.walker.y }));
check(up.flight.on && up.flight.height > 25, `F and Space take off: ${up.flight.height.toFixed(0)} m over the ground`);
check(await page.isVisible("#pad-fly") && /Volando a \d+ m/.test(await page.textContent("#slope")), "climb and descend buttons and the height are shown");
await page.keyboard.down("KeyW");
await page.waitForTimeout(1500);
await page.keyboard.up("KeyW");
const away = await page.evaluate(() => structuredClone({ walked: window.__geomapper.state.walked, x: window.__geomapper.state.walker.x, y: window.__geomapper.state.walker.y, visited: window.__geomapper.state.found.visited.size }));
const flown = Math.hypot(away.x - up.x, away.y - up.y);
check(flown > 40 && away.walked === up.walked, `flew ${flown.toFixed(0)} m in 1.5 s without adding to the distance walked`);
if (shots) await page.screenshot({ path: `${shots}/9-flying.png` });
await page.keyboard.press("KeyF");
await page.waitForTimeout(400);
const landed = await page.evaluate(() => structuredClone(window.__geomapper.state.flight));
check(!landed.on && landed.height === 0 && !(await page.isVisible("#pad-fly")), "F lands");
check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
await browser.close();
