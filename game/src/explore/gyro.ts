// Looking around by turning the tablet or phone itself, with its gyroscope, as through a window onto the field.
//
// The device orientation (alpha, beta, gamma) is turned into the direction the back camera faces, allowing for how
// the screen is rotated. Only the change since the last reading is used: it is added to the view like a drag, so the
// stick and the finger still turn the view as well, and switching it on does not jump the view.

import * as THREE from "three";

const DEG = Math.PI / 180;

/** Whether this device may have a gyroscope worth offering: a touch screen with orientation events. */
export function gyroAvailable(): boolean {
  return typeof window !== "undefined" && "DeviceOrientationEvent" in window && matchMedia("(pointer: coarse)").matches;
}

/** Direction the screen faces for a device orientation, as heading (degrees clockwise from north) and pitch. */
export function screenDirection(alpha: number, beta: number, gamma: number, screenAngle: number): { heading: number; pitch: number } {
  // As in three.js's former DeviceOrientationControls: the device frame, turned so that the camera looks out of the
  // back of the screen, then turned by the screen's own rotation.
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(beta * DEG, alpha * DEG, -gamma * DEG, "YXZ"));
  q.multiply(new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2)); // look out of the back, not the top
  q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -screenAngle * DEG));
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  // Alpha grows counter-clockwise seen from above, so a heading measured clockwise is its negative.
  const heading = ((-Math.atan2(-forward.x, -forward.z) / DEG) % 360 + 360) % 360;
  const pitch = Math.asin(Math.max(-1, Math.min(1, forward.y))) / DEG;
  return { heading, pitch };
}

export class Gyro {
  enabled = false;
  private last: { heading: number; pitch: number } | null = null;
  private turn = 0;
  private tilt = 0;
  private readonly onOrientation = (e: DeviceOrientationEvent) => {
    if (e.alpha === null || e.beta === null || e.gamma === null) return;
    const angle = screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
    const now = screenDirection(e.alpha, e.beta, e.gamma, angle);
    const last = this.last;
    this.last = now;
    if (!last) return;
    // Straight up or down the heading is undefined and swings wildly: only the tilt counts there.
    if (Math.abs(now.pitch) < 75) this.turn += ((now.heading - last.heading + 540) % 360) - 180;
    this.tilt += now.pitch - last.pitch;
  };

  /**
   * Switches the gyroscope on. Must be called from a tap: iOS asks the student for permission then. Resolves to
   * false when it is refused or the device sends no readings.
   */
  async enable(): Promise<boolean> {
    const request = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
    if (request) {
      try {
        if ((await request()) !== "granted") return false;
      } catch {
        return false;
      }
    }
    this.last = null;
    this.turn = this.tilt = 0;
    window.addEventListener("deviceorientation", this.onOrientation);
    // A device without a gyroscope sends nothing, or only nulls.
    const ok = await new Promise<boolean>((resolve) => {
      const started = performance.now();
      const check = () => (this.last ? resolve(true) : performance.now() - started > 1500 ? resolve(false) : setTimeout(check, 100));
      check();
    });
    if (!ok) window.removeEventListener("deviceorientation", this.onOrientation);
    this.enabled = ok;
    return ok;
  }

  disable(): void {
    this.enabled = false;
    this.last = null;
    window.removeEventListener("deviceorientation", this.onOrientation);
  }

  /** How far the device turned since the last call, in degrees of heading and pitch. */
  take(): { heading: number; pitch: number } {
    const out = { heading: this.turn, pitch: this.tilt };
    this.turn = this.tilt = 0;
    return out;
  }
}
