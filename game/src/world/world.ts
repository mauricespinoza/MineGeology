// The three.js scene: chunked terrain at two levels of detail, bedding lines, light and sky.

import * as THREE from "three";
import type { Scenario } from "../format/types";
import type { Avatar } from "../state/avatar";
import { SKIN_TONES, GEAR_COLOURS } from "../state/avatar";
import { type AvatarModel, animateAvatar, buildAvatar, disposeAvatar, hammerParts } from "./avatar";
import { beddingSegments } from "./bedding";
import { COVER, ENVIRONMENT_LOOK, type Grid, SUB, cellHash, heightAt } from "./blocks";
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

  /**
   * Trees on the vegetated cells of a forest: a trunk and a blocky crown, tall enough to hide the ground
   * beyond them, so that from afar only crags and clearings show rock. Two instanced meshes for the lot.
   */
  private plantTrees(grid: Grid): void {
    const spots: [number, number, number, number][] = [];
    for (let iy = 0; iy < grid.ny; iy++) {
      for (let ix = 0; ix < grid.nx; ix++) {
        if (grid.cover[ix + grid.nx * iy] !== COVER.vegetation || cellHash(ix, iy, 7) > 0.55) continue;
        const x = (ix + 0.2 + 0.6 * cellHash(ix, iy, 8)) * grid.cell, y = (iy + 0.2 + 0.6 * cellHash(ix, iy, 9)) * grid.cell;
        spots.push([x, y, heightAt(grid, x, y), 0.75 + 0.5 * cellHash(ix, iy, 10)]);
      }
    }
    const trunk = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 9, 1.2), new THREE.MeshLambertMaterial({ color: 0x5b4029 }), spots.length);
    const crown = new THREE.InstancedMesh(new THREE.BoxGeometry(6.5, 7, 6.5), new THREE.MeshLambertMaterial({ color: 0x2f5a2c }), spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), shade = new THREE.Color();
    spots.forEach(([x, y, z, s], i) => {
      m.compose(new THREE.Vector3(x, z + 4.5 * s, -y), q, new THREE.Vector3(1, s, 1));
      trunk.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, z + 9 * s + 2.5, -y), q, new THREE.Vector3(s, s, s));
      crown.setMatrixAt(i, m);
      crown.setColorAt(i, shade.setHex(0x2f5a2c).multiplyScalar(0.8 + 0.4 * cellHash(i, 3, 11)));
    });
    this.scene.add(trunk, crown);
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
    this.camera.remove(this.hand);
    this.hand.traverse((o) => o instanceof THREE.Mesh && (o.geometry.dispose(), (o.material as THREE.Material).dispose()));
    this.hand.clear();
    this.buildHand();
    if (this.figure) {
      this.scene.remove(this.figure.group);
      disposeAvatar(this.figure);
    }
    this.figure = buildAvatar(a);
    this.figure.group.scale.setScalar(1.75);
    this.figure.group.visible = this.thirdPerson;
    this.scene.add(this.figure.group);
  }

  private buildHand(): void {
    // Drawn on top of everything and without fog, so the arm never sinks into the ground. Marked transparent
    // so that it is drawn in the last pass, after the bedding lines, which are transparent too.
    const part = (w: number, h: number, d: number, colour: THREE.ColorRepresentation, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: colour, depthTest: false, depthWrite: false, fog: false, transparent: true }));
      mesh.position.set(x, y, z);
      mesh.renderOrder = 10;
      this.hand.add(mesh);
      return mesh;
    };
    const a = this.avatar;
    const sleeve = a ? (a.vest ? GEAR_COLOURS[a.vestColour]! : a.shirtColour) : 0x3d6b8f;
    part(0.13, 0.13, 0.36, sleeve, 0, -0.03, 0.2); // sleeve
    part(0.115, 0.115, 0.18, a ? SKIN_TONES[a.skin]! : 0xc9956b, 0, -0.01, -0.04); // forearm and fist
    // The hammer, drawn like the arm: on top of everything.
    const tool = new THREE.Group();
    tool.position.set(0, 0, -0.11);
    hammerParts(tool, a?.hammer ?? "punta");
    tool.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const m = o.material as THREE.MeshLambertMaterial;
      o.material = new THREE.MeshLambertMaterial({ color: m.color, depthTest: false, depthWrite: false, fog: false, transparent: true });
      m.dispose();
      o.renderOrder = 10;
    });
    this.hand.add(tool);
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
    this.flightHeight = height;
    const distance = VIEW_DISTANCE_M + height * 8;
    if (Math.abs(distance - this.viewDistance) < 20) return;
    this.viewDistance = distance;
    const look = ENVIRONMENT_LOOK[this.grid?.environment ?? "temperate"];
    const fog = this.scene.fog as THREE.Fog;
    fog.near = distance * look.fogNear;
    fog.far = distance * look.fogFar;
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
    const from = this.thirdPerson && this.figure
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
    this.hand.visible = !this.thirdPerson;
    if (this.figure) {
      this.figure.group.visible = this.thirdPerson;
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
    const look = ENVIRONMENT_LOOK[grid.environment];
    (this.scene.background as THREE.Color).setHex(look.sky);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.setHex(look.sky);
    fog.near = VIEW_DISTANCE_M * look.fogNear;
    fog.far = VIEW_DISTANCE_M * look.fogFar;
    this.camera.far = Math.max(this.camera.far, fog.far * 1.1);
    this.camera.updateProjectionMatrix();
    if (grid.environment === "forest") this.plantTrees(grid);
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
    this.camera.rotation.set((pitch * Math.PI) / 180, (-heading * Math.PI) / 180, 0);
    this.camera.position.set(x, eye, -y);
    if (this.figure) {
      // The figure stands where the student stands; eye is EYE_HEIGHT (3.2 m) above the feet, plus any flight.
      this.figure.group.rotation.order = "YXZ"; // turn to the heading first, then lean
      this.figure.group.rotation.y = (-heading * Math.PI) / 180;
      if (this.flightHeight > 1.5) {
        // Lying flat, the figure's middle sits where the eyes would be, so the camera looks along its back.
        const h = (heading * Math.PI) / 180;
        this.figure.group.position.set(x - Math.sin(h) * 1.6, eye - 1.2, -y + Math.cos(h) * 1.6);
      } else this.figure.group.position.set(x, eye - 3.2, -y);
    }
    if (this.thirdPerson && this.figure && this.flightHeight > 1.5) {
      // In flight the camera follows from above and to one side, so that the outstretched figure reads as flying.
      const h = (heading * Math.PI) / 180;
      const fwd = new THREE.Vector3(Math.sin(h), 0, -Math.cos(h)), right = new THREE.Vector3(Math.cos(h), 0, Math.sin(h));
      const centre = this.figure.group.position.clone().add(new THREE.Vector3(0, 0.6, 0)).addScaledVector(fwd, 1.4);
      this.camera.position.copy(centre).addScaledVector(fwd, -8.5).addScaledVector(right, 4.5).add(new THREE.Vector3(0, 4.5 + Math.sin((pitch * Math.PI) / 180) * 3, 0));
      this.camera.lookAt(centre.clone().addScaledVector(fwd, 6));
    } else if (this.thirdPerson) {
      // Behind and a little above, looking the same way, kept above the ground.
      const back = this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(-9);
      this.camera.position.add(back).add(new THREE.Vector3(0, 1.5, 0));
      if (this.grid) {
        const p = this.camera.position;
        const floor = heightAt(this.grid, p.x, -p.z) + 1.2;
        if (p.y < floor) p.y = floor;
      }
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
