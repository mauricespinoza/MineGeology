// The 3D model: the terrain of the area, the drill holes, and, where the solutions can be seen, the geological
// model itself from the lithology block baked in GemPy: the faces of a block that can be cut east-west,
// north-south and horizontally, and the bodies of chosen units.
//
// Three.js axes: x east, y up, z south. Local map metres (x east, y north, z elevation) go to (x, z, -y) inside
// a group that is centred on the area and scaled vertically by the exaggeration.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Manifest } from "../format/types";
import { direction, pointAt } from "../interpret/drill";
import { rasterize } from "../interpret/mapdata";
import { showsAnswers } from "../state/difficulty";
import type { Field } from "../tools/fieldwork";
import { type Grid, surfaceElevation } from "../world/blocks";
import { esc } from "./html";
import { captionButton, iconButton } from "./icons";

type Surface = "geology" | "map" | "cover";
const SURFACE_NAMES: Record<Surface, string> = { geology: "Geología del modelo", map: "Mi mapa", cover: "Cobertura (suelo y roca)" };
/** Most coarse cells drawn for unit bodies; the block is sampled every few cells to stay under it. */
const MAX_BODY_CELLS = 160_000;

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

export class Model3dView {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 5, 100_000);
  private controls: OrbitControls | null = null;
  private readonly root3d = new THREE.Group();
  private readonly layers = { terrain: new THREE.Group(), walls: new THREE.Group(), bodies: new THREE.Group(), holes: new THREE.Group(), marks: new THREE.Group(), slice: new THREE.Group() };
  private readonly canvas: HTMLCanvasElement;
  private frame = 0;
  private textures = new Map<string, THREE.Texture>();
  private clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);

  private surface: Surface = "cover";
  private exaggeration = 1;
  private terrainOpacity = 1;
  private showWalls = true;
  private showHoles = true;
  private showLabels = true;
  private sliceOn = false;
  private sliceZ = 0;
  private cut = { x0: 0, x1: 0, y0: 0, y1: 0 };
  private bodies = new Set<number>();
  private picking = false;
  private focus: number | null = null;
  private down: { x: number; y: number } | null = null;

  private readonly sx: number;
  private readonly sy: number;
  private readonly z0: number;
  private readonly ztop: number;

  constructor(
    private readonly root: HTMLElement,
    private readonly field: Field,
    private readonly grid: Grid,
    private readonly litho: Uint8Array | null,
    private readonly ctx: { close: () => void; position: () => { x: number; y: number }; pickCollar: (x: number, y: number) => void },
  ) {
    const g = this.manifest.grid;
    this.sx = g.nx * g.cell_size_m.x;
    this.sy = g.ny * g.cell_size_m.y;
    this.z0 = g.origin.elevation;
    this.ztop = Math.max(...grid.elevation);
    this.cut = { x0: 0, x1: this.sx, y0: 0, y1: this.sy };
    this.sliceZ = Math.round((this.z0 + this.ztop) / 2 / 10) * 10;
    root.innerHTML = `
      <canvas id="model-canvas"></canvas>
      <div class="panel" id="model-side"></div>
      ${iconButton("close", "Volver (G)", 'id="model-close" class="panel close-fixed"')}
      <div class="panel" id="model-hint"></div>`;
    this.canvas = root.querySelector("#model-canvas")!;
    root.querySelector<HTMLElement>("#model-close")!.onclick = () => this.ctx.close();
    const side = root.querySelector<HTMLElement>("#model-side")!;
    side.addEventListener("input", (e) => this.onInput(e, false));
    side.addEventListener("change", (e) => this.onInput(e, true));
    side.addEventListener("click", (e) => this.onClick(e));
    this.canvas.addEventListener("pointerdown", (e) => (this.down = { x: e.clientX, y: e.clientY }));
    this.canvas.addEventListener("pointerup", (e) => this.onPointerUp(e));
    window.addEventListener("resize", () => this.isOpen && this.resize());
    for (const layer of Object.values(this.layers)) this.root3d.add(layer);
    this.scene.add(this.root3d);
    this.scene.background = new THREE.Color(0x1d211f);
    this.scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x3a3328, 1.6));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-0.6, 1, 0.45);
    this.scene.add(sun);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  private get manifest(): Manifest {
    return this.field.scenario.manifest;
  }

  /** The model can be shown: the block is here and the solutions may be seen. */
  private get answers(): boolean {
    return !!this.litho && showsAnswers(this.field.state);
  }

  hide(): void {
    this.root.hidden = true;
    cancelAnimationFrame(this.frame);
    this.picking = false;
  }

  /** Opens the view, centred on a hole if given. */
  open(holeId?: number): void {
    this.root.hidden = false;
    if (!this.renderer) this.init();
    if (!this.answers) {
      this.bodies.clear();
      if (this.surface === "geology") this.surface = "cover";
    } else if (this.firstOpen) this.surface = "geology";
    // Without the model the holes are only seen through the ground.
    if (this.firstOpen && !this.answers) this.terrainOpacity = 0.55;
    if (this.firstOpen && window.innerWidth < 640) this.root.querySelector("#model-side")!.classList.add("folded");
    this.firstOpen = false;
    this.focus = holeId ?? null;
    this.textures.get("map")?.dispose();
    this.textures.delete("map"); // the student's map may have changed since
    this.resize();
    this.rebuild();
    if (holeId !== undefined) this.lookAtHole(holeId);
    this.renderSide();
    this.hint();
    const loop = () => {
      if (!this.isOpen) return;
      this.controls!.update();
      this.renderer!.render(this.scene, this.camera);
      this.frame = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(loop);
  }

  private firstOpen = true;

  private init(): void {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.95;
    this.resize();
    this.resetCamera();
  }

  private resetCamera(): void {
    // A narrow (upright) screen needs the camera farther away to see the whole area.
    const size = Math.max(this.sx, this.sy) * Math.max(1, 0.9 / this.camera.aspect);
    this.camera.position.set(-size * 0.55, size * 0.62, size * 0.85);
    this.controls!.target.set(0, 0, 0);
    this.camera.near = size / 500;
    this.camera.far = size * 20;
    this.camera.updateProjectionMatrix();
  }

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer?.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  /** Local map metres to the group's own coordinates (before the exaggeration). */
  private v(x: number, y: number, z: number): [number, number, number] {
    return [x, z, -y];
  }

  private place(): void {
    const zc = (this.z0 + this.ztop) / 2;
    this.root3d.scale.set(1, this.exaggeration, 1);
    this.root3d.position.set(-this.sx / 2, -zc * this.exaggeration, this.sy / 2);
    this.clip.constant = (this.sliceZ - zc) * this.exaggeration + 0.01;
  }

  private clipping(): THREE.Plane[] {
    return this.sliceOn && this.answers ? [this.clip] : [];
  }

  private dispose(group: THREE.Group): void {
    for (const child of [...group.children]) {
      group.remove(child);
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mat of mats) {
          const map = (mat as THREE.MeshLambertMaterial).map;
          if (map && ![...this.textures.values()].includes(map)) map.dispose();
          mat.dispose();
        }
      });
    }
  }

  private rebuild(): void {
    this.place();
    this.buildTerrain();
    this.buildWalls();
    this.buildBodies();
    this.buildSlice();
    this.buildHoles();
    this.buildMarks();
  }

  // ----- Textures ---------------------------------------------------------------------------------------

  private unitColours(): string[] {
    return this.field.scenario.units.map((u) => u.colour);
  }

  /** The unit index of the block at a cell; the block holds geology above the ground too. */
  private lithoAt(ix: number, iy: number, k: number): number {
    const g = this.manifest.grid;
    return this.litho![ix + g.nx * (iy + g.ny * k)]!;
  }

  private groundCell(ix: number, iy: number): number {
    const g = this.manifest.grid;
    return Math.min(Math.max(Math.floor((this.grid.elevation[ix + g.nx * iy]! - this.z0) / g.cell_size_m.z), 0), g.nz - 1);
  }

  private surfaceTexture(kind: Surface): THREE.Texture {
    const cached = this.textures.get(kind);
    if (cached) return cached;
    const { nx, ny } = this.manifest.grid;
    const canvas = document.createElement("canvas");
    canvas.width = nx;
    canvas.height = ny;
    const c2 = canvas.getContext("2d")!;
    const img = c2.createImageData(nx, ny);
    const unitRgb = this.unitColours().map((c) => new THREE.Color(c));
    const coverRgb = this.grid.coverColours.map((c) => new THREE.Color(c));
    const mine = kind === "map" ? rasterize(this.field.state.map, nx, ny, this.grid.cell) : null;
    const mapRgb = new Map(this.field.state.map.units.map((u) => [u.id, new THREE.Color(u.colour)]));
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const i = ix + nx * iy;
        let col = coverRgb[this.grid.cover[i]!] ?? new THREE.Color(0x888888);
        if (kind === "geology" && this.litho) col = unitRgb[this.lithoAt(ix, iy, this.groundCell(ix, iy))] ?? col;
        if (mine && mine[i]! >= 0) col = mapRgb.get(mine[i]!) ?? col;
        const o = 4 * (ix + nx * (ny - 1 - iy));
        img.data[o] = col.r * 255;
        img.data[o + 1] = col.g * 255;
        img.data[o + 2] = col.b * 255;
        img.data[o + 3] = 255;
      }
    }
    c2.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    this.textures.set(kind, tex);
    return tex;
  }

  // ----- Terrain ----------------------------------------------------------------------------------------

  private buildTerrain(): void {
    this.dispose(this.layers.terrain);
    const { nx, ny } = this.manifest.grid, cell = this.grid.cell;
    const ix0 = Math.max(Math.floor(this.cut.x0 / cell), 0), ix1 = Math.min(Math.ceil(this.cut.x1 / cell), nx);
    const iy0 = Math.max(Math.floor(this.cut.y0 / cell), 0), iy1 = Math.min(Math.ceil(this.cut.y1 / cell), ny);
    const step = Math.max(1, Math.ceil(Math.max(ix1 - ix0, iy1 - iy0) / 200));
    const xs: number[] = [], ys: number[] = [];
    for (let x = this.cut.x0; x < this.cut.x1; x += cell * step) xs.push(x);
    xs.push(this.cut.x1);
    for (let y = this.cut.y0; y < this.cut.y1; y += cell * step) ys.push(y);
    ys.push(this.cut.y1);
    const pos: number[] = [], uv: number[] = [], index: number[] = [];
    for (const y of ys) {
      for (const x of xs) {
        pos.push(...this.v(x, y, surfaceElevation(this.grid, x, y) + 0.5));
        uv.push(x / this.sx, y / this.sy);
      }
    }
    const w = xs.length;
    for (let j = 0; j + 1 < ys.length; j++) {
      for (let i = 0; i + 1 < w; i++) {
        const a = i + w * j, b = a + 1, c = a + w, d = c + 1;
        index.push(a, b, c, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const opacity = this.terrainOpacity;
    const mat = new THREE.MeshLambertMaterial({ map: this.surfaceTexture(this.surface), side: THREE.DoubleSide, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, clippingPlanes: this.clipping() });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "terrain";
    this.layers.terrain.add(mesh);
  }

  // ----- The faces of the block ------------------------------------------------------------------------

  /** A vertical face of the block along x (at y) or along y (at x), from the base to the ground. */
  private wall(along: "x" | "y", at: number, from: number, to: number): THREE.Mesh | null {
    const g = this.manifest.grid, cell = g.cell_size_m.x, dz = g.cell_size_m.z;
    const fixed = Math.min(Math.max(Math.floor(at / cell), 0), (along === "x" ? g.ny : g.nx) - 1);
    const i0 = Math.max(Math.floor(from / cell), 0), i1 = Math.min(Math.ceil(to / cell), along === "x" ? g.nx : g.ny);
    const n = i1 - i0;
    if (n < 1) return null;
    const canvas = document.createElement("canvas");
    canvas.width = n;
    canvas.height = g.nz;
    const c2 = canvas.getContext("2d")!;
    const img = c2.createImageData(n, g.nz);
    const colours = this.unitColours().map((c) => new THREE.Color(c));
    for (let i = 0; i < n; i++) {
      const ix = along === "x" ? i0 + i : fixed, iy = along === "x" ? fixed : i0 + i;
      const ground = this.grid.elevation[ix + g.nx * iy]!;
      for (let k = 0; k < g.nz; k++) {
        if (this.z0 + k * dz >= ground) break;
        const col = colours[this.lithoAt(ix, iy, k)] ?? new THREE.Color(0x888888);
        const o = 4 * (i + n * (g.nz - 1 - k));
        img.data[o] = col.r * 255;
        img.data[o + 1] = col.g * 255;
        img.data[o + 2] = col.b * 255;
        img.data[o + 3] = 255;
      }
    }
    c2.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    const pos: number[] = [], uv: number[] = [], index: number[] = [];
    const H = g.nz * dz;
    const points = [from, ...Array.from({ length: n }, (_, i) => (i0 + i + 0.5) * cell).filter((p) => p > from && p < to), to];
    for (const p of points) {
      const x = along === "x" ? p : at, y = along === "x" ? at : p;
      const top = surfaceElevation(this.grid, x, y);
      const u = (p / cell - i0) / n;
      pos.push(...this.v(x, y, this.z0), ...this.v(x, y, top));
      uv.push(u, 0, u, (top - this.z0) / H);
    }
    for (let i = 0; i + 1 < points.length; i++) index.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, alphaTest: 0.5, transparent: false, clippingPlanes: this.clipping() }));
  }

  /** A horizontal section of the block at elevation z over the cut, transparent above the ground. */
  private plan(z: number, clipped: boolean): THREE.Mesh {
    const g = this.manifest.grid;
    const k = Math.min(Math.max(Math.floor((z - this.z0) / g.cell_size_m.z), 0), g.nz - 1);
    const canvas = document.createElement("canvas");
    canvas.width = g.nx;
    canvas.height = g.ny;
    const c2 = canvas.getContext("2d")!;
    const img = c2.createImageData(g.nx, g.ny);
    const colours = this.unitColours().map((c) => new THREE.Color(c));
    for (let iy = 0; iy < g.ny; iy++) {
      for (let ix = 0; ix < g.nx; ix++) {
        if (this.grid.elevation[ix + g.nx * iy]! < z) continue;
        const col = colours[this.lithoAt(ix, iy, k)] ?? new THREE.Color(0x888888);
        const o = 4 * (ix + g.nx * (g.ny - 1 - iy));
        img.data[o] = col.r * 255;
        img.data[o + 1] = col.g * 255;
        img.data[o + 2] = col.b * 255;
        img.data[o + 3] = 255;
      }
    }
    c2.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    const { x0, x1, y0, y1 } = this.cut;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute([...this.v(x0, y0, z), ...this.v(x1, y0, z), ...this.v(x0, y1, z), ...this.v(x1, y1, z)], 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute([x0 / this.sx, y0 / this.sy, x1 / this.sx, y0 / this.sy, x0 / this.sx, y1 / this.sy, x1 / this.sx, y1 / this.sy], 2));
    geo.setIndex([0, 1, 2, 1, 3, 2]);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, alphaTest: 0.5, clippingPlanes: clipped ? this.clipping() : [] }));
  }

  private buildWalls(): void {
    this.dispose(this.layers.walls);
    if (!this.answers || !this.showWalls) return;
    const { x0, x1, y0, y1 } = this.cut;
    for (const m of [this.wall("x", y0 + 0.01, x0, x1), this.wall("x", y1 - 0.01, x0, x1), this.wall("y", x0 + 0.01, y0, y1), this.wall("y", x1 - 0.01, y0, y1)]) if (m) this.layers.walls.add(m);
    this.layers.walls.add(this.plan(this.z0 + 0.5, true));
  }

  private buildSlice(): void {
    this.dispose(this.layers.slice);
    if (!this.answers || !this.sliceOn) return;
    this.layers.slice.add(this.plan(this.sliceZ, false));
  }

  // ----- Unit bodies ------------------------------------------------------------------------------------

  private buildBodies(): void {
    this.dispose(this.layers.bodies);
    if (!this.answers || this.bodies.size === 0) return;
    const g = this.manifest.grid, cell = g.cell_size_m.x, dz = g.cell_size_m.z;
    const f = Math.max(1, Math.ceil(Math.cbrt((g.nx * g.ny * g.nz) / MAX_BODY_CELLS)));
    const ix0 = Math.floor(this.cut.x0 / cell / f), ix1 = Math.ceil(this.cut.x1 / cell / f);
    const iy0 = Math.floor(this.cut.y0 / cell / f), iy1 = Math.ceil(this.cut.y1 / cell / f);
    const cz = Math.ceil(g.nz / f);
    const cx = ix1 - ix0, cy = iy1 - iy0;
    const value = new Int16Array(cx * cy * cz).fill(-1);
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        const fx = Math.min((ix0 + i) * f + (f >> 1), g.nx - 1), fy = Math.min((iy0 + j) * f + (f >> 1), g.ny - 1);
        const ground = this.grid.elevation[fx + g.nx * fy]!;
        for (let k = 0; k < cz; k++) {
          const fk = Math.min(k * f + (f >> 1), g.nz - 1);
          if (this.z0 + (fk + 0.5) * dz > ground) break;
          const u = this.lithoAt(fx, fy, fk);
          if (this.bodies.has(u)) value[i + cx * (j + cy * k)] = u;
        }
      }
    }
    const pos: number[] = [], col: number[] = [], nor: number[] = [];
    const colours = this.unitColours().map((c) => new THREE.Color(c).convertSRGBToLinear());
    const at = (i: number, j: number, k: number) => (i < 0 || j < 0 || k < 0 || i >= cx || j >= cy || k >= cz ? -1 : value[i + cx * (j + cy * k)]!);
    const W = cell * f, Hc = dz * f;
    // Each face: the neighbour offset, its normal in map axes, and its four corners as unit-cube offsets.
    const faces: [number, number, number, number[]][] = [
      [1, 0, 0, [1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1]],
      [-1, 0, 0, [0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0]],
      [0, 1, 0, [0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0]],
      [0, -1, 0, [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]],
      [0, 0, 1, [0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]],
      [0, 0, -1, [0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0]],
    ];
    for (let k = 0; k < cz; k++) {
      for (let j = 0; j < cy; j++) {
        for (let i = 0; i < cx; i++) {
          const u = at(i, j, k);
          if (u < 0) continue;
          for (const [di, dj, dk, c] of faces) {
            if (at(i + di, j + dj, k + dk) === u) continue;
            const corner = (q: number) => this.v((ix0 + i + c[3 * q]!) * W, (iy0 + j + c[3 * q + 1]!) * W, this.z0 + (k + c[3 * q + 2]!) * Hc);
            for (const q of [0, 1, 2, 0, 2, 3]) {
              pos.push(...corner(q));
              nor.push(di, dk, -dj);
              col.push(colours[u]!.r, colours[u]!.g, colours[u]!.b);
            }
          }
        }
      }
    }
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    this.layers.bodies.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, clippingPlanes: this.clipping() })));
  }

  // ----- Drill holes and marks --------------------------------------------------------------------------

  private label(text: string, colour: string): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const c2 = canvas.getContext("2d")!;
    c2.font = "bold 36px system-ui, sans-serif";
    c2.textAlign = "center";
    c2.textBaseline = "middle";
    c2.lineWidth = 7;
    c2.strokeStyle = "rgba(0,0,0,0.85)";
    c2.strokeText(text, 128, 32);
    c2.fillStyle = colour;
    c2.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    const size = Math.max(this.sx, this.sy) / 14;
    sprite.scale.set(size, size / 4 / this.exaggeration, 1);
    sprite.renderOrder = 10;
    return sprite;
  }

  private buildHoles(): void {
    this.dispose(this.layers.holes);
    if (!this.showHoles) return;
    const holes = this.field.state.drill?.holes ?? [];
    const radius = Math.max(this.sx, this.sy) / 400;
    const up = new THREE.Vector3(0, 1, 0);
    for (const h of holes) {
      const group = new THREE.Group();
      const [dx, dy, dz] = direction(h.azimuth, h.inclination);
      const axis = new THREE.Vector3(...this.v(dx, dy, dz)).normalize();
      const turn = new THREE.Quaternion().setFromUnitVectors(up, axis);
      const big = h.id === this.focus ? 1.8 : 1;
      for (const r of h.intervals) {
        const len = r.to - r.from;
        if (len <= 0) continue;
        const mid = pointAt(h, (r.from + r.to) / 2);
        const unit = this.field.scenario.units.find((u) => u.key === r.unit);
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * big, radius * big, len, 10), new THREE.MeshLambertMaterial({ color: unit?.colour ?? "#888", clippingPlanes: this.clipping() }));
        mesh.position.set(...this.v(...mid));
        mesh.quaternion.copy(turn);
        group.add(mesh);
      }
      // The collar: a short mast so the hole is found from far away.
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.6, radius * 0.6, 60, 6), new THREE.MeshLambertMaterial({ color: h.id === this.focus ? 0xf2d16b : 0xe8e2d0 }));
      mast.position.set(...this.v(h.x, h.y, h.z + 30));
      group.add(mast);
      if (this.showLabels) {
        const label = this.label(h.name, h.id === this.focus ? "#f2d16b" : "#ffffff");
        label.position.set(...this.v(h.x, h.y, h.z + 60 + 25 / this.exaggeration));
        group.add(label);
      }
      this.layers.holes.add(group);
    }
  }

  /** Where the student stands. */
  private buildMarks(): void {
    this.dispose(this.layers.marks);
    const p = this.ctx.position();
    const size = Math.max(this.sx, this.sy) / 90;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(size * 0.45, size * 1.4, 12), new THREE.MeshLambertMaterial({ color: 0xd9412b }));
    cone.rotation.x = Math.PI;
    cone.position.set(...this.v(p.x, p.y, surfaceElevation(this.grid, p.x, p.y) + (size * 0.7 + 4) / this.exaggeration));
    cone.scale.y = 1 / this.exaggeration;
    this.layers.marks.add(cone);
  }

  private lookAtHole(id: number): void {
    const h = this.field.state.drill?.holes.find((q) => q.id === id);
    if (!h || !this.controls) return;
    const mid = pointAt(h, h.length / 2);
    const target = new THREE.Vector3(...this.v(...mid)).multiply(this.root3d.scale).add(this.root3d.position);
    const offset = this.camera.position.clone().sub(this.controls.target).setLength(Math.max(h.length * 3, 900));
    this.controls.target.copy(target);
    this.camera.position.copy(target).add(offset);
  }

  // ----- Interaction ------------------------------------------------------------------------------------

  private onPointerUp(e: PointerEvent): void {
    const d = this.down;
    this.down = null;
    if (!this.picking || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObjects(this.layers.terrain.children, false)[0];
    if (!hit) return;
    const local = this.root3d.worldToLocal(hit.point.clone());
    this.picking = false;
    this.ctx.pickCollar(local.x, -local.z);
  }

  private onClick(e: Event): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-do]");
    if (!el) return;
    const action = el.dataset.do;
    if (action === "reset") {
      this.cut = { x0: 0, x1: this.sx, y0: 0, y1: this.sy };
      this.sliceOn = false;
      this.resetCamera();
      this.rebuild();
      this.renderSide();
    } else if (action === "pick") {
      this.picking = !this.picking;
      this.renderSide();
    } else if (action === "fold") this.root.querySelector("#model-side")!.classList.toggle("folded");
    else if (action === "all-units" || action === "no-units") {
      this.bodies = action === "all-units" ? new Set(this.field.scenario.units.map((_, i) => i)) : new Set();
      if (action === "all-units") this.terrainOpacity = Math.min(this.terrainOpacity, 0.35);
      this.buildBodies();
      this.buildTerrain();
      this.renderSide();
    }
    this.hint();
  }

  private onInput(e: Event, final: boolean): void {
    const el = e.target as HTMLInputElement;
    const key = el.dataset.k;
    if (!key) return;
    const v = el.type === "checkbox" ? (el.checked ? 1 : 0) : Number(el.value);
    if (key === "surface" && final) {
      this.surface = el.value as Surface;
      this.buildTerrain();
    } else if (key === "ve" && final) {
      this.exaggeration = v;
      this.place();
      this.buildHoles();
      this.buildMarks();
    } else if (key === "opacity") {
      this.terrainOpacity = v / 100;
      const out = el.closest("label")?.querySelector("output");
      if (out) out.textContent = `${v} %`;
      if (final) this.buildTerrain();
      else {
        const mat = (this.layers.terrain.children[0] as THREE.Mesh | undefined)?.material as THREE.MeshLambertMaterial | undefined;
        if (mat) ((mat.opacity = this.terrainOpacity), (mat.transparent = true));
      }
    } else if (key === "walls") ((this.showWalls = !!v), this.buildWalls());
    else if (key === "holes") ((this.showHoles = !!v), this.buildHoles());
    else if (key === "labels") ((this.showLabels = !!v), this.buildHoles());
    else if (key === "slice") ((this.sliceOn = !!v), this.place(), this.rebuild());
    else if (key === "sliceZ") {
      this.sliceZ = v;
      this.place();
      const out = this.root.querySelector("#model-slice-z");
      if (out) out.textContent = `${v} m`;
      if (final) this.buildSlice();
    } else if (key.startsWith("cut-")) {
      const which = key.slice(4) as keyof Model3dView["cut"];
      this.cut[which] = v;
      const min = 20 * this.grid.cell;
      if (which === "x0") this.cut.x0 = Math.min(v, this.cut.x1 - min);
      if (which === "x1") this.cut.x1 = Math.max(v, this.cut.x0 + min);
      if (which === "y0") this.cut.y0 = Math.min(v, this.cut.y1 - min);
      if (which === "y1") this.cut.y1 = Math.max(v, this.cut.y0 + min);
      const out = this.root.querySelector(`#model-${key}`);
      if (out) out.textContent = this.coordText(which);
      if (final) this.rebuild();
    } else if (key === "unit") {
      const i = Number(el.value);
      if (el.checked) this.bodies.add(i);
      else this.bodies.delete(i);
      this.buildBodies();
    }
    this.hint();
  }

  private coordText(which: keyof Model3dView["cut"]): string {
    const o = this.manifest.grid.origin;
    return which.startsWith("x") ? `E ${Math.round(o.easting + this.cut[which])}` : `N ${Math.round(o.northing + this.cut[which])}`;
  }

  private hint(): void {
    const box = this.root.querySelector<HTMLElement>("#model-hint")!;
    if (this.picking) box.textContent = "Toca el terreno donde quieres el collar del sondaje.";
    else if (this.answers) box.textContent = "Arrastra para girar, rueda o pellizco para acercar, clic derecho o dos dedos para desplazar. Las caras del bloque y los cortes muestran el modelo de GemPy.";
    else box.textContent = "Arrastra para girar, rueda o pellizco para acercar. En modo campaña se ven el terreno, tu mapa y tus sondajes; el modelo geológico se ve en modo libre.";
  }

  private renderSide(): void {
    const side = this.root.querySelector<HTMLElement>("#model-side")!;
    const answers = this.answers, free = this.field.state.mode === "free";
    const surfaces = (Object.keys(SURFACE_NAMES) as Surface[]).filter((s) => s !== "geology" || answers);
    const g = this.manifest.grid;
    const slider = (key: keyof Model3dView["cut"], max: number) =>
      `<label class="range"><span>${key.startsWith("x") ? (key === "x0" ? "Oeste" : "Este") : key === "y0" ? "Sur" : "Norte"} <output id="model-cut-${key}">${this.coordText(key)}</output></span><input type="range" min="0" max="${max}" step="${this.grid.cell}" value="${this.cut[key]}" data-k="cut-${key}"></label>`;
    const units = answers
      ? this.field.scenario.units
          .map((u, i) => ({ u, i, name: this.field.truth?.units.find((t) => t.key === u.key)?.name ?? u.lithology }))
          .map(({ u, i, name }) => `<label class="check"><input type="checkbox" data-k="unit" value="${i}"${this.bodies.has(i) ? " checked" : ""}><i class="sw" style="background:${esc(u.colour)}"></i>${esc(name)}</label>`)
          .join("")
      : "";
    side.innerHTML = `
      <div class="legend-head"><b>Modelo 3D</b><button type="button" class="fold" data-do="fold" title="Plegar o desplegar">▾</button></div>
      <div class="side-body">
        <label>Superficie <select data-k="surface">${surfaces.map((s) => `<option value="${s}"${s === this.surface ? " selected" : ""}>${SURFACE_NAMES[s]}</option>`).join("")}</select></label>
        <label class="range"><span>Opacidad del terreno <output>${Math.round(this.terrainOpacity * 100)} %</output></span><input type="range" min="0" max="100" step="5" value="${Math.round(this.terrainOpacity * 100)}" data-k="opacity"></label>
        <label>Exageración vertical <select data-k="ve">${[1, 1.5, 2, 3].map((v) => `<option value="${v}"${v === this.exaggeration ? " selected" : ""}>${String(v).replace(".", ",")}×</option>`).join("")}</select></label>
        <label class="check"><input type="checkbox" data-k="holes"${this.showHoles ? " checked" : ""}>Sondajes</label>
        <label class="check"><input type="checkbox" data-k="labels"${this.showLabels ? " checked" : ""}>Nombres de los sondajes</label>
        ${free && this.litho ? `<div class="tools">${captionButton("drill", this.picking ? "Toca el terreno…" : "Ubicar sondaje", "Elegir el collar de un sondaje tocando el terreno", `data-do="pick" aria-pressed="${this.picking}"`)}</div>` : ""}
        ${answers ? `<h4>Bloque</h4>
          <label class="check"><input type="checkbox" data-k="walls"${this.showWalls ? " checked" : ""}>Caras del bloque</label>
          ${slider("x0", this.sx)}${slider("x1", this.sx)}${slider("y0", this.sy)}${slider("y1", this.sy)}
          <label class="check"><input type="checkbox" data-k="slice"${this.sliceOn ? " checked" : ""}>Corte horizontal</label>
          <label class="range"><span>Cota del corte <output id="model-slice-z">${this.sliceZ} m</output></span><input type="range" min="${Math.ceil(this.z0 / 10) * 10}" max="${Math.floor(this.ztop / 10) * 10}" step="10" value="${this.sliceZ}" data-k="sliceZ"></label>
          <h4>Cuerpos de unidades <small>(cada ${Math.max(1, Math.ceil(Math.cbrt((g.nx * g.ny * g.nz) / MAX_BODY_CELLS))) * g.cell_size_m.x} m)</small></h4>
          <div class="tools"><button type="button" data-do="all-units">Todas</button><button type="button" data-do="no-units">Ninguna</button></div>
          ${units}` : ""}
        <div class="tools"><button type="button" data-do="reset">Restablecer vista y cortes</button></div>
        ${this.legend()}
      </div>`;
  }

  /** The surface colours when they are not the model's units: the student's map units or the ground cover. */
  private legend(): string {
    if (this.surface === "map") {
      const units = this.field.state.map.units;
      return units.length ? `<h4>Mi mapa</h4>${units.map((u) => `<div class="row"><i class="sw" style="background:${esc(u.colour)}"></i>${esc(u.name)}</div>`).join("")}` : `<p class="hint">Tu mapa aún no tiene unidades pintadas.</p>`;
    }
    if (this.surface === "cover") {
      const names = ["Roca", "Suelo", "Aluvio", "Escombros", "Vegetación", "Zona de falla"];
      return `<h4>Cobertura</h4>${this.grid.coverColours.slice(0, names.length).map((c, i) => `<div class="row"><i class="sw" style="background:${hex(c)}"></i>${names[i]}</div>`).join("")}`;
    }
    return "";
  }
}

