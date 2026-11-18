// The MineGeology server: one handler from a web Request to a Response, so that the same code runs as a
// Supabase Edge Function (Deno) and as the local server (Node). Routes, all JSON:
//
//   GET  /me                      who is signed in
//   POST /attempt/open            {folder}             the student's attempt at a scenario, created on first use
//   POST /attempt/save            {id, version, state, events}   save; refused if another device saved first
//   POST /observe                 {id, outcrop, x, y}  what an outcrop shows, only to a student standing at it
//   POST /sample                  {id, outcrop, unit, analysis, number, day}   send a sample to the lab
//   POST /lab                     {id}                 the lab results whose day has come
//   POST /attempt/submit          {id, state}          hand in: the attempt is closed and graded
//   GET  /attempt/grade?id=       the grade, once the teacher has released it
//   GET  /teacher/attempts        teachers: every attempt, with progress
//   GET  /teacher/attempt?id=     teachers: one attempt, its traverse and its grade, with the true map
//   POST /teacher/adjust          teachers: {id, total?, note?}
//   POST /teacher/release         teachers: {id | folder, released}
//   POST /teacher/regrade         teachers: {id}
//   GET  /scenarios               the published scenarios (index.json)
//   GET  /bundle/<folder>/<file>  the graded bundle: the public files, outcrops without observations
//   POST /auth/dev-login          local server only: {email} -> a token, standing in for the email link
//
// The answer key (truth.json, the lithology block, unseen observations) never leaves this file's
// responses, except to teachers.

import { grade } from "../../game/src/grade/grade";
import type { Observation, Outcrop } from "../../game/src/format/types";
import type { GameState } from "../../game/src/state/state";
import { AuthError, type Identity, type User, signToken, toUser } from "./auth";
import { Scenarios } from "./scenarios";
import type { AttemptRecord, EventRecord, GradeRecord, Store } from "./store";

export interface AppOptions {
  store: Store;
  scenarios: Scenarios;
  identity: Identity;
  /** Email domains allowed to sign in, e.g. ["udec.cl"]. */
  domains: string[];
  /** Teachers' addresses: they may sign in with any address and see every attempt. */
  teachers: string[];
  /** Local server only: the secret that signs development tokens. Absent in production. */
  devSecret?: string;
  /** Where the student may stand to see an outcrop, metres from its nearest cell. */
  reach?: number;
  random?: () => number;
  now?: () => Date;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

/** The route, whatever prefix the host puts in front: /api/... locally, /functions/v1/geomapper/... on Supabase. */
export function routeOf(pathname: string): string {
  const m = pathname.match(/\/(?:api|geomapper)(\/.*)$/);
  return m ? m[1]! : pathname;
}

export function createApp(opts: AppOptions): (req: Request) => Promise<Response> {
  const { store, scenarios } = opts;
  const reach = opts.reach ?? 14;
  const random = opts.random ?? Math.random;
  const now = () => (opts.now ? opts.now() : new Date());

  const who = async (req: Request): Promise<User> => {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) throw new AuthError("Inicia sesión.");
    const id = await opts.identity.identify(token);
    if (!id) throw new AuthError("La sesión expiró: inicia sesión otra vez.");
    return toUser(id, opts);
  };

  const own = async (user: User, id: unknown): Promise<AttemptRecord> => {
    const a = typeof id === "string" ? await store.getAttempt(id) : null;
    if (!a || (a.user !== user.id && user.role !== "teacher")) throw new HttpError(404, "No existe ese intento.");
    return a;
  };

  /** What the student's browser may hold: never the answer key, and lab results only once their day has come. */
  const view = (a: AttemptRecord) => {
    const day = (a.state as GameState | null)?.clock?.day ?? 1;
    return {
      id: a.id,
      folder: a.folder,
      seed: a.seed,
      status: a.status,
      version: a.version,
      state: a.state,
      observations: a.observations,
      lab: Object.fromEntries(Object.entries(a.lab).filter(([, r]) => r.day <= day).map(([k, r]) => [k, r.text])),
    };
  };

  /** Read, change and write an attempt, trying again if a save slipped in between. */
  const change = async (id: string, edit: (a: AttemptRecord) => void): Promise<AttemptRecord> => {
    for (let tries = 0; tries < 4; tries++) {
      const a = await store.getAttempt(id);
      if (!a) throw new HttpError(404, "No existe ese intento.");
      const expected = a.version;
      edit(a);
      a.updated = now().toISOString();
      if (await store.updateAttempt(a, expected)) return a;
    }
    throw new HttpError(409, "El intento cambió mientras se guardaba; vuelve a intentarlo.");
  };

  const gradeOf = async (a: AttemptRecord) => {
    const { scenario, truth, litho, grid } = await scenarios.load(a.folder);
    return grade({ scenario, truth, litho, grid, state: a.state as GameState });
  };

  const routes: Record<string, (req: Request, body: Record<string, unknown>, url: URL) => Promise<unknown>> = {
    "POST /auth/dev-login": async (_req, body) => {
      if (!opts.devSecret) throw new HttpError(404, "No disponible.");
      const email = String(body.email ?? "").trim().toLowerCase();
      const user = toUser({ id: `dev-${email}`, email }, opts);
      return { token: await signToken(opts.devSecret, { sub: user.id, email: user.email }), email: user.email, role: user.role };
    },

    "GET /me": async (req) => {
      const u = await who(req);
      return { email: u.email, role: u.role };
    },

    "POST /attempt/open": async (req, body) => {
      const u = await who(req);
      const folder = String(body.folder ?? "");
      await scenarios.load(folder); // the scenario must exist on the server
      const found = await store.findAttempt(u.id, folder);
      if (found) return view(found);
      const t = now().toISOString();
      const a: AttemptRecord = {
        id: crypto.randomUUID(), user: u.id, email: u.email, folder, seed: Math.floor(random() * 2 ** 31),
        status: "open", version: 0, state: null, observations: {}, lab: {}, created: t, updated: t,
      };
      return view(await store.createAttempt(a));
    },

    "POST /attempt/save": async (req, body) => {
      const u = await who(req);
      const a = await own(u, body.id);
      if (a.status !== "open") throw new HttpError(409, "El intento ya fue entregado.", { attempt: view(a) });
      if (body.version !== a.version) throw new HttpError(409, "Otro dispositivo guardó después: se cargó su versión.", { attempt: view(a) });
      const state = body.state as GameState | null;
      if (!state || typeof state !== "object" || state.scenarioId === undefined) throw new HttpError(400, "Estado inválido.");
      state.mode = "campaign"; // graded attempts keep the clock and the costs
      state.seed = a.seed;
      const next = { ...a, state, version: a.version + 1, updated: now().toISOString() };
      if (!(await store.updateAttempt(next, a.version))) {
        const current = (await store.getAttempt(a.id))!;
        throw new HttpError(409, "Otro dispositivo guardó después: se cargó su versión.", { attempt: view(current) });
      }
      const events = Array.isArray(body.events) ? (body.events as EventRecord[]).slice(0, 500) : [];
      if (events.length) await store.appendEvents(a.id, events.map((e) => ({ t: String(e.t ?? now().toISOString()), kind: String(e.kind ?? "?"), data: e.data ?? null })));
      return { version: next.version };
    },

    "POST /observe": async (req, body) => {
      const u = await who(req);
      const a = await own(u, body.id);
      if (a.status !== "open") throw new HttpError(409, "El intento ya fue entregado.");
      const { scenario, grid } = await scenarios.load(a.folder);
      const outcrop = scenario.outcrops.find((o) => o.id === body.outcrop);
      if (!outcrop) throw new HttpError(404, "No existe ese afloramiento.");
      const x = Number(body.x), y = Number(body.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || distanceTo(outcrop, grid.cell, x, y) > reach) {
        throw new HttpError(403, "Hay que estar junto al afloramiento para verlo.");
      }
      const last = (a.state as GameState | null)?.walker;
      if (last && Math.hypot(last.x - x, last.y - y) > 400) {
        // Far from where the last save left the student: save first, then look.
        throw new HttpError(409, "Tu posición no coincide con la guardada; guarda e inténtalo otra vez.");
      }
      const observation = outcrop.observation as Observation;
      await change(a.id, (r) => (r.observations[outcrop.id] = observation));
      await store.appendEvents(a.id, [{ t: now().toISOString(), kind: "observe", data: { outcrop: outcrop.id, x, y } }]);
      return { observation };
    },

    "POST /sample": async (req, body) => {
      const u = await who(req);
      const a = await own(u, body.id);
      if (a.status !== "open") throw new HttpError(409, "El intento ya fue entregado.");
      const obs = a.observations[String(body.outcrop)];
      if (!obs) throw new HttpError(403, "Primero hay que trabajar en ese afloramiento.");
      if (!obs.sampleable) throw new HttpError(400, "La roca está demasiado meteorizada para tomar una muestra útil.");
      const unit = String(body.unit), number = String(body.number), analysis = body.analysis;
      if (unit !== obs.unit && !((obs.contact?.units ?? []) as string[]).includes(unit)) throw new HttpError(400, "Esa roca no se puede muestrear aquí.");
      const { scenario, truth } = await scenarios.load(a.folder);
      if (Object.keys(a.lab).length >= scenario.manifest.rules.sample_limit && !a.lab[number]) throw new HttpError(400, "No quedan muestras disponibles en esta campaña.");
      let text: string;
      if (analysis === "thin_section") text = scenario.units.find((k) => k.key === unit)?.thin_section ?? "El corte delgado no entregó información adicional.";
      else if (analysis === "age") {
        const age = truth.units.find((k) => k.key === unit)?.lab_age;
        const n = (v: number) => String(v).replace(".", ",");
        text = age ? `Edad ${age.method}${age.material ? ` en ${age.material}` : ""}: ${n(age.value_ma)} ± ${n(age.error_ma)} Ma.` : "La muestra no contenía material datable.";
      } else throw new HttpError(400, "Análisis desconocido.");
      const day = Math.max(1, Math.floor(Number(body.day) || 1)) + 1; // the lab answers the next field day
      await change(a.id, (r) => (r.lab[number] = { text, day }));
      return { number, day };
    },

    "POST /lab": async (req, body) => {
      const u = await who(req);
      return { lab: view(await own(u, body.id)).lab };
    },

    "POST /attempt/submit": async (req, body) => {
      const u = await who(req);
      const a = await own(u, body.id);
      if (a.status === "submitted") return { status: a.status };
      const updated = await change(a.id, (r) => {
        if (body.state && typeof body.state === "object") r.state = { ...(body.state as GameState), mode: "campaign", seed: r.seed };
        r.status = "submitted";
        r.version += 1;
      });
      const auto = await gradeOf(updated);
      await store.putGrade({ attempt: a.id, auto, released: false, updated: now().toISOString() });
      await store.appendEvents(a.id, [{ t: now().toISOString(), kind: "submit", data: null }]);
      return { status: "submitted" };
    },

    "GET /attempt/grade": async (req, _body, url) => {
      const u = await who(req);
      const a = await own(u, url.searchParams.get("id"));
      const g = await store.getGrade(a.id);
      if (!g || !g.released) return { released: false };
      const auto = g.auto as { total: number; parts: unknown[] };
      return { released: true, total: g.adjusted ?? auto.total, parts: auto.parts, note: g.note ?? null };
    },

    // --- teachers -------------------------------------------------------------------------
    "GET /teacher/attempts": async (req) => {
      const u = await who(req);
      teacherOnly(u);
      const out = [];
      for (const a of await store.listAttempts()) {
        const s = a.state as GameState | null;
        const g = await store.getGrade(a.id);
        out.push({
          id: a.id, email: a.email, folder: a.folder, status: a.status, updated: a.updated,
          day: s?.clock?.day ?? 0, stations: s?.stations?.length ?? 0, walked: Math.round(s?.walked ?? 0),
          areas: s?.map?.polygons?.length ?? 0, lines: s?.map?.lines?.length ?? 0,
          grade: g ? { auto: (g.auto as { total: number }).total, adjusted: g.adjusted ?? null, released: g.released } : null,
        });
      }
      return { attempts: out.sort((x, y) => (x.email + x.folder).localeCompare(y.email + y.folder)) };
    },

    "GET /teacher/attempt": async (req, _body, url) => {
      const u = await who(req);
      teacherOnly(u);
      const a = await own(u, url.searchParams.get("id"));
      const { truth } = await scenarios.load(a.folder);
      return { attempt: a, events: await store.listEvents(a.id), grade: await store.getGrade(a.id), truth: { units: truth.units, map: truth.map, contacts: truth.contacts } };
    },

    "POST /teacher/adjust": async (req, body) => {
      const u = await who(req);
      teacherOnly(u);
      const g = await store.getGrade(String(body.id));
      if (!g) throw new HttpError(404, "Ese intento todavía no tiene nota.");
      if (body.total === null) delete g.adjusted;
      else if (body.total !== undefined) {
        const t = Number(body.total);
        if (!(t >= 0 && t <= 1)) throw new HttpError(400, "La nota va de 0 a 1.");
        g.adjusted = t;
      }
      if (typeof body.note === "string") g.note = body.note.slice(0, 2000);
      g.updated = now().toISOString();
      await store.putGrade(g);
      return { grade: g };
    },

    "POST /teacher/release": async (req, body) => {
      const u = await who(req);
      teacherOnly(u);
      const released = body.released !== false;
      const ids = body.id ? [String(body.id)] : (await store.listAttempts()).filter((a) => a.folder === body.folder).map((a) => a.id);
      let n = 0;
      for (const id of ids) {
        const g = await store.getGrade(id);
        if (!g) continue;
        await store.putGrade({ ...g, released, updated: now().toISOString() });
        n++;
      }
      return { changed: n };
    },

    "POST /teacher/regrade": async (req, body) => {
      const u = await who(req);
      teacherOnly(u);
      const a = await own(u, body.id);
      const old = await store.getGrade(a.id);
      const g: GradeRecord = { attempt: a.id, auto: await gradeOf(a), released: old?.released ?? false, updated: now().toISOString(), ...(old?.adjusted !== undefined ? { adjusted: old.adjusted } : {}), ...(old?.note ? { note: old.note } : {}) };
      await store.putGrade(g);
      return { grade: g };
    },
  };

  const TYPES: Record<string, string> = { json: "application/json", bin: "application/octet-stream", jpg: "image/jpeg" };
  const bundle = async (path: string): Promise<Response> => {
    const [, folder = "", ...rest] = path.split("/").slice(1);
    const file = rest.join("/");
    const bytes = await scenarios.graded(folder, file).catch(() => null);
    if (!bytes) return json({ error: "No existe ese archivo." }, 404);
    return new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { "Content-Type": TYPES[file.split(".").pop() ?? ""] ?? "application/octet-stream", "Cache-Control": "no-cache", ...CORS } });
  };

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    const path = routeOf(url.pathname);
    if (req.method === "GET" && path.startsWith("/bundle/")) return bundle(path);
    if (req.method === "GET" && path === "/scenarios") {
      const index = await scenarios.index().catch(() => ({ scenarios: [] }));
      return json(index);
    }
    const route = routes[`${req.method} ${routeOf(url.pathname)}`];
    if (!route) return json({ error: "No existe esa ruta." }, 404);
    try {
      const body = req.method === "POST" ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};
      return json(await route(req, body, url));
    } catch (e) {
      if (e instanceof AuthError) return json({ error: e.message }, e.status);
      if (e instanceof HttpError) return json({ error: e.message, ...(e.body as object | undefined) }, e.status);
      console.error(e);
      return json({ error: "Error del servidor." }, 500);
    }
  };
}

function teacherOnly(u: User): void {
  if (u.role !== "teacher") throw new HttpError(403, "Solo para docentes.");
}

/** Metres from a point to the nearest cell of an outcrop. */
export function distanceTo(outcrop: Outcrop, cell: number, x: number, y: number): number {
  let best = Infinity;
  for (const [ix, iy] of outcrop.cells) {
    const cx = Math.min(Math.max(x, ix * cell), (ix + 1) * cell), cy = Math.min(Math.max(y, iy * cell), (iy + 1) * cell);
    best = Math.min(best, Math.hypot(cx - x, cy - y));
  }
  return best;
}
