// End-to-end check of the levels of difficulty and of the notebook as a hand-written field book.
// Usage: node e2e/difficulty.mjs [base url] [screenshot folder]
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
const ready = (button = "#overlay-second") =>
  page.waitForFunction((b) => window.__geomapper && !document.getElementById(b.slice(1)).hidden, button, { timeout: 90000 });

/** Stands `d` metres west of a cell, facing it and looking down at it. */
const standFacing = (ix, iy, d) => page.evaluate(([ix, iy, d]) => {
  const g = window.__geomapper, c = g.grid.cell, tx = (ix + 0.5) * c, ty = (iy + 0.5) * c, w = g.state.walker;
  w.x = tx - d; w.y = ty;
  w.heading = 90;
  const drop = g.heightAt(w.x, w.y) + 4.6 - g.heightAt(tx, ty);
  w.pitch = -Math.atan2(drop, d) * 180 / Math.PI;
}, [ix, iy, d]);

// ---- A forest scenario at medium: the level is chosen on the start screen. ----
await page.goto(`${base}?s=cerro-pizarras-a`);
await ready();
check(await page.isVisible("#overlay-difficulty"), "the start offers the three levels");
check((await page.$$eval("#overlay-difficulty [data-level]", (b) => b.map((x) => x.textContent))).join() === "Fácil,Medio,Difícil", "Fácil, Medio and Difícil");
check((await page.getAttribute('[data-level="medium"]', "aria-checked")) === "true", "medium is chosen the first time");
await page.click('[data-level="hard"]');
check(/alteración/.test(await page.textContent(".level-text")), "each level explains what it allows");
await page.click('[data-level="medium"]');
if (shots) await page.screenshot({ path: `${shots}/difficulty-1-start.png` });
await page.click("#overlay-second"); // free mode, same level: no reload
await page.waitForFunction(() => document.getElementById("overlay").hidden);
check(await page.evaluate(() => window.__geomapper.state.difficulty === "medium"), "the attempt is at medium");
check((await page.textContent("#clock")).includes("Medio"), "the status shows the level");
check(await page.evaluate(() => window.__geomapper.scenario.outcrops.every((o) => o.observation.quality !== "poor")), "medium: every outcrop can be measured in full");

// The lens reaches the rock under the soil.
const soil = await page.evaluate(() => {
  const g = window.__geomapper.grid;
  for (let iy = 20; iy < g.ny - 20; iy++) for (let ix = 20; ix < g.nx - 20; ix++) {
    const i = ix + g.nx * iy;
    if (g.outcrop[i] < 0 && (g.cover[i] === 1 || g.cover[i] === 4) && g.cover[i - 1] !== 0 && g.outcrop[i - 1] < 0 && g.outcrop[i + 1] < 0 && g.outcrop[i + g.nx] < 0 && g.outcrop[i - g.nx] < 0) return { ix, iy };
  }
  return null;
});
await standFacing(soil.ix, soil.iy, 5);
await page.waitForTimeout(900);
await page.mouse.click(640, 400);
await page.waitForTimeout(150);
check(await page.isVisible("#lupa-button"), "medium: hammering the soil offers «Ver con lupa»");
await page.click("#lupa-button");
await page.waitForSelector("#rock-card:not([hidden])", { timeout: 3000 });
check(/Bajo el suelo/.test(await page.textContent("#rock-card")), "and the lens shows the rock under the soil");
await page.click('#rock-card [data-do="close"]');

// The notebook as a field book written by hand.
const outcrop = await page.evaluate(() => window.__geomapper.scenario.outcrops.findIndex((o) => o.observation.planes.length));
await page.evaluate((n) => {
  const g = window.__geomapper, o = g.scenario.outcrops[n], origin = g.scenario.manifest.grid.origin;
  g.state.walker.x = o.position.easting - origin.easting;
  g.state.walker.y = o.position.northing - origin.northing;
  g.panel.open(o, true);
}, outcrop);
await page.waitForSelector("#field-panel .paper");
await page.fill("#station-rock", "pizarra gris");
await page.fill("#station-text", "Foliación bien marcada,\nvetillas de cuarzo.");
check(await page.$eval("#station-text", (e) => getComputedStyle(e).fontFamily.includes("Kalam")), "the station's notes are written in a hand-written letter");
if (shots) await page.screenshot({ path: `${shots}/difficulty-2-station.png` });
await page.keyboard.press("Escape");
await page.click("#notebook-button");
await page.waitForSelector("#notebook.field-book:not([hidden]) .page");
check((await page.textContent("#notebook")).includes("pizarra gris"), "the notebook shows the station on its page");
check(await page.$eval("#notebook .page", (e) => getComputedStyle(e).backgroundImage.includes("repeating-linear-gradient")), "the page is ruled");
if (shots) await page.screenshot({ path: `${shots}/difficulty-3-notebook.png` });
await page.click('#notebook [data-do="close"]');

// ---- Start over at easy: another world, so the page loads again. ----
await page.click("#help-button");
await page.reload();
await ready("#overlay-button");
await page.click("#overlay-second"); // start over
await page.waitForFunction(() => !document.getElementById("overlay-difficulty").hidden);
check((await page.getAttribute('[data-level="medium"]', "aria-checked")) === "true", "starting over proposes the current level");
await page.click('[data-level="easy"]');
await page.click("#overlay-button"); // campaign
await page.waitForURL(/nuevo=campaign/);
await ready("#overlay-button");
check((await page.textContent("#overlay-button")) === "Comenzar", "the new world waits for «Comenzar»");
check(!page.url().includes("nuevo"), "the address forgets the new start, so a reload does not wipe the attempt");
await page.click("#overlay-button");
await page.waitForFunction(() => document.getElementById("overlay").hidden);
const easy = await page.evaluate(() => {
  const g = window.__geomapper;
  return { level: g.state.difficulty, mode: g.state.mode, bare: g.grid.cover.every((c) => c === 0), everywhere: g.grid.outcrop.every((n) => n >= 0), trees: g.grid.cover.some((c) => c === 4) };
});
check(easy.level === "easy" && easy.mode === "campaign", "the attempt is at easy, in a campaign");
check(easy.bare && easy.everywhere && !easy.trees, "easy: bare rock everywhere, no soil and no trees, and every cell an outcrop");
if (shots) {
  await page.evaluate(() => { const w = window.__geomapper.state.walker; w.pitch = -12; });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${shots}/difficulty-4-easy.png` });
}
await page.keyboard.press("KeyM");
await page.waitForSelector("#map:not([hidden])");
check(await page.isVisible("#map-solution"), "easy: the solution map is offered even in a campaign");
await page.keyboard.press("Escape");
await page.reload();
await ready("#overlay-button");
check((await page.textContent("#overlay-button")) === "Continuar" && /nivel fácil/.test(await page.textContent("#overlay-text")), "a reload continues the attempt at easy");

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
await browser.close();
