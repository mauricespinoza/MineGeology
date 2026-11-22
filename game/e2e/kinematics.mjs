// End-to-end check of a faulted scenario: the start screen, an outcrop on the fault,
// the kinematic indicator sketch and the sense of slip read from it, in free mode.
// Usage: node e2e/kinematics.mjs [base url] [screenshot folder]
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const base = process.argv[2] ?? "http://localhost:5173/";
const shots = process.argv[3];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => { try { if (!localStorage.getItem("geomapper:difficulty")) localStorage.setItem("geomapper:difficulty", "hard"); } catch {} }); // these checks are written for the hard level
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

await page.goto(base);
await page.waitForSelector("#overlay-list:not([hidden]) .pick", { timeout: 60000 });
await Promise.all([page.waitForNavigation(), page.click('.pick[data-folder="estero-las-tobas-a"]')]);
await page.waitForFunction(() => window.__geomapper && !document.getElementById("overlay-second").hidden, null, { timeout: 60000 });
check((await page.textContent("#overlay-title")) === "Estero Las Tobas", "the chosen scenario loads");
check(await page.isVisible("#overlay-change"), "the overlay offers to change scenario");
await page.click("#overlay-second"); // free mode

// Stand next to the best fault outcrop that shows an indicator.
const target = await page.evaluate(() => {
  const g = window.__geomapper, org = g.scenario.manifest.grid.origin, w = g.state.walker;
  const o = g.scenario.outcrops.find((k) => k.observation?.kinematic && k.observation.quality !== "poor");
  const tx = o.position.easting - org.easting, ty = o.position.northing - org.northing;
  w.x = tx + 6;
  w.y = ty + 6;
  w.heading = ((Math.atan2(tx - w.x, ty - w.y) * 180) / Math.PI + 360) % 360;
  return { id: o.id, sense: o.observation.kinematic.sense, indicator: o.observation.kinematic.indicator };
});
await page.waitForFunction(() => !document.getElementById("work-button").hidden, null, { timeout: 8000 });
// Open the station of that very outcrop: on the fault scarp, E may pick a neighbouring outcrop the crosshair meets first.
await page.evaluate((id) => {
  const g = window.__geomapper;
  g.panel.open(g.scenario.outcrops.find((k) => k.id === id));
}, target.id);
await page.waitForSelector("#field-panel:not([hidden])");
await page.click('[data-do="kinematics"]');
await page.waitForSelector("#field-panel svg.kinematic", { timeout: 3000 });
check(true, `the ${target.indicator} sketch appears at ${target.id}`);
const svgText = await page.textContent("#field-panel .kinematic-box");
check(!/dextral|sinistral|normal|invers/.test(svgText.replace(/\(elige\)|normal<|inverso<|Sentido de movimiento.*$/s, "")), "the sketch does not name the sense");
if (shots) await page.screenshot({ path: `${shots}/k1-sketch.png` });

const wrong = target.sense === "reverse" ? "normal" : "reverse";
await page.selectOption("#station-sense", wrong);
await page.waitForFunction(() => /Revisa el croquis/.test(document.querySelector("#field-panel .kinematic-box").textContent));
check(true, "a wrong reading gets a hint in free mode");
await page.selectOption("#station-sense", target.sense);
await page.waitForFunction(() => /Correcto/.test(document.querySelector("#field-panel .kinematic-box").textContent));
check(true, `the right reading (${target.sense}) is confirmed`);
const saved = await page.evaluate(() => window.__geomapper.state.stations.at(-1).sense);
check(saved === target.sense, "the sense is written in the notebook");
if (shots) await page.screenshot({ path: `${shots}/k2-sense.png` });

check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join("; ") : ""}`);
await browser.close();
