// The spyglass view: the scene drawn small and blown up in big square pixels, seen through a round eyepiece.
// Outside the circle all is dark, the edge of the lens darkens and the brass rim shows in steps, as in pixel art.

import * as THREE from "three";

/** About how many big pixels span the shorter side of the screen. */
const PIXELS_ACROSS = 220;
/** Radius of the eyepiece, as a share of half the shorter side of the screen. */
export const SPYGLASS_RADIUS = 0.9;

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D view;
uniform vec2 size;      // drawing buffer, device pixels
uniform vec2 cells;     // the small picture, in big pixels
uniform float pixel;    // device pixels per big pixel
uniform float radius;   // eyepiece radius, big pixels
uniform float time;
varying vec2 vUv;

void main() {
  // Every device pixel takes the value of the big pixel it lies in: the circle, the rim and the view are all stepped.
  vec2 cell = floor(gl_FragCoord.xy / pixel);
  vec2 centre = floor(cells * 0.5);
  float d = length(cell + 0.5 - centre - 0.5);
  vec3 colour;
  if (d > radius + 3.0) {
    // The dark of the tube, a little lighter towards the eyepiece, in coarse dithered steps.
    float glow = clamp(1.0 - (d - radius) / (radius * 0.9), 0.0, 1.0);
    float dither = mod(cell.x + cell.y, 2.0) * 0.012;
    colour = vec3(0.016, 0.015, 0.013) + vec3(0.05, 0.042, 0.03) * floor(glow * 4.0) / 4.0 + dither;
  } else if (d > radius) {
    // The brass rim: three rings of big pixels, lit from the upper left.
    float ring = floor(d - radius);
    vec2 n = normalize(cell + 0.5 - centre);
    float light = 0.55 + 0.45 * dot(n, normalize(vec2(-0.6, 0.8)));
    vec3 brass = ring < 1.0 ? vec3(0.09, 0.07, 0.04) : ring < 2.0 ? vec3(0.55, 0.42, 0.18) : vec3(0.27, 0.2, 0.09);
    colour = brass * light;
  } else {
    vec2 uv = (cell + 0.5) / cells;
    colour = texture2D(view, uv).rgb;
    // The lens darkens towards its edge, in a few hard steps.
    float edge = d / radius;
    colour *= 1.0 - floor(smoothstep(0.72, 1.0, edge) * 4.0) / 4.0 * 0.55;
    // A faint cold tint of the glass.
    colour = mix(colour, colour * vec3(0.93, 0.98, 1.04), 0.6);
    // The reticle: a thin cross with ticks every eighth of the radius, broken at the middle.
    vec2 r = cell + 0.5 - centre - 0.5;
    float onLine = (abs(r.x) < 0.5 || abs(r.y) < 0.5) && max(abs(r.x), abs(r.y)) > 3.0 ? 1.0 : 0.0;
    float step = max(floor(radius / 8.0), 2.0);
    float tick = 0.0;
    if (abs(r.y) < 0.5 && mod(abs(r.x), step) < 0.5 && abs(r.x) > 0.5) tick = 1.0;
    if (abs(r.x) < 0.5 && mod(abs(r.y), step) < 0.5 && abs(r.y) > 0.5) tick = 1.0;
    float tickLine = (abs(r.y) < 1.5 && abs(r.y) >= 0.5 && mod(abs(r.x), step) < 0.5 && abs(r.x) > 0.5) ||
      (abs(r.x) < 1.5 && abs(r.x) >= 0.5 && mod(abs(r.y), step) < 0.5 && abs(r.y) > 0.5) ? 1.0 : 0.0;
    colour = mix(colour, vec3(0.06, 0.05, 0.04), max(onLine * 0.7, max(tick, tickLine) * 0.8));
  }
  gl_FragColor = vec4(colour, 1.0);
  #include <colorspace_fragment>
}`;

export class Spyglass {
  private target = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.SRGBColorSpace, depthBuffer: true });
  private readonly material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      view: { value: null },
      size: { value: new THREE.Vector2() },
      cells: { value: new THREE.Vector2() },
      pixel: { value: 4 },
      radius: { value: 100 },
      time: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
  });
  private readonly quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor() {
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** Big pixel size in device pixels for a drawing buffer of w by h. */
  static pixelFor(w: number, h: number): number {
    return Math.max(2, Math.round(Math.min(w, h) / PIXELS_ACROSS));
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
    const pixel = Spyglass.pixelFor(buffer.x, buffer.y);
    const cw = Math.ceil(buffer.x / pixel), ch = Math.ceil(buffer.y / pixel);
    // Drawn at twice the big pixels each way: each big pixel samples the corner of its own four texels, and the
    // linear filter averages them, so thin cracks between block faces do not flash as whole big pixels of sky.
    if (this.target.width !== cw * 2 || this.target.height !== ch * 2) this.target.setSize(cw * 2, ch * 2);
    const aspect = camera.aspect;
    camera.aspect = cw / ch;
    camera.updateProjectionMatrix();
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    const u = this.material.uniforms;
    u.view!.value = this.target.texture;
    (u.size!.value as THREE.Vector2).set(buffer.x, buffer.y);
    (u.cells!.value as THREE.Vector2).set(cw, ch);
    u.pixel!.value = pixel;
    u.radius!.value = Math.floor((Math.min(buffer.x, buffer.y) / pixel / 2) * SPYGLASS_RADIUS) - 3;
    renderer.render(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
