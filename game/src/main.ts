import { type DayState, dayState, nextDay, remaining, spend, timeOfDay } from "./explore/clock";
import { Controls } from "./explore/controls";
import { discover, outcropInReach } from "./explore/discovery";
import { EYE_HEIGHT, step } from "./explore/movement";
import { FormatError, loadScenario } from "./format/loader";
import { type GameState, newGame } from "./state/state";
import { MapView } from "./ui/mapview";
import { buildGrid, heightAt } from "./world/blocks";
import { World } from "./world/world";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const overlay = $("overlay"), overlayTitle = $("overlay-title"), overlayText = $("overlay-text");
const overlayButton = $<HTMLButtonElement>("overlay-button"), overlayHelp = $("overlay-help");
const WINDS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];

function show(title: string, text: string, button: string | null, action?: () => void): void {
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  overlayButton.hidden = button === null;
  if (button !== null) overlayButton.textContent = button;
  overlayButton.onclick = action ?? null;
  overlay.hidden = false;
}

async function start(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const folder = (params.get("s") ?? "quebrada-los-litres-a").replace(/[^a-z0-9-]/g, "");
  const scenario = await loadScenario(async (path) => {
    const response = await fetch(`./${folder}/${path}`);
    if (!response.ok) throw new FormatError(`No se pudo descargar ${folder}/${path} (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  });
  const rules = scenario.manifest.rules;
  const grid = buildGrid(scenario);
  const canvas = $<HTMLCanvasElement>("view");
  const world = new World(canvas);
  const state: GameState = newGame(scenario, grid);
  const controls = new Controls(canvas);
  const map = new MapView($<HTMLCanvasElement>("map-canvas"), $("map-legend"), scenario, grid);
  const mapPanel = $("map"), hud = $("hud"), prompt = $("prompt");
  await world.build(scenario, grid);
  world.update(state.walker.x, state.walker.y);

  let eye = heightAt(grid, state.walker.x, state.walker.y) + EYE_HEIGHT;
  let playing = false;
  let fps = 0;
  const origin = scenario.manifest.grid.origin;

  const toggleMap = () => {
    if (!hud.hidden || !mapPanel.hidden) {
      mapPanel.hidden = !mapPanel.hidden;
      if (!mapPanel.hidden) {
        document.exitPointerLock?.();
        map.draw(state);
      }
    }
  };
  controls.onToggleMap = toggleMap;
  $("map-button").onclick = toggleMap;
  $("map-close").onclick = toggleMap;
  window.addEventListener("resize", () => world.resize());

  const begin = () => {
    overlay.hidden = true;
    hud.hidden = false;
    playing = true;
    controls.lock();
  };
  const onDay = (now: DayState) => {
    if (now === "working") return;
    playing = false;
    document.exitPointerLock?.();
    if (now === "day_over") {
      show(`Fin del día ${state.clock.day}`, `Caminaste ${(state.walked / 1000).toFixed(1)} km. Quedan ${rules.field_days - state.clock.day} días de terreno.`, `Comenzar el día ${state.clock.day + 1}`, () => {
        nextDay(state.clock, rules);
        begin();
      });
    } else {
      show("Fin de la campaña", "Se acabaron los días de terreno. Aún puedes revisar el mapa (M).", null);
    }
  };

  overlayHelp.hidden = false;
  show(
    scenario.manifest.title,
    `Tienes ${rules.field_days} días de terreno de ${rules.minutes_per_day / 60} horas. Caminar cuesta tiempo: planifica tus recorridos.`,
    "Comenzar",
    begin,
  );

  let last = performance.now();
  let sinceDiscovery = 1;
  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;

    if (playing && mapPanel.hidden) {
      const look = controls.look();
      state.walker.heading = (((state.walker.heading + look.heading) % 360) + 360) % 360;
      state.walker.pitch = Math.max(-85, Math.min(85, state.walker.pitch + look.pitch));
      const intent = controls.move();
      const moved = step(state.walker, grid, intent.forward, intent.right, dt);
      state.walked += moved.distance;
      if (moved.minutes > 0) onDay(spend(state.clock, moved.minutes, rules));
      sinceDiscovery += dt;
      if (sinceDiscovery > 0.25) {
        sinceDiscovery = 0;
        world.update(state.walker.x, state.walker.y);
        discover(scenario, grid, state.found, state.walker.x, state.walker.y);
        const near = outcropInReach(scenario, grid, state.walker.x, state.walker.y);
        prompt.hidden = near < 0;
        if (near >= 0) prompt.textContent = `Afloramiento ${scenario.outcrops[near]!.id.slice(1)} · las herramientas de terreno llegan en la próxima etapa`;
      }
    } else {
      controls.look();
    }

    // Glide over the steps of the blocky ground instead of snapping.
    const target = heightAt(grid, state.walker.x, state.walker.y) + EYE_HEIGHT;
    eye += (target - eye) * Math.min(1, dt * 9);
    world.look(state.walker.x, state.walker.y, eye, state.walker.heading, state.walker.pitch);
    world.render();

    $("clock").textContent = `Día ${state.clock.day} de ${rules.field_days} · ${timeOfDay(state.clock)} · quedan ${remaining(state.clock, rules)}`;
    $("coords").textContent = `E ${Math.round(origin.easting + state.walker.x)} · N ${Math.round(origin.northing + state.walker.y)} · ${Math.round(target - EYE_HEIGHT)} m s.n.m.`;
    $("compass").textContent = `${String(Math.round(state.walker.heading) % 360).padStart(3, "0")}° ${WINDS[Math.round(state.walker.heading / 45) % 8]}`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // For the end-to-end test and for debugging in the console.
  Object.assign(window, { __geomapper: { state, grid, scenario, world, fps: () => fps, heightAt: (x: number, y: number) => heightAt(grid, x, y), dayState: () => dayState(state.clock, rules) } });
}

start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  show("No se pudo cargar el escenario", message, null);
  console.error(error);
});
