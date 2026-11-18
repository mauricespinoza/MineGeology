// The field geologist as a blocky figure, for the preview, the third-person view and the hand in first person.
// Units are metres, with the feet at the origin and the figure facing -Z, the way the camera looks.

import * as THREE from "three";
import { type Avatar, GEAR_COLOURS, HAIR_COLOURS, SKIN_TONES } from "../state/avatar";

const TROUSERS = 0x6b5a43, BOOTS = 0x3b2a1e, PACK = 0x4f5d3a, STEEL = 0x6f7377, HANDLE = 0x8b5a2b, STRIPE = 0xd8dde0;

export interface AvatarModel {
  group: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
}

function box(parent: THREE.Object3D, w: number, h: number, d: number, colour: THREE.ColorRepresentation, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: colour }));
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/** The hammer, along +Y from the hand, with its head at the top. */
export function hammerParts(parent: THREE.Object3D, kind: Avatar["hammer"], scale = 1): void {
  const s = scale;
  box(parent, 0.035 * s, 0.36 * s, 0.035 * s, HANDLE, 0, 0.13 * s, 0);
  box(parent, 0.2 * s, 0.065 * s, 0.065 * s, STEEL, 0.02 * s, 0.31 * s, 0);
  if (kind === "punta") box(parent, 0.06 * s, 0.045 * s, 0.045 * s, 0x55595d, -0.11 * s, 0.31 * s, 0); // the pick
  else box(parent, 0.05 * s, 0.075 * s, 0.012 * s, 0x55595d, -0.1 * s, 0.31 * s, 0); // the chisel edge
}

export function buildAvatar(a: Avatar): AvatarModel {
  const group = new THREE.Group();
  const skin = SKIN_TONES[a.skin]!, hair = HAIR_COLOURS[a.hair]!;
  const female = a.figure === "femenino";
  const shoulders = female ? 0.4 : 0.46;

  const leg = (side: number) => {
    const g = new THREE.Group();
    g.position.set(side * 0.1, 0.82, 0);
    box(g, 0.17, 0.7, 0.2, TROUSERS, 0, -0.35, 0);
    box(g, 0.19, 0.13, 0.26, BOOTS, 0, -0.76, -0.03);
    group.add(g);
    return g;
  };
  const legL = leg(-1), legR = leg(1);

  // Body: shirt, and the field vest with pockets and reflective stripes over it.
  box(group, shoulders, 0.64, 0.26, a.shirtColour, 0, 1.13, 0);
  if (female) box(group, shoulders + 0.04, 0.12, 0.27, a.shirtColour, 0, 0.86, 0); // a little wider at the hips
  if (a.vest) {
    const vest = GEAR_COLOURS[a.vestColour]!;
    box(group, shoulders + 0.03, 0.5, 0.28, vest, 0, 1.18, 0);
    for (const x of [-0.11, 0.11]) box(group, 0.12, 0.1, 0.02, new THREE.Color(vest).multiplyScalar(0.8), x, 1.05, -0.15); // pockets
    box(group, shoulders + 0.035, 0.03, 0.285, STRIPE, 0, 1.0, 0);
    box(group, shoulders + 0.035, 0.03, 0.285, STRIPE, 0, 1.3, 0);
  }
  if (a.lens) {
    box(group, 0.012, 0.16, 0.01, 0x222222, 0, 1.38, -0.16); // the cord
    box(group, 0.05, 0.05, 0.03, 0xc9ccd0, 0, 1.28, -0.165);
  }
  if (a.backpack) {
    box(group, 0.36, 0.46, 0.18, PACK, 0, 1.16, 0.22);
    box(group, 0.3, 0.1, 0.12, new THREE.Color(PACK).multiplyScalar(0.8), 0, 1.44, 0.22); // the rolled jacket on top
  }

  const arm = (side: number) => {
    const g = new THREE.Group();
    g.position.set(side * (shoulders / 2 + 0.075), 1.42, 0);
    box(g, 0.14, 0.32, 0.16, a.vest ? GEAR_COLOURS[a.vestColour]! : a.shirtColour, 0, -0.14, 0);
    box(g, 0.13, 0.32, 0.15, skin, 0, -0.44, 0);
    group.add(g);
    return g;
  };
  const armL = arm(-1), armR = arm(1);
  const grip = new THREE.Group();
  grip.position.set(0, -0.58, -0.04);
  grip.rotation.x = -Math.PI / 2.4; // the hammer points forward, ready
  hammerParts(grip, a.hammer, 1.25);
  armR.add(grip);

  // Head, face and hair.
  box(group, 0.07, 0.06, 0.07, skin, 0, 1.48, 0); // neck
  box(group, 0.3, 0.3, 0.3, skin, 0, 1.66, 0);
  for (const x of [-0.065, 0.065]) box(group, 0.045, 0.045, 0.01, 0x1c1c1c, x, 1.69, -0.152);
  box(group, 0.09, 0.02, 0.01, new THREE.Color(skin).multiplyScalar(0.7), 0, 1.6, -0.152);
  box(group, 0.32, 0.07, 0.32, hair, 0, 1.815, 0); // top
  box(group, 0.32, female ? 0.34 : 0.16, 0.05, hair, 0, female ? 1.66 : 1.73, 0.15); // back
  for (const x of [-0.155, 0.155]) box(group, 0.03, female ? 0.26 : 0.1, 0.2, hair, x, female ? 1.7 : 1.76, 0.05); // sides
  if (female) box(group, 0.1, 0.24, 0.08, hair, 0, 1.56, 0.2); // ponytail

  const hatColour = GEAR_COLOURS[a.hatColour]!;
  if (a.hat === "casco") {
    box(group, 0.36, 0.13, 0.36, hatColour, 0, 1.88, 0);
    box(group, 0.28, 0.05, 0.3, hatColour, 0, 1.96, 0);
    box(group, 0.38, 0.025, 0.12, hatColour, 0, 1.82, -0.2); // the peak
  } else if (a.hat === "sombrero") {
    box(group, 0.62, 0.025, 0.62, hatColour, 0, 1.84, 0);
    box(group, 0.32, 0.14, 0.32, hatColour, 0, 1.92, 0);
    box(group, 0.33, 0.03, 0.33, 0x3b2a1e, 0, 1.87, 0); // the band
  } else if (a.hat === "jockey") {
    box(group, 0.33, 0.1, 0.33, hatColour, 0, 1.87, 0);
    box(group, 0.3, 0.025, 0.17, hatColour, 0, 1.83, -0.23); // the visor
  }
  return { group, armL, armR, legL, legR };
}

/** Swings arms and legs while walking; `phase` grows with the distance walked. */
export function animateAvatar(m: AvatarModel, phase: number, walking: boolean): void {
  const s = walking ? Math.sin(phase) * 0.55 : 0;
  m.legL.rotation.x = s;
  m.legR.rotation.x = -s;
  m.armL.rotation.x = -s * 0.8;
  m.armR.rotation.x = s * 0.5;
}

/** Frees the geometries and materials of a figure that is no longer shown. */
export function disposeAvatar(m: AvatarModel): void {
  m.group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
}
