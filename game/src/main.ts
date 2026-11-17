import { type DayState, dayState, nextDay, remaining, spend, timeOfDay } from "./explore/clock";
import { Controls } from "./explore/controls";
import { discover, outcropInReach } from "./explore/discovery";
import { EYE_HEIGHT, step } from "./explore/movement";
import { FormatError, loadPracticeTruth, loadScenario } from "./format/loader";
import { browserStore, clear, load, save, serialize } from "./state/save";
import { type GameState, newGame } from "./state/state";
import type { Field } from "./tools/fieldwork";
import { FieldPanel } from "./ui/fieldPanel";
import { MapBoard } from "./ui/mapboard";
import { NetView } from "./ui/netview";
import { Notebook } from "./ui/notebook";
import { buildGrid, heightAt } from "./world/blocks";
import { World } from "./world/world";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const overlay = $("overlay"), overlayTitle = $("overlay-title"), overlayText = $("overlay-text");
const overlayButton = $<HTMLButtonElement>("overlay-button"), overlaySecond = $<HTMLButtonElement>("overlay-second");
const WINDS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];

interface Choice {
  label: string;
  action: () => void;
}

function show(title: string, text: string, first?: Choice, second?: Choice): void {
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  for (const [button, choice] of [[overlayButton, first], [overlaySecond, second]] as const) {
    button.hidden = !choice;
    button.textContent = choice?.label ?? "";
    button.onclick = choice?.action ?? null;
  }
  overlay.hidden = false;
}

async function start(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const folder = (params.get("s") ?? "quebrada-los-litres-a").replace(/[^a-z0-9-]/g, "");
  const read = async (path: string) => {
    const response = await fetch(`./${folder}/${path}`);
    // Static hosts and dev servers may answer a missing file with the site's own page.
    const missing = !response.ok || (response.headers.get("content-type") ?? "").includes("text/html");
    if (missing) throw new FormatError(`No se pudo descargar ${folder}/${path} (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  };
  const scenario = await loadScenario(read);
  const truth = await loadPracticeTruth(read, scenario.manifest);
  const rules = scenario.manifest.rules;
  const grid = buildGrid(scenario);
  const canvas = $<HTMLCanvasElement>("view");
  const world = new World(canvas);
  const store = browserStore();
  const { scenario_id, variant } = scenario.manifest;
  const saved = store && load(store, scenario_id, variant);
  // One object for the whole attempt; "start over" refills it rather than replacing it.
  const state: GameState = saved ?? newGame(scenario, grid);
  const field: Field = { scenario, state, truth };
  const controls = new Controls(canvas);
  const hud = $("hud"), prompt = $("prompt"), workButton = $("work-button");
  await world.build(scenario, grid);
  world.update(state.walker.x, state.walker.y);

  let eye = heightAt(grid, state.walker.x, state.walker.y) + EYE_HEIGHT;
  let playing = false;
  let fps = 0;
  let near = -1;
  let saveFailed = false;
  const origin = scenario.manifest.grid.origin;
  const persist = () => {
    if (store && !save(store, state)) saveFailed = true;
  };

  const onDay = (now: DayState): boolean => {
    if (now === "working") return true;
    playing = false;
    panel.hide();
    notebook.hide();
    board.hide();
    net.hide();
    document.exitPointerLock?.();
    persist();
    if (now === "day_over") {
      show(`Fin del día ${state.clock.day}`, `Llevas ${(state.walked / 1000).toFixed(1)} km caminados y ${state.stations.length} estaciones. Quedan ${rules.field_days - state.clock.day} días de terreno.`, {
        label: `Comenzar el día ${state.clock.day + 1}`,
        action: () => {
          nextDay(state.clock, rules);
          persist();
          begin();
        },
      });
    } else {
      show("Fin de la campaña", "Se acabaron los días de terreno. Aún puedes revisar tu libreta y el mapa.", { label: "Ver la libreta", action: () => { overlay.hidden = true; hud.hidden = false; notebook.open(); } });
    }
    return false;
  };
  const charge = (minutes: number) => onDay(spend(state.clock, minutes, rules));

  const resume = () => {
    panel.hide();
    notebook.hide();
    board.hide();
    net.hide();
    if (dayState(state.clock, rules) === "working") controls.lock();
  };
  const panel = new FieldPanel($("field-panel"), field, charge, persist, resume);
  const notebook = new Notebook($("notebook"), field, rules, () => serialize(state), resume);
  const net = new NetView($("stereonet"), field, resume);
  const board = new MapBoard($("map"), scenario, grid, field, persist, () => command("KeyM"), () => command("KeyS"));
  const anyOpen = (): boolean => panel.isOpen || notebook.isOpen || board.isOpen || net.isOpen;

  const command = (code: string): void => {
    if (hud.hidden || !overlay.hidden) return;
    if (code === "Escape") {
      if (board.isOpen && board.cancelDrawing()) return; // first Esc drops the line being drawn
      return anyOpen() ? resume() : undefined;
    }
    const wasOpen = { KeyM: board.isOpen, KeyE: panel.isOpen, KeyN: notebook.isOpen, KeyS: net.isOpen }[code];
    resume();
    if (wasOpen) return;
    document.exitPointerLock?.();
    if (code === "KeyM") board.open();
    else if (code === "KeyS") net.open();
    else if (code === "KeyN") notebook.open();
    else if (code === "KeyE" && near >= 0 && dayState(state.clock, rules) === "working") panel.open(scenario.outcrops[near]!);
  };
  controls.onCommand = command;
  $("map-button").onclick = () => command("KeyM");
  $("net-button").onclick = () => command("KeyS");
  $("notebook-button").onclick = () => command("KeyN");
  workButton.onclick = () => command("KeyE");
  window.addEventListener("resize", () => world.resize());
  window.addEventListener("pagehide", persist);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && persist());

  function begin(): void {
    overlay.hidden = true;
    hud.hidden = false;
    playing = true;
    controls.lock();
  }

  $("overlay-help").hidden = false;
  const intro = `Tienes ${rules.field_days} días de terreno de ${rules.minutes_per_day / 60} horas. Caminar, medir y muestrear cuestan tiempo: planifica tus recorridos.`;
  if (saved) {
    show(scenario.manifest.title, `Tienes un trabajo guardado: día ${state.clock.day}, ${state.stations.length} estaciones, ${(state.walked / 1000).toFixed(1)} km caminados.`, {
      label: "Continuar",
      action: () => (dayState(state.clock, rules) === "working" ? begin() : onDay(dayState(state.clock, rules))),
    }, {
      label: "Empezar de nuevo (borra lo guardado)",
      action: () => {
        clear(store!, scenario_id, variant);
        Object.assign(state, newGame(scenario, grid));
        eye = heightAt(grid, state.walker.x, state.walker.y) + EYE_HEIGHT;
        world.update(state.walker.x, state.walker.y);
        show(scenario.manifest.title, intro, { label: "Comenzar", action: begin });
      },
    });
  } else {
    show(scenario.manifest.title, store ? intro : `${intro} Este navegador no permite guardar: el trabajo se perderá al cerrar la página.`, { label: "Comenzar", action: begin });
  }

  let last = performance.now();
  let sinceCheck = 1, sinceSave = 0;
  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.25); // a slow frame must not turn into slow motion
    last = now;
    fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;

    if (playing && !anyOpen()) {
      const look = controls.look();
      state.walker.heading = (((state.walker.heading + look.heading) % 360) + 360) % 360;
      state.walker.pitch = Math.max(-85, Math.min(85, state.walker.pitch + look.pitch));
      const intent = controls.move();
      const moved = step(state.walker, grid, intent.forward, intent.right, dt);
      state.walked += moved.distance;
      if (moved.minutes > 0) charge(moved.minutes);
      sinceCheck += dt;
      sinceSave += dt;
      if (sinceCheck > 0.25) {
        sinceCheck = 0;
        world.update(state.walker.x, state.walker.y);
        discover(scenario, grid, state.found, state.walker.x, state.walker.y);
        near = outcropInReach(scenario, grid, state.walker.x, state.walker.y);
      }
      if (sinceSave > 5) {
        sinceSave = 0;
        persist();
      }
    } else {
      controls.look();
    }
    const canWork = near >= 0 && playing && !anyOpen();
    workButton.hidden = !canWork;
    prompt.hidden = !saveFailed;
    if (saveFailed) prompt.textContent = "No se pudo guardar en este navegador. Exporta tu libreta para no perder el trabajo.";

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
  Object.assign(window, {
    __geomapper: { state, grid, scenario, world, fps: () => fps, heightAt: (x: number, y: number) => heightAt(grid, x, y), dayState: () => dayState(state.clock, rules), save: persist, board, net },
  });
}

start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  show("No se pudo cargar el escenario", message);
  console.error(error);
});
