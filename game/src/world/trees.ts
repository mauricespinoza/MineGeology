// Trees, still blocky but closer to the real woods of each environment.
//
// Forest (the Coastal Cordillera near Concepción): rectangular stands of planted radiata pine and eucalyptus,
// in rows, between patches of mixed native forest with broad, lumpy crowns. Temperate land (central Chile):
// a few sclerophyllous trees (quillay, peumo, litre) and small umbrella-shaped espinos among the shrubs.
// Desert: none.
//
// Each tree is made of a few boxes with shaded vertex colours (darker inside and below the crown), turned,
// leaned and tinted on its own, and it sways a little in the wind. Near the student the trees are drawn in
// full; farther away as a trunk and one crown box, so that tens of thousands of trees stay cheap.

import * as THREE from "three";
import { type Grid, cellHash, heightAt } from "./blocks";
import { type Species, stand, treeAt } from "./treeplaces";

export type { Species };
const SPECIES: Species[] = ["pine", "eucalyptus", "native", "sclerophyll", "espino"];

export interface TreeSpot {
  x: number;
  y: number;
  z: number;
  species: Species;
  /** Height in metres. */
  height: number;
  /** Turn about the vertical and lean, in radians. */
  turn: number;
  leanX: number;
  leanZ: number;
  /** Multiplies the vertex colours: a little variety from tree to tree. */
  tint: [number, number, number];
}

/** Trees are drawn in full within this distance of the student; beyond it, simply. */
export const NEAR_TREES_M = 240;
/** The near set is refreshed when the student has moved this far. */
const REFRESH_M = 35;

/** Every tree of the land, the same each time for the same scenario. */
export function treeSpots(grid: Grid): TreeSpot[] {
  const spots: TreeSpot[] = [];
  const h = (ix: number, iy: number, salt: number) => cellHash(ix, iy, salt);
  for (let iy = 0; iy < grid.ny; iy++) {
    for (let ix = 0; ix < grid.nx; ix++) {
      if (!treeAt(grid, ix, iy)) continue;
      let species: Species;
      if (grid.environment === "forest") {
        species = stand(ix, iy);
        if (species === "native" && h(ix, iy, 40) < 0.2) species = "sclerophyll";
      } else species = h(ix, iy, 40) < 0.72 ? "sclerophyll" : "espino";
      const planted = species === "pine" || species === "eucalyptus";
      // Plantations stand in rows; wild trees anywhere in the cell.
      const jx = planted ? 0.5 + 0.08 * (h(ix, iy, 8) - 0.5) : 0.15 + 0.7 * h(ix, iy, 8);
      const jy = planted ? 0.5 + 0.08 * (h(ix, iy, 9) - 0.5) : 0.15 + 0.7 * h(ix, iy, 9);
      const x = (ix + jx) * grid.cell, y = (iy + jy) * grid.cell;
      const range: Record<Species, [number, number]> = { pine: [17, 24], eucalyptus: [21, 29], native: [11, 18], sclerophyll: [5.5, 9.5], espino: [3, 5] };
      const [lo, hi] = range[species];
      const r = h(ix, iy, 10);
      const lean = planted ? 0.03 : species === "espino" ? 0.12 : 0.08;
      const shade = 0.82 + 0.3 * h(ix, iy, 12);
      const warm = 0.94 + 0.12 * h(ix, iy, 13);
      spots.push({
        x,
        y,
        z: heightAt(grid, x, y),
        species,
        height: lo + (hi - lo) * r,
        turn: 2 * Math.PI * h(ix, iy, 11),
        leanX: lean * (h(ix, iy, 14) - 0.5) * 2,
        leanZ: lean * (h(ix, iy, 15) - 0.5) * 2,
        tint: [shade * warm, shade, shade * (2 - warm)],
      });
    }
  }
  return spots;
}

// ---- geometry: boxes with shaded vertex colours, merged into one geometry per species ----

interface Part {
  /** Size and centre, in units of the tree's height (x, z across; y up from the foot). */
  size: [number, number, number];
  at: [number, number, number];
  colour: number;
  /** Turn of the box about the vertical, and tilt about x, in radians. */
  turn?: number;
  tilt?: number;
}

function merge(parts: Part[]): THREE.BufferGeometry {
  const positions: number[] = [], normals: number[] = [], colours: number[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), n = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  const c = new THREE.Color();
  for (const p of parts) {
    const box = new THREE.BoxGeometry(...p.size).toNonIndexed();
    m.compose(new THREE.Vector3(...p.at), q.setFromEuler(e.set(p.tilt ?? 0, p.turn ?? 0, 0)), new THREE.Vector3(1, 1, 1));
    nm.getNormalMatrix(m);
    const pos = box.getAttribute("position"), nor = box.getAttribute("normal");
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      positions.push(v.x, v.y, v.z);
      normals.push(n.x, n.y, n.z);
      // Darker below and inside the crown, lighter on top: a cheap ambient occlusion.
      const local = pos.getY(i) / p.size[1] + 0.5; // 0 at the bottom of the box, 1 at its top
      const f = 0.72 + 0.34 * local + (n.y > 0.5 ? 0.08 : 0);
      c.setHex(p.colour).multiplyScalar(f);
      colours.push(c.r, c.g, c.b);
    }
    box.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  return g;
}

/** The tree drawn in full, in units of its height. */
function detailed(species: Species): THREE.BufferGeometry {
  switch (species) {
    case "pine": {
      // A straight, bare trunk and a narrow crown of tiers, as in a plantation.
      const bark = 0x5b4634, needles = 0x2d4a30, parts: Part[] = [{ size: [0.035, 0.62, 0.035], at: [0, 0.31, 0], colour: bark }];
      const tiers = [[0.3, 0.5], [0.27, 0.62], [0.22, 0.73], [0.16, 0.83], [0.09, 0.93]] as const;
      tiers.forEach(([w, y], i) => parts.push({ size: [w, 0.13, w], at: [0, y, 0], colour: i % 2 ? 0x31503a : needles, turn: i % 2 ? Math.PI / 4 : 0 }));
      return merge(parts);
    }
    case "eucalyptus": {
      // A tall, pale trunk shedding its bark, and a high, open crown of a few hanging clumps.
      const leaves = 0x6b8668;
      return merge([
        { size: [0.03, 0.78, 0.03], at: [0, 0.39, 0], colour: 0xb9ae99 },
        { size: [0.032, 0.18, 0.032], at: [0, 0.2, 0], colour: 0x8c7a62 },
        { size: [0.018, 0.22, 0.018], at: [0.05, 0.74, 0], colour: 0xb9ae99, tilt: 0, turn: 0 },
        { size: [0.16, 0.2, 0.13], at: [0.06, 0.86, 0.02], colour: leaves },
        { size: [0.12, 0.17, 0.12], at: [-0.07, 0.8, -0.03], colour: 0x627d60 },
        { size: [0.1, 0.14, 0.11], at: [0.01, 0.94, -0.05], colour: 0x7a9575 },
        { size: [0.09, 0.12, 0.08], at: [-0.03, 0.7, 0.07], colour: leaves },
      ]);
    }
    case "native": {
      // Mixed evergreen forest: a thick trunk forking into a broad, lumpy crown.
      const bark = 0x4f3b2a, leaf = 0x3e6a33;
      return merge([
        { size: [0.06, 0.5, 0.06], at: [0, 0.25, 0], colour: bark },
        { size: [0.035, 0.22, 0.035], at: [0.06, 0.52, 0], colour: bark, turn: 0, tilt: 0 },
        { size: [0.03, 0.2, 0.03], at: [-0.05, 0.54, 0.03], colour: bark },
        { size: [0.46, 0.28, 0.44], at: [0, 0.66, 0], colour: leaf },
        { size: [0.3, 0.24, 0.28], at: [0.2, 0.62, 0.1], colour: 0x375f2e },
        { size: [0.28, 0.22, 0.3], at: [-0.19, 0.6, -0.08], colour: 0x37602f },
        { size: [0.26, 0.22, 0.24], at: [0.05, 0.6, -0.21], colour: 0x416e35 },
        { size: [0.3, 0.2, 0.3], at: [-0.04, 0.84, 0.03], colour: 0x4c7c3e },
        { size: [0.16, 0.12, 0.16], at: [0.1, 0.95, -0.04], colour: 0x578a46 },
      ]);
    }
    case "sclerophyll": {
      // Quillay, peumo or litre: a short trunk that splits, and a wide, dense, dark crown.
      const bark = 0x5a4a3a, leaf = 0x4a5c35;
      return merge([
        { size: [0.09, 0.36, 0.09], at: [0, 0.18, 0], colour: bark },
        { size: [0.06, 0.3, 0.06], at: [0.08, 0.42, 0], colour: bark, tilt: 0 },
        { size: [0.05, 0.28, 0.05], at: [-0.07, 0.42, 0.03], colour: bark },
        { size: [0.8, 0.32, 0.72], at: [0, 0.62, 0], colour: leaf },
        { size: [0.5, 0.28, 0.46], at: [0.32, 0.56, 0.12], colour: 0x435530 },
        { size: [0.46, 0.26, 0.5], at: [-0.3, 0.58, -0.14], colour: 0x45572f },
        { size: [0.52, 0.22, 0.5], at: [0.02, 0.84, 0.02], colour: 0x56693c },
      ]);
    }
    case "espino": {
      // A small tree with a crooked trunk and a flat, umbrella-shaped crown.
      const bark = 0x3d3026;
      return merge([
        { size: [0.08, 0.6, 0.08], at: [0.03, 0.3, 0], colour: bark, tilt: 0.12 },
        { size: [0.06, 0.3, 0.06], at: [-0.1, 0.62, 0], colour: bark, tilt: -0.5 },
        { size: [1.1, 0.16, 1.0], at: [0, 0.8, 0], colour: 0x6b7a3c },
        { size: [0.7, 0.12, 0.7], at: [0.08, 0.92, -0.05], colour: 0x76853f, turn: Math.PI / 4 },
      ]);
    }
  }
}

/** The tree from afar: a trunk and one crown box, in units of height and crown width. */
function simple(): THREE.BufferGeometry {
  return merge([
    { size: [0.14, 0.5, 0.14], at: [0, 0.25, 0], colour: 0x6b5a48 },
    { size: [1, 0.62, 1], at: [0, 0.69, 0], colour: 0xffffff },
  ]);
}

/** Crown width over height, and the colour of a distant crown, by species. */
const FAR: Record<Species, { width: number; colour: number }> = {
  pine: { width: 0.26, colour: 0x2f4c32 },
  eucalyptus: { width: 0.18, colour: 0x6b8668 },
  native: { width: 0.5, colour: 0x3f6b34 },
  sclerophyll: { width: 0.85, colour: 0x4a5c35 },
  espino: { width: 1.0, colour: 0x6b7a3c },
};

/** A material that sways a little in the wind: more toward the top of the tree, out of step from tree to tree. */
function swayingMaterial(time: { value: number }): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float phase = instanceMatrix[3].x * 0.071 + instanceMatrix[3].z * 0.053;
          float bend = max(transformed.y - 0.35, 0.0);
          float gust = 0.6 + 0.4 * sin(uTime * 0.37 + phase * 0.3);
          transformed.x += bend * bend * 0.035 * gust * sin(uTime * 1.6 + phase);
          transformed.z += bend * bend * 0.025 * gust * sin(uTime * 1.25 + phase * 1.3);
        #endif`,
      );
  };
  return material;
}

export class Forest {
  readonly group = new THREE.Group();
  private readonly time = { value: 0 };
  private readonly far: THREE.InstancedMesh;
  private readonly near = new Map<Species, THREE.InstancedMesh>();
  private readonly farMatrices: THREE.Matrix4[] = [];
  private readonly nearSet = new Set<number>();
  private last: { x: number; y: number } | null = null;
  private static readonly ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(readonly spots: TreeSpot[]) {
    const material = swayingMaterial(this.time);
    this.far = new THREE.InstancedMesh(simple(), material, Math.max(spots.length, 1));
    this.far.count = spots.length;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), colour = new THREE.Color();
    spots.forEach((s, i) => {
      const w = FAR[s.species].width * s.height;
      m.compose(new THREE.Vector3(s.x, s.z, -s.y), q.setFromEuler(e.set(s.leanX, s.turn, s.leanZ)), new THREE.Vector3(w, s.height, w));
      this.farMatrices.push(m.clone());
      this.far.setMatrixAt(i, m);
      colour.setHex(FAR[s.species].colour);
      this.far.setColorAt(i, colour.setRGB(colour.r * s.tint[0], colour.g * s.tint[1], colour.b * s.tint[2]));
    });
    this.group.add(this.far);
    for (const species of SPECIES) {
      const total = spots.filter((s) => s.species === species).length;
      if (!total) continue;
      const mesh = new THREE.InstancedMesh(detailed(species), material, total);
      mesh.count = 0;
      mesh.frustumCulled = false; // the instances move with the student; the mesh's own bounds would not
      this.near.set(species, mesh);
      this.group.add(mesh);
    }
    this.far.frustumCulled = false;
  }

  /** How many trees are drawn in full now. */
  get nearCount(): number {
    return this.nearSet.size;
  }

  /** Draws the trees around x, y in full and the rest simply; cheap to call every frame. */
  update(x: number, y: number): void {
    if (this.last && Math.hypot(x - this.last.x, y - this.last.y) < REFRESH_M) return;
    this.last = { x, y };
    const counts = new Map<Species, number>();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), colour = new THREE.Color();
    const r2 = NEAR_TREES_M * NEAR_TREES_M;
    this.spots.forEach((s, i) => {
      const near = (s.x - x) ** 2 + (s.y - y) ** 2 < r2;
      if (near !== this.nearSet.has(i)) {
        this.far.setMatrixAt(i, near ? Forest.ZERO : this.farMatrices[i]!);
        if (near) this.nearSet.add(i);
        else this.nearSet.delete(i);
      }
      if (!near) return;
      const mesh = this.near.get(s.species)!;
      const k = counts.get(s.species) ?? 0;
      counts.set(s.species, k + 1);
      m.compose(new THREE.Vector3(s.x, s.z, -s.y), q.setFromEuler(e.set(s.leanX, s.turn, s.leanZ)), new THREE.Vector3(s.height, s.height, s.height));
      mesh.setMatrixAt(k, m);
      mesh.setColorAt(k, colour.setRGB(s.tint[0], s.tint[1], s.tint[2]));
    });
    this.far.instanceMatrix.needsUpdate = true;
    for (const [species, mesh] of this.near) {
      mesh.count = counts.get(species) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** The wind. */
  animate(dt: number): void {
    this.time.value += dt;
  }
}
