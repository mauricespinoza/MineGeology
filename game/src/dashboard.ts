// The teacher dashboard (stage B): the class with its progress, each student's traverse replayed over
// the map, the student's map against the true one, the automatic grade, its adjustment, and release.

import { expandTruthMap, loadScenario } from "./format/loader";
import type { Scenario, Truth } from "./format/types";
import { Remote, RemoteError, loadServerConfig } from "./net/remote";

interface Row {
  id: string;
  email: string;
  folder: string;
  status: string;
  updated: string;
  day: number;
  stations: number;
  walked: number;
  areas: number;
  lines: number;
  grade: { auto: number; adjusted: number | null; released: boolean } | null;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)} %`);
const PART_NAMES: Record<string, string> = { map: "Mapa geológico", structures: "Estructuras", section: "Perfil", column: "Columna e historia", field: "Práctica de terreno" };

let remote: Remote;
let rows: Row[] = [];
const scenarios = new Map<string, Promise<Scenario>>();

async function main(): Promise<void> {
  const config = await loadServerConfig();
  if (!config) {
    document.querySelector("main")!.innerHTML = "<p>Este sitio no tiene servidor: el panel docente funciona solo con cuentas (etapa B).</p>";
    return;
  }
  remote = new Remote(config);
  remote.takeTokenFromUrl();
  const me = remote.token ? await remote.me().catch(() => null) : null;
  if (!me || me.role !== "teacher") return signIn(me ? "Esta cuenta no es de un docente." : "");
  $("who").innerHTML = `${esc(me.email)} · <a href="./">Juego</a> · <a href="#" id="out">Salir</a>`;
  $("out").onclick = (e) => {
    e.preventDefault();
    remote.signOut();
    location.reload();
  };
  $("refresh").onclick = () => void list();
  $("filter").onchange = () => render();
  $("release-all").onclick = async () => {
    const folder = $<HTMLSelectElement>("filter").value;
    if (!folder || !confirm(`¿Liberar las notas de todos los trabajos entregados de ${folder}?`)) return;
    await remote.call("POST", "/teacher/release", { folder, released: true });
    await list();
  };
  await list();
}

function signIn(message: string): void {
  const box = $("signin");
  box.hidden = false;
  box.innerHTML = `<div class="signin-box"><h2>Panel docente</h2><p class="muted">${esc(message)} Entra con el correo registrado como docente.</p>
    <form id="f"><input id="email" type="email" required placeholder="docente@udec.cl"><button type="submit" class="primary">${remote.config.kind === "local" ? "Entrar" : "Enviarme el enlace"}</button></form><p id="msg" class="muted"></p></div>`;
  $<HTMLFormElement>("f").onsubmit = async (e) => {
    e.preventDefault();
    try {
      if (await remote.signIn($<HTMLInputElement>("email").value.trim())) location.reload();
      else $("msg").textContent = "Te enviamos un enlace: ábrelo en este dispositivo.";
    } catch (error) {
      $("msg").textContent = error instanceof Error ? error.message : String(error);
    }
  };
}

async function list(): Promise<void> {
  rows = (await remote.call<{ attempts: Row[] }>("GET", "/teacher/attempts")).attempts;
  const filter = $<HTMLSelectElement>("filter");
  const chosen = filter.value;
  const folders = [...new Set(rows.map((r) => r.folder))].sort();
  filter.innerHTML = `<option value="">todos</option>${folders.map((f) => `<option${f === chosen ? " selected" : ""}>${esc(f)}</option>`).join("")}`;
  $("list").hidden = false;
  render();
}

function render(): void {
  const folder = $<HTMLSelectElement>("filter").value;
  $<HTMLButtonElement>("release-all").disabled = !folder;
  const shown = rows.filter((r) => !folder || r.folder === folder);
  $("rows").innerHTML = shown.length
    ? shown
        .map((r) => `<tr data-id="${r.id}"><td>${esc(r.email)}</td><td>${esc(r.folder)}</td><td><span class="tag ${r.status}">${r.status === "submitted" ? "entregado" : "en terreno"}</span></td>
          <td>${r.day}</td><td>${r.stations}</td><td>${(r.walked / 1000).toFixed(1)}</td><td>${r.areas} áreas · ${r.lines} líneas</td>
          <td>${r.grade ? `${pct(r.grade.adjusted ?? r.grade.auto)}${r.grade.adjusted !== null ? " (ajustada)" : ""}` : "—"}</td><td>${r.grade?.released ? "sí" : "no"}</td>
          <td>${new Date(r.updated).toLocaleString("es-CL")}</td></tr>`)
        .join("")
    : `<tr><td colspan="10" class="muted">Aún no hay intentos.</td></tr>`;
  for (const tr of document.querySelectorAll<HTMLElement>("#rows tr[data-id]")) tr.onclick = () => void detail(tr.dataset.id!);
}

function scenarioOf(folder: string): Promise<Scenario> {
  let p = scenarios.get(folder);
  if (!p) scenarios.set(folder, (p = loadScenario(remote.bundle(folder))));
  return p;
}

async function detail(id: string): Promise<void> {
  const d = await remote.call<{ attempt: { id: string; email: string; folder: string; status: string; state: any }; events: { t: string; kind: string; data: any }[]; grade: { auto: any; adjusted?: number; note?: string; released: boolean } | null; truth: Pick<Truth, "units" | "map" | "contacts"> }>("GET", `/teacher/attempt?id=${encodeURIComponent(id)}`);
  const scenario = await scenarioOf(d.attempt.folder);
  const box = $("detail");
  box.hidden = false;
  $("list").hidden = true;
  const g = d.grade, auto = g?.auto as { total: number; parts: { key: string; score: number | null; weight: number; notes: string[] }[] } | undefined;
  box.innerHTML = `<div class="bar"><button type="button" id="back">← Volver a la lista</button><b>${esc(d.attempt.email)}</b> · ${esc(d.attempt.folder)} · <span class="tag ${d.attempt.status}">${d.attempt.status === "submitted" ? "entregado" : "en terreno"}</span></div>
    <div class="detail-grid">
      <div><canvas id="map"></canvas>
        <p class="legend"><span><i style="background:#ddd"></i>Mapa verdadero (tenue)</span><span><i style="background:#fff;border-color:#333"></i>Áreas y líneas del estudiante</span><span><i style="background:#1a5fb4"></i>Recorrido</span><span><i style="background:#fff"></i>Estaciones</span></p>
        <label>Recorrido hasta: <input type="range" id="replay" min="0" max="${Math.max(d.events.filter((e) => e.kind === "pos").length, 1)}" value="${d.events.length}"></label></div>
      <div>
        <div class="card"><h3>Nota automática ${auto ? pct(auto.total) : "—"}</h3>${
          auto
            ? `<table class="parts">${auto.parts.map((p) => `<tr><td>${PART_NAMES[p.key] ?? p.key}<div class="muted">${p.notes.map(esc).join("<br>")}</div></td><td>${p.score === null ? "no aplica" : pct(p.score)}</td></tr>`).join("")}</table>`
            : '<p class="muted">Se calcula cuando el estudiante entrega.</p>'
        }</div>
        ${
          g
            ? `<div class="card"><h3>Nota final</h3><label>Ajuste: <b id="adj-v">${pct(g.adjusted ?? auto!.total)}</b><input type="range" id="adj" min="0" max="100" value="${Math.round((g.adjusted ?? auto!.total) * 100)}"></label>
               <label>Comentario para el estudiante<textarea id="note">${esc(g.note ?? "")}</textarea></label>
               <div class="bar"><button type="button" class="primary" id="save">Guardar</button><button type="button" id="reset">Volver a la automática</button>
               <button type="button" id="release">${g.released ? "Ocultar la nota" : "Liberar la nota"}</button><button type="button" id="regrade">Recalcular</button></div>
               <p class="muted">${g.released ? "El estudiante ya ve su nota." : "El estudiante aún no ve la nota."}</p></div>`
            : ""
        }
        <div class="card"><h3>Avance</h3><p>Día ${d.attempt.state?.clock?.day ?? "—"} · ${d.attempt.state?.stations?.length ?? 0} estaciones · ${((d.attempt.state?.walked ?? 0) / 1000).toFixed(1)} km · ${d.events.filter((e) => e.kind === "observe").length} afloramientos trabajados</p></div>
      </div>
    </div>`;
  $("back").onclick = () => ((box.hidden = true), void list());
  const draw = () => drawMap($<HTMLCanvasElement>("map"), scenario, d.truth, d.attempt.state, d.events, Number($<HTMLInputElement>("replay").value));
  $("replay").oninput = draw;
  draw();
  if (!g) return;
  $("adj").oninput = () => ($("adj-v").textContent = `${$<HTMLInputElement>("adj").value} %`);
  $("save").onclick = async () => {
    await remote.call("POST", "/teacher/adjust", { id, total: Number($<HTMLInputElement>("adj").value) / 100, note: $<HTMLTextAreaElement>("note").value });
    await detail(id);
  };
  $("reset").onclick = async () => {
    await remote.call("POST", "/teacher/adjust", { id, total: null });
    await detail(id);
  };
  $("release").onclick = async () => {
    await remote.call("POST", "/teacher/release", { id, released: !g.released });
    await detail(id);
  };
  $("regrade").onclick = async () => {
    await remote.call("POST", "/teacher/regrade", { id });
    await detail(id);
  };
}

/** The true map, faint; the student's areas, lines and stations over it; and the traverse. */
function drawMap(canvas: HTMLCanvasElement, scenario: Scenario, truth: Pick<Truth, "units" | "map" | "contacts">, state: any, events: { kind: string; data: any }[], upTo: number): void {
  const { nx, ny, cell_size_m } = scenario.manifest.grid, cell = cell_size_m.x;
  const px = 3;
  canvas.width = nx * px;
  canvas.height = ny * px;
  const ctx = canvas.getContext("2d")!;
  const trueMap = expandTruthMap(truth as Truth, scenario.manifest);
  const colour = new Map(scenario.units.map((u, i) => [i, u.colour]));
  ctx.globalAlpha = 0.45;
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      ctx.fillStyle = colour.get(trueMap[ix + nx * iy]!) ?? "#ccc";
      ctx.fillRect(ix * px, (ny - 1 - iy) * px, px, px);
    }
  }
  ctx.globalAlpha = 1;
  const sx = (x: number) => (x / cell) * px, sy = (y: number) => canvas.height - (y / cell) * px;
  const path = (pts: number[], closed: boolean) => {
    ctx.beginPath();
    for (let i = 0; i + 1 < pts.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, sx(pts[i]!), sy(pts[i + 1]!));
    if (closed) ctx.closePath();
  };
  const map = state?.map ?? { polygons: [], lines: [], units: [] };
  // The student's areas, outlined in their colours.
  for (const p of map.polygons) {
    ctx.strokeStyle = map.units.find((u: any) => u.id === p.unit)?.colour ?? "#333";
    ctx.lineWidth = 2;
    path(p.points, true);
    ctx.stroke();
  }
  for (const l of map.lines) {
    ctx.strokeStyle = l.kind === "fault" ? "#b01c1c" : "#111";
    ctx.lineWidth = l.kind === "fault" ? 2.5 : 1.5;
    path(l.points, false);
    ctx.stroke();
  }
  // The traverse, from the positions logged every ten seconds.
  const pos = events.filter((e) => e.kind === "pos").slice(0, upTo).map((e) => e.data as number[]);
  if (pos.length > 1) {
    ctx.strokeStyle = "#1a5fb4";
    ctx.lineWidth = 2;
    ctx.beginPath();
    pos.forEach(([x, y], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, sx(x!), sy(y!)));
    ctx.stroke();
  }
  const origin = scenario.manifest.grid.origin;
  for (const s of state?.stations ?? []) {
    ctx.beginPath();
    ctx.arc(sx(s.easting - origin.easting), sy(s.northing - origin.northing), 4, 0, 2 * Math.PI);
    ctx.fillStyle = map.units.find((u: any) => u.id === s.unit)?.colour ?? "#fff";
    ctx.fill();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
}

main().catch((e: unknown) => {
  document.querySelector("main")!.innerHTML = `<p>No se pudo cargar el panel: ${esc(e instanceof RemoteError || e instanceof Error ? e.message : String(e))}</p>`;
});
