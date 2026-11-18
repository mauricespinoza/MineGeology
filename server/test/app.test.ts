import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp, distanceTo, routeOf } from "../src/app";
import { LocalIdentity, allowedEmail, signToken, verifyToken } from "../src/auth";
import { Scenarios } from "../src/scenarios";
import { MemoryStore } from "../src/store";
import { newGame } from "../../game/src/state/state";

const BAKED = fileURLToPath(new URL("../../baked/", import.meta.url));
const FOLDER = "quebrada-los-litres-a";
const SECRET = "test-secret";
const scenarios = new Scenarios((folder, path) => readFile(`${BAKED}${folder ? `${folder}/` : ""}${path}`).then((b) => new Uint8Array(b)));
const store = new MemoryStore();
const app = createApp({ store, scenarios, identity: new LocalIdentity(SECRET), domains: ["udec.cl"], teachers: ["profe@gmail.com"], devSecret: SECRET });

const call = async (method: string, route: string, body?: unknown, token?: string) => {
  const r = await app(new Request(`http://x/api${route}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }));
  return { status: r.status, body: (await r.json()) as any };
};
const login = async (email: string) => (await call("POST", "/auth/dev-login", { email })).body.token as string;

let ana: string, beto: string, profe: string;
beforeAll(async () => {
  ana = await login("ana@udec.cl");
  beto = await login("beto@alumnos.udec.cl");
  profe = await login("profe@gmail.com");
});

describe("sign-in", () => {
  it("accepts institutional addresses and the teachers, and nobody else", async () => {
    expect(allowedEmail("a@udec.cl", ["udec.cl"])).toBe(true);
    expect(allowedEmail("a@alumnos.udec.cl", ["udec.cl"])).toBe(true);
    expect(allowedEmail("a@fakeudec.cl", ["udec.cl"])).toBe(false);
    expect((await call("POST", "/auth/dev-login", { email: "intruso@gmail.com" })).status).toBe(403);
    expect((await call("GET", "/me", undefined, profe)).body.role).toBe("teacher");
    expect((await call("GET", "/me", undefined, ana)).body).toEqual({ email: "ana@udec.cl", role: "student" });
    expect((await call("GET", "/me")).status).toBe(401);
    expect((await call("GET", "/me", undefined, `${ana}x`)).status).toBe(401);
  });

  it("signs tokens that expire and cannot be forged", async () => {
    const t = await signToken(SECRET, { sub: "u", email: "u@udec.cl" }, -1);
    expect(await verifyToken(SECRET, t)).toBeNull();
    expect(await verifyToken("other", await signToken(SECRET, { sub: "u", email: "u@udec.cl" }))).toBeNull();
    expect(routeOf("/functions/v1/geomapper/attempt/open")).toBe("/attempt/open");
  });
});

describe("attempts", () => {
  it("gives each student their own attempt, resumable, and refuses a save from a stale copy", async () => {
    const a1 = (await call("POST", "/attempt/open", { folder: FOLDER }, ana)).body;
    const b1 = (await call("POST", "/attempt/open", { folder: FOLDER }, beto)).body;
    expect(a1.id).not.toBe(b1.id);
    expect(a1.seed).not.toBe(b1.seed);
    expect(a1.version).toBe(0);
    const { scenario, grid } = await scenarios.load(FOLDER);
    const state = newGame(scenario, grid, a1.seed);
    state.walked = 1234;
    expect((await call("POST", "/attempt/save", { id: a1.id, version: 0, state, events: [{ t: "x", kind: "move", data: [1, 2] }] }, ana)).body.version).toBe(1);
    // Another device, opening the same attempt, gets the saved state.
    const again = (await call("POST", "/attempt/open", { folder: FOLDER }, ana)).body;
    expect(again.id).toBe(a1.id);
    expect(again.state.walked).toBe(1234);
    // A device that still holds version 0 is refused, and gets the current copy back.
    const stale = await call("POST", "/attempt/save", { id: a1.id, version: 0, state }, ana);
    expect(stale.status).toBe(409);
    expect(stale.body.attempt.version).toBe(1);
    // Someone else's attempt is invisible.
    expect((await call("POST", "/attempt/save", { id: a1.id, version: 1, state }, beto)).status).toBe(404);
    // Free mode cannot be smuggled in.
    await call("POST", "/attempt/save", { id: a1.id, version: 1, state: { ...state, mode: "free" } }, ana);
    expect((await store.getAttempt(a1.id))!.state).toMatchObject({ mode: "campaign", seed: a1.seed });
  });
});

describe("the answer key stays on the server", () => {
  it("shows an outcrop only to a student standing at it, and keeps what was seen", async () => {
    const a = (await call("POST", "/attempt/open", { folder: FOLDER }, ana)).body;
    const { scenario, grid } = await scenarios.load(FOLDER);
    const o = scenario.outcrops[10]!;
    const [ix, iy] = o.cells[0]!;
    const near = { x: (ix + 0.5) * grid.cell, y: (iy + 0.5) * grid.cell };
    const state = newGame(scenario, grid, a.seed);
    state.walker.x = near.x;
    state.walker.y = near.y;
    await call("POST", "/attempt/save", { id: a.id, version: a.version, state }, ana);
    expect((await call("POST", "/observe", { id: a.id, outcrop: o.id, x: near.x + 500, y: near.y }, ana)).status).toBe(403);
    const seen = await call("POST", "/observe", { id: a.id, outcrop: o.id, x: near.x, y: near.y }, ana);
    expect(seen.status).toBe(200);
    expect(seen.body.observation.unit).toBe(o.observation!.unit);
    const back = (await call("POST", "/attempt/open", { folder: FOLDER }, ana)).body;
    expect(Object.keys(back.observations)).toEqual([o.id]);
    expect(distanceTo(o, grid.cell, near.x, near.y)).toBe(0);
  });

  it("answers the lab the next field day, and never sends the true map, names or block to a student", async () => {
    const a = (await call("POST", "/attempt/open", { folder: FOLDER }, ana)).body;
    const [outcrop, obs] = Object.entries(a.observations)[0] as [string, any];
    const sent = await call("POST", "/sample", { id: a.id, outcrop, unit: obs.unit, analysis: "age", number: 1, day: 1 }, ana);
    expect(sent.body).toEqual({ number: "1", day: 2 });
    expect((await call("POST", "/lab", { id: a.id }, ana)).body.lab).toEqual({}); // still day 1
    const s = (await call("POST", "/attempt/open", { folder: FOLDER }, ana)).body;
    s.state.clock.day = 2;
    await call("POST", "/attempt/save", { id: a.id, version: s.version, state: s.state }, ana);
    expect((await call("POST", "/lab", { id: a.id }, ana)).body.lab["1"]).toMatch(/Edad|datable/);
    const everything = JSON.stringify((await call("POST", "/attempt/open", { folder: FOLDER }, ana)).body);
    const { truth } = await scenarios.load(FOLDER);
    for (const u of truth.units) expect(everything).not.toContain(u.name);
    expect(everything).not.toContain('"runs"');
  });

  it("serves a graded bundle without observations, and refuses the answer-key files", async () => {
    const outcrops = JSON.parse(new TextDecoder().decode((await scenarios.graded(FOLDER, "outcrops.json"))!));
    expect(outcrops.outcrops.every((o: any) => !("observation" in o))).toBe(true);
    for (const p of ["truth.json", "practice.bin", "practice-litho.bin", "litho.bin", "orient.bin"]) expect(await scenarios.graded(FOLDER, p)).toBeNull();
    const manifest = JSON.parse(new TextDecoder().decode((await scenarios.graded(FOLDER, "manifest.json"))!));
    const bytes = (await scenarios.graded(FOLDER, "outcrops.json"))!;
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>))].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(manifest.files.outcrops.sha256).toBe(digest);
    expect(await scenarios.graded("../etc", "manifest.json")).toBeNull();
    const r = await app(new Request(`http://x/api/bundle/${FOLDER}/outcrops.json`));
    expect(r.status).toBe(200);
    expect(await r.text()).not.toContain("observation");
    expect((await app(new Request(`http://x/api/bundle/${FOLDER}/practice.bin`))).status).toBe(404);
    const list = (await (await app(new Request("http://x/api/scenarios"))).json()) as { scenarios: { folder: string }[] };
    expect(list.scenarios.map((e) => e.folder)).toContain(FOLDER);
  });
});

describe("submission and the teacher", () => {
  it("grades on submission, shows the grade only once released, and lets the teacher adjust it", async () => {
    const a = (await call("POST", "/attempt/open", { folder: FOLDER }, beto)).body;
    const { scenario, grid } = await scenarios.load(FOLDER);
    const state = a.state ?? newGame(scenario, grid, a.seed);
    expect((await call("POST", "/attempt/submit", { id: a.id, state }, beto)).body.status).toBe("submitted");
    expect((await call("POST", "/attempt/save", { id: a.id, version: 99, state }, beto)).status).toBe(409);
    expect((await call("GET", `/attempt/grade?id=${a.id}`, undefined, beto)).body).toEqual({ released: false });
    expect((await call("GET", "/teacher/attempts", undefined, beto)).status).toBe(403);
    const list = (await call("GET", "/teacher/attempts", undefined, profe)).body.attempts;
    expect(list.map((x: any) => x.email).sort()).toEqual(["ana@udec.cl", "beto@alumnos.udec.cl"]);
    const detail = (await call("GET", `/teacher/attempt?id=${a.id}`, undefined, profe)).body;
    expect(detail.truth.units.length).toBeGreaterThan(0);
    await call("POST", "/teacher/adjust", { id: a.id, total: 0.55, note: "Falta el perfil." }, profe);
    expect((await call("POST", "/teacher/release", { folder: FOLDER }, profe)).body.changed).toBe(1);
    const g = (await call("GET", `/attempt/grade?id=${a.id}`, undefined, beto)).body;
    expect(g).toMatchObject({ released: true, total: 0.55, note: "Falta el perfil." });
    expect(g.parts.length).toBe(5);
  });
});
