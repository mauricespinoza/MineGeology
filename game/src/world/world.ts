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
    this.resize();
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
  update(x: number, y: number): void {
    const half = (CHUNK * this.grid.cell) / 2;
    for (const chunk of this.chunks.values()) {
      // Distance to the chunk's square, not to its centre, so the ground underfoot is always fine.
      const distance = Math.hypot(Math.max(Math.abs(chunk.x - x) - half, 0), Math.max(Math.abs(chunk.y - y) - half, 0));
      if (distance < FINE_DISTANCE_M && !chunk.fineRequested) {
        chunk.fineRequested = true;
        this.request({ cx: chunk.cx, cy: chunk.cy, sub: SUB });
      } else if (distance > FINE_RELEASE_M && chunk.fineRequested) {
        chunk.fineRequested = false;
        if (chunk.fine) {
          this.scene.remove(chunk.fine);
          chunk.fine.geometry.dispose();
          chunk.fine = null;
        }
      }
      const visible = distance < VIEW_DISTANCE_M;
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
