// The three.js scene: chunked terrain at two levels of detail, bedding lines, light, sky and clouds.

import * as THREE from "three";
import type { Scenario } from "../format/types";
import type { Avatar } from "../state/avatar";
import { SKIN_TONES, GEAR_COLOURS } from "../state/avatar";
import { type AvatarModel, animateAvatar, buildAvatar, disposeAvatar, fistParts, hammerParts } from "./avatar";
import { beddingSegments } from "./bedding";
import { COVER, ENVIRONMENT_LOOK, type Grid, SUB, cellHash, heightAt } from "./blocks";
import { EYE_HEIGHT } from "../explore/movement";
import { surfaceMaterial } from "./materials";
import { CHUNK, type ChunkMesh, buildChunk } from "./mesher";
import { addRockPatterns } from "./rockPattern";
import { Forest, treeSpots } from "./trees";
import { Spyglass } from "./spyglass";
import { Clouds } from "./clouds";

const SKY = 0x9ec3dd;
/**
 * The figure, built about 1.85 m tall, is drawn big against the blocks, as in a block game: its eyes at
 * EYE_HEIGHT, so that a terrain step comes to about its waist.
 */
const FIGURE_SCALE = EYE_HEIGHT / 1.69;
/** Field of view of the eye, in degrees; zooming narrows it. */
const FOV = 70;
/** How far the view may zoom out (below 1) and in. */
export const ZOOM_MIN = 0.8, ZOOM_MAX = 5;
export const VIEW_DISTANCE_M = 1400;
/** Chunks whose centre is nearer than this are drawn with fine blocks. */
export const FINE_DISTANCE_M = 330;
const FINE_RELEASE_M = 480;
/** Through the spyglass: how far the student sees, and how many far chunks may be drawn with fine blocks. */
const SPYGLASS_DISTANCE_M = 3200;
const SPYGLASS_FINE_CHUNKS = 20;
/** Powers of the spyglass, × the naked eye. */
export const SPYGLASS_MIN = 4, SPYGLASS_MAX = 20, SPYGLASS_DEFAULT = 8;

interface Chunk {
  cx: number;
  cy: number;
  /** Centre in model metres. */
  x: number;
  y: number;
  coarse: THREE.Mesh | null;
  fine: THREE.Mesh | null;
  fineRequested: boolean;
}

type Request = { cx: number; cy: number; sub: number };

export class World {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.3, VIEW_DISTANCE_M * 1.2);
  readonly renderer: THREE.WebGLRenderer;
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly chunks = new Map<string, Chunk>();
  private grid!: Grid;
  private worker: Worker | null = null;
  private pending = 0;
  private whenIdle: (() => void) | null = null;
  chunksLoaded = 0;
  /**
   * The student's arm and hammer, held in front of the camera as in a block game. They live in a scene of their
   * own, drawn after the terrain over a cleared depth buffer: never sunk into the ground, and still shaded properly.
   */
  private readonly hand = new THREE.Group();
  private readonly handScene = new THREE.Scene();
  private readonly handCamera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 10);
  /** The rock patterns on the block faces; switched off on devices too slow for them (see `watchSpeed`). */
  private patterns: { enabled: boolean } = { enabled: true };
  private slowTime = 0;
  private fastTime = 0;
  /** Zoom of the view, from a pinch or the mouse wheel: 1 is the normal eye. */
  zoom = 1;
  private swingTime = -1;
  private walkPhase = 0;
  private readonly flying: { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }[] = [];
  private readonly chipGeometry = new THREE.BoxGeometry(0.07, 0.07, 0.07);
  /** Width in pixels of a panel covering the right of the view; the arm moves left to stay visible. */
  inset = 0;
  /** How far the student sees; it grows when flying. */
  private viewDistance = VIEW_DISTANCE_M;
  /** The figure seen from behind in third person, scaled to the block world (eyes at EYE_HEIGHT). */
  private figure: AvatarModel | null = null;
  private avatar: Avatar | null = null;
  /** A flag at each station, in the colour of the unit assigned there. */
  private readonly flags = new THREE.Group();
  private flagKey = "";
  /** Third person: the camera stands behind the student, who is drawn. */
  thirdPerson = false;
  /** Height over the ground; above a few metres the figure flies like a superhero. */
  private flightHeight = 0;
  /** The spyglass held to the eye: its power (×), or 0 when it is put away. See spyglass.ts. */
  private spyglassPower = 0;
  private spyglass: Spyglass | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.patterns = addRockPatterns(this.material);
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, VIEW_DISTANCE_M * 0.45, VIEW_DISTANCE_M);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a5c, 1.15));
    const sun = new THREE.DirectionalLight(0xfff2d6, 1.6);
    sun.position.set(-0.6, 1, 0.35); // from the north-west, like a shaded-relief map
    this.scene.add(sun);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera); // so that what the camera holds is drawn
    this.handScene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a5c, 1.25));
    const handSun = new THREE.DirectionalLight(0xfff2d6, 1.7);
    handSun.position.set(-0.8, 1, 0.9); // over the left shoulder
    this.handScene.add(handSun, this.hand);
    this.buildHand();
    this.resize();
  }

  /** The trees of a forest, and the few of temperate land (see trees.ts). */
  private forest: Forest | null = null;
  /** Clouds drifting slowly over the area (see clouds.ts). */
  private clouds: Clouds | null = null;

  private plantTrees(grid: Grid): void {
    const spots = treeSpots(grid);
    if (!spots.length) return;
    this.forest = new Forest(spots);
    this.scene.add(this.forest.group);
  }

  /** Puts a flag at each station: x, y in model metres, colour of its unit (white while unassigned). */
  setStations(stations: { x: number; y: number; colour: string | null }[]): void {
    const key = stations.map((s) => `${s.x},${s.y},${s.colour}`).join(";");
    if (key === this.flagKey || !this.grid) return;
    this.flagKey = key;
    this.flags.traverse((o) => o instanceof THREE.Mesh && (o.geometry.dispose(), (o.material as THREE.Material).dispose()));
    this.flags.clear();
    if (!this.flags.parent) this.scene.add(this.flags);
    for (const s of stations) {
      const ground = heightAt(this.grid, s.x, s.y);
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.25, 4.2, 0.25), new THREE.MeshLambertMaterial({ color: 0x7a5a3a }));
      pole.position.set(s.x, ground + 2.1, -s.y);
      const flag = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.1), new THREE.MeshLambertMaterial({ color: s.colour ?? "#f4f1e8" }));
      flag.position.set(s.x + 0.9, ground + 3.6, -s.y);
      this.flags.add(pole, flag);
    }
  }

  /** Dresses the hand in first person and the figure in third person. */
  setAvatar(a: Avatar): void {
    this.avatar = a;
    this.hand.traverse((o) => o instanceof THREE.Mesh && (o.geometry.dispose(), (o.material as THREE.Material).dispose()));
    this.hand.clear();
    this.buildHand();
    if (this.figure) {
      this.scene.remove(this.figure.group);
      disposeAvatar(this.figure);
    }
    this.figure = buildAvatar(a);
    this.figure.group.scale.setScalar(FIGURE_SCALE);
    this.figure.group.visible = this.thirdPerson;
    this.scene.add(this.figure.group);
  }

  /** The forearm coming in from the lower right, the fist closed on the grip, and the hammer upright in it. */
  private buildHand(): void {
    const a = this.avatar;
    const skin = a ? SKIN_TONES[a.skin]! : "#c9956b";
    const sleeveColour = a ? (a.vest ? GEAR_COLOURS[a.vestColour]! : a.shirtColour) : "#3d6b8f";
    const part = (w: number, h: number, d: number, colour: THREE.ColorRepresentation, x: number, y: number, z: number, kind: "skin" | "cloth" = "cloth") => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), surfaceMaterial(kind, colour, Math.max(w, d) * 6, h * 6));
      mesh.position.set(x, y, z);
      this.hand.add(mesh);
      return mesh;
    };
    part(0.15, 0.15, 0.34, sleeveColour, 0, -0.035, 0.27); // sleeve
    part(0.155, 0.155, 0.05, new THREE.Color(sleeveColour).multiplyScalar(0.78), 0, -0.035, 0.1); // cuff
    part(0.118, 0.112, 0.15, skin, 0, -0.03, 0.01, "skin"); // forearm
    part(0.105, 0.1, 0.05, new THREE.Color(skin).multiplyScalar(0.94), 0, -0.025, -0.065, "skin"); // wrist
    const fist = new THREE.Group();
    fist.position.set(0, 0, -0.11);
    fist.rotation.y = -1.0; // the back of the hand towards the student and to the right
    fistParts(fist, skin, 1.4);
    this.hand.add(fist);
    const tool = new THREE.Group();
    tool.position.set(0, 0, -0.11);
    hammerParts(tool, a?.hammer ?? "punta");
    this.hand.add(tool);
    this.hand.scale.setScalar(0.85);
    this.hand.position.set(this.handX(0.62), -0.33, -0.62);
    this.hand.rotation.set(0.25, -0.35, -0.15);
  }

  /** Sideways position, at `depth` in front of the camera, that puts the arm in the right part of what is visible. */
  private handX(depth: number): number {
    const width = this.renderer.domElement.clientWidth || window.innerWidth;
    const right = 1 - (2 * Math.min(this.inset, width * 0.8)) / width; // visible part, in screen units from -1 to 1
    const ndc = -1 + (right + 1) * 0.76;
    return ndc * Math.tan(((FOV / 2) * Math.PI) / 180) * this.camera.aspect * depth;
  }

  /** From the air the student sees further: fog and the far plane move out with the height over the ground. */
  setHeight(height: number): void {
    this.flightHeight = height;
    // Through the spyglass the far hills come out of the haze: the whole area is in view.
    const distance = this.spyglassPower > 0 ? Math.max(SPYGLASS_DISTANCE_M, VIEW_DISTANCE_M + height * 8) : VIEW_DISTANCE_M + height * 8;
    if (Math.abs(distance - this.viewDistance) < 20) return;
    this.viewDistance = distance;
    const look = ENVIRONMENT_LOOK[this.grid?.environment ?? "temperate"];
    const fog = this.scene.fog as THREE.Fog;
    const clear = this.spyglassPower > 0 ? 1.6 : 1; // the lens sees through more of the haze
    fog.near = distance * look.fogNear * clear;
    fog.far = distance * look.fogFar * clear;
    this.camera.far = Math.max(distance * 1.2, fog.far * 1.1);
    this.camera.updateProjectionMatrix();
  }

  /** Starts three blows of the hammer. */
  swing(): void {
    this.swingTime = 0;
  }

  /**
   * The ray under screen point x, y (client pixels), in model coordinates: origin at the camera, unit direction,
   * x east, y north, z up.
   */
  screenRay(x: number, y: number): { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number } {
    const box = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - box.left) / box.width) * 2 - 1, -((y - box.top) / box.height) * 2 + 1);
    this.camera.updateMatrixWorld();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    return { ox: o.x, oy: -o.z, oz: o.y, dx: d.x, dy: -d.z, dz: d.y };
  }

  /** Rock chips flying from in front of the student, or from model point `at`, in the colour of the rock. */
  chips(colour: string, at?: { x: number; y: number; z: number }): void {
    const material = new THREE.MeshLambertMaterial({ color: new THREE.Color(colour) });
    const from = at
      ? new THREE.Vector3(at.x, at.z + 0.4, -at.y)
      : this.thirdPerson && this.figure
      ? this.figure.group.localToWorld(new THREE.Vector3(0.25, 0.6, -0.9)) // in front of the figure, where the hammer strikes
      : this.camera.localToWorld(new THREE.Vector3(this.handX(1.5) - 0.25, -0.45, -1.5));
    for (let i = 0; i < 16; i++) {
      const mesh = new THREE.Mesh(this.chipGeometry, material);
      mesh.position.copy(from);
      const velocity = this.camera.localToWorld(new THREE.Vector3((Math.random() - 0.5) * 2.4, 1.2 + Math.random() * 2.2, 0.6 + Math.random())).sub(this.camera.position);
      this.scene.add(mesh);
      // The first blow lands about a fifth of a second in.
      this.flying.push({ mesh, velocity, life: -0.18 - (i % 3) * 0.3 });
    }
  }

  /** Moves the arm and the chips; `walking` makes the arm bob. Call once a frame. */
  animate(dt: number, walking: boolean): void {
    this.forest?.animate(dt);
    this.clouds?.animate(dt, this.camera);
    if (walking) this.walkPhase += dt * 9;
    const bob = walking ? Math.sin(this.walkPhase) * 0.018 : 0;
    let blow = 0;
    if (this.swingTime >= 0) {
      this.swingTime += dt;
      const t = this.swingTime / 0.3; // each blow takes 0.3 s
      if (t >= 3) this.swingTime = -1;
      else blow = Math.sin(Math.PI * (t % 1)) ** 2;
    }
    this.hand.position.set(this.handX(0.62), -0.33 + bob - blow * 0.05, -0.62 - blow * 0.08);
    this.hand.rotation.set(0.25 - blow * 1.25, -0.35 + blow * 0.2, -0.15);
    this.hand.visible = !this.thirdPerson && !this.spyglassPower;
    if (this.figure) {
      this.figure.group.visible = this.thirdPerson && !this.spyglassPower;
      const flying = this.flightHeight > 1.5;
      // Flying: the body flat, the right fist forward, the left arm along the side, legs together.
      this.figure.group.rotation.x = flying ? -Math.PI / 2 + 0.12 : 0;
      if (flying) {
        this.walkPhase += dt * 3;
        this.figure.armR.rotation.x = Math.PI; // reaching ahead of the head
        this.figure.armL.rotation.x = 0.15 + Math.sin(this.walkPhase) * 0.05;
        this.figure.legL.rotation.x = this.figure.legR.rotation.x = Math.sin(this.walkPhase * 0.7) * 0.06;
      } else {
        animateAvatar(this.figure, this.walkPhase, walking);
        if (blow) this.figure.armR.rotation.x = -1.6 * blow - 0.6;
      }
    }
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const chip = this.flying[i]!;
      chip.life += dt;
      chip.mesh.visible = chip.life > 0;
      if (chip.life <= 0) continue;
      chip.velocity.y -= 9.8 * dt;
      chip.mesh.position.addScaledVector(chip.velocity, dt);
      chip.mesh.rotation.x += dt * 8;
      chip.mesh.rotation.z += dt * 6;
      if (chip.life > 0.9) {
        this.scene.remove(chip.mesh);
        this.flying.splice(i, 1);
      }
    }
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = this.handCamera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.handCamera.updateProjectionMatrix();
  }

  private toMesh(mesh: ChunkMesh): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(mesh.colours, 3));
    geometry.setAttribute("pattern", new THREE.BufferAttribute(mesh.patterns, 1));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    geometry.computeBoundingSphere();
    return new THREE.Mesh(geometry, this.material);
  }

  private receive(cx: number, cy: number, sub: number, data: ChunkMesh): void {
    const chunk = this.chunks.get(`${cx},${cy}`)!;
    const mesh = this.toMesh(data);
    if (sub === 1) {
      chunk.coarse = mesh;
      this.chunksLoaded += 1;
    } else if (chunk.fineRequested) {
      if (chunk.fine) {
        // Meshed again after a block was broken: the new mesh takes the old one's place as it is.
        mesh.visible = chunk.fine.visible;
        this.scene.remove(chunk.fine);
        chunk.fine.geometry.dispose();
        chunk.fine = mesh;
        this.scene.add(mesh);
        this.pending -= 1;
        if (this.pending === 0) this.whenIdle?.();
        return;
      }
      chunk.fine = mesh;
    } else {
      mesh.geometry.dispose(); // released while it was being built
      return;
    }
    mesh.visible = false;
    this.scene.add(mesh);
    this.pending -= 1;
    if (this.pending === 0) this.whenIdle?.();
  }

  private request(r: Request): void {
    this.pending += 1;
    if (this.worker) this.worker.postMessage(r);
    else this.receive(r.cx, r.cy, r.sub, buildChunk(this.grid, r.cx, r.cy, r.sub));
  }

  /** Meshes every chunk coarsely, in a worker where one is available. Fine chunks follow the student. */
  build(scenario: Scenario, grid: Grid): Promise<void> {
    this.grid = grid;
    const look = ENVIRONMENT_LOOK[grid.environment];
    (this.scene.background as THREE.Color).setHex(look.sky);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.setHex(look.sky);
    fog.near = VIEW_DISTANCE_M * look.fogNear;
    fog.far = VIEW_DISTANCE_M * look.fogFar;
    this.camera.far = Math.max(this.camera.far, fog.far * 1.1);
    this.camera.updateProjectionMatrix();
    this.plantTrees(grid);
    this.clouds = new Clouds(grid);
    this.scene.add(this.clouds.group);
    const lines = new THREE.BufferGeometry();
    lines.setAttribute("position", new THREE.BufferAttribute(beddingSegments(scenario, grid), 3));
    this.scene.add(new THREE.LineSegments(lines, new THREE.LineBasicMaterial({ color: 0x1a1612, transparent: true, opacity: 0.6 })));

    try {
      this.worker = new Worker(new URL("./mesh.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (e: MessageEvent<Request & { mesh: ChunkMesh }>) => this.receive(e.data.cx, e.data.cy, e.data.sub, e.data.mesh);
      this.worker.onerror = () => {
        // Fall back to meshing on the main thread for whatever is still missing.
        this.worker?.terminate();
        this.worker = null;
        this.pending = 0;
        for (const chunk of this.chunks.values()) {
          if (!chunk.coarse) this.request({ cx: chunk.cx, cy: chunk.cy, sub: 1 });
          chunk.fineRequested = false;
        }
      };
      this.worker.postMessage({ grid });
    } catch {
      this.worker = null;
    }

    return new Promise((resolve) => {
      this.whenIdle = () => {
        this.whenIdle = null;
        resolve();
      };
      for (let cy = 0; cy < grid.ny; cy += CHUNK) {
        for (let cx = 0; cx < grid.nx; cx += CHUNK) {
          const x = (Math.min(cx + CHUNK, grid.nx) + cx) / 2 * grid.cell, y = (Math.min(cy + CHUNK, grid.ny) + cy) / 2 * grid.cell;
          this.chunks.set(`${cx},${cy}`, { cx, cy, x, y, coarse: null, fine: null, fineRequested: false });
        }
      }
      for (const chunk of [...this.chunks.values()]) this.request({ cx: chunk.cx, cy: chunk.cy, sub: 1 });
    });
  }

  /**
   * Breaks one near block down to `steps` steps below the ground, as with the hammer, and meshes again the chunks
   * whose blocks or side faces it touches.
   */
  dig(index: number, steps: number): void {
    const grid = this.grid, wide = grid.nx * SUB;
    grid.dug ??= new Uint8Array(wide * grid.ny * SUB);
    grid.dug[index] = steps;
    this.worker?.postMessage({ dig: [index, steps] });
    const bx = index % wide, by = Math.floor(index / wide);
    const keys = new Set<string>();
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ix = Math.floor((bx + dx) / SUB), iy = Math.floor((by + dy) / SUB);
      if (ix < 0 || iy < 0 || ix >= grid.nx || iy >= grid.ny) continue;
      keys.add(`${Math.floor(ix / CHUNK) * CHUNK},${Math.floor(iy / CHUNK) * CHUNK}`);
    }
    for (const key of keys) {
      const chunk = this.chunks.get(key);
      if (chunk?.fineRequested) this.request({ cx: chunk.cx, cy: chunk.cy, sub: SUB });
    }
  }

  /** Mends every broken block, for a new attempt. */
  clearDigs(): void {
    if (!this.grid?.dug) return;
    this.grid.dug = undefined;
    this.worker?.postMessage({ clearDigs: true });
    for (const chunk of this.chunks.values()) if (chunk.fineRequested) this.request({ cx: chunk.cx, cy: chunk.cy, sub: SUB });
  }

  /** Choose the level of detail of each chunk for a student at model x, y. Call a few times a second. */
  update(x: number, y: number, fine = true, heading = 0): void {
    this.forest?.update(x, y);
    const half = (CHUNK * this.grid.cell) / 2;
    const looked = this.spyglassPower > 0 && fine ? this.chunksInSight(x, y, heading) : null;
    for (const chunk of this.chunks.values()) {
      // Distance to the chunk's square, not to its centre, so the ground underfoot is always fine.
      const distance = Math.hypot(Math.max(Math.abs(chunk.x - x) - half, 0), Math.max(Math.abs(chunk.y - y) - half, 0));
      const wanted = fine && (distance < FINE_DISTANCE_M || !!looked?.has(chunk));
      if (wanted && !chunk.fineRequested) {
        chunk.fineRequested = true;
        this.request({ cx: chunk.cx, cy: chunk.cy, sub: SUB });
      } else if (!wanted && (!fine || distance > FINE_RELEASE_M) && chunk.fineRequested) {
        chunk.fineRequested = false;
        if (chunk.fine) {
          this.scene.remove(chunk.fine);
          chunk.fine.geometry.dispose();
          chunk.fine = null;
        }
      }
      const visible = distance < this.viewDistance;
      if (chunk.fine) chunk.fine.visible = visible;
      if (chunk.coarse) chunk.coarse.visible = visible && !chunk.fine;
    }
  }

  /** Place the camera at model x, y (metres east and north), eye elevation, heading and pitch in degrees. */
  look(x: number, y: number, eye: number, heading: number, pitch: number): void {
    this.camera.rotation.set((pitch * Math.PI) / 180, (-heading * Math.PI) / 180, 0);
    this.camera.position.set(x, eye, -y);
    if (this.figure) {
      // The figure stands where the student stands; eye is EYE_HEIGHT above the feet, plus any flight.
      this.figure.group.rotation.order = "YXZ"; // turn to the heading first, then lean
      this.figure.group.rotation.y = (-heading * Math.PI) / 180;
      if (this.flightHeight > 1.5) {
        // Lying flat, the figure's middle sits where the eyes would be, so the camera looks along its back.
        const h = (heading * Math.PI) / 180, k = FIGURE_SCALE / 1.75;
        this.figure.group.position.set(x - Math.sin(h) * 1.6 * k, eye - 1.2 * k, -y + Math.cos(h) * 1.6 * k);
      } else this.figure.group.position.set(x, eye - EYE_HEIGHT, -y);
    }
    if (this.spyglassPower > 0) {
      // The spyglass is at the student's own eye, whatever the view was.
    } else if (this.thirdPerson && this.figure && this.flightHeight > 1.5) {
      // In flight the camera follows from above and to one side, so that the outstretched figure reads as flying.
      const h = (heading * Math.PI) / 180;
      const fwd = new THREE.Vector3(Math.sin(h), 0, -Math.cos(h)), right = new THREE.Vector3(Math.cos(h), 0, Math.sin(h));
      const centre = this.figure.group.position.clone().add(new THREE.Vector3(0, 0.6, 0)).addScaledVector(fwd, 1.4);
      const k = FIGURE_SCALE / 1.75;
      this.camera.position.copy(centre).addScaledVector(fwd, -8.5 * k).addScaledVector(right, 4.5 * k).add(new THREE.Vector3(0, (4.5 + Math.sin((pitch * Math.PI) / 180) * 3) * k, 0));
      this.camera.lookAt(centre.clone().addScaledVector(fwd, 6));
    } else if (this.thirdPerson) {
      // Behind and a little above, looking the same way, kept above the ground.
      const back = this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(-EYE_HEIGHT * 2.9);
      this.camera.position.add(back).add(new THREE.Vector3(0, EYE_HEIGHT * 0.45, 0));
      if (this.grid) {
        const p = this.camera.position;
        const floor = heightAt(this.grid, p.x, -p.z) + 1.2;
        if (p.y < floor) p.y = floor;
      }
    }
  }

  get patternsOn(): boolean {
    return this.patterns.enabled;
  }

  /**
   * Adaptive quality: after about two seconds of frames slower than 20 per second the rock patterns are switched
   * off, so a weak tablet keeps walking smoothly with plain block colours. Call once a frame with its duration.
   */
  watchSpeed(dt: number): void {
    if (!this.patterns.enabled || dt <= 0) return;
    if (dt > 0.05) ((this.slowTime += dt), (this.fastTime = 0));
    else if ((this.fastTime += dt) > 1) this.slowTime = 0;
    if (this.slowTime > 2) this.patterns.enabled = false;
  }

  /** Zooms the view by `factor`, within ZOOM_MIN and ZOOM_MAX. */
  zoomBy(factor: number, force = false): void {
    const zoom = Math.min(Math.max(this.zoom * factor, ZOOM_MIN), ZOOM_MAX);
    if (Math.abs(zoom - this.zoom) < 1e-4 && !force) return;
    this.zoom = zoom;
    this.camera.fov = (2 * Math.atan(Math.tan(((FOV / 2) * Math.PI) / 180) / this.magnification) * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
  }

  /** The far chunks in the spyglass's field of view, nearest first, up to SPYGLASS_FINE_CHUNKS. */
  private chunksInSight(x: number, y: number, heading: number): Set<Chunk> {
    const h = (heading * Math.PI) / 180;
    const fx = Math.sin(h), fy = Math.cos(h);
    const half = (CHUNK * this.grid.cell) / 2;
    // Half the horizontal field of view, widened by the chunk's own half-width at its distance.
    const halfView = Math.atan(Math.tan(((FOV / 2) * Math.PI) / 180) * this.camera.aspect / this.magnification);
    const seen: { chunk: Chunk; d: number }[] = [];
    for (const chunk of this.chunks.values()) {
      const dx = chunk.x - x, dy = chunk.y - y, d = Math.hypot(dx, dy);
      if (d < FINE_DISTANCE_M || d > SPYGLASS_DISTANCE_M) continue;
      const off = Math.acos(Math.min(1, Math.max(-1, (dx * fx + dy * fy) / d)));
      if (off < halfView + Math.atan((half * 1.42) / d)) seen.push({ chunk, d });
    }
    seen.sort((a, b) => a.d - b.d);
    return new Set(seen.slice(0, SPYGLASS_FINE_CHUNKS).map((s) => s.chunk));
  }

  /** Power of the view: the pinch or wheel zoom times the spyglass, when it is held to the eye. */
  get magnification(): number {
    return this.zoom * (this.spyglassPower || 1);
  }

  get spyglassOn(): boolean {
    return this.spyglassPower > 0;
  }

  get spyglassPowerNow(): number {
    return this.spyglassPower;
  }

  /** Holds the spyglass to the eye at `power` (×), or puts it away with 0. */
  setSpyglass(power: number): void {
    const next = power > 0 ? Math.min(Math.max(power, SPYGLASS_MIN), SPYGLASS_MAX) : 0;
    if (next === this.spyglassPower) return;
    const was = this.spyglassPower;
    this.spyglassPower = next;
    this.zoomBy(1, true);
    if ((was > 0) !== (next > 0)) {
      this.viewDistance = -1; // refresh fog and far plane
      this.setHeight(this.flightHeight);
    }
  }

  render(): void {
    if (this.spyglassPower > 0) {
      (this.spyglass ??= new Spyglass()).render(this.renderer, this.scene, this.camera);
      return;
    }
    this.renderer.render(this.scene, this.camera);
    if (!this.hand.visible) return;
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.handScene, this.handCamera);
    this.renderer.autoClear = true;
  }
}
