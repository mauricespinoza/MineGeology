// End-to-end check of hammering: a click on an outcrop close by swings the hammer there and offers
// "Ver con lupa"; far rock cannot be hammered; loose weathered rock can be looked at with the lens.
// Usage: node e2e/aim.mjs [base url] [screenshot folder]
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const base = process.argv[2] ?? "http://localhost:5173/";
const shots = process.argv[3];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
// The visit counter is a third-party script; the tests do not count as visits.
await page.route(/goatcounter\.com|gc\.zgo\.at/, (r) => r.fulfill({ body: "", contentType: "text/javascript" }));
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const check = (ok, message) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else console.log(`ok: ${message}`);
};

await page.goto(`${base}?s=quebrada-los-litres-a`);
await page.waitForFunction(() => window.__geomapper && !document.getElementById("overlay-second").hidden, null, { timeout: 60000 });
await page.click("#overlay-second");
await page.evaluate(() => document.exitPointerLock?.());

/** Stands `d` metres from a cell, facing it and looking down at it. */
const standFacing = (ix, iy, d) => page.evaluate(([ix, iy, d]) => {
  const g = window.__geomapper, c = g.grid.cell, tx = (ix + 0.5) * c, ty = (iy + 0.5) * c, w = g.state.walker;
  w.x = tx - d; w.y = ty;
  w.heading = 90;
  const drop = g.heightAt(w.x, w.y) + 4.6 - g.heightAt(tx, ty);
  w.pitch = -Math.atan2(drop, d) * 180 / Math.PI;
}, [ix, iy, d]);

// An outcrop cell with open ground to its west, where the student can stand.
const target = await page.evaluate(() => {
  const g = window.__geomapper.grid;
  for (let iy = 5; iy < g.ny - 5; iy++) for (let ix = 5; ix < g.nx - 5; ix++) {
    const here = g.outcrop[ix + g.nx * iy], west = g.outcrop[ix - 1 + g.nx * iy];
    if (here >= 0 && west < 0) return { ix, iy, n: here };
  }
  return null;
});
const swinging = () => page.evaluate(() => window.__geomapper.world.swingTime >= 0 || window.__geomapper.world.flying.length > 0);
// Too far: clicking the rock does not hammer it.
await standFacing(target.ix, target.iy, 16);
await page.waitForTimeout(600);
await page.mouse.click(640, 400);
await page.waitForTimeout(100);
check(!(await page.isVisible("#lupa-button")), "rock out of reach cannot be hammered");
await page.evaluate(() => document.exitPointerLock?.());
await standFacing(target.ix, target.iy, 5);
await page.waitForTimeout(900);
check(!(await swinging()), "pointing at an outcrop does not swing the hammer by itself");
check(await page.isVisible("#work-button") && (await page.getAttribute("#work-button", "data-mode")) === "work", "the outcrop close by offers to work there");
await page.mouse.click(640, 400); // the crosshair is on the outcrop cell
await page.waitForTimeout(80);
check(await swinging(), "clicking the outcrop close by swings the hammer");
const broken = await page.evaluate(() => {
  const g = window.__geomapper, [index, steps] = g.state.dug;
  const wide = g.grid.nx * 2, size = g.grid.cell / 2, bx = index % wide, by = Math.floor(index / wide);
  const x = (bx + 0.5) * size, y = (by + 0.5) * size, now = g.heightAt(x, y);
  g.grid.dug[index] = 0;
  const was = g.heightAt(x, y);
  g.grid.dug[index] = steps;
  return { entries: g.state.dug.length, steps, drop: was - now };
});
check(broken.entries === 2 && broken.steps === 1 && Math.abs(broken.drop - 2.5) < 1e-6, `the blow breaks the block struck, one step down (${JSON.stringify(broken)})`);
check(await page.isVisible("#lupa-button"), "and offers «Ver con lupa»");
if (shots) await page.screenshot({ path: `${shots}/aim-1-outcrop.png` });
await page.click("#lupa-button");
await page.waitForSelector("#field-panel:not([hidden]) #lupa", { timeout: 3000 });
const quality = await page.evaluate((n) => window.__geomapper.scenario.outcrops[n].observation.quality, target.n);
const panelText = await page.textContent("#field-panel");
check(quality === "poor" ? /mala calidad/.test(panelText) && !(await page.isVisible('[data-do="way_up"]')) : !/mala calidad/.test(panelText) && (await page.isVisible('[data-do="way_up"]')),
  `the lens describes the ${quality} outcrop ${quality === "poor" ? "in part, without measurements" : "in full, with the measuring tools"}`);
check(await page.evaluate(() => document.pointerLockElement === null), "the mouse is free while the panel is open");
await page.click('#field-panel [data-do="close"]');
await page.evaluate(() => document.exitPointerLock?.());

// Scree out of reach of any outcrop: the button turns into a lens, and the card describes the rock nearby.
// Scree lies next to rock, so try the candidates until one is out of reach of every outcrop.
const candidates = await page.evaluate(() => {
  const g = window.__geomapper.grid, out = [];
  const clear = (ix, iy) => { for (let j = -1; j <= 1; j++) for (let i = -2; i <= 1; i++) if (g.outcrop[ix + i + g.nx * (iy + j)] >= 0) return false; return true; };
  for (let iy = 6; iy < g.ny - 6; iy++) for (let ix = 6; ix < g.nx - 6; ix++) if (g.cover[ix + g.nx * iy] === 3 && clear(ix, iy)) out.push({ ix, iy });
  return out.slice(0, 40);
});
let scree = null;
for (const c of candidates) {
  await standFacing(c.ix, c.iy, 6);
  await page.waitForTimeout(400);
  if ((await page.isVisible("#work-button")) && (await page.getAttribute("#work-button", "data-mode")) === "look") {
    scree = c;
    break;
  }
}
check(scree !== null, "pointing at weathered rock out of reach of the outcrops offers the lens");
if (scree) {
  await page.click("#work-button");
  await page.waitForSelector("#rock-card:not([hidden])", { timeout: 3000 });
  const text = await page.textContent("#rock-card");
  check(/no están en su lugar/.test(text) && /Con lupa/.test(text) && /descripción parcial/.test(text), "the card describes the loose rock in part, and says it cannot be measured");
  check(await page.isVisible("#rock-lupa"), "with the view through the lens");
  if (shots) await page.screenshot({ path: `${shots}/aim-2-scree.png` });
  await page.click('#rock-card [data-do="close"]');
}
check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join("; ") : ""}`);
await browser.close();
