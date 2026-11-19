// What a block face looks like up close: a pattern for each kind of rock and cover, drawn by the GPU from the
// world position, so the faces need no textures. Every pattern is isotropic on purpose: crystals, clasts,
// spots and joints, never lines with a direction, which would read as bedding or foliation that is not there.
// The true bedding is drawn separately, as lines at the true apparent dip.
//
// Patterns fade to plain colour with distance, so the far hills keep the colours of the map and do not shimmer.

import type * as THREE from "three";

/** Pattern numbers, stored per vertex. */
export const PATTERN = {
  plain: 0,
  granular: 1,
  porphyritic: 2,
  megaporphyritic: 3,
  breccia: 4,
  conglomerate: 5,
  sandstone: 6,
  fine: 7,
  tuff: 8,
  ignimbrite: 9,
  gypsum: 10,
  metamorphic: 11,
  limestone: 12,
  spotted: 13,
  soil: 14,
  alluvium: 15,
  scree: 16,
  vegetation: 17,
} as const;

/** The pattern for a unit's texture name in units.json. */
export function patternFor(texture: string): number {
  if (texture === "plutonic_granular") return PATTERN.granular;
  if (texture === "lava_megaporphyritic") return PATTERN.megaporphyritic;
  if (texture.startsWith("lava")) return PATTERN.porphyritic;
  if (texture.startsWith("breccia")) return PATTERN.breccia;
  if (texture === "conglomerate") return PATTERN.conglomerate;
  if (texture.startsWith("sandstone") || texture === "redbeds") return PATTERN.sandstone;
  if (texture === "tuff_lapilli") return PATTERN.tuff;
  if (texture === "ignimbrite") return PATTERN.ignimbrite;
  if (texture === "gypsum") return PATTERN.gypsum;
  if (texture === "limestone") return PATTERN.limestone;
  if (texture === "hornfels_spotted") return PATTERN.spotted;
  if (texture === "slate" || texture === "metasandstone") return PATTERN.metamorphic;
  if (texture === "shale" || texture === "dyke_fine") return PATTERN.fine;
  return PATTERN.sandstone;
}

const VERTEX_HEAD = /* glsl */ `
attribute float pattern;
varying float vPattern;
varying vec3 vRockPos;
varying vec3 vRockNormal;
`;

const FRAGMENT_HEAD = /* glsl */ `
uniform float uPatterns;
varying float vPattern;
varying vec3 vRockPos;
varying vec3 vRockNormal;

float rh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rh(i), rh(i + vec2(1.0, 0.0)), f.x), mix(rh(i + vec2(0.0, 1.0)), rh(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { return 0.5 * rn(p) + 0.3 * rn(p * 2.03 + 7.1) + 0.2 * rn(p * 4.01 + 3.7); }
// Cells of a jittered grid: x = distance to the nearest centre, y = to the second, z = a number for the nearest cell.
vec3 cells(vec2 p, float jitter) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = g + 0.5 + jitter * (vec2(rh(i + g), rh(i + g + 19.19)) - 0.5) - f;
      float d = dot(o, o);
      if (d < d1) { d2 = d1; d1 = d; id = rh(i + g + 3.7); }
      else if (d < d2) { d2 = d; }
    }
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}

vec3 rockPattern(float kind, vec2 p) {
  int k = int(kind + 0.5);
  // One value of noise each for the fine grain and the patchy weathering: cheap enough for a tablet.
  float grain = rn(p * 60.0);
  float mottle = rn(p * 1.3);
  vec3 tone = vec3(0.9 + 0.2 * mottle);
  if (k == 1) {
    // Granite: interlocking crystals of feldspar, quartz and dark mica.
    vec3 c = cells(p * 14.0, 0.9);
    vec3 m = c.z < 0.12 ? vec3(0.32) : c.z < 0.3 ? vec3(0.78, 0.8, 0.84) : c.z < 0.45 ? vec3(1.12, 0.96, 0.9) : vec3(1.1, 1.08, 1.04);
    return m * (0.92 + 0.12 * grain) * (c.y - c.x < 0.04 ? 0.82 : 1.0);
  }
  if (k == 2 || k == 3) {
    // Lava: a dark, fine groundmass with pale feldspar phenocrysts, and now and then a filled vesicle.
    float size = k == 3 ? 6.0 : 11.0;
    vec3 c = cells(p * size, 0.8);
    vec3 m = vec3(0.86 + 0.1 * grain) * tone;
    if (c.z < (k == 3 ? 0.35 : 0.22) && c.x < 0.28) m = vec3(1.55, 1.5, 1.42);
    vec3 v = cells(p * 3.0 + 11.0, 0.9);
    if (v.z < 0.08 && v.x < 0.12) m = vec3(1.2, 1.3, 1.15);
    return m;
  }
  if (k == 4) {
    // Breccia: angular clasts of many tones in a darker matrix.
    vec3 c = cells(p * 3.2, 1.0);
    vec3 m = vec3(0.7 + 0.6 * c.z, 0.72 + 0.5 * fract(c.z * 7.3), 0.7 + 0.55 * fract(c.z * 3.1));
    return (c.y - c.x < 0.08 ? vec3(0.72) : m) * (0.93 + 0.12 * grain);
  }
  if (k == 5) {
    // Conglomerate: rounded pebbles in a sandy matrix.
    vec3 c = cells(p * 5.0, 0.7);
    float r = 0.28 + 0.14 * c.z;
    vec3 pebble = vec3(0.7 + 0.6 * c.z, 0.7 + 0.55 * fract(c.z * 5.7), 0.68 + 0.5 * fract(c.z * 2.3));
    float rim = smoothstep(r, r - 0.05, c.x);
    return mix(vec3(0.95 + 0.1 * grain) * tone, pebble * (1.0 - 0.25 * smoothstep(0.0, r, c.x)), rim);
  }
  if (k == 6) {
    // Sandstone: sorted grains and the patchy stain of weathering.
    return tone * (0.9 + 0.2 * grain) * (0.94 + 0.12 * rn(p * 9.0));
  }
  if (k == 7 || k == 11 || k == 12 || k == 13) {
    // Fine-grained rock, slate and limestone: a smooth surface broken by joints.
    vec3 j = cells(p * 1.4, 1.0);
    float joint = smoothstep(0.0, 0.035, j.y - j.x);
    vec3 m = tone * (0.95 + 0.06 * grain) * (0.93 + 0.12 * j.z) * mix(0.55, 1.0, joint);
    if (k == 11) m *= 0.94 + 0.12 * rn(p * 30.0); // a sheen of fine mica
    if (k == 12) {
      vec3 f = cells(p * 9.0 + 5.0, 0.9);
      if (f.z < 0.1 && f.x < 0.18) m *= 1.3; // shell fragments
    }
    if (k == 13) {
      vec3 s = cells(p * 16.0 + 2.0, 0.9);
      if (s.z < 0.35 && s.x < 0.3) m *= 0.6; // cordierite spots
    }
    return m;
  }
  if (k == 8) {
    // Lapilli tuff: ash with lapilli of pumice and lava.
    vec3 c = cells(p * 12.0, 0.9);
    vec3 m = tone * (0.92 + 0.14 * grain);
    if (c.x < 0.3 && c.z < 0.35) m = c.z < 0.15 ? vec3(0.62) : vec3(1.28, 1.25, 1.18);
    return m;
  }
  if (k == 9) {
    // Ignimbrite: pale pumice and dark lithic fragments in welded ash.
    vec3 c = cells(p * 9.0, 0.9);
    vec3 m = tone * (0.95 + 0.1 * grain);
    if (c.x < 0.3 && c.z < 0.16) m = vec3(1.3, 1.26, 1.2);
    else if (c.x < 0.25 && c.z > 0.9) m = vec3(0.55, 0.5, 0.5);
    return m;
  }
  if (k == 10) {
    // Gypsum: sparkling crystals.
    vec3 c = cells(p * 20.0, 0.9);
    return vec3(0.94 + 0.16 * c.z) * (0.97 + 0.05 * mottle);
  }
  if (k == 14) {
    // Soil: patches of damp and dry, a few small stones.
    vec3 c = cells(p * 9.0, 0.9);
    vec3 m = vec3(0.84 + 0.3 * fbm(p * 0.7)) * (0.94 + 0.1 * grain);
    if (c.z < 0.06 && c.x < 0.25) m *= 1.25;
    return m;
  }
  if (k == 15) {
    // Alluvium: rounded gravel of many sizes in sand.
    vec3 c = cells(p * 6.0, 0.9);
    float r = 0.18 + 0.22 * c.z;
    float pebble = smoothstep(r, r - 0.08, c.x);
    return mix(vec3(0.95 + 0.08 * grain) * tone, vec3(0.78 + 0.42 * fract(c.z * 7.7)), pebble * step(0.25, c.z));
  }
  if (k == 16) {
    // Scree: loose angular blocks of mixed sizes, half buried in grit, with shadowed gaps between them.
    vec3 big = cells(p * 2.2 + 3.0, 1.0), small = cells(p * 7.0, 1.0);
    bool onBig = big.z < 0.45;
    vec3 c = onBig ? big : small;
    float gap = smoothstep(0.0, onBig ? 0.1 : 0.16, c.y - c.x);
    float grit = 0.88 + 0.16 * rn(p * 40.0);
    vec3 block = vec3(0.8 + 0.38 * c.z) * (0.92 + 0.14 * fbm(p * 5.0 + c.z * 9.0));
    return mix(vec3(0.72) * grit, block, 0.35 + 0.65 * gap) * tone;
  }
  if (k == 17) {
    // Grass and low plants.
    float g = rn(p * 25.0) * 0.6 + rn(p * 6.0) * 0.4;
    return vec3(0.78 + 0.4 * g, 0.82 + 0.36 * g, 0.75 + 0.3 * g) * (0.9 + 0.2 * mottle);
  }
  return vec3(0.96 + 0.08 * mottle);
}
`;

/**
 * Adds the rock patterns to a vertex-coloured Lambert material; its geometry must carry a `pattern` attribute.
 * Returns a switch: turning it off rebuilds the shader without the patterns, for devices too slow for them.
 */
export function addRockPatterns(material: THREE.MeshLambertMaterial): { enabled: boolean } {
  const toggle = { value: 1 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPatterns = toggle;
    shader.vertexShader = VERTEX_HEAD + shader.vertexShader.replace(
      "#include <project_vertex>",
      `#include <project_vertex>
      vPattern = pattern;
      vRockPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vRockNormal = normal;`,
    );
    shader.fragmentShader = FRAGMENT_HEAD + shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      {
        float fade = uPatterns * (1.0 - smoothstep(10.0, 45.0, distance(vRockPos, cameraPosition)));
        if (fade > 0.0) {
          vec3 n = abs(vRockNormal);
          // Each face shows the plane it lies in; the offset keeps the pattern from repeating between faces.
          vec2 p = n.y > 0.5 ? vRockPos.xz : n.x > 0.5 ? vRockPos.zy + 31.0 : vRockPos.xy + 57.0;
          diffuseColor.rgb *= mix(vec3(1.0), rockPattern(vPattern, p), fade);
        }
      }`,
    );
  };
  material.customProgramCacheKey = () => "rock-patterns-3";
  return {
    get enabled() {
      return toggle.value > 0;
    },
    set enabled(on: boolean) {
      if (on || toggle.value === 0) return; // switched off for good: a slow device stays slow
      toggle.value = 0;
      // Some GPUs (and software renderers) run both sides of a branch: only a shader without the code is cheap.
      material.onBeforeCompile = () => {};
      material.customProgramCacheKey = () => "rock-patterns-off";
      material.needsUpdate = true;
    },
  };
}
