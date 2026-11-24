// Clouds: flat, blocky clouds high over the area, drifting slowly with the wind.
//
// Each cloud is a patch of cells on a coarse grid, one box per cell, as in a block game. The clouds lie on a
// square tile that is wrapped about the camera, so the sky never runs out however far the student walks or
// flies; the wrap happens far out in the haze, where the fog has already turned a cloud the colour of the sky.
// Desert skies have few clouds, forest skies many and greyer ones.

import * as THREE from "three";
import { generator, hash } from "../tools/random";
import type { Environment, Grid } from "./blocks";

/** Side of one cloud cell and thickness of a cloud, in metres. */
export const CLOUD_CELL_M = 24;
const CLOUD_THICKNESS_M = 14;
/** Height of the cloud base over the highest ground of the area. */
export const CLOUD_BASE_M = 260;
/** Side of the tile of sky wrapped about the camera, in metres. */
export const CLOUD_TILE_M = 4200;
/** Wind speed in m/s: slow enough that the clouds only creep across the sky. */
export const WIND_M_S = 3.5;

const SKY_LOOK: Record<Environment, { count: number; colour: number; size: number }> = {
  temperate: { count: 60, colour: 0xffffff, size: 1 },
  desert: { count: 18, colour: 0xfbfaf6, size: 0.75 },
  forest: { count: 95, colour: 0xe6e9ec, size: 1.2 },
};

export interface CloudShape {
  /** Position of the cloud on the tile, in metres from its corner (x east, y north). */
  x: number;
  y: number;
  /** Height of the cloud base, in metres. */
  z: number;
  /** Cells of the cloud, in cell units from its centre. */
  cells: [number, number][];
}

/** Shapes of the clouds over a grid: a few overlapping ellipses of cells each, the same every time. */
export function cloudShapes(grid: Grid, seed = hash("clouds", grid.nx, grid.ny, grid.cell)): CloudShape[] {
  const random = generator(seed);
  const look = SKY_LOOK[grid.environment];
  let top = -Infinity;
  for (const e of grid.elevation) top = Math.max(top, e);
  const shapes: CloudShape[] = [];
  for (let c = 0; c < look.count; c++) {
    const cells = new Set<string>();
    const lobes = 1 + Math.floor(random() * 4);
    for (let l = 0; l < lobes; l++) {
      const ox = (random() - 0.5) * 6, oy = (random() - 0.5) * 4;
      const rx = (1.5 + random() * 4) * look.size, ry = (1 + random() * 2.5) * look.size;
      for (let i = Math.floor(ox - rx); i <= Math.ceil(ox + rx); i++)
        for (let j = Math.floor(oy - ry); j <= Math.ceil(oy + ry); j++) {
          const d = ((i - ox) / rx) ** 2 + ((j - oy) / ry) ** 2;
          if (d <= 1 - random() * 0.35) cells.add(`${i},${j}`);
        }
    }
    if (!cells.size) cells.add("0,0");
    shapes.push({
      x: random() * CLOUD_TILE_M,
      y: random() * CLOUD_TILE_M,
      z: top + CLOUD_BASE_M + random() * 60,
      cells: [...cells].map((k) => k.split(",").map(Number) as [number, number]),
    });
  }
  return shapes;
}

/** Wraps v into [-half, half) of a tile of side `tile`. */
export function wrap(v: number, tile: number): number {
  return ((((v + tile / 2) % tile) + tile) % tile) - tile / 2;
}

export class Clouds {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly shapes: CloudShape[];
  /** How far the wind has carried the clouds, in metres east and north. */
  private driftX = 0;
  private driftY = 0;
  private readonly windX: number;
  private readonly windY: number;
  private readonly matrix = new THREE.Matrix4();

  constructor(grid: Grid) {
    this.shapes = cloudShapes(grid);
    const look = SKY_LOOK[grid.environment];
    // A prevailing wind from the west, turned a little by the scenario.
    const turn = ((hash("wind", grid.nx, grid.ny) % 1000) / 1000 - 0.5) * 1.2;
    this.windX = Math.cos(turn) * WIND_M_S;
    this.windY = Math.sin(turn) * WIND_M_S;
    const total = this.shapes.reduce((n, s) => n + s.cells.length, 0);
    const material = new THREE.MeshLambertMaterial({ color: look.colour, emissive: look.colour, emissiveIntensity: 0.6 });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(CLOUD_CELL_M, CLOUD_THICKNESS_M, CLOUD_CELL_M), material, Math.max(total, 1));
    this.mesh.count = total;
    this.mesh.frustumCulled = false; // the instances move about the camera; the box of the first frame is wrong later
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.mesh);
  }

  /** Moves the clouds with the wind and keeps the tile about the camera. Call once a frame. */
  animate(dt: number, camera: THREE.Camera): void {
    this.driftX += this.windX * dt;
    this.driftY += this.windY * dt;
    const camX = camera.position.x, camY = -camera.position.z;
    let k = 0;
    for (const s of this.shapes) {
      const x = camX + wrap(s.x + this.driftX - camX, CLOUD_TILE_M);
      const y = camY + wrap(s.y + this.driftY - camY, CLOUD_TILE_M);
      for (const [i, j] of s.cells) {
        this.matrix.makeTranslation(x + i * CLOUD_CELL_M, s.z + CLOUD_THICKNESS_M / 2, -(y + j * CLOUD_CELL_M));
        this.mesh.setMatrixAt(k++, this.matrix);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
