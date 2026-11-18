// End-to-end check of stage B against the local server (server/dist/local.mjs, with the graded build):
// two students on separate devices keep separate attempts, an attempt resumes on a third device, the
// teacher sees and grades both, and no response the students' browsers receive holds the answer key.
// Usage: node e2e/graded.mjs <base url, e.g. http://localhost:8788/> [screenshot folder]
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const base = process.argv[2] ?? "http://localhost:8788/";
const shots = process.argv[3];
const FOLDER = "quebrada-los-litres-a";
let failed = false;
const check = (ok, message) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    failed = true;
  } else console.log(`ok: ${message}`);
};

// The answer key, read here to know what must never reach a student's browser.
const dir = new URL(`../../baked/${FOLDER}/`, import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", dir), "utf8"));
const key = Buffer.from(manifest.files.truth.sha256, "hex");
const truth = JSON.parse(gunzipSync(readFileSync(new URL("practice.bin", dir)).map((b, i) => b ^ key[i % 32])).toString("utf8"));
const secrets = truth.units.map((u) => u.name);

const browser = await chromium.launch();
const seen = []; // every response body a student's browser got
const forbidden = []; // requests for files that hold the answer key

async function device(name, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...options });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => /practice|truth\.json|litho\.bin|orient\.bin/.test(r.url()) && forbidden.push(r.url()));
  page.on("response", async (r) => {
    const type = r.headers()["content-type"] ?? "";
    if (/json|text|javascript/.test(type)) seen.push({ who: name, url: r.url(), body: await r.text().catch(() => "") });
  });
  return { context, page, errors };
}

async function signIn(page, email) {
  await page.goto(base);
  await page.waitForSelector("#signin-email", { timeout: 60000 });
  await page.fill("#signin-email", email);
  await Promise.all([page.waitForNavigation(), page.click("#signin-go")]);
  await page.waitForSelector("#overlay-list .pick", { timeout: 60000 });
}

async function openScenario(page) {
  await Promise.all([page.waitForNavigation(), page.click(`.pick[data-folder="${FOLDER}"]`)]);
  await page.waitForFunction(() => window.__geomapper?.session && !document.getElementById("overlay-button").hidden, null, { timeout: 60000 });
}

/** Walks (by teleport) to the n-th outcrop, works it through the server, names the rock and saves. */
async function workOutcrop(page, n, rock) {
  await page.click("#overlay-button");
  await page.evaluate(() => document.exitPointerLock?.());
  const id = await page.evaluate((n) => {
    const g = window.__geomapper, o = g.scenario.outcrops[n], [ix, iy] = o.cells[0];
    g.state.walker.x = (ix + 0.5) * g.grid.cell + 4;
    g.state.walker.y = (iy + 0.5) * g.grid.cell;
    return o.id;
  }, n);
  await page.waitForFunction(() => !document.getElementById("work-button").hidden, null, { timeout: 8000 });
  await page.keyboard.press("KeyE");
  await page.waitForSelector("#field-panel:not([hidden])", { timeout: 8000 });
  await page.fill("#station-rock", rock);
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.__geomapper.session.flush());
  return id;
}

// --- Ana, on her laptop ------------------------------------------------------------------
const a1 = await device("ana-1");
await signIn(a1.page, "ana@udec.cl");
check(await a1.page.isVisible("#overlay-account") && (await a1.page.textContent("#overlay-account")).includes("ana@udec.cl"), "Ana signs in and sees her account");
await openScenario(a1.page);
check((await a1.page.textContent("#overlay-text")).includes("modo campaña"), "a graded attempt is in campaign mode, with no free mode offered");
check(await a1.page.evaluate(() => window.__geomapper.scenario.outcrops.every((o) => !o.observation)), "the browser holds no outcrop observation before the student works one");
const anaOutcrop = await workOutcrop(a1.page, 12, "andesita de Ana");
const anaSaved = await a1.page.evaluate(() => ({ x: window.__geomapper.state.walker.x, y: window.__geomapper.state.walker.y, stations: window.__geomapper.state.stations.length, version: window.__geomapper.session.version }));
check(anaSaved.stations === 1 && anaSaved.version >= 1, `Ana works outcrop ${anaOutcrop} and it is saved on the server (version ${anaSaved.version})`);
if (shots) await a1.page.screenshot({ path: `${shots}/graded-1-ana.png` });
// She pauses and leaves the laptop open: paused, it saves nothing more on its own.
await a1.page.evaluate(() => document.getElementById("help-button").click());
await a1.page.waitForFunction(() => document.getElementById("overlay-title").textContent === "En pausa");

// --- Beto, on another computer -----------------------------------------------------------
const b = await device("beto");
await signIn(b.page, "beto@alumnos.udec.cl");
await openScenario(b.page);
check((await b.page.textContent("#overlay-button")) === "Comenzar", "Beto starts his own attempt, not Ana's");
await workOutcrop(b.page, 40, "arenisca de Beto");
const seeds = [await a1.page.evaluate(() => window.__geomapper.state.seed), await b.page.evaluate(() => window.__geomapper.state.seed)];
check(seeds[0] !== seeds[1], "the two students have different measurement seeds");

// --- Ana again, on her phone: the attempt resumes -------------------------------------------
const a2 = await device("ana-2", devices["iPhone 13"]);
await signIn(a2.page, "ana@udec.cl");
await openScenario(a2.page);
check((await a2.page.textContent("#overlay-text")).includes("1 estaciones"), "on a second device Ana's attempt resumes where she left it");
const resumed = await a2.page.evaluate((id) => {
  const g = window.__geomapper;
  return { x: g.state.walker.x, y: g.state.walker.y, rock: g.state.stations[0]?.rock, seen: g.scenario.outcrops.filter((o) => o.observation).map((o) => o.id), id };
}, anaOutcrop);
check(Math.hypot(resumed.x - anaSaved.x, resumed.y - anaSaved.y) < 1 && resumed.rock === "andesita de Ana", "with her position and her notebook");
check(resumed.seen.length === 1 && resumed.seen[0] === anaOutcrop, "and only the outcrop she worked is known to the browser");
// The old laptop now holds a stale copy: its next save is refused rather than overwriting the phone's.
await a2.page.evaluate(() => { window.__geomapper.state.walked += 100; window.__geomapper.session.queue(); return window.__geomapper.session.flush(); });
await a1.page.evaluate(() => { window.__geomapper.state.walked += 1; window.__geomapper.session.queue(); return window.__geomapper.session.flush(); });
await a1.page.waitForFunction(() => document.getElementById("overlay-title").textContent.includes("versión más reciente"), null, { timeout: 5000 }).then(() => check(true, "a stale device is told another device saved, instead of overwriting it"), () => check(false, "a stale device is told another device saved"));

// --- Ana hands in from the phone -------------------------------------------------------------
a2.page.once("dialog", (d) => d.accept());
await a2.page.click("#overlay-button");
await a2.page.evaluate(() => document.getElementById("eval-button").click());
await a2.page.waitForFunction(() => document.getElementById("overlay-title").textContent === "Trabajo entregado", null, { timeout: 15000 });
check(true, "Ana hands her work in");

// --- The teacher -------------------------------------------------------------------------------
const t = await device("profe");
await t.page.goto(`${base}dashboard.html`);
await t.page.fill("#email", "profe@udec.cl");
await Promise.all([t.page.waitForNavigation(), t.page.click("#f button")]);
await t.page.waitForSelector("#rows tr[data-id]", { timeout: 30000 });
const listed = await t.page.$$eval("#rows tr[data-id]", (trs) => trs.map((tr) => tr.textContent));
check(listed.length === 2 && listed.some((r) => r.includes("ana@udec.cl") && r.includes("entregado")) && listed.some((r) => r.includes("beto@alumnos.udec.cl") && r.includes("en terreno")), "the teacher sees both attempts, one handed in and one in the field");
await t.page.click("#rows tr:has-text('ana@udec.cl')");
await t.page.waitForSelector("#map", { timeout: 15000 });
check(await t.page.isVisible("#adj"), "and opens Ana's: map, traverse, automatic grade and adjustment");
if (shots) await t.page.screenshot({ path: `${shots}/graded-2-teacher.png`, fullPage: true });
await t.page.evaluate(() => { document.getElementById("adj").value = "62"; document.getElementById("note").value = "Bien la libreta; falta el mapa."; });
await t.page.click("#save");
await t.page.waitForSelector("#release");
await t.page.click("#release");
await t.page.waitForFunction(() => document.querySelector("#detail").textContent.includes("ya ve su nota"), null, { timeout: 10000 });
check(true, "the teacher adjusts the grade, comments and releases it");

await a2.page.reload();
await a2.page.waitForFunction(() => window.__geomapper?.session && !document.getElementById("overlay-button").hidden, null, { timeout: 60000 });
await a2.page.click("#overlay-button");
await a2.page.waitForFunction(() => document.getElementById("overlay-title").textContent.startsWith("Nota"), null, { timeout: 10000 });
check((await a2.page.textContent("#overlay-title")).includes("62 %") && (await a2.page.textContent("#overlay-text")).includes("falta el mapa"), "Ana then sees her released grade and the comment");

// --- The answer key never reached a student ---------------------------------------------------
const students = seen.filter((s) => s.who !== "profe");
// Formation names anywhere; the keys of the true map and its contacts in data (the game's code holds the
// format's schema, which names those keys, and that is no secret).
const isData = (s) => !/\.(js|css|html)(\?|$)/.test(s.url);
const leaks = students.filter((s) => secrets.some((n) => s.body.includes(n)) || (isData(s) && (s.body.includes('"runs"') || s.body.includes('"contacts"'))));
check(forbidden.length === 0, `no student's browser asked for an answer-key file${forbidden.length ? ": " + forbidden.join(", ") : ""}`);
check(leaks.length === 0, `no response to a student held formation names, the true map or its contacts (${students.length} responses checked)${leaks.length ? ": " + leaks.map((l) => l.url).join(", ") : ""}`);
const outcrops = students.filter((s) => s.url.endsWith("/outcrops.json"));
check(outcrops.length > 0 && outcrops.every((s) => !s.body.includes('"observation"')), "the outcrop catalogue reached the browser without observations");

for (const d of [a1, b, a2, t]) check(d.errors.length === 0, `no page errors on ${d === a1 ? "ana-1" : d === b ? "beto" : d === a2 ? "ana-2" : "profe"}${d.errors.length ? ": " + d.errors.join("; ") : ""}`);
await browser.close();
process.exitCode = failed ? 1 : 0;
