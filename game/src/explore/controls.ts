// Keyboard, mouse and touch input, and the on-screen pads that show it: a cross to walk and a stick to look.
// Whatever drives the walker, the pads light up, so it is always clear whether the student walks or looks.
import { capture } from "../ui/html";

/** True while the student types in a field, when keys must not move the walker or open screens. Radio buttons and check boxes do not count. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
  return target.tagName === "INPUT" && !["radio", "checkbox", "button", "color", "range"].includes((target as HTMLInputElement).type);
}

type Dir = "forward" | "back" | "left" | "right" | "up" | "down";
const KEYS: Record<Dir, string[]> = {
  forward: ["KeyW", "ArrowUp"],
  back: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  up: ["Space"],
  down: ["ShiftLeft", "ShiftRight"],
};
/** Degrees per second at full stick. */
const STICK_TURN = 110, STICK_TILT = 70;

export class Controls {
  private readonly keys = new Set<string>();
  private lookX = 0;
  private lookY = 0;
  private readonly held = new Map<number, Dir>();
  private stick: { id: number; dx: number; dy: number } | null = null;
  private touchLook: { id: number; x: number; y: number } | null = null;
  /** Recent mouse or touch look, for the stick's knob to follow. */
  private echo = { x: 0, y: 0 };
  /** Called for single key presses that are commands (M, E, N, S, F, P, C, Escape), never while typing in a field. */
  onCommand: (code: string) => void = () => {};
  /**
   * Whether the mouse may be captured now. Never while a panel or a screen is open: a captured mouse sends every
   * click to the 3D view, and the buttons of the panel would stop answering.
   */
  allowLock: () => boolean = () => true;
  /**
   * A click or a tap on the 3D view, at screen point x, y (the crosshair when the mouse is captured). `how` says
   * where it came from. Returns true when it was used, for the hammer; otherwise a mouse click captures the mouse.
   */
  onTap: (x: number, y: number, how: "locked" | "mouse" | "touch") => boolean = () => false;
  /** The finger that may be a tap rather than a drag: where and when it touched. */
  private tapStart: { id: number; x: number; y: number; at: number } | null = null;
  /** Fingers on the 3D view, for pinch zoom; while two are down the view zooms instead of turning. */
  private readonly fingers = new Map<number, { x: number; y: number }>();
  private pinch: number | null = null;
  private pinched = false;
  /** Zoom of the 3D view from a pinch or the mouse wheel, as a factor (1 = normal). */
  private zoomBy = 1;
  /** The mouse held down on the 3D view: dragging it turns the view, a click without dragging hammers. */
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private dragged = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly padMove: HTMLElement,
    private readonly padLook: HTMLElement,
  ) {
    window.addEventListener("keydown", (e) => {
      const typing = isTyping(e.target);
      if (typing && e.code !== "Escape") return;
      if (!e.repeat && ["KeyM", "KeyE", "KeyB", "KeyN", "KeyS", "KeyF", "KeyP", "KeyC", "KeyG", "KeyK", "KeyV", "KeyL", "Escape"].includes(e.code)) this.onCommand(e.code);
      if (e.code === "Space") e.preventDefault(); // Space climbs; it must not scroll or press a button
      if (!typing) this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => (this.keys.clear(), this.held.clear(), (this.stick = null)));
    document.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement === canvas) {
        this.lookX += e.movementX;
        this.lookY += e.movementY;
        return;
      }
      // The mouse stays free, so every button can be clicked: dragging the landscape turns the view.
      const d = this.drag;
      if (!d) return;
      if ((e.buttons & 7) === 0) return void (this.drag = null);
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
      if (!d.moved) canvas.style.cursor = "grabbing";
      d.moved = true;
      this.lookX += (e.clientX - d.x) * 1.8;
      this.lookY += (e.clientY - d.y) * 1.8;
      d.x = e.clientX;
      d.y = e.clientY;
    });
    canvas.addEventListener("mousedown", (e) => {
      if (document.pointerLockElement === canvas) return;
      this.drag = { x: e.clientX, y: e.clientY, moved: false };
      this.dragged = false;
    });
    window.addEventListener("mouseup", () => {
      if (!this.drag) return;
      this.dragged = this.drag.moved;
      this.drag = null;
      canvas.style.cursor = "";
    });
    canvas.addEventListener("click", (e) => {
      if (document.pointerLockElement === canvas) return void this.onTap(window.innerWidth / 2, window.innerHeight / 2, "locked");
      // The end of a drag that turned the view is not a click on the rock.
      if (this.dragged) return void (this.dragged = false);
      this.onTap(e.clientX, e.clientY, "mouse");
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    // The wheel zooms the view in and out, like the fingers on a touch screen.
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.zoomBy *= Math.exp(-e.deltaY * 0.0015);
    }, { passive: false });
    // If the browser grants the capture late, after a panel has opened, it is given back at once.
    document.addEventListener("pointerlockchange", () => {
      if (document.pointerLockElement === canvas && !this.allowLock()) document.exitPointerLock?.();
    });
    canvas.addEventListener("touchstart", (e) => this.touch(e), { passive: false });
    canvas.addEventListener("touchmove", (e) => this.touch(e), { passive: false });
    canvas.addEventListener("touchend", (e) => this.touchEnd(e));
    canvas.addEventListener("touchcancel", (e) => this.touchEnd(e));

    // The cross: hold a button to walk that way. Climb and descend buttons work the same way.
    for (const button of Array.from(document.querySelectorAll<HTMLElement>("#pad-move [data-dir], #pad-fly [data-dir]"))) {
      const dir = button.dataset.dir as Dir;
      button.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        capture(button, e.pointerId);
        this.held.set(e.pointerId, dir);
      });
      const release = (e: PointerEvent) => this.held.delete(e.pointerId);
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("lostpointercapture", release);
      button.addEventListener("contextmenu", (e) => e.preventDefault());
    }
    // The stick: drag the knob; the further from the centre, the faster the view turns.
    const ring = padLook.querySelector<HTMLElement>(".ring")!;
    const follow = (e: PointerEvent) => {
      if (!this.stick || this.stick.id !== e.pointerId) return;
      const box = ring.getBoundingClientRect();
      const r = box.width / 2;
      let dx = (e.clientX - box.left - r) / r, dy = (e.clientY - box.top - r) / r;
      const length = Math.hypot(dx, dy);
      if (length > 1) ((dx /= length), (dy /= length));
      this.stick.dx = dx;
      this.stick.dy = dy;
    };
    ring.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      capture(ring, e.pointerId);
      this.stick = { id: e.pointerId, dx: 0, dy: 0 };
      follow(e);
    });
    ring.addEventListener("pointermove", follow);
    const letGo = (e: PointerEvent) => this.stick?.id === e.pointerId && (this.stick = null);
    ring.addEventListener("pointerup", letGo);
    ring.addEventListener("pointercancel", letGo);
    ring.addEventListener("lostpointercapture", letGo);
  }

  /** Zoom asked for since the last call, as a factor; 1 when nothing changed. */
  zoom(): number {
    const z = this.zoomBy;
    this.zoomBy = 1;
    return z;
  }

  /**
   * Asks the browser to capture the mouse, for those who prefer to look by moving it (key L). It may refuse
   * (no recent click, or Esc was just pressed). The game never captures it by itself: a captured mouse cannot
   * click the buttons.
   */
  lock(): void {
    if (document.pointerLockElement === this.canvas || !this.allowLock()) return;
    // A touch screen walks and looks with the pads and the finger: capturing the pointer there would only freeze the buttons.
    if (matchMedia("(pointer: coarse)").matches) return;
    try {
      const asked: unknown = this.canvas.requestPointerLock?.();
      if (asked instanceof Promise) asked.catch(() => {});
    } catch {
      // some browsers throw instead of refusing
    }
  }

  /** A finger dragged on the terrain itself turns the view; two fingers pinched apart or together zoom it. */
  private touch(e: TouchEvent): void {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) this.fingers.set(t.identifier, { x: t.clientX, y: t.clientY });
    if (this.fingers.size >= 2) {
      const [a, b] = [...this.fingers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1);
      if (this.pinch !== null) this.zoomBy *= d / this.pinch;
      this.pinch = d;
      // A pinch neither turns the view nor counts as a tap, until every finger is lifted.
      this.pinched = true;
      this.touchLook = null;
      this.tapStart = null;
      return;
    }
    if (this.pinched) return;
    for (const t of Array.from(e.changedTouches)) {
      if (this.touchLook?.id === t.identifier) {
        this.lookX += (t.clientX - this.touchLook.x) * 2.2;
        this.lookY += (t.clientY - this.touchLook.y) * 2.2;
        this.touchLook.x = t.clientX;
        this.touchLook.y = t.clientY;
      } else if (e.type === "touchstart" && !this.touchLook) {
        this.touchLook = { id: t.identifier, x: t.clientX, y: t.clientY };
      }
      if (e.type === "touchstart") this.tapStart = e.targetTouches.length === 1 ? { id: t.identifier, x: t.clientX, y: t.clientY, at: performance.now() } : null;
      else if (this.tapStart?.id === t.identifier && Math.hypot(t.clientX - this.tapStart.x, t.clientY - this.tapStart.y) > 14) this.tapStart = null;
    }
  }

  private touchEnd(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) this.fingers.delete(t.identifier);
    if (this.fingers.size < 2) this.pinch = null;
    if (this.pinched) {
      if (this.fingers.size === 0) this.pinched = false;
      this.touchLook = null;
      this.tapStart = null;
      return;
    }
    for (const t of Array.from(e.changedTouches)) {
      if (this.touchLook?.id === t.identifier) this.touchLook = null;
      // A short touch that hardly moved is a tap: it swings the hammer where the finger touched.
      const tap = this.tapStart;
      if (tap?.id === t.identifier) {
        this.tapStart = null;
        if (e.type === "touchend" && performance.now() - tap.at < 400) this.onTap(t.clientX, t.clientY, "touch");
      }
    }
  }

  private pressed(dir: Dir): boolean {
    return KEYS[dir].some((c) => this.keys.has(c)) || [...this.held.values()].includes(dir);
  }

  /** Forward and right intent, each in [-1, 1]. */
  move(): { forward: number; right: number } {
    const k = (dir: Dir) => (this.pressed(dir) ? 1 : 0);
    return { forward: k("forward") - k("back"), right: k("right") - k("left") };
  }

  /** Climb (+1) or descend (-1) when flying. */
  vertical(): number {
    return (this.pressed("up") ? 1 : 0) - (this.pressed("down") ? 1 : 0);
  }

  /** How far to turn the view since the last call, in degrees, from the mouse, a finger or the stick. */
  look(dt: number): { heading: number; pitch: number } {
    const out = { heading: this.lookX * 0.12, pitch: -this.lookY * 0.12 };
    if (this.stick) {
      out.heading += this.stick.dx * STICK_TURN * dt;
      out.pitch -= this.stick.dy * STICK_TILT * dt;
    }
    this.echo.x = this.echo.x * 0.75 + this.lookX * 0.25;
    this.echo.y = this.echo.y * 0.75 + this.lookY * 0.25;
    this.lookX = 0;
    this.lookY = 0;
    this.paint();
    return out;
  }

  /** Lights the buttons being used and moves the knob, whatever the input. */
  private paint(): void {
    for (const button of Array.from(document.querySelectorAll<HTMLElement>("#pad-move [data-dir], #pad-fly [data-dir]"))) {
      button.classList.toggle("on", this.pressed(button.dataset.dir as Dir));
    }
    const knob = this.padLook.querySelector<HTMLElement>(".knob")!;
    const reach = (this.padLook.querySelector<HTMLElement>(".ring")!.offsetWidth || 110) / 2 - 18;
    let x = this.stick?.dx ?? Math.max(-1, Math.min(1, this.echo.x / 25));
    let y = this.stick?.dy ?? Math.max(-1, Math.min(1, this.echo.y / 25));
    if (Math.hypot(x, y) < 0.04) x = y = 0;
    knob.style.transform = `translate(${(x * reach).toFixed(1)}px, ${(y * reach).toFixed(1)}px)`;
    this.padLook.classList.toggle("on", x !== 0 || y !== 0);
    this.padMove.classList.toggle("on", (["forward", "back", "left", "right"] as Dir[]).some((d) => this.pressed(d)));
  }
}
