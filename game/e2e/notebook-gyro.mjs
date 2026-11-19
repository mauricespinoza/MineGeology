// End-to-end check: with the notebook open the student still walks and looks, and on a tablet the gyroscope turns
// the view (a fake gyroscope sends the orientation events). Run with the dev server up:
//   node e2e/notebook-gyro.mjs [url] [screenshot folder]
import { createRequire } from "node:module";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
const base = process.argv[2] ?? "http://localhost:5173/";
const S = process.argv[3];
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const errors = [];
const check = (ok, m) => (ok ? console.log(`ok: ${m}`) : (console.error(`FAIL: ${m}`), (process.exitCode = 1)));
async function start(page) {
  await page.route(/goatcounter\.com|gc\.zgo\.at/, (r) => r.fulfill({ body: "", contentType: "text/javascript" }));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}?s=quebrada-los-litres-a`);
  await page.waitForFunction(() => window.__geomapper && !document.getElementById("overlay-button").hidden, null, { timeout: 90000 });
  await page.click("#overlay-second");
  await page.waitForTimeout(800);
}
const w = (page) => page.evaluate(() => ({ ...window.__geomapper.state.walker }));
// Desktop: notebook open, then W, and a drag on the view.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  await start(page);
  await page.keyboard.press("KeyN");
  await page.waitForTimeout(300);
  check(await page.isVisible("#notebook"), "notebook open");
  const a = await w(page);
  await page.keyboard.down("KeyW"); await page.waitForTimeout(1200); await page.keyboard.up("KeyW");
  const b = await w(page);
  check(Math.hypot(b.x - a.x, b.y - a.y) > 1, `walks with the notebook open (${Math.hypot(b.x - a.x, b.y - a.y).toFixed(1)} m)`);
  await page.mouse.move(250, 400); await page.mouse.down(); await page.mouse.move(400, 380, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(200);
  const c = await w(page);
  check(Math.abs(c.heading - b.heading) > 5, `turns the head with a drag (${(c.heading - b.heading).toFixed(0)}°)`);
  check(await page.isVisible("#notebook"), "notebook still open");
  if (S) await page.screenshot({ path: `${S}/notebook-desktop.png` });
  await page.close();
}
// Tablet: the stick beside the notebook, and the gyroscope.
{
  const ctx = await browser.newContext({ ...devices["iPad (gen 7) landscape"] });
  await ctx.grantPermissions(["accelerometer", "gyroscope", "magnetometer"]);
  const page = await ctx.newPage();
  await start(page);
  check(await page.isVisible("#gyro-button"), "gyro button offered on a tablet");
  // A fake gyroscope: the tablet upright, facing alpha.
  await page.evaluate(() => {
    window.__orient = (alpha, beta, gamma) => window.dispatchEvent(Object.assign(new Event("deviceorientation"), { alpha, beta, gamma }));
    window.__tick = setInterval(() => window.__orient(window.__alpha ?? 0, window.__beta ?? 0, window.__gamma ?? -90), 50);
  });
  await page.tap("#gyro-button");
  await page.waitForTimeout(600);
  check(await page.evaluate(() => document.getElementById("gyro-button").classList.contains("flying")), "gyro switched on");
  const a = await w(page);
  await page.evaluate(() => (window.__alpha = 30)); // turned to the left by 30 degrees
  await page.waitForTimeout(400);
  const b = await w(page);
  const turn = ((b.heading - a.heading + 540) % 360) - 180;
  check(Math.abs(Math.abs(turn) - 30) < 3, `turning the tablet turns the view (${turn.toFixed(1)}°)`);
  await page.tap("#notebook-button");
  await page.waitForTimeout(300);
  await page.evaluate(() => (window.__alpha = 0));
  await page.waitForTimeout(400);
  const c = await w(page);
  check(Math.abs(((c.heading - b.heading + 540) % 360) - 180) > 25, "the gyro still turns the view with the notebook open");
  const look = await page.$eval("#pad-look", (e) => e.getBoundingClientRect().right);
  const nb = await page.$eval("#notebook", (e) => e.getBoundingClientRect().left);
  check(look <= nb, `the stick sits beside the notebook (${look.toFixed(0)} <= ${nb.toFixed(0)})`);
  if (S) await page.screenshot({ path: `${S}/notebook-tablet.png` });
  await ctx.close();
}
check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join("; ") : ""}`);
await browser.close();
