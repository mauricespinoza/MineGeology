// The field geologist as a blocky figure, for the preview, the third-person view and the hand in first person.
// Units are metres, with the feet at the origin and the figure facing -Z, the way the camera looks.

import * as THREE from "three";
import { type Avatar, GEAR_COLOURS, HAIR_COLOURS, SKIN_TONES } from "../state/avatar";
import { type SurfaceKind, surfaceMaterial } from "./materials";

const TROUSERS = 0x6b5a43, BOOTS = 0x3b2a1e, PACK = 0x4f5d3a, STRIPE = 0xd8dde0;
const STEEL = 0x8a9096, STEEL_DARK = 0x5c6268, FACE = 0xc4c9ce, GRIP = 0x2a5d9f, GRIP_DARK = 0x1c3f6e;

export interface AvatarModel {
  group: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
}

/** A box of the figure, `kind` its surface: the texture repeats about every 25 cm of cloth, or once on small parts. */
function box(parent: THREE.Object3D, w: number, h: number, d: number, colour: THREE.ColorRepresentation, x: number, y: number, z: number, kind: SurfaceKind = "cloth"): THREE.Mesh {
  const tile = kind === "skin" || kind === "plastic" ? 0.4 : 0.25;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), surfaceMaterial(kind, colour, Math.max(w, d) / tile, h / tile));
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/** Polished steel: a little shine, so the head of the hammer catches the sun. */
const steel = (colour: number) => surfaceMaterial("steel", colour);

/** A four-sided taper along -X from x0, `length` long, from a square of side `base` to `tip`; `flat` squeezes it in Z. */
function taper(parent: THREE.Object3D, x0: number, y: number, length: number, base: number, tip: number, flat: number, material: THREE.Material): THREE.Mesh {
  // A cylinder of four sides is a square frustum; turned 45° about its axis its faces line up with the head.
  const geometry = new THREE.CylinderGeometry(tip * Math.SQRT1_2, base * Math.SQRT1_2, length, 4, 1);
  geometry.rotateY(Math.PI / 4);
  geometry.rotateZ(Math.PI / 2); // the axis along X, the wide end at +X
  geometry.scale(1, 1, flat);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x0 - length / 2, y, 0);
  parent.add(mesh);
  return mesh;
}

/**
 * The geologist's hammer, along +Y from the hand, with its head at the top: a steel shaft with a rubber grip
 * where the hand holds it (around the origin), a square striking face on +X, and the pick or the chisel on -X.
 */
export function hammerParts(parent: THREE.Object3D, kind: Avatar["hammer"], scale = 1): void {
  const s = scale;
  const g = new THREE.Group();
  g.scale.setScalar(s);
  parent.add(g);
  // Grip: blue rubber with grooves, and a cap at the end.
  box(g, 0.036, 0.22, 0.03, GRIP, 0, 0.02, 0, "rubber");
  for (let i = 0; i < 8; i++) box(g, 0.038, 0.007, 0.032, GRIP_DARK, 0, -0.07 + i * 0.026, 0, "rubber");
  box(g, 0.044, 0.022, 0.038, GRIP_DARK, 0, -0.097, 0, "rubber");
  // Shaft: forged steel, flattened, a little thicker where it meets the head.
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.16, 0.02), steel(STEEL));
  shaft.position.set(0, 0.205, 0);
  g.add(shaft);
  const collar = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.04, 0.026), steel(STEEL));
  collar.position.set(0, 0.285, 0);
  g.add(collar);
  // Head: the eye block, the neck and round striking face on +X, the pick or the chisel on -X.
  const head = steel(STEEL_DARK);
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.055, 0.042), head);
  eye.position.set(0, 0.325, 0);
  g.add(eye);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.023, 0.05, 10), head);
  neck.rotation.z = Math.PI / 2;
  neck.position.set(0.055, 0.325, 0);
  g.add(neck);
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.024, 12), steel(FACE));
  face.rotation.z = Math.PI / 2;
  face.position.set(0.09, 0.325, 0);
  g.add(face);
  if (kind === "punta") {
    taper(g, -0.03, 0.325, 0.07, 0.042, 0.026, 1, head);
    taper(g, -0.1, 0.33, 0.06, 0.026, 0.006, 1, steel(FACE)); // the point, bright where it is sharpened
  } else {
    taper(g, -0.03, 0.325, 0.06, 0.042, 0.034, 0.8, head);
    taper(g, -0.09, 0.325, 0.055, 0.034, 0.006, 1.6, steel(FACE)); // the flat chisel edge, across the swing
  }
}

/**
 * A right hand closed around a handle that runs along Y through the origin: the back of the hand on +X, four
 * fingers wrapped round the front (-Z) the fingertips on the inside and the
 * thumb closed over the top.
 */
export function fistParts(parent: THREE.Object3D, skin: THREE.ColorRepresentation, scale = 1): void {
  const g = new THREE.Group();
  g.scale.setScalar(scale);
  parent.add(g);
  const shade = new THREE.Color(skin).multiplyScalar(0.88), knuckle = new THREE.Color(skin).multiplyScalar(1.06);
  box(g, 0.07, 0.096, 0.062, shade, 0.006, -0.004, -0.01, "skin"); // the closed hand, solid round the handle
  box(g, 0.036, 0.1, 0.07, skin, 0.036, -0.004, 0.006, "skin"); // back of the hand
  for (let i = 0; i < 4; i++) {
    const y = 0.033 - i * 0.024;
    box(g, 0.066, 0.023, 0.028, i % 2 ? shade : skin, 0.011, y, -0.031, "skin"); // finger, across the front of the handle
    box(g, 0.02, 0.021, 0.028, knuckle, 0.046, y, -0.03, "skin"); // knuckle
    box(g, 0.024, 0.023, 0.04, shade, -0.027, y, -0.006, "skin"); // fingertip, against the inside
  }
  const thumb = box(g, 0.026, 0.024, 0.062, shade, -0.006, 0.056, -0.012, "skin"); // thumb, closed over the top
  thumb.rotation.y = 0.35;
}

export function buildAvatar(a: Avatar): AvatarModel {
  const group = new THREE.Group();
  const skin = SKIN_TONES[a.skin]!, hair = HAIR_COLOURS[a.hair]!;
  const shoulders = 0.44;

  const leg = (side: number) => {
    const g = new THREE.Group();
    g.position.set(side * 0.1, 0.82, 0);
    box(g, 0.17, 0.7, 0.2, TROUSERS, 0, -0.35, 0, "denim");
    box(g, 0.19, 0.13, 0.26, BOOTS, 0, -0.76, -0.03, "leather");
    box(g, 0.2, 0.03, 0.27, 0x1e1712, 0, -0.815, -0.03, "rubber"); // the lugged sole
    group.add(g);
    return g;
  };
  const legL = leg(-1), legR = leg(1);

  // Body: shirt, and the field vest with pockets and reflective stripes over it.
  box(group, shoulders, 0.64, 0.26, a.shirtColour, 0, 1.13, 0);
  box(group, shoulders + 0.02, 0.06, 0.27, 0x4a3b2a, 0, 0.84, 0, "leather"); // belt
  box(group, 0.05, 0.04, 0.01, 0xb8a46a, 0, 0.84, -0.137, "steel"); // the buckle
  if (a.vest) {
    const vest = GEAR_COLOURS[a.vestColour]!;
    box(group, shoulders + 0.03, 0.5, 0.28, vest, 0, 1.18, 0, "canvas");
    for (const x of [-0.11, 0.11]) box(group, 0.12, 0.1, 0.02, new THREE.Color(vest).multiplyScalar(0.8), x, 1.05, -0.15, "canvas"); // pockets
    box(group, shoulders + 0.035, 0.03, 0.285, STRIPE, 0, 1.0, 0, "plastic");
    box(group, shoulders + 0.035, 0.03, 0.285, STRIPE, 0, 1.3, 0, "plastic");
  }
  if (a.lens) {
    box(group, 0.012, 0.16, 0.01, 0x222222, 0, 1.38, -0.16); // the cord
    box(group, 0.05, 0.05, 0.03, 0xc9ccd0, 0, 1.28, -0.165, "steel");
  }
  if (a.backpack) {
    box(group, 0.36, 0.46, 0.18, PACK, 0, 1.16, 0.22, "canvas");
    box(group, 0.3, 0.1, 0.12, new THREE.Color(PACK).multiplyScalar(0.8), 0, 1.44, 0.22, "cloth"); // the rolled jacket on top
    for (const x of [-0.12, 0.12]) box(group, 0.04, 0.4, 0.02, 0x2f2a22, x, 1.18, 0.315, "leather"); // the straps
  }

  const arm = (side: number) => {
    const g = new THREE.Group();
    g.position.set(side * (shoulders / 2 + 0.075), 1.42, 0);
    const sleeve = a.vest ? GEAR_COLOURS[a.vestColour]! : a.shirtColour;
    box(g, 0.14, 0.3, 0.16, sleeve, 0, -0.13, 0);
    box(g, 0.135, 0.05, 0.155, new THREE.Color(sleeve).multiplyScalar(0.8), 0, -0.29, 0); // cuff
    box(g, 0.12, 0.26, 0.135, skin, 0, -0.43, 0, "skin"); // forearm
    group.add(g);
    return g;
  };
  const armL = arm(-1), armR = arm(1);
  box(armL, 0.11, 0.09, 0.12, skin, 0, -0.6, 0, "skin"); // the free hand
  const grip = new THREE.Group();
  grip.position.set(0, -0.6, -0.02);
  grip.rotation.x = -Math.PI / 2.4; // the hammer points forward, ready
  fistParts(grip, skin, 1.3);
  hammerParts(grip, a.hammer, 1.25);
  armR.add(grip);

  // Head, face and hair.
  box(group, 0.07, 0.06, 0.07, skin, 0, 1.48, 0, "skin"); // neck
  box(group, 0.3, 0.3, 0.3, skin, 0, 1.66, 0, "skin");
  for (const x of [-0.065, 0.065]) {
    box(group, 0.05, 0.035, 0.008, 0xf2f0ea, x, 1.69, -0.151, "plastic"); // the white of the eye
    box(group, 0.024, 0.03, 0.01, 0x2a1d14, x, 1.69, -0.153, "plastic"); // the iris
    box(group, 0.06, 0.012, 0.01, new THREE.Color(hair).multiplyScalar(0.85), x, 1.725, -0.153, "hair"); // eyebrow
  }
  box(group, 0.04, 0.05, 0.03, new THREE.Color(skin).multiplyScalar(0.93), 0, 1.645, -0.16, "skin"); // nose
  box(group, 0.09, 0.02, 0.01, new THREE.Color(skin).multiplyScalar(0.7), 0, 1.6, -0.152, "skin");
  for (const x of [-0.157, 0.157]) box(group, 0.02, 0.06, 0.04, new THREE.Color(skin).multiplyScalar(0.92), x, 1.66, 0.0, "skin"); // ears
  box(group, 0.32, 0.07, 0.32, hair, 0, 1.815, 0, "hair"); // top
  box(group, 0.32, 0.2, 0.05, hair, 0, 1.71, 0.15, "hair"); // back
  for (const x of [-0.155, 0.155]) box(group, 0.03, 0.14, 0.2, hair, x, 1.74, 0.05, "hair"); // sides

  const hatColour = GEAR_COLOURS[a.hatColour]!;
  if (a.hat === "casco") {
    box(group, 0.36, 0.13, 0.36, hatColour, 0, 1.88, 0, "plastic");
    box(group, 0.28, 0.05, 0.3, hatColour, 0, 1.96, 0, "plastic");
    box(group, 0.06, 0.04, 0.32, new THREE.Color(hatColour).multiplyScalar(0.9), 0, 1.99, 0, "plastic"); // the ridge
    box(group, 0.38, 0.025, 0.12, hatColour, 0, 1.82, -0.2, "plastic"); // the peak
  } else if (a.hat === "sombrero") {
    box(group, 0.62, 0.025, 0.62, hatColour, 0, 1.84, 0, "felt");
    box(group, 0.32, 0.14, 0.32, hatColour, 0, 1.92, 0, "felt");
    box(group, 0.33, 0.03, 0.33, 0x3b2a1e, 0, 1.87, 0, "leather"); // the band
  } else if (a.hat === "jockey") {
    box(group, 0.33, 0.1, 0.33, hatColour, 0, 1.87, 0, "cloth");
    box(group, 0.3, 0.025, 0.17, hatColour, 0, 1.83, -0.23, "cloth"); // the visor
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
