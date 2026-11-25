// The sun: a square, blocky disc in the sky, with a soft glow, where the scene's light comes from.
//
// It stays at a fixed distance from the camera in the direction of the sunlight, so it never comes nearer however
// far the student walks. It is drawn without fog, so the haze does not wash it out, but the clouds and the hills
// still pass in front of it.

import * as THREE from "three";

/** Direction to the sun in scene coordinates (x east, y up, z south): high in the west-south-west, where the light comes from. */
export const SUN_DIRECTION = new THREE.Vector3(-0.6, 1, 0.35).normalize();
/** Distance of the sun from the camera, in metres: beyond the clouds, inside the far plane. */
export const SUN_DISTANCE_M = 1100;
/** Width of the disc and of its glow, in metres at SUN_DISTANCE_M. */
const DISC_M = 90;
const GLOW_M = 320;

/** A radial glow, white in the middle and clear at the edge, drawn on a small canvas. */
function glowTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,248,220,0.85)");
  gradient.addColorStop(0.35, "rgba(255,240,200,0.3)");
  gradient.addColorStop(1, "rgba(255,240,200,0)");
  g.fillStyle = gradient;
  g.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class Sun {
  readonly group = new THREE.Group();

  constructor() {
    const disc = new THREE.Mesh(
      new THREE.PlaneGeometry(DISC_M, DISC_M),
      new THREE.MeshBasicMaterial({ color: 0xfff7d6, fog: false }),
    );
    const rim = new THREE.Mesh(
      new THREE.PlaneGeometry(DISC_M * 1.3, DISC_M * 1.3),
      new THREE.MeshBasicMaterial({ color: 0xffeeb0, fog: false, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    rim.position.z = -0.5;
    this.group.add(rim, disc);
    const texture = glowTexture();
    if (texture) {
      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(GLOW_M, GLOW_M),
        new THREE.MeshBasicMaterial({ map: texture, fog: false, transparent: true, depthWrite: false }),
      );
      glow.position.z = -1;
      this.group.add(glow);
    }
    this.group.renderOrder = -1;
  }

  /** Keeps the sun in its place in the sky, facing the camera. Call once a frame. */
  animate(camera: THREE.Camera): void {
    this.group.position.copy(camera.position).addScaledVector(SUN_DIRECTION, SUN_DISTANCE_M);
    this.group.lookAt(camera.position);
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material as THREE.MeshBasicMaterial;
        m.map?.dispose();
        m.dispose();
      }
    });
  }
}
