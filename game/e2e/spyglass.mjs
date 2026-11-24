// End-to-end check of the spyglass: Z (or its button) holds it to the eye, the view narrows and turns into a round,
// pixelated eyepiece with a reading of the far ground; the wheel changes its power; the student cannot walk; Esc puts it away.
// Usage: node e2e/spyglass.mjs [base url] [screenshot folder]
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const base = process.argv[2] ?? "http://localhost:5173/";
const shots = process.argv[3];
const browser = await chromium.launch();
const errors = [];
const check = (ok, message) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else console.log(`ok: ${message}`);
};

async function open(options, name) {
  const page = await browser.newPage(options);
  await page.route(/goatcounter\.com|gc\.zgo\.at/, (r) => r.fulfill({ body: "", contentType: "text/javascript" }));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}?s=quebrada-los-litres-a`);
  await page.waitForFunction(() => window.__geomapper && !document.getElementById("overlay-second").hidden, null, { timeout: 60000 });
  await page.click("#overlay-second");
  // Stand in the middle of the area, facing the highest ground at least a kilometre away.
  await page.evaluate(() => {
    const g = window.__geomapper, grid = g.grid, w = g.state.walker;
    w.x = (grid.nx * grid.cell) / 2; w.y = (grid.ny * grid.cell) / 2;
    let best = null;
    for (let a = 0; a < 360; a += 5) {
      const h = (a * Math.PI) / 180, d = 1200;
      const z = g.heightAt(w.x + Math.sin(h) * d, w.y + Math.cos(h) * d);
      if (!best || z > best.z) best = { a, z, d };
    }
    w.heading = best.a;
    w.pitch = Math.atan2(best.z - g.heightAt(w.x, w.y) - 4, best.d) * 180 / Math.PI;
  });
  await page.waitForTimeout(2500);
  if (shots) await page.screenshot({ path: `${shots}/${name}-eye.png` });
  return page;
}

const page = await open({ viewport: { width: 1280, height: 800 } }, "desktop");
const fovBefore = await page.evaluate(() => window.__geomapper.world.camera.fov);
await page.keyboard.press("KeyZ");
await page.waitForTimeout(2500);
const on = await page.evaluate(() => ({ spy: window.__geomapper.world.spyglassOn, fov: window.__geomapper.world.camera.fov, body: document.body.classList.contains("spyglass") }));
check(on.spy && on.body, "Z holds the spyglass to the eye");
check(on.fov < fovBefore / 5, `the view narrows (${fovBefore.toFixed(1)}° to ${on.fov.toFixed(1)}°)`);
check(await page.isVisible("#spyglass-info"), "the spyglass shows its reading");
check(!(await page.isVisible("#pad-move")), "the walking pad is put away");
const reading = await page.textContent("#spyglass-info .read");
check(/×8/.test(reading) && / m/.test(reading), `the reading gives power and distance: «${reading}»`);
if (shots) await page.screenshot({ path: `${shots}/desktop-spyglass.png` });
const start = await page.evaluate(() => ({ x: window.__geomapper.state.walker.x, y: window.__geomapper.state.walker.y }));
await page.keyboard.down("KeyW");
await page.waitForTimeout(600);
await page.keyboard.up("KeyW");
const after = await page.evaluate(() => ({ x: window.__geomapper.state.walker.x, y: window.__geomapper.state.walker.y }));
check(Math.hypot(after.x - start.x, after.y - start.y) < 0.01, "the student stands still while looking through it");
await page.mouse.move(640, 400);
await page.mouse.wheel(0, -400);
await page.waitForTimeout(300);
const power = await page.evaluate(() => window.__geomapper.world.spyglassPowerNow);
check(power > 8, `the wheel draws the tube out (×${power.toFixed(1)})`);
if (shots) await page.screenshot({ path: `${shots}/desktop-spyglass-more.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
const off = await page.evaluate(() => ({ spy: window.__geomapper.world.spyglassOn, fov: window.__geomapper.world.camera.fov }));
check(!off.spy && Math.abs(off.fov - fovBefore) < 0.01, "Esc puts it away and the view is as before");
await page.click("#spyglass-button");
await page.waitForTimeout(200);
check(await page.evaluate(() => window.__geomapper.world.spyglassOn), "the toolbar button holds it to the eye");
await page.keyboard.press("KeyM");
await page.waitForTimeout(200);
check(await page.evaluate(() => !window.__geomapper.world.spyglassOn && window.__geomapper.board.isOpen), "opening the map puts it away");
await page.close();

const phone = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, "phone");
await phone.tap("#spyglass-button");
await phone.waitForTimeout(2500);
check(await phone.evaluate(() => window.__geomapper.world.spyglassOn), "on a phone, the button holds it to the eye");
if (shots) await phone.screenshot({ path: `${shots}/phone-spyglass.png` });
await phone.tap("#spyglass-info [data-spy=close]");
await phone.waitForTimeout(200);
check(await phone.evaluate(() => !window.__geomapper.world.spyglassOn), "its close button puts it away");
await phone.close();

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
await browser.close();
