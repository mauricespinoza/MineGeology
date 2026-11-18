import { type DayState, dayState, nextDay, remaining, spend, timeOfDay } from "./explore/clock";
import { Controls } from "./explore/controls";
import { discover, outcropInReach } from "./explore/discovery";
import { CLIMB_SPEED, EYE_HEIGHT, FLY_CEILING_M, FLY_SPEED, pace, slopeAt, step } from "./explore/movement";
import { FormatError, loadPracticeLitho, loadPracticeTruth, loadScenario } from "./format/loader";
import { browserStore, clear, load, save, serialize } from "./state/save";
import { type GameState, type Mode, newGame } from "./state/state";
import type { Field } from "./tools/fieldwork";
import { FieldPanel } from "./ui/fieldPanel";
import { MapBoard } from "./ui/mapboard";
import { NetView } from "./ui/netview";
import { ColumnView } from "./ui/columnView";
import { EvalView } from "./ui/evalView";
import { SectionView } from "./ui/sectionView";
import { Notebook } from "./ui/notebook";
import { type IconName, icon } from "./ui/icons";
import { logoSvg } from "./ui/logo";
import { Sound } from "./audio/sound";
import { aimAt } from "./explore/aim";
import { RockCard } from "./ui/rockCard";
import { COVER } from "./world/blocks";
import { loadIndex, renderPicker } from "./ui/picker";
import { hasSavedAvatar, loadAvatar } from "./state/avatar";
import { AvatarView } from "./ui/avatarView";
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

/** Fills every element marked data-icon with its icon, and its caption if it has one. */
function drawIcons(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>("[data-icon]")) {
    el.innerHTML = icon(el.dataset.icon as IconName) + (el.dataset.caption ? `<span>${el.dataset.caption}</span>` : "");
  }
}
drawIcons();
document.getElementById("overlay-logo")!.innerHTML = logoSvg(window.innerWidth < 520 ? 5 : 8);
// Touch screens get touch instructions; a mouse and keyboard get the keys.
document.documentElement.classList.toggle("touch", matchMedia("(pointer: coarse)").matches);

async function start(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const index = await loadIndex();
  if (!params.get("s") && index && index.length > 1) {
    const store = browserStore();
    show("", "Elige un escenario. Cada variante tiene otra geometría o afloramientos distintos, y su propio avance guardado.");
    renderPicker($("overlay-list"), index, (e) => !!store && !!load(store, e.scenario_id, e.variant));
    return;
  }
  const folder = (params.get("s") ?? index?.[0]?.folder ?? "quebrada-los-litres-a").replace(/[^a-z0-9-]/g, "");
  $("overlay-change").hidden = !index || index.length < 2;
  const read = async (path: string) => {
    const response = await fetch(`./${folder}/${path}`);
    // Static hosts and dev servers may answer a missing file with the site's own page.
    const missing = !response.ok || (response.headers.get("content-type") ?? "").includes("text/html");
    if (missing) throw new FormatError(`No se pudo descargar ${folder}/${path} (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  };
  const scenario = await loadScenario(read);
  const truth = await loadPracticeTruth(read, scenario.manifest);
  const litho = truth ? await loadPracticeLitho(read, scenario.manifest) : null;
  const rules = scenario.manifest.rules;
  const grid = buildGrid(scenario);
  const canvas = $<HTMLCanvasElement>("view");
  const world = new World(canvas);
  const store = browserStore();
  const { scenario_id, variant } = scenario.manifest;
  const saved = store && load(store, scenario_id, variant);
  // One object for the whole attempt; "start over" refills it rather than replacing it.
  const state: GameState = saved ?? newGame(scenario, grid);
  const field: Field = { scenario, state, truth, assetUrl: (path) => `./${folder}/${path}` };
  const controls = new Controls(canvas, $("pad-move"), $("pad-look"));
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
    section.hide();
    column.hide();
    evaluation.hide();
    rockCard.hide();
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
  // Free mode keeps no clock: nothing costs time and the day never ends.
  const charge = (minutes: number) => state.mode === "free" || onDay(spend(state.clock, minutes, rules));

  const resume = () => {
    panel.hide();
    notebook.hide();
    board.hide();
    net.hide();
    section.hide();
    column.hide();
    evaluation.hide();
    rockCard.hide();
    if (dayState(state.clock, rules) === "working") controls.lock();
  };
  const sound = new Sound();
  const panel = new FieldPanel($("field-panel"), field, charge, persist, resume, (colour) => {
    world.swing();
    world.chips(colour);
    sound.hammer();
  });
  const soundButton = $<HTMLButtonElement>("sound-button");
  const showSound = () => {
    soundButton.innerHTML = icon(sound.enabled ? "soundOn" : "soundOff");
    soundButton.title = soundButton.ariaLabel = sound.enabled ? "Sonido: activado" : "Sonido: apagado";
  };
  showSound();
  soundButton.onclick = () => (sound.setEnabled(!sound.enabled), showSound(), soundButton.blur());
  const notebook = new Notebook($("notebook"), field, rules, () => serialize(state), resume);
  const net = new NetView($("stereonet"), field, resume);
  const board = new MapBoard($("map"), scenario, grid, field, persist, () => command("KeyM"), () => command("KeyS"), () => command("KeyP"));
  const section = new SectionView($("section"), field, grid, persist, resume);
  const column = new ColumnView($("column"), field, persist, resume);
  const evaluation = new EvalView($("evaluation"), field, grid, litho, resume);
  const rockCard = new RockCard($("rock-card"), scenario, field.assetUrl ?? ((path) => path), resume);

  // The student's figure: the hand in first person, the whole figure in third person.
  const avatar = loadAvatar();
  world.setAvatar(avatar);
  const viewButton = $<HTMLButtonElement>("view-button");
  const setView = (third: boolean) => {
    world.thirdPerson = third;
    viewButton.innerHTML = icon(third ? "firstPerson" : "thirdPerson");
    viewButton.title = viewButton.ariaLabel = third ? "Volver a la vista en primera persona (V)" : "Verte desde atrás (V)";
    viewButton.classList.toggle("flying", third);
    try {
      localStorage.setItem("geomapper:view", third ? "third" : "first");
    } catch {
      // Not saved in a private window.
    }
  };
  try {
    setView(localStorage.getItem("geomapper:view") === "third");
  } catch {
    setView(false);
  }
  viewButton.onclick = () => (setView(!world.thirdPerson), viewButton.blur());
  let overlayBeforeAvatar = false;
  const avatarView = new AvatarView($("avatar"), avatar, (a) => world.setAvatar(a), () => {
    avatarView.hide();
    if (overlayBeforeAvatar) overlay.hidden = false;
  });
  $("overlay-avatar").onclick = () => {
    overlayBeforeAvatar = !overlay.hidden;
    overlay.hidden = true;
    avatarView.open();
  };
  $("overlay-avatar-row").hidden = false;
  if (!hasSavedAvatar()) $("overlay-avatar").classList.add("first-time");
  const anyOpen = (): boolean => panel.isOpen || notebook.isOpen || board.isOpen || net.isOpen || section.isOpen || column.isOpen || evaluation.isOpen || rockCard.isOpen;

  const command = (code: string): void => {
    if (hud.hidden || !overlay.hidden) return;
    if (code === "Escape") {
      if (board.isOpen && board.cancelDrawing()) return; // first Esc drops the line being drawn
      if (section.isOpen && section.cancelDrawing()) return;
      return anyOpen() ? resume() : undefined;
    }
    if (code === "KeyF") {
      if (!anyOpen()) toggleFlight();
      return;
    }
    if (code === "KeyV") {
      if (!anyOpen()) setView(!world.thirdPerson);
      return;
    }
    const wasOpen = { KeyM: board.isOpen, KeyE: panel.isOpen, KeyN: notebook.isOpen, KeyS: net.isOpen, KeyP: section.isOpen, KeyC: column.isOpen, Evaluate: evaluation.isOpen }[code];
    resume();
    if (wasOpen) return;
    document.exitPointerLock?.();
    if (code === "KeyM") board.open();
    else if (code === "KeyS") net.open();
    else if (code === "KeyP") section.open();
    else if (code === "KeyC") column.open();
    else if (code === "Evaluate") evaluation.open();
    else if (code === "KeyN") notebook.open();
    else if (code === "KeyE" && dayState(state.clock, rules) === "working") {
      if (near >= 0) panel.open(scenario.outcrops[near]!);
      else if (looseRock) {
        rockCard.open(RockCard.nearest(scenario, looseRock.x, looseRock.y), `${looseRock.x},${looseRock.y}`);
        charge(5); // a look with the lens, as at an outcrop
      }
    }
  };
  controls.onCommand = command;
  $("map-button").onclick = () => command("KeyM");
  $("net-button").onclick = () => command("KeyS");
  $("section-button").onclick = () => command("KeyP");
  $("column-button").onclick = () => command("KeyC");
  const evalButton = $("eval-button");
  evalButton.hidden = !truth;
  evalButton.onclick = () => command("Evaluate");
  $("notebook-button").onclick = () => command("KeyN");
  workButton.onclick = () => command("KeyE");
  const flyButton = $<HTMLButtonElement>("fly-button"), flyPad = $("pad-fly");
  /** Free mode only. Landing puts the student back on the ground at once. */
  function toggleFlight(): void {
    if (state.mode !== "free") return;
    state.flight.on = !state.flight.on;
    if (!state.flight.on) state.flight.height = 0;
    persist();
  }
  flyButton.onclick = () => (toggleFlight(), flyButton.blur());
  $("help-button").onclick = () => {
    if (!playing) return;
    resume();
    playing = false;
    document.exitPointerLock?.();
    persist();
    show("En pausa", "Tu avance se guarda solo en este navegador.", { label: "Continuar", action: begin });
    $("overlay-help").hidden = false;
  };
  window.addEventListener("resize", () => world.resize());
  window.addEventListener("pagehide", persist);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && persist());

  function begin(): void {
    sound.start(); // a tap or a click started the game, so the browser lets the sound begin
    overlay.hidden = true;
    hud.hidden = false;
    playing = true;
    controls.lock();
  }

  $("overlay-help").hidden = false;
  const intro =
    `Modo campaña: ${rules.field_days} días de terreno de ${rules.minutes_per_day / 60} horas; caminar (más en pendiente o entre vegetación), medir y muestrear cuestan tiempo, y hay ${rules.sample_limit} muestras. ` +
    "Modo libre: sin reloj ni cansancio, muestras sin límite y resultados de laboratorio al instante.";
  const fresh = (mode: Mode) => {
    if (store) clear(store, scenario_id, variant);
    Object.assign(state, newGame(scenario, grid, undefined, mode));
    eye = heightAt(grid, state.walker.x, state.walker.y) + EYE_HEIGHT;
    world.update(state.walker.x, state.walker.y);
    persist();
    begin();
  };
  const choose = () =>
    show(scenario.manifest.title, store ? intro : `${intro} Este navegador no permite guardar: el trabajo se perderá al cerrar la página.`,
      { label: "Modo campaña (con tiempo)", action: () => fresh("campaign") },
      { label: "Modo libre (sin tiempo)", action: () => fresh("free") });
  if (saved) {
    const where = state.mode === "free" ? "en modo libre" : `en modo campaña, día ${state.clock.day}`;
    show(scenario.manifest.title, `Tienes un trabajo guardado ${where}: ${state.stations.length} estaciones, ${(state.walked / 1000).toFixed(1)} km caminados.`, {
      label: "Continuar",
      action: () => (state.mode === "free" || dayState(state.clock, rules) === "working" ? begin() : onDay(dayState(state.clock, rules))),
    }, { label: "Empezar de nuevo (borra lo guardado)", action: choose });
  } else choose();

  const slopeBox = $("slope");
  const showSlope = () => {
    if (state.flight.on) {
      slopeBox.className = "panel";
      slopeBox.innerHTML = `Volando a <b>${Math.round(state.flight.height)} m</b><span class="long"> sobre el suelo · Espacio sube, Mayúsculas baja, F aterriza. Para ver la roca hay que bajar.</span>`;
      return;
    }
    const s = slopeAt(grid, state.walker.x, state.walker.y, state.walker.heading);
    const degrees = Math.abs(s.degrees);
    const way = s.along > 0.02 ? "↑ sube" : s.along < -0.02 ? "↓ baja" : "plano";
    let text = `<span class="long">Pendiente hacia donde miras: </span><b>${degrees.toFixed(0)}°</b> (${Math.round(Math.abs(s.along) * 100)} %) ${way}`;
    if (state.mode === "campaign") {
      const ix = Math.min(Math.max(Math.floor(state.walker.x / grid.cell), 0), grid.nx - 1);
      const iy = Math.min(Math.max(Math.floor(state.walker.y / grid.cell), 0), grid.ny - 1);
      const kmh = pace(s.along, grid.cover[ix + grid.nx * iy]!);
      text += ` · ${kmh.toFixed(1).replace(".", ",")} km/h<span class="long"> · ${(6 / kmh).toFixed(1).replace(".", ",")} min cada 100 m</span>`;
    }
    slopeBox.className = `panel ${degrees < 8 ? "easy" : degrees < 20 ? "moderate" : degrees < 30 ? "hard" : "steep"}`;
    slopeBox.innerHTML = text;
  };

  let last = performance.now();
  let sinceCheck = 1, sinceSave = 0;
  let walking = false;
  let lastClock = "";
  let looseRock: { x: number; y: number } | null = null;
  let lastSwung = -1, awayFor = 0;
  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.25); // a slow frame must not turn into slow motion
    last = now;
    fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;

    if (playing && !anyOpen()) {
      const look = controls.look(dt);
      state.walker.heading = (((state.walker.heading + look.heading) % 360) + 360) % 360;
      state.walker.pitch = Math.max(-85, Math.min(85, state.walker.pitch + look.pitch));
      const intent = controls.move();
      const flying = state.flight.on;
      if (flying) state.flight.height = Math.min(Math.max(state.flight.height + controls.vertical() * CLIMB_SPEED * dt, 0), FLY_CEILING_M);
      const moved = step(state.walker, grid, intent.forward, intent.right, dt, state.mode === "campaign", flying ? FLY_SPEED : undefined);
      walking = moved.distance > 0 && !flying;
      if (!flying) state.walked += moved.distance;
      if (moved.minutes > 0) charge(moved.minutes);
      sinceCheck += dt;
      sinceSave += dt;
      if (sinceCheck > 0.25) {
        sinceCheck = 0;
        world.update(state.walker.x, state.walker.y, state.flight.height < 80); // high up, the coarse blocks are enough
        discover(scenario, grid, state.found, state.walker.x, state.walker.y, state.flight.height);
        // What the crosshair points at: an outcrop close by, or loose weathered rock.
        near = -1;
        looseRock = null;
        let aimed = -1;
        if (state.flight.height < 3) {
          const a = aimAt(grid, state.walker.x, state.walker.y, eye, state.walker.heading, state.walker.pitch);
          if (a) {
            const cell = a.ix + grid.nx * a.iy;
            aimed = grid.outcrop[cell]!;
            if (aimed < 0 && grid.cover[cell] === COVER.scree) looseRock = { x: (a.ix + 0.5) * grid.cell, y: (a.iy + 0.5) * grid.cell };
          }
          // The rock pointed at first, then any outcrop within reach, and loose rock only where neither is.
          near = aimed >= 0 ? aimed : outcropInReach(scenario, grid, state.walker.x, state.walker.y);
          if (near >= 0) looseRock = null;
        }
        // Pointing at rock from close by breaks a piece off: the gesture only, it costs no time.
        if (aimed >= 0 && aimed !== lastSwung) {
          const unit = scenario.units.find((u) => u.key === scenario.outcrops[aimed]!.observation?.unit);
          world.swing();
          world.chips(unit?.colour ?? "#8d8d86");
          sound.hammer();
          lastSwung = aimed;
          awayFor = 0;
        } else if (aimed < 0 && (awayFor += 0.25) > 1.5) lastSwung = -1;
        showSlope();
      }
      if (sinceCheck === 0) {
        world.setStations(state.stations.map((st) => ({
          x: st.easting - origin.easting, y: st.northing - origin.northing,
          colour: state.map.units.find((u) => u.id === st.unit)?.colour ?? null,
        })));
      }
      if (sinceSave > 5) {
        sinceSave = 0;
        persist();
      }
    } else {
      controls.look(dt);
      walking = false;
    }
    const canWork = (near >= 0 || looseRock !== null) && playing && !anyOpen();
    workButton.hidden = !canWork;
    const workMode = near >= 0 ? "work" : "look";
    if (canWork && workButton.dataset.mode !== workMode) {
      workButton.dataset.mode = workMode;
      workButton.innerHTML = icon(near >= 0 ? "hammer" : "lens") + `<span>${near >= 0 ? "Trabajar" : "Mirar"}</span>`;
      workButton.title = workButton.ariaLabel = near >= 0 ? "Trabajar en el afloramiento (E)" : "Mirar la roca suelta con la lupa (E)";
    }
    prompt.hidden = !saveFailed;
    if (saveFailed) prompt.textContent = "No se pudo guardar en este navegador. Exporta tu libreta para no perder el trabajo.";

    // Glide over the steps of the blocky ground instead of snapping.
    const ground = heightAt(grid, state.walker.x, state.walker.y);
    const target = ground + EYE_HEIGHT + state.flight.height;
    flyButton.hidden = state.mode !== "free" || hud.hidden;
    const flight = state.flight.on ? "on" : "off";
    if (flyButton.dataset.state !== flight) {
      flyButton.dataset.state = flight;
      flyButton.classList.toggle("flying", state.flight.on);
      flyButton.innerHTML = icon(state.flight.on ? "land" : "fly");
      flyButton.title = flyButton.ariaLabel = state.flight.on ? "Aterrizar (F)" : "Volar (F)";
    }
    flyPad.hidden = !state.flight.on;
    eye += (target - eye) * Math.min(1, dt * 9);
    world.look(state.walker.x, state.walker.y, eye, state.walker.heading, state.walker.pitch);
    world.inset = panel.isOpen ? $("field-panel").offsetWidth : 0;
    world.setHeight(state.flight.height);
    world.animate(dt, walking);
    world.render();

    const clockText = state.mode === "free" ? "Modo libre<span class=\"long\"> · sin límite de tiempo</span>" : `Día ${state.clock.day}/${rules.field_days} · ${timeOfDay(state.clock)}<span class="long"> · quedan ${remaining(state.clock, rules)}</span>`;
    if (clockText !== lastClock) $("clock").innerHTML = lastClock = clockText;
    $("coords").textContent = `E ${Math.round(origin.easting + state.walker.x)} · N ${Math.round(origin.northing + state.walker.y)} · ${Math.round(ground)} m`;
    $("compass").textContent = `${String(Math.round(state.walker.heading) % 360).padStart(3, "0")}° ${WINDS[Math.round(state.walker.heading / 45) % 8]}`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // For the end-to-end test and for debugging in the console.
  Object.assign(window, {
    __geomapper: { state, grid, scenario, world, fps: () => fps, heightAt: (x: number, y: number) => heightAt(grid, x, y), dayState: () => dayState(state.clock, rules), save: persist, board, net, panel, section, column, evaluation },
  });
}

start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  show("No se pudo cargar el escenario", message);
  console.error(error);
});
