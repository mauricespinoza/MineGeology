// End-to-end check on touch screens: a phone upright and sideways, and a tablet.
// Real touches (not mouse clicks): walking with the cross, the hammer, the map with
// a pinch and a contact drawn by taps; and no two controls of the HUD overlapping.
// Usage: node e2e/touch.mjs [base url] [screenshot folder]
import { createRequire } from "node:module";
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const base = process.argv[2] ?? "http://localhost:5173/";
const shots = process.argv[3];
let failed = false;
const check = (ok, message) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    failed = true;
  } else console.log(`ok: ${message}`);
};

const browser = await chromium.launch();
for (const [name, device] of [["teléfono vertical", devices["iPhone 13"]], ["teléfono horizontal", devices["iPhone 13 landscape"]], ["tablet", devices["iPad (gen 7) landscape"]]]) {
  const context = await browser.newContext({ ...device });
  // The visit counter is a third-party script; the tests do not count as visits.
  await context.route(/goatcounter\.com|gc\.zgo\.at/, (r) => r.fulfill({ body: "", contentType: "text/javascript" }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const cdp = await context.newCDPSession(page);
  const centre = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel);
  const tap = async (sel) => {
    await page.locator(sel).first().scrollIntoViewIfNeeded();
    const [x, y] = await centre(sel);
    await page.touchscreen.tap(x, y);
  };
  const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });

  await page.goto(`${base}?s=quebrada-los-litres-a`);
  await page.waitForFunction(() => window.__geomapper && !document.getElementById("overlay-second").hidden, null, { timeout: 60000 });
  check(await page.isVisible(".touch-help") && !(await page.isVisible(".keys-help")), `${name}: the start explains the touch controls`);
  // Choose the field geologist before going out: figure, skin tone, hat; it is saved in the browser.
  await tap("#overlay-avatar");
  await page.waitForSelector("#avatar:not([hidden]) #avatar-canvas");
  await tap('#avatar [data-pick="figure"][data-value="masculino"]');
  await tap('#avatar [data-pick="skin"][data-value="5"]');
  await tap('#avatar [data-pick="hat"][data-value="jockey"]');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("geomapper:avatar")));
  check(saved.figure === "masculino" && saved.skin === 5 && saved.hat === "jockey", `${name}: the character is chosen with taps and saved`);
  await tap('#avatar .avatar-controls [data-do="close"]');
  await page.waitForFunction(() => document.getElementById("avatar").hidden && !document.getElementById("overlay").hidden, null, { timeout: 3000 });
  check(true, `${name}: closing the character screen goes back to the start`);
  await tap("#overlay-second");
  await page.waitForTimeout(600);
  await tap("#view-button");
  check(await page.evaluate(() => window.__geomapper.world.thirdPerson), `${name}: the eye button shows the student from behind`);
  await tap("#view-button");

  // Every HUD control is on screen and none covers another.
  const fits = async (when) => {
    const overlaps = await page.evaluate(() => {
      const els = [...document.querySelectorAll("#hud-top .panel, #compass, #hud-buttons button:not([hidden]), #pad-move, #pad-look .ring, #work-button:not([hidden])")].filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden"); // fixed elements have no offsetParent
      const rects = els.map((e) => [e.id || e.className, e.getBoundingClientRect()]);
      const out = [];
      for (const [n, r] of rects) if (r.left < 0 || r.top < 0 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) out.push(`${n} off screen`);
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        const [a, ra] = rects[i], [b, rb] = rects[j];
        if (ra.left < rb.right - 1 && rb.left < ra.right - 1 && ra.top < rb.bottom - 1 && rb.top < ra.bottom - 1) out.push(`${a} over ${b}`);
      }
      return out;
    });
    check(overlaps.length === 0, `${name}: HUD controls fit without overlapping ${when}${overlaps.length ? ": " + overlaps.join("; ") : ""}`);
  };
  await fits("while walking");
  const small = await page.$$eval("#hud-buttons button:not([hidden])", (bs) => bs.filter((b) => b.offsetWidth < 40 || b.offsetHeight < 40).map((b) => b.id));
  check(small.length === 0, `${name}: tool buttons are at least 40 px for a finger${small.length ? ": " + small.join(", ") : ""}`);
  const named = await page.$$eval("#hud button", (bs) => bs.filter((b) => !b.getAttribute("aria-label") && !b.textContent.trim()).length);
  check(named === 0, `${name}: every icon button has an accessible name`);

  // Walk forward with the cross, holding a finger on the arrow.
  const before = await page.evaluate(() => ({ x: window.__geomapper.state.walker.x, y: window.__geomapper.state.walker.y }));
  const [fx, fy] = await centre('#pad-move [data-dir="forward"]');
  await touch("touchStart", [[fx, fy]]);
  await page.waitForTimeout(900);
  await touch("touchEnd", []);
  const after = await page.evaluate(() => ({ x: window.__geomapper.state.walker.x, y: window.__geomapper.state.walker.y }));
  check(Math.hypot(after.x - before.x, after.y - before.y) > 1, `${name}: the cross walks (${Math.hypot(after.x - before.x, after.y - before.y).toFixed(1)} m)`);

  // Stand at an outcrop: the hammer appears and a tap opens the field panel.
  await page.evaluate(() => {
    const g = window.__geomapper, o = g.scenario.outcrops.find((k) => k.cells.length > 8), org = g.scenario.manifest.grid.origin;
    g.state.walker.x = o.position.easting - org.easting + 6;
    g.state.walker.y = o.position.northing - org.northing + 6;
  });
  await page.waitForSelector("#work-button:not([hidden])", { timeout: 5000 });
  await fits("with the hammer showing");
  if (shots) await page.screenshot({ path: `${shots}/touch-${name.replace(/ /g, "-")}-1-hammer.png` });
  await tap("#work-button");
  await page.waitForSelector("#field-panel:not([hidden])", { timeout: 3000 });
  check(true, `${name}: a tap on the hammer opens the field panel`);
  await tap('#field-panel [data-do="close"]');
  await page.waitForFunction(() => document.getElementById("field-panel").hidden, null, { timeout: 3000 });
  check(true, `${name}: the close button shuts it`);

  // The map: pinch to zoom, then draw a contact by taps and finish with the check button.
  await tap("#map-button");
  await page.waitForSelector("#map:not([hidden])");
  await page.waitForTimeout(300);
  const scale0 = await page.evaluate(() => { const b = window.__geomapper.board; return b.toScreen(1000, 0)[0] - b.toScreen(0, 0)[0]; });
  const vw = await page.evaluate(() => innerWidth), vh = await page.evaluate(() => innerHeight);
  const cx = vw / 2, cy = vh / 2;
  const linesBefore = await page.evaluate(() => window.__geomapper.state.map.lines.length);
  await touch("touchStart", [[cx - 40, cy], [cx + 40, cy]]);
  for (let k = 1; k <= 6; k++) {
    await touch("touchMove", [[cx - 40 - 15 * k, cy], [cx + 40 + 15 * k, cy]]);
    await page.waitForTimeout(30);
  }
  await touch("touchEnd", []);
  await page.waitForTimeout(200);
  const scale1 = await page.evaluate(() => { const b = window.__geomapper.board; return b.toScreen(1000, 0)[0] - b.toScreen(0, 0)[0]; });
  check(scale1 > scale0 * 1.5, `${name}: a pinch zooms the map in (${(scale1 / scale0).toFixed(2)}×)`);
  const lines0 = await page.evaluate(() => window.__geomapper.state.map.lines.length);
  check(lines0 === linesBefore, `${name}: the pinch drew nothing`);
  await tap('#map-toolbar [data-tool="contact"]');
  for (const [dx, dy] of [[-60, -20], [0, 10], [60, 30]]) {
    await page.touchscreen.tap(cx + dx, cy + dy);
    await page.waitForTimeout(350); // apart, so two taps are not a double tap
  }
  await tap("#map-finish");
  const lines1 = await page.evaluate(() => window.__geomapper.state.map.lines.length);
  check(lines1 === lines0 + 1, `${name}: three taps and the check button draw a contact`);
  const folded = await page.evaluate(() => document.getElementById("map-side").classList.contains("folded"));
  if (folded) {
    await tap("#unit-toggle");
    check(await page.isVisible("#unit-new"), `${name}: the folded units panel opens with a tap`);
  }
  if (shots) await page.screenshot({ path: `${shots}/touch-${name.replace(/ /g, "-")}-2-map.png` });
  await tap("#map-close");
  await page.waitForFunction(() => document.getElementById("map").hidden, null, { timeout: 3000 });

  check(errors.length === 0, `${name}: no page errors${errors.length ? ": " + errors.join("; ") : ""}`);
  await context.close();
}
await browser.close();
process.exitCode = failed ? 1 : 0;
