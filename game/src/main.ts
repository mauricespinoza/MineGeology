import { type DayState, dayState, nextDay, remaining, spend, timeOfDay } from "./explore/clock";
import { Controls } from "./explore/controls";
import { discover, outcropInReach } from "./explore/discovery";
import { CLIMB_SPEED, EYE_HEIGHT, FLY_CEILING_M, FLY_SPEED, pace, slopeAt, step } from "./explore/movement";
import { FormatError, loadPracticeLitho, loadPracticeTruth, loadScenario } from "./format/loader";
import { browserStore, clear, deserialize, load, save, serialize } from "./state/save";
import { type AttemptView, type Me, Remote, RemoteError, loadServerConfig } from "./net/remote";
import { GradedSession, reveal } from "./net/session";
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

/** Stage B: the sign-in screen. The local server signs in at once; Supabase sends an email with a link. */
function signIn(remote: Remote, message = ""): void {
  const local = remote.config.kind === "local";
  show("Iniciar sesión", `${message ? `${message} ` : ""}Entra con tu correo institucional para guardar tu avance en cualquier dispositivo y entregar tu trabajo.`);
  const list = $("overlay-list");
  list.innerHTML = `<form id="signin" class="signin"><input id="signin-email" type="email" required autocomplete="email" placeholder="nombre@udec.cl" aria-label="Correo institucional">
    <button type="submit" id="signin-go">${local ? "Entrar" : "Enviarme el enlace"}</button><p id="signin-msg" class="tip"></p></form>`;
  list.hidden = false;
  $<HTMLFormElement>("signin").onsubmit = async (e) => {
    e.preventDefault();
    const email = $<HTMLInputElement>("signin-email").value.trim();
    const msg = $("signin-msg");
    msg.textContent = local ? "Entrando…" : "Enviando…";
    try {
      if (await remote.signIn(email)) location.reload();
      else msg.textContent = `Te enviamos un enlace a ${email}. Ábrelo en este dispositivo para entrar.`;
    } catch (error) {
      msg.textContent = error instanceof Error ? error.message : String(error);
    }
  };
}

/** Who is signed in, with a way out and, for teachers, the dashboard. */
function showAccount(me: Me, remote: Remote): void {
  const p = $("overlay-account");
  p.innerHTML = `Conectado como <b>${me.email}</b>${me.role === "teacher" ? ' · <a href="./dashboard.html">Panel docente</a>' : ""} · <a href="#" id="signout">Salir</a>`;
  p.hidden = false;
  $("signout").onclick = (e) => {
    e.preventDefault();
    remote.signOut();
    location.href = location.pathname;
  };
}

async function start(): Promise<void> {
  const params = new URLSearchParams(location.search);
  // Stage B when the site has a server.json: sign-in first, scenarios and attempts from the server.
  const server = await loadServerConfig();
  const remote = server ? new Remote(server) : null;
  if (remote) {
    remote.takeTokenFromUrl();
    const me = remote.token ? await remote.me().catch((e: unknown) => (e instanceof RemoteError && e.status === 403 ? (signIn(remote, e.message), undefined) : null)) : null;
    if (me === undefined) return;
    if (!me) return signIn(remote);
    showAccount(me, remote);
  }
  const index = remote ? (await remote.scenarios()).scenarios : await loadIndex();
  if (!params.get("s") && index && index.length > 1) {
    const store = browserStore();
    show("", "Elige un escenario. Cada variante tiene otra geometría o afloramientos distintos, y su propio avance guardado.");
    renderPicker($("overlay-list"), index, (e) => !!store && !!load(store, e.scenario_id, e.variant));
    return;
  }
  const folder = (params.get("s") ?? index?.[0]?.folder ?? "quebrada-los-litres-a").replace(/[^a-z0-9-]/g, "");
  $("overlay-change").hidden = !index || index.length < 2;
  const read = remote ? remote.bundle(folder) : async (path: string) => {
    const response = await fetch(`./${folder}/${path}`);
    // Static hosts and dev servers may answer a missing file with the site's own page.
    const missing = !response.ok || (response.headers.get("content-type") ?? "").includes("text/html");
    if (missing) throw new FormatError(`No se pudo descargar ${folder}/${path} (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  };
  const scenario = await loadScenario(read);
  // Graded mode: the attempt lives on the server; what was already seen at outcrops comes back with it.
  const attempt: AttemptView | null = remote ? await remote.open(folder) : null;
  if (attempt) for (const o of scenario.outcrops) if (attempt.observations[o.id]) o.observation = attempt.observations[o.id];
  const truth = remote ? null : await loadPracticeTruth(read, scenario.manifest);
  const litho = truth ? await loadPracticeLitho(read, scenario.manifest) : null;
  const rules = scenario.manifest.rules;
  const grid = buildGrid(scenario);
  const canvas = $<HTMLCanvasElement>("view");
  const world = new World(canvas);
  const store = browserStore();
  const { scenario_id, variant } = scenario.manifest;
  const saved = attempt ? (attempt.state ? deserialize(JSON.stringify(attempt.state), scenario_id, variant) : null) : store && load(store, scenario_id, variant);
  // One object for the whole attempt; "start over" refills it rather than replacing it.
  const state: GameState = saved ?? newGame(scenario, grid, attempt?.seed, "campaign");
  const field: Field = { scenario, state, truth, assetUrl: (path) => (remote ? `${remote.config.api}/bundle/${folder}/${path}` : `./${folder}/${path}`) };
  const session = remote && attempt ? new GradedSession(remote, attempt, state) : null;
  if (session) {
    field.lab = session.lab;
    field.onSample = (sample) => void session.sample(sample).catch((e: unknown) => alert(e instanceof Error ? e.message : String(e)));
    session.onConflict = (message) => show("Se cargó la versión más reciente", message, { label: "Seguir", action: () => location.reload() });
    session.onError = () => (saveFailed = true);
  }
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
    if (session) return session.queue(); // the server keeps graded attempts
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
          if (session) void session.refreshLab().then(() => (field.lab = session.lab)).catch(() => {});
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
  const minimap = new Minimap($<HTMLCanvasElement>("minimap"), scenario, grid, state);
  $("minimap").onclick = () => command("KeyM");
  let minimapFrame = 0;
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
      if (near >= 0 && session && !scenario.outcrops[near]!.observation) {
        // Graded mode: the server says what the outcrop shows, because the student is standing at it.
        const outcrop = scenario.outcrops[near]!;
        void session.observe(outcrop, grid, scenario.units.map((u) => u.key)).then(() => panel.open(outcrop), (e: unknown) => show("No se pudo ver el afloramiento", e instanceof Error ? e.message : String(e), { label: "Seguir", action: begin }));
      } else if (near >= 0) panel.open(scenario.outcrops[near]!);
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
  evalButton.hidden = !truth && !session;
  evalButton.onclick = () => (session ? handIn() : command("Evaluate"));
  if (session) {
    evalButton.title = evalButton.ariaLabel = "Entregar el trabajo";
    $("help-button").title = "Ayuda y pausa (Esc)";
  }
  /** Graded mode: hands the attempt in, after asking; no more changes afterwards. */
  async function handIn(): Promise<void> {
    if (!session || session.submitted) return showGrade();
    resume();
    playing = false;
    document.exitPointerLock?.();
    if (!confirm("¿Entregar el trabajo? Después ya no podrás cambiar la libreta ni el mapa.")) return begin();
    try {
      await session.submit();
      show("Trabajo entregado", "Tu profesor revisará la nota automática y la liberará. Puedes volver aquí para verla.", { label: "Ver la nota", action: () => void showGrade() });
    } catch (e) {
      show("No se pudo entregar", e instanceof Error ? e.message : String(e), { label: "Seguir", action: begin });
    }
  }
  async function showGrade(): Promise<void> {
    if (!session) return;
    const g = await session.remote.grade(session.attempt.id).catch(() => null);
    if (!g || !g.released) return show("Trabajo entregado", "La nota aún no ha sido liberada por tu profesor.", { label: "Volver a mirar", action: () => void showGrade() });
    const parts = (g.parts ?? []).map((p) => `${p.key}: ${p.score === null ? "no aplica" : `${Math.round(p.score * 100)} %`}`).join(" · ");
    show(`Nota: ${Math.round((g.total ?? 0) * 100)} %`, `${parts}${g.note ? ` — Comentario: ${g.note}` : ""}`);
  }
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
  if (session) {
    // Graded: one attempt per student, in campaign mode, kept on the server; no starting over.
    if (session.submitted) {
      show(scenario.manifest.title, "Ya entregaste este trabajo.", { label: "Ver la nota", action: () => void showGrade() });
    } else {
    const where = saved ? `Vas en el día ${state.clock.day}: ${state.stations.length} estaciones, ${(state.walked / 1000).toFixed(1)} km caminados.` : "Trabajo evaluado: modo campaña, con días de terreno.";
    show(scenario.manifest.title, `${where} Tu avance se guarda en el servidor.`, {
      label: saved ? "Continuar" : "Comenzar",
      action: () => {
        if (!saved) persist();
        return dayState(state.clock, rules) === "working" ? begin() : onDay(dayState(state.clock, rules));
      },
    });
    }
  }
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
  if (session) {
    // already shown above
  } else if (saved) {
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
  let trackCount = 0;
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
      if (sinceCheck === 0 && session && ++trackCount % 40 === 0) {
        // Every ten seconds of play, where the student is: the teacher replays the traverse from these.
        session.track("pos", [Math.round(state.walker.x), Math.round(state.walker.y), state.clock.day, Math.round(state.clock.minutes)]);
        session.queue();
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
    __geomapper: { state, grid, scenario, world, fps: () => fps, heightAt: (x: number, y: number) => heightAt(grid, x, y), dayState: () => dayState(state.clock, rules), save: persist, board, net, panel, section, column, evaluation, session },
  });
}

start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  show("No se pudo cargar el escenario", message);
  console.error(error);
});
