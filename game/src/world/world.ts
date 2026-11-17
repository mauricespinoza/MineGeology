// The three.js scene: chunked terrain at two levels of detail, bedding lines, light and sky.

import * as THREE from "three";
import type { Scenario } from "../format/types";
import { beddingSegments } from "./bedding";
import { type Grid, SUB } from "./blocks";
import { CHUNK, type ChunkMesh, buildChunk } from "./mesher";

const SKY = 0x9ec3dd;
export const VIEW_DISTANCE_M = 1400;
/** Chunks whose centre is nearer than this are drawn with fine blocks. */
export const FINE_DISTANCE_M = 330;
const FINE_RELEASE_M = 480;

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
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.3, VIEW_DISTANCE_M * 1.2);
  readonly renderer: THREE.WebGLRenderer;
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly chunks = new Map<string, Chunk>();
  private grid!: Grid;
  private worker: Worker | null = null;
  private pending = 0;
  private whenIdle: (() => void) | null = null;
  chunksLoaded = 0;
  /** The student's arm and hammer, held in front of the camera as in a block game. */
  private readonly hand = new THREE.Group();
  private swingTime = -1;
  private walkPhase = 0;
  private readonly flying: { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }[] = [];
  private readonly chipGeometry = new THREE.BoxGeometry(0.07, 0.07, 0.07);
  /** Width in pixels of a panel covering the right of the view; the arm moves left to stay visible. */
  inset = 0;
  /** How far the student sees; it grows when flying. */
  private viewDistance = VIEW_DISTANCE_M;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, VIEW_DISTANCE_M * 0.45, VIEW_DISTANCE_M);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a5c, 1.15));
    const sun = new THREE.DirectionalLight(0xfff2d6, 1.6);
    sun.position.set(-0.6, 1, 0.35); // from the north-west, like a shaded-relief map
    this.scene.add(sun);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera); // so that what the camera holds is drawn
    this.buildHand();
    this.resize();
  }

  private buildHand(): void {
    // Drawn on top of everything and without fog, so the arm never sinks into the ground. Marked transparent
    // so that it is drawn in the last pass, after the bedding lines, which are transparent too.
    const part = (w: number, h: number, d: number, colour: number, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: colour, depthTest: false, depthWrite: false, fog: false, transparent: true }));
      mesh.position.set(x, y, z);
      mesh.renderOrder = 10;
      this.hand.add(mesh);
      return mesh;
    };
    part(0.13, 0.13, 0.36, 0x3d6b8f, 0, -0.03, 0.2); // sleeve
    part(0.115, 0.115, 0.18, 0xc9956b, 0, -0.01, -0.04); // forearm and fist
    part(0.035, 0.36, 0.035, 0x8b5a2b, 0, 0.13, -0.11); // handle
    part(0.2, 0.065, 0.065, 0x6f7377, 0.02, 0.31, -0.11); // head
    part(0.05, 0.05, 0.05, 0x55595d, -0.1, 0.31, -0.11); // pick end
    this.hand.scale.setScalar(0.85);
    this.hand.position.set(this.handX(0.62), -0.33, -0.62);
    this.hand.rotation.set(0.25, -0.35, -0.15);
    this.camera.add(this.hand);
  }

  /** Sideways position, at `depth` in front of the camera, that puts the arm in the right part of what is visible. */
  private handX(depth: number): number {
    const width = this.renderer.domElement.clientWidth || window.innerWidth;
    const right = 1 - (2 * Math.min(this.inset, width * 0.8)) / width; // visible part, in screen units from -1 to 1
    const ndc = -1 + (right + 1) * 0.76;
    return ndc * Math.tan(((this.camera.fov / 2) * Math.PI) / 180) * this.camera.aspect * depth;
  }

  /** From the air the student sees further: fog and the far plane move out with the height over the ground. */
  setHeight(height: number): void {
    const distance = VIEW_DISTANCE_M + height * 8;
    if (Math.abs(distance - this.viewDistance) < 20) return;
    this.viewDistance = distance;
    const fog = this.scene.fog as THREE.Fog;
    fog.near = distance * 0.45;
    fog.far = distance;
    this.camera.far = distance * 1.2;
    this.camera.updateProjectionMatrix();
  }

  /** Starts three blows of the hammer. */
  swing(): void {
    this.swingTime = 0;
  }

  /** Rock chips flying from in front of the student, in the colour of the rock. */
  chips(colour: string): void {
    const material = new THREE.MeshLambertMaterial({ color: new THREE.Color(colour) });
    const from = this.camera.localToWorld(new THREE.Vector3(this.handX(1.5) - 0.25, -0.45, -1.5));
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
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private toMesh(mesh: ChunkMesh): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(mesh.colours, 3));
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

  /** Choose the level of detail of each chunk for a student at model x, y. Call a few times a second. */
  update(x: number, y: number, fine = true): void {
    const half = (CHUNK * this.grid.cell) / 2;
    for (const chunk of this.chunks.values()) {
      // Distance to the chunk's square, not to its centre, so the ground underfoot is always fine.
      const distance = Math.hypot(Math.max(Math.abs(chunk.x - x) - half, 0), Math.max(Math.abs(chunk.y - y) - half, 0));
      if (fine && distance < FINE_DISTANCE_M && !chunk.fineRequested) {
        chunk.fineRequested = true;
        this.request({ cx: chunk.cx, cy: chunk.cy, sub: SUB });
      } else if ((!fine || distance > FINE_RELEASE_M) && chunk.fineRequested) {
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
    this.camera.position.set(x, eye, -y);
    this.camera.rotation.set((pitch * Math.PI) / 180, (-heading * Math.PI) / 180, 0);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
