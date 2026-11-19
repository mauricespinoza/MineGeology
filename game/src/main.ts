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
import { aimAt, rayHit } from "./explore/aim";
import { RockCard } from "./ui/rockCard";
import { closeLupaFull } from "./ui/lupa";
import { Minimap } from "./ui/minimap";
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
/** How far from the student's feet the hammer reaches, metres on the ground. */
const HAMMER_REACH_M = 7;

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
    closeLupaFull();
    // The mouse stays free: it is never captured by itself, so the buttons always answer a click.
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
  const minimap = new Minimap($<HTMLCanvasElement>("minimap"), scenario, grid, state);
  $("minimap").onclick = () => command("KeyM");
  let minimapFrame = 0;
  const rockCard = new RockCard($("rock-card"), scenario, field.assetUrl ?? ((path) => path), resume);

  // The hammer anywhere: a tap (or a click) on rock within reach swings it there, and "Ver con lupa" comes up.
  const lupaButton = $<HTMLButtonElement>("lupa-button");
  /** What was hammered last and where the student stood, while its "Ver con lupa" is offered. */
  let hammered: { key: string; outcrop: number; x: number; y: number; standX: number; standY: number; until: number } | null = null;
  let toastText = "", toastUntil = 0;
  const toast = (text: string) => ((toastText = text), (toastUntil = performance.now() + 2600));
  const dropLupa = () => {
    hammered = null;
    lupaButton.hidden = true;
  };
  /** The rock under the hammer: an outcrop (its index), loose weathered rock, or none (soil, gravel, vegetation). */
  const rockAt = (ix: number, iy: number): { outcrop: number } | { loose: true } | null => {
    const cell = ix + grid.nx * iy;
    if (grid.outcrop[cell]! >= 0) return { outcrop: grid.outcrop[cell]! };
    // A block or two off an outcrop's edge still strikes it: the outcrop cells are coarse.
    for (let r = 1; r <= 1; r++) {
      for (let j = -r; j <= r; j++) {
        for (let i = -r; i <= r; i++) {
          const x = ix + i, y = iy + j;
          if (x >= 0 && y >= 0 && x < grid.nx && y < grid.ny && grid.outcrop[x + grid.nx * y]! >= 0) return { outcrop: grid.outcrop[x + grid.nx * y]! };
        }
      }
    }
    if (grid.cover[cell] === COVER.scree || grid.cover[cell] === COVER.rock) return { loose: true };
    return null;
  };
  const hammerAt = (sx: number, sy: number, how: "locked" | "mouse" | "touch"): boolean => {
    if (!playing || anyOpen() || hud.hidden || !overlay.hidden || dayState(state.clock, rules) !== "working") return false;
    const explain = how !== "mouse"; // a plain click on far ground captures the mouse instead
    const r = world.screenRay(sx, sy);
    const hit = rayHit(grid, r.ox, r.oy, r.oz, r.dx, r.dy, r.dz, 80);
    if (!hit) return false;
    if (state.flight.height >= 3) return explain && (toast("Aterriza para martillar la roca: desde el aire no se alcanza."), true);
    if (Math.hypot(hit.x - state.walker.x, hit.y - state.walker.y) > HAMMER_REACH_M)
      return explain && (toast("Demasiado lejos: acércate a la roca para martillarla."), true);
    const rock = rockAt(hit.ix, hit.iy);
    if (!rock) return explain && (toast("Aquí hay suelo o vegetación, no roca: toca un afloramiento o roca suelta cercana."), true);
    const outcrop = "outcrop" in rock ? rock.outcrop : -1;
    const key = outcrop >= 0 ? `o${outcrop}` : `${hit.ix},${hit.iy}`;
    const now = performance.now();
    // With the mouse captured the button cannot be clicked: hammering the same rock again looks at it.
    if (how === "locked" && hammered?.key === key && now < hammered.until) return openLupa(), true;
    const source = outcrop >= 0 ? scenario.outcrops[outcrop]! : RockCard.nearest(scenario, hit.x, hit.y);
    const unit = scenario.units.find((u) => u.key === source?.observation?.unit);
    world.swing();
    world.chips(unit?.colour ?? "#8d8d86", hit);
    sound.hammer();
    hammered = { key, outcrop, x: (hit.ix + 0.5) * grid.cell, y: (hit.iy + 0.5) * grid.cell, standX: state.walker.x, standY: state.walker.y, until: now + 12000 };
    const w = window.innerWidth, h = window.innerHeight;
    lupaButton.style.left = `${Math.min(Math.max(sx, 70), w - 70)}px`;
    lupaButton.style.top = `${Math.min(Math.max(sy - 64, 70), h - 120)}px`;
    lupaButton.title = lupaButton.ariaLabel = how === "locked" ? "Ver con lupa (E, o martilla otra vez)" : "Ver con lupa (E)";
    lupaButton.hidden = false;
    return true;
  };
  /** Opens what the hammer broke off: the station of the outcrop with the lens description, or the loose rock. */
  function openLupa(): void {
    const h = hammered;
    if (!h) return;
    dropLupa();
    resume();
    document.exitPointerLock?.();
    if (h.outcrop >= 0) panel.open(scenario.outcrops[h.outcrop]!, true);
    else {
      rockCard.open(RockCard.nearest(scenario, h.x, h.y), `${h.x},${h.y}`);
      charge(5); // a look with the lens, as at an outcrop
    }
  }
  lupaButton.onclick = () => openLupa();

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
  controls.allowLock = () => playing && !anyOpen() && overlay.hidden && !avatarView.isOpen;
  controls.onTap = hammerAt;

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
    if (code === "KeyL") {
      // For those who prefer to look by moving the mouse: L captures it, L or Esc frees it.
      if (document.pointerLockElement) document.exitPointerLock?.();
      else if (!anyOpen() && playing) controls.lock();
      return;
    }
    const wasOpen = { KeyM: board.isOpen, KeyE: panel.isOpen, KeyN: notebook.isOpen, KeyS: net.isOpen, KeyP: section.isOpen, KeyC: column.isOpen, Evaluate: evaluation.isOpen }[code];
    if (wasOpen) return resume();
    // Close what is open without asking for the mouse: a capture granted late would freeze the panel about to open.
    panel.hide();
    notebook.hide();
    board.hide();
    net.hide();
    section.hide();
    column.hide();
    evaluation.hide();
    rockCard.hide();
    document.exitPointerLock?.();
    if (code === "KeyM") board.open();
    else if (code === "KeyS") net.open();
    else if (code === "KeyP") section.open();
    else if (code === "KeyC") column.open();
    else if (code === "Evaluate") evaluation.open();
    else if (code === "KeyN") notebook.open();
    else if (code === "KeyE" && dayState(state.clock, rules) === "working") {
      if (hammered && performance.now() < hammered.until) openLupa();
      else if (near >= 0) panel.open(scenario.outcrops[near]!);
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
  /** The view before taking off: flying switches to third person, to see the figure fly, and landing restores it. */
  let viewBeforeFlight: boolean | null = null;
  function toggleFlight(): void {
    if (state.mode !== "free") return;
    state.flight.on = !state.flight.on;
    if (state.flight.on) {
      viewBeforeFlight = world.thirdPerson;
      setView(true);
    } else {
      state.flight.height = 0;
      if (viewBeforeFlight !== null) setView(viewBeforeFlight);
      viewBeforeFlight = null;
    }
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
  // Safari ignores user-scalable=no: a pinch on the buttons must not zoom the whole page.
  for (const type of ["gesturestart", "gesturechange"]) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  window.addEventListener("pagehide", persist);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && persist());

  function begin(): void {
    sound.start(); // a tap or a click started the game, so the browser lets the sound begin
    overlay.hidden = true;
    hud.hidden = false;
    playing = true;
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
  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.25); // a slow frame must not turn into slow motion
    last = now;
    fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;

    if (playing && !anyOpen()) {
      world.zoomBy(controls.zoom());
      const look = controls.look(dt);
      // Zoomed in, the same drag turns the view less, as with binoculars.
      state.walker.heading = (((state.walker.heading + look.heading / world.zoom) % 360) + 360) % 360;
      state.walker.pitch = Math.max(-85, Math.min(85, state.walker.pitch + look.pitch / world.zoom));
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
        // "Ver con lupa" is offered while the student stays by the rock hammered.
        if (hammered && (performance.now() > hammered.until || Math.hypot(state.walker.x - hammered.standX, state.walker.y - hammered.standY) > HAMMER_REACH_M)) dropLupa();
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
      controls.zoom();
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
    const toastOn = now < toastUntil && playing;
    prompt.hidden = !saveFailed && !toastOn;
    const promptText = saveFailed ? "No se pudo guardar en este navegador. Exporta tu libreta para no perder el trabajo." : toastOn ? toastText : "";
    if (promptText && prompt.textContent !== promptText) prompt.textContent = promptText;
    if (hammered && (anyOpen() || !playing)) lupaButton.hidden = true;
    else if (hammered) lupaButton.hidden = false;

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
    if (!hud.hidden && ++minimapFrame % 3 === 0) minimap.draw();

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
