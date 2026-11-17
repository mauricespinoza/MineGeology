// Keyboard, mouse and touch input, reduced to what the walker needs.

export class Controls {
  private readonly keys = new Set<string>();
  private lookX = 0;
  private lookY = 0;
  private touchMove: { id: number; x0: number; y0: number; x: number; y: number } | null = null;
  private touchLook: { id: number; x: number; y: number } | null = null;
  /** Called for single key presses that are commands (M, E, N, S, Escape), never while typing in a field. */
  onCommand: (code: string) => void = () => {};

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (typing && e.code !== "Escape") return;
      if (!e.repeat && ["KeyM", "KeyE", "KeyN", "KeyS", "Escape"].includes(e.code)) this.onCommand(e.code);
      if (!typing) this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
    document.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement !== canvas) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    canvas.addEventListener("click", () => this.lock());
    canvas.addEventListener("touchstart", (e) => this.touch(e), { passive: false });
    canvas.addEventListener("touchmove", (e) => this.touch(e), { passive: false });
    canvas.addEventListener("touchend", (e) => this.touchEnd(e));
    canvas.addEventListener("touchcancel", (e) => this.touchEnd(e));
  }

  /** Asks the browser to capture the mouse. It may refuse (no recent click, or Esc was just pressed); clicking the terrain asks again. */
  lock(): void {
    if (document.pointerLockElement === this.canvas) return;
    try {
      const asked: unknown = this.canvas.requestPointerLock?.();
      if (asked instanceof Promise) asked.catch(() => {});
    } catch {
      // some browsers throw instead of refusing
    }
  }

  private touch(e: TouchEvent): void {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (this.touchMove?.id === t.identifier) {
        this.touchMove.x = t.clientX;
        this.touchMove.y = t.clientY;
      } else if (this.touchLook?.id === t.identifier) {
        this.lookX += (t.clientX - this.touchLook.x) * 2.2;
        this.lookY += (t.clientY - this.touchLook.y) * 2.2;
        this.touchLook.x = t.clientX;
        this.touchLook.y = t.clientY;
      } else if (e.type === "touchstart") {
        if (t.clientX < window.innerWidth / 2 && !this.touchMove) {
          this.touchMove = { id: t.identifier, x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY };
        } else if (!this.touchLook) {
          this.touchLook = { id: t.identifier, x: t.clientX, y: t.clientY };
        }
      }
    }
  }

  private touchEnd(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      if (this.touchMove?.id === t.identifier) this.touchMove = null;
      if (this.touchLook?.id === t.identifier) this.touchLook = null;
    }
  }

  /** Forward and right intent, each in [-1, 1]. */
  move(): { forward: number; right: number } {
    const k = (...codes: string[]) => (codes.some((c) => this.keys.has(c)) ? 1 : 0);
    let forward = k("KeyW", "ArrowUp") - k("KeyS", "ArrowDown");
    let right = k("KeyD", "ArrowRight") - k("KeyA", "ArrowLeft");
    if (this.touchMove) {
      const reach = 60;
      right += Math.max(-1, Math.min(1, (this.touchMove.x - this.touchMove.x0) / reach));
      forward += Math.max(-1, Math.min(1, (this.touchMove.y0 - this.touchMove.y) / reach));
    }
    return { forward: Math.max(-1, Math.min(1, forward)), right: Math.max(-1, Math.min(1, right)) };
  }

  /** Mouse or touch look since the last call, in degrees: heading change and pitch change. */
  look(): { heading: number; pitch: number } {
    const out = { heading: this.lookX * 0.12, pitch: -this.lookY * 0.12 };
    this.lookX = 0;
    this.lookY = 0;
    return out;
  }
}
