// End-to-end check of the compass button, of text that does not get selected by accident, and of the profile
// solution in free mode (and not in a campaign).
// Usage: node e2e/compass-section.mjs [base url] [screenshot folder]
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const base = process.argv[2] ?? "http://localhost:5173/";
const shots = process.argv[3];
const browser = await chromium.launch();
const check = (ok, message) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else console.log(`ok: ${message}`);
};

async function start(free) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route(/goatcounter\.com|gc\.zgo\.at/, (r) => r.fulfill({ body: "", contentType: "text/javascript" }));
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(`${base}?s=estero-las-tobas-a`);
  await page.waitForFunction(() => window.__geomapper && !document.getElementById("overlay-second").hidden, null, { timeout: 90000 });
  await page.evaluate(() => localStorage.clear());
  await page.click(free ? "#overlay-second" : "#overlay-button");
  await page.waitForFunction(() => document.getElementById("overlay").hidden);
  return page;
}

/** Stands 5 m from the first outcrop that `pick` accepts, facing it; returns its id. */
const standBy = (page, pick) =>
  page.evaluate((pick) => {
    const g = window.__geomapper, org = g.scenario.manifest.grid.origin, w = g.state.walker;
    const o = g.scenario.outcrops.find(new Function("o", `return ${pick}`));
    const tx = o.position.easting - org.easting, ty = o.position.northing - org.northing;
    w.x = tx + 4;
    w.y = ty + 3;
    w.heading = ((Math.atan2(tx - w.x, ty - w.y) * 180) / Math.PI + 360) % 360;
    w.pitch = -30;
    return o.id;
  }, pick);

const page = await start(true);

// 1. Nothing gets selected by dragging across the screen; what the student types still can be.
check((await page.evaluate(() => getComputedStyle(document.body).userSelect)) === "none", "the page does not select text by default");
await page.keyboard.press("KeyN");
await page.waitForSelector("#notebook:not([hidden])");
const box = await page.locator("#notebook").boundingBox();
await page.mouse.move(box.x + 30, box.y + 20);
await page.mouse.down();
await page.mouse.move(box.x + box.width - 30, box.y + 260, { steps: 8 });
await page.mouse.up();
check((await page.evaluate(() => String(getSelection()))) === "", "dragging over the notebook selects no text");
await page.dblclick("#notebook h3, #notebook b");
check((await page.evaluate(() => String(getSelection()))) === "", "a double click on a heading selects no text");
await page.keyboard.press("KeyN");

// 2. The compass button, at a poor outcrop with a single plane: the reading comes up at once.
const poor = await standBy(page, 'o.observation?.quality === "poor" && o.observation.planes.length === 1 && !o.observation.planes[0].lineation');
await page.waitForFunction(() => !document.getElementById("compass-button").hidden, null, { timeout: 8000 });
check(true, `the compass button shows beside the hammer at the poor outcrop ${poor}`);
if (shots) await page.screenshot({ path: `${shots}/c1-buttons.png` });
await page.click("#compass-button");
await page.waitForSelector("#field-panel:not([hidden])");
const open = await page.evaluate(() => {
  const g = window.__geomapper, st = g.state.stations.at(-1), o = g.scenario.outcrops.find((k) => k.id === st.outcrop);
  return { quality: o.observation.quality, options: o.observation.planes.length, reading: !!g.panel.pendingReading };
});
check(open.reading || open.options > 1, `the compass button opens the station at the compass (${open.quality}, reading on screen: ${open.reading})`);
check(await page.isVisible("#field-panel .compass-pick h3"), "the compass has a section of its own in the station");
if (open.reading) {
  const r = await page.evaluate(() => window.__geomapper.panel.pendingReading);
  await page.fill("#c-first", String(r.a));
  await page.fill("#c-second", String(r.b));
  await page.click('[data-do="annotate"]');
  const m = await page.evaluate(() => window.__geomapper.state.stations.at(-1).measurements.length);
  check(m === 1, "a plane measured on a poor outcrop is written in the notebook");
}
if (shots) await page.screenshot({ path: `${shots}/c2-poor-compass.png` });
await page.keyboard.press("Escape");

// B opens it too, at a good outcrop with several things to measure: the student picks one.
await standBy(page, 'o.observation?.quality === "good" && o.observation.planes.some((p) => p.lineation)');
await page.waitForFunction(() => !document.getElementById("compass-button").hidden, null, { timeout: 8000 });
await page.keyboard.press("KeyB");
await page.waitForSelector("#field-panel:not([hidden])");
const buttons = await page.$$eval('#field-panel .compass-pick [data-do="measure"]', (b) => b.length);
check(buttons >= 1, `B opens the station with the compass choices (${buttons})`);
await page.keyboard.press("Escape");

// 3. The profile solution in free mode.
await page.evaluate(() => {
  const g = window.__geomapper, { nx, ny } = g.scenario.manifest.grid, c = g.grid.cell;
  g.state.section.line = { x1: nx * c * 0.15, y1: ny * c * 0.5, x2: nx * c * 0.85, y2: ny * c * 0.5 };
  g.state.section.polygons.push({ id: 99, unit: 1, points: [300, 400, 900, 400, 900, 700, 300, 700] });
});
await page.keyboard.press("KeyP");
await page.waitForSelector("#section-canvas", { state: "visible" });
check(await page.isVisible("#section-solution"), "the profile offers its solution in free mode");
const px = async () => page.evaluate(() => {
  const c = document.getElementById("section-canvas"), g = window.__geomapper, [x, y] = g.section.toScreen(1500, g.scenario.manifest.grid.origin.elevation + 100);
  const d = c.getContext("2d").getImageData(Math.round(x * Math.min(devicePixelRatio, 2)), Math.round(y * Math.min(devicePixelRatio, 2)), 1, 1).data;
  return [d[0], d[1], d[2]];
});
const before = await px();
await page.click("#section-solution");
check((await page.getAttribute("#section-solution", "aria-pressed")) === "true", "the solution button is pressed");
check(await page.isVisible("#section-solution-legend"), "the legend of the true units shows");
const after = await px();
check(before.join() !== after.join(), `the true section is drawn in the rock (${before} → ${after})`);
if (shots) await page.screenshot({ path: `${shots}/c3-section-solution.png` });
await page.click("#section-solution");
check(!(await page.isVisible("#section-solution-legend")), "a second tap hides the solution");
check(page.errors.length === 0, `no page errors${page.errors.length ? ": " + page.errors.join("; ") : ""}`);
await page.close();

// In a campaign there is no solution.
const campaign = await start(false);
await campaign.evaluate(() => {
  const g = window.__geomapper, { nx, ny } = g.scenario.manifest.grid, c = g.grid.cell;
  g.state.section.line = { x1: nx * c * 0.15, y1: ny * c * 0.5, x2: nx * c * 0.85, y2: ny * c * 0.5 };
});
await campaign.keyboard.press("KeyP");
await campaign.waitForSelector("#section-canvas", { state: "visible" });
check(!(await campaign.isVisible("#section-solution")), "a campaign does not offer the profile solution");
check(campaign.errors.length === 0, "no page errors in the campaign");
await browser.close();
