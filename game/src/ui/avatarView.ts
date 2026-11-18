// "Tu geólog@": choose the skin tone, the hair and the field gear of the geologist, with a turning preview.

import * as THREE from "three";
import {
  type Avatar, GEAR_COLOURS, HAIR_COLOURS, HAMMER_NAMES, HAT_NAMES, type Hammer, type Hat, SKIN_TONES,
  saveAvatar,
} from "../state/avatar";
import { type AvatarModel, buildAvatar, disposeAvatar } from "../world/avatar";
import { esc } from "./html";
import { iconButton, labelledButton } from "./icons";

const SKIN_NAMES = ["muy clara", "clara", "clara media", "media", "morena clara", "morena", "oscura", "muy oscura"];
const HAIR_NAMES = ["negro", "castaño oscuro", "castaño", "rubio oscuro", "rubio", "canoso"];
const GEAR_NAMES = ["naranja", "amarillo", "blanco", "rojo", "azul", "verde oliva"];

export class AvatarView {
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  private model: AvatarModel | null = null;
  private angle = 0.5;
  private frame = 0;
  private drag: { x: number; angle: number } | null = null;

  /** `changed` is called with every choice, so the game can dress the hand and the figure at once. */
  constructor(
    private readonly root: HTMLElement,
    private readonly avatar: Avatar,
    private readonly changed: (a: Avatar) => void,
    private readonly close: () => void,
  ) {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6d6352, 1.3));
    const sun = new THREE.DirectionalLight(0xfff2d6, 1.5);
    sun.position.set(-1, 2, -1.5);
    this.scene.add(sun);
    this.camera.position.set(0, 1.3, -4.3);
    this.camera.lookAt(0, 1.02, 0);
    root.addEventListener("click", (e) => this.click(e));
    root.addEventListener("input", (e) => this.input(e));
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.root.hidden = false;
    this.render();
    this.loop();
  }

  hide(): void {
    this.root.hidden = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private swatches(name: string, colours: readonly string[], names: string[], selected: number): string {
    return `<div class="swatches" role="radiogroup">${colours
      .map((c, i) => `<button type="button" class="swatch${i === selected ? " on" : ""}" style="background:${c}" data-pick="${name}" data-value="${i}" role="radio" aria-checked="${i === selected}" aria-label="${esc(names[i]!)}" title="${esc(names[i]!)}"></button>`)
      .join("")}</div>`;
  }

  private choices<T extends string>(name: string, options: Record<T, string>, selected: T): string {
    return `<div class="choice-row" role="radiogroup">${(Object.keys(options) as T[])
      .map((k) => `<button type="button" class="choice${k === selected ? " on" : ""}" data-pick="${name}" data-value="${k}" role="radio" aria-checked="${k === selected}">${esc(options[k])}</button>`)
      .join("")}</div>`;
  }

  private toggle(name: string, label: string, on: boolean): string {
    return `<button type="button" class="choice${on ? " on" : ""}" data-pick="${name}" data-value="${!on}" aria-pressed="${on}">${esc(label)}</button>`;
  }

  render(): void {
    if (!this.root.querySelector("#avatar-canvas")) this.shell();
    const a = this.avatar;
    this.root.querySelector(".avatar-controls")!.innerHTML = `
          <h3>Tono de piel</h3>${this.swatches("skin", SKIN_TONES, SKIN_NAMES, a.skin)}
          <h3>Pelo</h3>${this.swatches("hair", HAIR_COLOURS, HAIR_NAMES, a.hair)}
          <h3>Cabeza</h3>${this.choices<Hat>("hat", HAT_NAMES, a.hat)}
          ${a.hat === "ninguno" ? "" : this.swatches("hatColour", GEAR_COLOURS, GEAR_NAMES, a.hatColour)}
          <h3>Ropa y equipo</h3>
          <div class="choice-row">${this.toggle("vest", "Chaleco de terreno", a.vest)}${this.toggle("backpack", "Mochila", a.backpack)}${this.toggle("lens", "Lupa al cuello", a.lens)}</div>
          ${a.vest ? `<p class="tip">Color del chaleco</p>${this.swatches("vestColour", GEAR_COLOURS, GEAR_NAMES, a.vestColour)}` : ""}
          <label class="inline">Camisa <input type="color" id="avatar-shirt" value="${esc(a.shirtColour)}"></label>
          <h3>Martillo</h3>${this.choices<Hammer>("hammer", HAMMER_NAMES, a.hammer)}
          <div class="tools">${labelledButton("check", "Listo", 'data-do="close" class="primary"')}</div>`;
    this.rebuild();
  }

  /** The heading and the preview, made once: the preview keeps one WebGL context for good. */
  private shell(): void {
    this.root.innerHTML = `
      <div class="head"><b>Tu geólog@</b> <small>se guarda en este navegador</small>${iconButton("close", "Listo", 'data-do="close" class="x"')}</div>
      <div class="avatar-layout">
        <div class="avatar-preview"><canvas id="avatar-canvas" width="300" height="380" aria-label="Vista previa del personaje; arrastra para girarlo"></canvas><p class="tip">Arrastra para girarlo.</p></div>
        <div class="avatar-controls"></div>
      </div>`;
    const canvas = this.root.querySelector<HTMLCanvasElement>("#avatar-canvas")!;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(300, 380, false);
    this.camera.aspect = 300 / 380;
    this.camera.updateProjectionMatrix();
    canvas.addEventListener("pointerdown", (e) => (this.drag = { x: e.clientX, angle: this.angle }));
    canvas.addEventListener("pointermove", (e) => this.drag && (this.angle = this.drag.angle + (e.clientX - this.drag.x) * 0.012));
    for (const end of ["pointerup", "pointercancel", "pointerleave"]) canvas.addEventListener(end, () => (this.drag = null));
  }

  private rebuild(): void {
    if (this.model) {
      this.scene.remove(this.model.group);
      disposeAvatar(this.model);
    }
    this.model = buildAvatar(this.avatar);
    this.scene.add(this.model.group);
  }

  private loop(): void {
    const tick = () => {
      if (!this.isOpen) return;
      if (!this.drag) this.angle += 0.008;
      if (this.model) this.model.group.rotation.y = this.angle;
      this.renderer?.render(this.scene, this.camera);
      this.frame = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(tick);
  }

  private click(e: Event): void {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-pick], [data-do]");
    if (!t) return;
    if (t.dataset.do === "close") return this.close();
    const a = this.avatar as unknown as Record<string, unknown>;
    const key = t.dataset.pick!, value = t.dataset.value!;
    a[key] = value === "true" ? true : value === "false" ? false : /^\d+$/.test(value) ? Number(value) : value;
    this.commit(true);
  }

  private input(e: Event): void {
    const t = e.target as HTMLInputElement;
    if (t.id !== "avatar-shirt") return;
    this.avatar.shirtColour = t.value;
    this.commit(false);
  }

  /** Saves and shows the choice; `redraw` refreshes the controls too (not while the colour picker is open). */
  private commit(redraw: boolean): void {
    saveAvatar(this.avatar);
    this.changed(this.avatar);
    if (redraw) this.render();
    else this.rebuild();
  }
}
