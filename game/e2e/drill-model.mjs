// Drill holes and the 3D model, in both modes. Run with the dev or preview server up:
//   node e2e/drill-model.mjs [url] [screenshot folder]
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");

const base = process.argv[2] ?? "http://localhost:5173/";
const shots = process.argv[3];
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const errors = [];
const check = (ok, message) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else console.log(`ok: ${message}`);
};

async function start(mode, scenario, viewport = { width: 1280, height: 800 }) {
  const page = await browser.newPage({ viewport });
  await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem("geomapper:difficulty", "medium"); } catch {} });
  await page.route(/goatcounter\.com|gc\.zgo\.at/, (r) => r.fulfill({ body: "", contentType: "text/javascript" }));
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${base}?s=${scenario}`);
  await page.waitForFunction(() => window.__geomapper && !document.getElementById("overlay-button").hidden, null, { timeout: 60000 });
  await page.click(mode === "free" ? "#overlay-second" : "#overlay-button");
  await page.waitForFunction(() => document.getElementById("overlay").hidden);
  return page;
}

// ---- Campaign: holes cost money and time, collar where the student stands, no model in 3D. ----
{
  const page = await start("campaign", "quebrada-los-litres-a");
  await page.click("#drill-button");
  check(await page.isVisible("#drill"), "the drill sheet opens from its button");
  check((await page.textContent("#drill .drill-budget")).includes("250.000"), "the budget is shown");
  check(await page.$eval('#drill input[readonly]', () => true).catch(() => false), "the collar is where the student stands (read only)");
  const before = await page.evaluate(() => ({ minutes: window.__geomapper.state.clock.minutes }));
  await page.fill('#drill input[data-plan="inclination"]', "70");
  await page.fill('#drill input[data-plan="length"]', "200");
  await page.click('#drill [data-do="drill"]');
  const after = await page.evaluate(() => {
    const s = window.__geomapper.state;
    return { minutes: s.clock.minutes, spent: s.drill.spent, holes: s.drill.holes.length, intervals: s.drill.holes[0]?.intervals.length ?? 0, length: s.drill.holes[0]?.length ?? 0 };
  });
  check(after.holes === 1 && after.intervals >= 1, `one hole drilled with ${after.intervals} intervals, ${after.length} m`);
  check(after.spent === 6000 + 180 * after.length, `it cost US$ ${after.spent}`);
  check(after.minutes - before.minutes >= 45, `it took ${Math.round(after.minutes - before.minutes)} min of field time`);
  const desc = await page.textContent("#drill .intervals");
  check(desc.includes("Descripción del testigo") && desc.includes("Con lupa"), "the core is described as the lens shows it, not by unit name");
  check((await page.$$("#drill .drill-svg rect")).length >= after.intervals, "the log is drawn");
  if (shots) await page.screenshot({ path: `${shots}/campaign-drill.png` });
  await page.click('#drill [data-do="view3d"]');
  await page.waitForTimeout(800);
  check(await page.isVisible("#model3d"), "the 3D view opens on the hole");
  const side = await page.textContent("#model-side");
  check(!side.includes("Caras del bloque") && !side.includes("Geología del modelo"), "campaign mode does not show the model in 3D");
  if (shots) await page.screenshot({ path: `${shots}/campaign-3d.png` });
  await page.keyboard.press("KeyG");
  check(!(await page.isVisible("#model3d")), "G closes the 3D view");
  await page.close();
}

// ---- Free mode: no cost, collars anywhere, the model in 3D. ----
{
  const page = await start("free", "cerro-amarillo-a");
  await page.keyboard.press("KeyK");
  check(await page.isVisible("#drill"), "K opens the drill sheet");
  check((await page.textContent("#drill .drill-budget")).includes("sin costo"), "free mode drills without cost");
  const origin = await page.evaluate(() => window.__geomapper.scenario.manifest.grid.origin);
  const collars = [[500, 2000], [900, 2000], [1300, 2000]];
  for (const [x, y] of collars) {
    await page.fill('#drill input[data-plan="x"]', String(origin.easting + x));
    await page.fill('#drill input[data-plan="y"]', String(origin.northing + y));
    await page.fill('#drill input[data-plan="inclination"]', "90");
    await page.fill('#drill input[data-plan="length"]', "400");
    await page.click('#drill [data-do="drill"]');
  }
  const drill = await page.evaluate(() => window.__geomapper.state.drill);
  check(drill.holes.length === 3 && drill.spent === 0, `three free holes, US$ ${drill.spent} spent`);
  check(Math.abs(drill.holes[1].x - 900) < 1, "the collar typed in is used");
  check((await page.$$("#drill .drill-svg line[stroke-dasharray]")).length > 0, "unit tops are joined between holes");
  if (shots) await page.screenshot({ path: `${shots}/free-drill.png` });
  await page.keyboard.press("KeyG");
  await page.waitForTimeout(1500);
  const side = await page.textContent("#model-side");
  check(side.includes("Caras del bloque") && side.includes("Cuerpos de unidades"), "free mode shows the model's block and unit bodies");
  const tris = await page.evaluate(() => {
    const m = window.__geomapper.model;
    return m.renderer.info.render.triangles;
  });
  check(tris > 1000, `the 3D view draws ${tris} triangles`);
  if (shots) await page.screenshot({ path: `${shots}/free-3d.png` });
  // Cut the block and show two unit bodies.
  await page.$eval('#model-side input[data-k="cut-y1"]', (el) => { el.value = "1300"; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.$eval('#model-side input[data-k="unit"]', (el) => { el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.$eval('#model-side input[data-k="opacity"]', (el) => { el.value = "40"; el.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.waitForTimeout(1000);
  if (shots) await page.screenshot({ path: `${shots}/free-3d-cut.png` });
  await page.$eval('#model-side input[data-k="slice"]', (el) => { el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.waitForTimeout(800);
  if (shots) await page.screenshot({ path: `${shots}/free-3d-slice.png` });
  // Pick a collar on the terrain.
  await page.click('#model-side [data-do="pick"]');
  await page.mouse.click(760, 420);
  await page.waitForTimeout(300);
  check(await page.isVisible("#drill"), "a tap on the terrain sets the collar and opens the drill sheet");
  await page.close();
}

// ---- A phone held upright: the tools still fit. ----
{
  const page = await start("free", "quebrada-los-litres-a", { width: 390, height: 760 });
  const box = await page.$eval("#hud-buttons", (el) => el.getBoundingClientRect().bottom);
  check(box < 760 - 150, `the tool buttons end at ${Math.round(box)} px, clear of the look stick`);
  if (shots) await page.screenshot({ path: `${shots}/phone-hud.png` });
  await page.keyboard.press("KeyG");
  await page.waitForTimeout(800);
  if (shots) await page.screenshot({ path: `${shots}/phone-3d.png` });
  await page.close();
}

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
await browser.close();
