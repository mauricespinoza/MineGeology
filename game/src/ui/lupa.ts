// What the hand lens shows: a few millimetres of the rock, drawn from its texture and colour.
// The picture is generated, the same every time for the same outcrop, and at any size: everything is placed in a
// fixed 240-unit frame (about 8 mm) and only then scaled, so the enlarged view shows the same crystals, sharper.
//
// It is built in three passes, as a rock surface looks under a lens:
//   1. the groundmass or matrix, painted pixel by pixel from noise (or, for granular rocks, a mosaic of crystals);
//   2. the larger grains on top: phenocrysts with twin planes, clasts with their own texture, flakes, fossils;
//   3. the relief of the broken surface: light from the upper left and a fine grain, over everything.

import type { Alteration, AlterationIntensity, Unit } from "../format/types";
import { generator, hash } from "../tools/random";
import { icon } from "./icons";

/** Size of the frame the rock is drawn in; the lens circle is about 8 mm across. */
const L = 240;

type RGB = [number, number, number];

/** Since format 1.6.0: the alteration over the rock, drawn after the rock and before the relief. */
export interface LensAlteration {
  zone: Alteration;
  intensity: AlterationIntensity;
}

/**
 * How the minerals of an alteration look under the lens, found by name in the zone's mineral list:
 * colour, how many spots, their size, and their shape (soft blotch, cubic cavity, fine flake or fibre).
 */
const ALTERATION_LOOK: { match: RegExp; colour: string; count: number; size: [number, number]; shape: "blotch" | "cube" | "flake" | "fibre" }[] = [
  { match: /jarosita/, colour: "#d9b62c", count: 26, size: [3, 9], shape: "blotch" },
  { match: /goethita|limonita/, colour: "#9c5a1e", count: 18, size: [3, 7], shape: "cube" },
  { match: /hematita/, colour: "#9b2f1f", count: 14, size: [2, 6], shape: "blotch" },
  { match: /crisocola/, colour: "#3fb4a6", count: 14, size: [3, 9], shape: "blotch" },
  { match: /malaquita/, colour: "#2f8f4e", count: 10, size: [3, 7], shape: "blotch" },
  { match: /epidota/, colour: "#a5b33c", count: 22, size: [2, 6], shape: "blotch" },
  { match: /clorita/, colour: "#4f6b47", count: 30, size: [2, 5], shape: "flake" },
  { match: /biotita secundaria/, colour: "#2a2420", count: 60, size: [1, 2.5], shape: "flake" },
  { match: /feldespato potásico/, colour: "#e3a58f", count: 14, size: [4, 9], shape: "blotch" },
  { match: /magnetita/, colour: "#1b1b1d", count: 10, size: [1.5, 3], shape: "cube" },
  { match: /sericita/, colour: "#e8e2c8", count: 70, size: [1, 3], shape: "fibre" },
  { match: /alunita/, colour: "#d8a39b", count: 18, size: [2, 6], shape: "blotch" },
  { match: /caolinita/, colour: "#f4f1ea", count: 20, size: [4, 10], shape: "blotch" },
  { match: /oquerosa/, colour: "#3a3633", count: 22, size: [2, 6], shape: "cube" },
  { match: /pirita/, colour: "#cdb45c", count: 6, size: [1.5, 3], shape: "cube" },
  { match: /molibdenita/, colour: "#8c96a6", count: 4, size: [2, 4], shape: "flake" },
  { match: /calcita/, colour: "#f1ede2", count: 8, size: [2, 5], shape: "blotch" },
];

/** The alteration over the drawn rock: a wash of the zone's colour, its minerals and, often, a veinlet. */
function drawAlteration(ctx: CanvasRenderingContext2D, alteration: LensAlteration, random: () => number, c: number, R: number): void {
  const strength = { weak: 0.25, moderate: 0.5, strong: 0.78 }[alteration.intensity];
  const between = (a: number, b: number) => a + (b - a) * random();
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, R, 0, 2 * Math.PI);
  ctx.clip();
  // The wash: the rock's colours fade toward the zone's, more where the alteration is strong.
  ctx.globalAlpha = strength * 0.6;
  ctx.fillStyle = alteration.zone.colour;
  ctx.fillRect(c - R, c - R, 2 * R, 2 * R);
  ctx.globalAlpha = 1;
  const minerals = alteration.zone.minerals.join(" ").toLowerCase();
  // A veinlet with its halo, where the zone has veins.
  if (/vetilla|cuarzo/.test(minerals) && random() < 0.4 + strength * 0.6) {
    const a = between(0, Math.PI), w = between(4, 9), off = between(-R * 0.4, R * 0.4);
    const dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
    const x0 = c + nx * off - dx * R * 1.2, y0 = c + ny * off - dy * R * 1.2, x1 = c + nx * off + dx * R * 1.2, y1 = c + ny * off + dy * R * 1.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(236,232,214,0.55)";
    ctx.lineWidth = w * 3.2;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = "#ece9df";
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    if (/molibdenita/.test(minerals)) {
      ctx.strokeStyle = "#7d8696";
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
  }
  for (const look of ALTERATION_LOOK) {
    if (!look.match.test(minerals)) continue;
    const n = Math.round(look.count * (0.4 + strength));
    for (let i = 0; i < n; i++) {
      const r = R * Math.sqrt(random()), t = random() * 2 * Math.PI;
      const x = c + r * Math.cos(t), y = c + r * Math.sin(t), s = between(look.size[0], look.size[1]);
      ctx.fillStyle = look.colour;
      ctx.strokeStyle = look.colour;
      ctx.globalAlpha = between(0.65, 0.95);
      if (look.shape === "cube") {
        // A cubic cavity or crystal: a dark rim and a lit face.
        ctx.save(); ctx.translate(x, y); ctx.rotate(between(0, Math.PI / 2));
        ctx.fillRect(-s / 2, -s / 2, s, s);
        ctx.strokeStyle = "rgba(20,14,8,0.6)"; ctx.lineWidth = 0.8; ctx.strokeRect(-s / 2, -s / 2, s, s);
        ctx.restore();
      } else if (look.shape === "flake") {
        ctx.save(); ctx.translate(x, y); ctx.rotate(between(0, Math.PI));
        ctx.fillRect(-s, -s / 3, 2 * s, (2 * s) / 3);
        ctx.restore();
      } else if (look.shape === "fibre") {
        const a = between(0, Math.PI);
        ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * s, y - Math.sin(a) * s); ctx.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s); ctx.stroke();
      } else {
        ctx.beginPath();
        for (let j = 0; j < 7; j++) {
          const b = (j / 7) * 2 * Math.PI, rr = s * between(0.6, 1.1);
          j ? ctx.lineTo(x + rr * Math.cos(b), y + rr * Math.sin(b)) : ctx.moveTo(x + rr * Math.cos(b), y + rr * Math.sin(b));
        }
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function rgb(hex: string): RGB {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const css = (c: RGB, alpha = 1) => `rgba(${c.map((v) => Math.max(0, Math.min(255, Math.round(v)))).join(",")},${alpha})`;
const scale = (c: RGB, f: number): RGB => [c[0] * f, c[1] * f, c[2] * f];
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Smooth value noise in [0, 1], seeded; and its sum over a few octaves. */
function noise(seed: number) {
  const h = (x: number, y: number) => {
    let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const value = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const fbm = (x: number, y: number, octaves = 3) => {
    let sum = 0, amp = 0.5, f = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * value(x * f + o * 17.3, y * f + o * 9.1);
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return sum / norm;
  };
  return { value, fbm, hash: h };
}

/** A mosaic of crystals: each point of the frame belongs to the nearest of a set of jittered seeds. */
interface Mosaic {
  nearest(x: number, y: number): { i: number; d1: number; d2: number };
  count: number;
}
function mosaic(random: () => number, spacing: number): Mosaic {
  const n = Math.ceil(L / spacing) + 2;
  const seeds: [number, number][] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) seeds.push([(i - 1 + 0.15 + 0.7 * random()) * spacing, (j - 1 + 0.15 + 0.7 * random()) * spacing]);
  return {
    count: seeds.length,
    nearest(x, y) {
      const ci = Math.floor(x / spacing) + 1, cj = Math.floor(y / spacing) + 1;
      let best = 0, d1 = 1e9, d2 = 1e9;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const i = ci + di, j = cj + dj;
          if (i < 0 || j < 0 || i >= n || j >= n) continue;
          const s = seeds[i + n * j]!, d = Math.hypot(s[0] - x, s[1] - y);
          if (d < d1) ((d2 = d1), (d1 = d), (best = i + n * j));
          else if (d < d2) d2 = d;
        }
      }
      return { i: best, d1, d2 };
    },
  };
}

/** Draws the view through a 10x lens on a square canvas of any size: the circle is about 8 mm across. */
export function drawLupa(canvas: HTMLCanvasElement, unit: Unit, seedText: string, alteration?: LensAlteration | null): void {
  const ctx = canvas.getContext("2d")!;
  const size = canvas.width, k = size / L;
  const c = L / 2, R = L / 2 - 10;
  const seed = hash("lupa", seedText, unit.key);
  const random = generator(seed);
  const between = (a: number, b: number) => a + (b - a) * random();
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)]!;
  const N = noise(seed);
  const texture = unit.texture;
  const base = rgb(unit.colour);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size, size);

  // ---- 1. Groundmass, pixel by pixel.
  const image = ctx.createImageData(size, size);
  const px = image.data;
  const paint = (colourAt: (x: number, y: number) => RGB) => {
    for (let py = 0; py < size; py++) {
      const y = (py + 0.5) / k;
      for (let pxi = 0; pxi < size; pxi++) {
        const x = (pxi + 0.5) / k;
        const col = colourAt(x, y), o = (py * size + pxi) * 4;
        px[o] = col[0];
        px[o + 1] = col[1];
        px[o + 2] = col[2];
        px[o + 3] = 255;
      }
    }
  };
  /** A fine-grained matrix: mottled at the scale of a millimetre, speckled at the scale of the grains. */
  const matrix = (colour: RGB, grain: number, contrast: number, speck = 0) => (x: number, y: number): RGB => {
    const m = N.fbm(x / 38, y / 38), g = N.value(x * grain, y * grain);
    let f = 1 + (m - 0.5) * contrast + (g - 0.5) * contrast * 0.9;
    if (speck && N.hash(Math.floor(x * 1.3), Math.floor(y * 1.3)) < speck) f *= 0.55;
    return scale(colour, f);
  };

  const dark = /lava|shale|slate|hornfels|dyke/.test(texture);
  const groundmass = scale(base, texture === "dyke_fine" ? 0.95 : dark ? 0.78 : 1.0);

  if (texture === "plutonic_granular" || texture === "gypsum") {
    // Interlocking crystals filling the whole view.
    const granite = texture === "plutonic_granular";
    const m = mosaic(random, granite ? 22 : 30);
    const kinds = Array.from({ length: m.count }, () => random());
    const angle = Array.from({ length: m.count }, () => random() * Math.PI);
    const tint = Array.from({ length: m.count }, () => 0.9 + 0.2 * random());
    const QUARTZ: RGB = [168, 166, 160], PLAG: RGB = [238, 233, 222], KSPAR: RGB = [226, 178, 156], HBL: RGB = [44, 48, 42];
    paint((x, y) => {
      const { i, d1, d2 } = m.nearest(x, y);
      const kind = kinds[i]!, a = angle[i]!;
      const along = x * Math.cos(a) + y * Math.sin(a), across = -x * Math.sin(a) + y * Math.cos(a);
      let col: RGB;
      if (!granite) {
        // Gypsum: clear to white blades with a satin sheen along each crystal.
        col = scale([236, 232, 224], tint[i]! * (0.93 + 0.1 * Math.sin(across * 0.9) ** 2));
      } else if (kind < 0.3) {
        // Quartz: grey and glassy, with a soft conchoidal shine.
        col = scale(QUARTZ, tint[i]! * (0.9 + 0.25 * N.fbm(x / 9 + i, y / 9)));
      } else if (kind < 0.62) {
        // Plagioclase: white, with the fine stripes of polysynthetic twinning.
        col = scale(PLAG, tint[i]! * (Math.sin(across * 1.6) > 0.6 ? 0.94 : 1));
      } else if (kind < 0.85) {
        // K-feldspar: pink, with threads of perthite.
        col = scale(KSPAR, tint[i]! * (N.value(along * 0.6, across * 3) > 0.72 ? 1.08 : 1));
      } else col = scale(HBL, 0.8 + 0.4 * N.value(along * 0.5, across * 0.5)); // hornblende and biotite
      // Grain boundaries: a thin shadow where two crystals meet.
      if (d2 - d1 < 0.7) col = scale(col, 0.75);
      return mixRGB(col, base, granite ? 0.12 : 0.2);
    });
  } else if (texture === "limestone") {
    paint(matrix(base, 0.9, 0.18));
  } else if (texture === "shale" || texture === "slate") {
    // Very fine grain, in thin laminae (shale) or with the sheen of the cleavage (slate).
    const tilt = between(-0.25, 0.25);
    paint((x, y) => {
      const v = y + Math.tan(tilt) * x;
      const lam = texture === "shale" ? 0.9 + 0.12 * N.value(0.5, v * 0.35) + 0.06 * Math.sin(v * 1.3) : 0.95 + 0.1 * N.value(x * 0.05, v * 0.9);
      return scale(groundmass, lam * (0.94 + 0.12 * N.value(x * 1.2, y * 1.2)));
    });
  } else if (texture === "redbeds" || texture.startsWith("sandstone") || texture === "metasandstone") {
    paint(matrix(groundmass, 0.6, 0.22));
  } else if (texture.startsWith("lava") || texture === "dyke_fine") {
    paint(matrix(groundmass, 1.4, 0.2, 0.05));
  } else {
    paint(matrix(groundmass, 0.9, 0.24));
  }
  ctx.putImageData(image, 0, 0);

  // ---- 2. Grains on top, drawn in the 240-unit frame.
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, R + 6, 0, 2 * Math.PI);
  ctx.clip();

  /** A euhedral lath (feldspar): tapered ends, shaded across its width, with twin planes along it. */
  const lath = (x: number, y: number, length: number, width: number, a: number, colour: RGB, twins = true) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    const l = length / 2, w = width / 2, t = Math.min(w, l * 0.4);
    ctx.beginPath();
    ctx.moveTo(-l, 0); ctx.lineTo(-l + t, -w); ctx.lineTo(l - t, -w); ctx.lineTo(l, 0); ctx.lineTo(l - t, w); ctx.lineTo(-l + t, w);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -w, 0, w);
    g.addColorStop(0, css(scale(colour, 1.08)));
    g.addColorStop(0.55, css(colour));
    g.addColorStop(1, css(scale(colour, 0.78)));
    ctx.fillStyle = g;
    ctx.fill();
    if (twins && width > 2.5) {
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = css(scale(colour, 0.82), 0.55);
      ctx.lineWidth = 0.35;
      for (let v = -w + between(0.4, 1); v < w; v += between(0.7, 1.6)) {
        ctx.beginPath();
        ctx.moveTo(-l, v);
        ctx.lineTo(l, v);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.strokeStyle = "rgba(20,16,12,0.45)";
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.restore();
  };
  /** A prism of pyroxene or amphibole: dark, stubby, with a glint on one face. */
  const prism = (x: number, y: number, length: number, width: number, a: number, colour: RGB) => {
    lath(x, y, length, width, a, colour, false);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(-length * 0.3, -width * 0.42, length * 0.45, width * 0.18);
    ctx.restore();
  };
  /** A grain or a clast: lit from the upper left, with a shadow below, and its own speckle inside. */
  const clast = (x: number, y: number, r: number, colour: RGB, opts: { corners?: number; rough?: number; glassy?: boolean; speck?: RGB[]; shadow?: number } = {}) => {
    const corners = opts.corners ?? 10, rough = opts.rough ?? 0.18;
    const a0 = between(0, 2 * Math.PI);
    const points: [number, number][] = [];
    for (let i = 0; i < corners; i++) {
      const a = a0 + (i / corners) * 2 * Math.PI + between(-0.25, 0.25) * (6 / corners), rr = r * between(1 - rough, 1 + rough);
      points.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
    }
    const shape = () => {
      ctx.beginPath();
      points.forEach(([px, py], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, px, py));
      ctx.closePath();
    };
    // The shadow, cast down and to the right; shadow sizes are in canvas pixels, not in the frame's units.
    if ((opts.shadow ?? 0.45) > 0) {
      ctx.save();
      ctx.shadowColor = `rgba(0,0,0,${opts.shadow ?? 0.45})`;
      ctx.shadowBlur = r * 0.35 * k;
      ctx.shadowOffsetX = r * 0.08 * k;
      ctx.shadowOffsetY = r * 0.14 * k;
      shape();
      ctx.fillStyle = css(colour);
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    shape();
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r * 1.15);
    g.addColorStop(0, css(scale(colour, opts.glassy ? 1.3 : 1.14)));
    g.addColorStop(0.6, css(colour));
    g.addColorStop(1, css(scale(colour, 0.7)));
    ctx.fillStyle = g;
    ctx.fill();
    if (opts.speck || opts.glassy) {
      ctx.clip();
      if (opts.speck) {
        for (let i = 0; i < r * r * 0.5; i++) {
          ctx.fillStyle = css(pick(opts.speck), between(0.35, 0.8));
          const d = between(0.4, Math.max(0.6, r * 0.12));
          ctx.fillRect(x + between(-r, r), y + between(-r, r), d, d);
        }
      }
      if (opts.glassy) {
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.beginPath();
        ctx.ellipse(x - r * 0.35, y - r * 0.4, r * 0.28, r * 0.13, -0.6, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
    ctx.restore();
    shape();
    ctx.strokeStyle = "rgba(15,12,10,0.4)";
    ctx.lineWidth = 0.5;
    ctx.stroke();
  };
  /** A flake of mica: a dark hexagon with a bronze sheen. */
  const flake = (x: number, y: number, r: number, a: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, Math.cos((i * Math.PI) / 3) * r, Math.sin((i * Math.PI) / 3) * r * 0.8);
    ctx.closePath();
    const g = ctx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, "#5b4a32");
    g.addColorStop(0.45, "#1a1612");
    g.addColorStop(1, "#2c241a");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  };
  /** A filled gas bubble (amygdale): concentric chlorite and white calcite or zeolite. */
  const amygdale = (x: number, y: number, r: number) => {
    clast(x, y, r, [196, 214, 190], { corners: 14, rough: 0.07, shadow: 0.25 });
    clast(x + r * 0.05, y + r * 0.05, r * 0.62, [112, 150, 104], { corners: 12, rough: 0.08, shadow: 0 });
    clast(x + r * 0.08, y + r * 0.06, r * 0.3, [236, 240, 230], { corners: 10, rough: 0.1, shadow: 0, glassy: true });
  };
  const anywhere = () => [between(-6, L + 6), between(-6, L + 6)] as const;

  const PLAG: RGB = [240, 235, 222], PYX: RGB = [42, 58, 44], QTZ: RGB = [190, 188, 182], WHITE: RGB = [246, 243, 236];

  if (texture === "lava_megaporphyritic") {
    const flow = between(0, Math.PI);
    for (let i = 0; i < 22; i++) lath(...anywhere(), between(26, 56), between(8, 13), flow + between(-0.3, 0.3), scale(PLAG, between(0.94, 1.03)));
    for (let i = 0; i < 40; i++) lath(...anywhere(), between(4, 9), between(1.2, 2.2), flow + between(-0.5, 0.5), PLAG, false);
    for (let i = 0; i < 5; i++) clast(...anywhere(), between(3, 6), [138, 64, 40], { corners: 7, rough: 0.3, shadow: 0.2 }); // iddingsite
  } else if (texture.startsWith("lava")) {
    for (let i = 0; i < 30; i++) lath(...anywhere(), between(12, 28), between(4, 8), between(0, Math.PI), scale(PLAG, between(0.92, 1.03)));
    for (let i = 0; i < 70; i++) lath(...anywhere(), between(2.5, 6), between(0.8, 1.5), between(0, Math.PI), PLAG, false);
    for (let i = 0; i < 12; i++) prism(...anywhere(), between(6, 12), between(4, 7), between(0, Math.PI), scale(PYX, between(0.8, 1.2)));
    for (let i = 0; i < 4; i++) amygdale(...anywhere(), between(7, 13));
  } else if (texture === "dyke_fine") {
    for (let i = 0; i < 160; i++) lath(...anywhere(), between(2.5, 6), between(0.7, 1.4), between(0, Math.PI), scale(PLAG, 0.92), false);
    for (let i = 0; i < 26; i++) prism(...anywhere(), between(3, 7), between(2, 3.5), between(0, Math.PI), [24, 26, 24]);
    for (let i = 0; i < 6; i++) lath(...anywhere(), between(8, 13), between(3, 4.5), between(0, Math.PI), scale(PLAG, 0.97));
  } else if (texture.startsWith("breccia")) {
    // Angular fragments of lavas of several colours, each with its own small crystals, in a reddish matrix.
    const tones: RGB[] = [[94, 111, 100], [106, 84, 117], [123, 75, 62], [141, 138, 124], [79, 90, 82], [150, 96, 70]];
    for (let i = 0; i < 18; i++) {
      const [x, y] = anywhere(), r = between(12, 34), tone = pick(tones);
      clast(x, y, r, tone, { corners: Math.floor(between(4, 7)), rough: 0.35, speck: [scale(WHITE, 0.95), scale(tone, 0.6)] });
    }
    for (let i = 0; i < 30; i++) lath(...anywhere(), between(3, 8), between(1.4, 3), between(0, Math.PI), PLAG);
  } else if (texture === "conglomerate") {
    const tones: RGB[] = [[232, 228, 218], [92, 98, 104], [118, 92, 110], [150, 128, 102], [196, 160, 128], [84, 104, 90]];
    for (let i = 0; i < 1500; i++) clast(...anywhere(), between(1.6, 3.4), mixRGB(pick([QTZ, [214, 196, 168], [120, 112, 100], [176, 140, 110]] as RGB[]), base, 0.3), { corners: 7, rough: 0.22, shadow: 0.12 });
    for (let i = 0; i < 15; i++) {
      const tone = pick(tones);
      clast(...anywhere(), between(16, 40), tone, { corners: 16, rough: 0.1, glassy: tone === tones[0], speck: [scale(tone, 0.8), scale(tone, 1.15)] });
    }
  } else if (texture === "redbeds" || texture.startsWith("sandstone")) {
    // Well-sorted grains: glassy quartz, cream and pink feldspar, dark rock fragments; a stain of hematite in red beds.
    const red = texture === "redbeds";
    const tones: RGB[] = red
      ? [[214, 150, 120], [196, 120, 92], [232, 196, 170], [150, 80, 60], [118, 98, 90]]
      : [[226, 222, 212], [212, 196, 160], [220, 176, 150], [176, 168, 150], [104, 102, 96]];
    // Packed grains, touching one another: a grain every few units, enough to cover the matrix.
    for (let i = 0; i < 1500; i++) {
      const tone = mixRGB(pick(tones), base, 0.3);
      clast(...anywhere(), between(2.4, 4.6), tone, { corners: 8, rough: 0.22, glassy: random() < 0.25, shadow: 0.15 });
    }
    if (red) for (let i = 0; i < 4; i++) clast(...anywhere(), between(9, 15), pick([[226, 220, 210], [120, 96, 104]] as RGB[]), { corners: 14, rough: 0.1 });
    for (let i = 0; i < 6; i++) flake(...anywhere(), between(2, 3.5), between(0, Math.PI));
  } else if (texture === "ignimbrite") {
    // Welded ash with flattened pumice (fiamme), white pumice, broken crystals and lithic fragments.
    const tilt = between(-0.15, 0.15);
    for (let i = 0; i < 12; i++) {
      const [x, y] = anywhere(), l = between(26, 52), w = between(3, 7);
      ctx.save(); ctx.translate(x, y); ctx.rotate(tilt + between(-0.08, 0.08));
      ctx.beginPath(); ctx.moveTo(-l / 2, 0); ctx.bezierCurveTo(-l / 4, -w, l / 4, -w * 0.8, l / 2, 0); ctx.bezierCurveTo(l / 4, w * 0.9, -l / 4, w, -l / 2, 0);
      ctx.fillStyle = css([62, 50, 48]); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.lineWidth = 0.5; ctx.stroke(); ctx.restore();
    }
    for (let i = 0; i < 18; i++) clast(...anywhere(), between(3, 8), [238, 234, 224], { corners: 9, rough: 0.3, speck: [[200, 196, 186]], shadow: 0.25 });
    for (let i = 0; i < 40; i++) clast(...anywhere(), between(1.5, 3.5), pick([QTZ, PLAG]), { corners: 5, rough: 0.4, glassy: true, shadow: 0.2 });
    for (let i = 0; i < 8; i++) clast(...anywhere(), between(4, 9), pick([[70, 70, 66], [110, 80, 70]] as RGB[]), { corners: 6, rough: 0.35 });
  } else if (texture === "tuff_lapilli") {
    for (let i = 0; i < 260; i++) clast(...anywhere(), between(0.8, 1.8), pick([[239, 233, 218], [216, 207, 187], [60, 60, 56]] as RGB[]), { corners: 5, rough: 0.35, shadow: 0.15 });
    for (let i = 0; i < 16; i++) clast(...anywhere(), between(6, 16), pick([[127, 138, 111], [110, 90, 99], [201, 193, 173], [90, 100, 92]] as RGB[]), { corners: 8, rough: 0.3, speck: [WHITE, [50, 50, 50]] });
    for (let i = 0; i < 20; i++) clast(...anywhere(), between(1.5, 3), PLAG, { corners: 5, rough: 0.4, glassy: true, shadow: 0.2 });
  } else if (texture === "plutonic_granular") {
    for (let i = 0; i < 26; i++) flake(...anywhere(), between(2.5, 5.5), between(0, Math.PI));
    for (let i = 0; i < 4; i++) prism(...anywhere(), between(10, 16), between(4, 6), between(0, Math.PI), [30, 40, 30]);
  } else if (texture === "gypsum") {
    for (let i = 0; i < 26; i++) lath(...anywhere(), between(14, 34), between(2.5, 5), between(0, Math.PI), [248, 246, 240], false);
  } else if (texture === "metasandstone") {
    const tilt = between(-0.3, 0.3);
    for (let i = 0; i < 360; i++) lath(...anywhere(), between(4, 9), between(2, 3.6), tilt + between(-0.12, 0.12), mixRGB(pick([[230, 226, 216], [200, 194, 182], [150, 146, 140]] as RGB[]), base, 0.3), false);
    for (let i = 0; i < 40; i++) lath(...anywhere(), between(5, 10), between(0.6, 1.1), tilt + between(-0.08, 0.08), [222, 228, 234], false); // white mica
  } else if (texture === "slate") {
    for (let i = 0; i < 4; i++) {
      // Pyrite cubes: brassy, with a lit face and a shaded face.
      const [x, y] = anywhere(), s = between(4, 8), a = between(0, Math.PI / 2);
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      const g = ctx.createLinearGradient(-s, -s, s, s);
      g.addColorStop(0, "#e9d48a"); g.addColorStop(0.5, "#b39a4c"); g.addColorStop(1, "#6c5a2a");
      ctx.fillStyle = g; ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 0.5; ctx.strokeRect(-s / 2, -s / 2, s, s); ctx.restore();
    }
  } else if (texture === "hornfels_spotted") {
    for (let i = 0; i < 30; i++) clast(...anywhere(), between(3, 7), scale(base, 0.55), { corners: 10, rough: 0.25, shadow: 0.1 });
    for (let i = 0; i < 8; i++) {
      // Andalusite (chiastolite): square sections with the dark cross of inclusions.
      const [x, y] = anywhere(), w = between(8, 13), a = between(0, Math.PI);
      lath(x, y, w, w, a, [207, 196, 180], false);
      ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.strokeStyle = "#2a2528"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-w * 0.4, -w * 0.4); ctx.lineTo(w * 0.4, w * 0.4); ctx.moveTo(w * 0.4, -w * 0.4); ctx.lineTo(-w * 0.4, w * 0.4); ctx.stroke(); ctx.restore();
    }
  } else if (texture === "limestone") {
    // Micrite with shell fragments, crinoid ossicles and patches of sparry calcite.
    for (let i = 0; i < 8; i++) clast(...anywhere(), between(6, 12), scale(base, 1.18), { corners: 9, rough: 0.3, glassy: true, shadow: 0.1 });
    for (let i = 0; i < 14; i++) {
      const [x, y] = anywhere(), r = between(8, 20), a = between(0, 2 * Math.PI), span = between(0.8, 2.2);
      ctx.strokeStyle = "rgba(60,50,40,0.5)"; ctx.lineWidth = 3.2; ctx.beginPath(); ctx.arc(x + 0.6, y + 0.8, r, a, a + span); ctx.stroke();
      ctx.strokeStyle = "#f6f2e8"; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.arc(x, y, r, a, a + span); ctx.stroke();
    }
    for (let i = 0; i < 4; i++) {
      const [x, y] = anywhere();
      clast(x, y, 7, [236, 230, 216], { corners: 14, rough: 0.04 });
      ctx.fillStyle = "#6d6457"; ctx.beginPath(); ctx.arc(x, y, 1.5, 0, 2 * Math.PI); ctx.fill();
    }
  }
  if (unit.fossils?.length && texture !== "limestone") {
    for (let i = 0; i < 6; i++) {
      const [x, y] = anywhere(), r = between(8, 18), a = between(0, 2 * Math.PI), span = between(1.2, 2.4);
      ctx.strokeStyle = "rgba(50,40,30,0.5)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x + 0.6, y + 0.8, r, a, a + span); ctx.stroke();
      ctx.strokeStyle = "#fbf9f3"; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(x, y, r, a, a + span); ctx.stroke();
    }
  }
  ctx.restore();

  // ---- 2b. The alteration over the rock, where there is one (format 1.6.0).
  if (alteration) {
    ctx.setTransform(k, 0, 0, k, 0, 0);
    drawAlteration(ctx, alteration, generator(hash("alteration", seedText, alteration.zone.key)), c, R);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ---- 3. Relief of the broken surface and a fine grain, lit from the upper left.
  const lit = ctx.getImageData(0, 0, size, size);
  const d = lit.data, bump = 2.5;
  for (let py = 0; py < size; py++) {
    const y = (py + 0.5) / k;
    for (let pxi = 0; pxi < size; pxi++) {
      const x = (pxi + 0.5) / k;
      // A gentle relief: the broken surface is rough, not cratered.
      const dx = N.fbm((x + bump) / 16, y / 16, 2) - N.fbm((x - bump) / 16, y / 16, 2);
      const dy = N.fbm(x / 16, (y + bump) / 16, 2) - N.fbm(x / 16, (y - bump) / 16, 2);
      const f = Math.min(1.12, Math.max(0.86, 1 - (dx + dy) * 0.9)) * (1 + (N.value(x * 2.6, y * 2.6) - 0.5) * 0.06);
      const o = (py * size + pxi) * 4;
      d[o] = d[o]! * f;
      d[o + 1] = d[o + 1]! * f;
      d[o + 2] = d[o + 2]! * f;
    }
  }
  ctx.putImageData(lit, 0, 0);

  // The lens: a soft vignette, a little glare and the rim.
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, L, L);
  ctx.arc(c, c, R, 0, 2 * Math.PI, true);
  ctx.fillStyle = "#16191b";
  ctx.fill("evenodd");
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, R, 0, 2 * Math.PI);
  ctx.clip();
  const glow = ctx.createRadialGradient(c, c, R * 0.55, c, c, R);
  glow.addColorStop(0, "rgba(0,0,0,0)");
  glow.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, L, L);
  const glare = ctx.createRadialGradient(c - R * 0.45, c - R * 0.5, 0, c - R * 0.45, c - R * 0.5, R * 0.6);
  glare.addColorStop(0, "rgba(255,255,255,0.14)");
  glare.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glare;
  ctx.fillRect(0, 0, L, L);
  ctx.restore();
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#2b2b2b";
  ctx.beginPath();
  ctx.arc(c, c, R + 4, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#8c8c8c";
  ctx.beginPath();
  ctx.arc(c, c, R + 8, 0, 2 * Math.PI);
  ctx.stroke();
  // Scale: the circle is about 8 mm across.
  const mm = (2 * R) / 8;
  ctx.fillStyle = "#fff";
  ctx.fillRect(c - mm, L - 30, 2 * mm, 2.4);
  ctx.font = "10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.strokeText("2 mm", c, L - 34);
  ctx.fillText("2 mm", c, L - 34);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** What the large view says under the rock. */
export const LUPA_CAPTION = "Con la lupa de 10 aumentos: el círculo mide unos 8 mm. Toca la imagen o la X para volver.";

/** The markup of a lens view with its button to see it large; pair it with `wireLupa`. */
export function lupaHtml(id: string): string {
  return `<div class="lupa-view"><canvas id="${id}" width="240" height="240" aria-label="Vista con lupa: tócala para verla en grande" title="Ver en grande"></canvas>` +
    `<button type="button" class="icon-btn lupa-max" data-lupa-max aria-label="Ver la roca en grande" title="Ver la roca en grande">${icon("maximize")}</button></div>`;
}

/** Draws the lens view in `root` and lets a tap on it, or its button, open it large. */
export function wireLupa(root: ParentNode, id: string, unit: Unit, seedText: string, caption: string, alteration?: LensAlteration | null): void {
  const canvas = root.querySelector<HTMLCanvasElement>(`#${id}`);
  if (!canvas) return;
  drawLupa(canvas, unit, seedText, alteration);
  const open = (e: Event) => {
    e.stopPropagation();
    openLupaFull(unit, seedText, caption, alteration);
  };
  canvas.onclick = open;
  const button = canvas.parentElement?.querySelector<HTMLElement>("[data-lupa-max]");
  if (button) button.onclick = open;
}

let full: HTMLElement | null = null;

/** Whether the large lens view is open. */
export function lupaFullOpen(): boolean {
  return !!full && !full.hidden;
}

export function closeLupaFull(): void {
  if (full) full.hidden = true;
}

/** The lens view over the whole screen, drawn afresh at the screen's resolution. */
export function openLupaFull(unit: Unit, seedText: string, caption: string, alteration?: LensAlteration | null): void {
  if (!full) {
    full = document.createElement("div");
    full.id = "lupa-full";
    full.setAttribute("role", "dialog");
    full.setAttribute("aria-label", "La roca con lupa, en grande");
    full.hidden = true;
    document.body.appendChild(full);
    // Esc closes the large view first, before anything else hears it.
    window.addEventListener("keydown", (e) => {
      if (e.code === "Escape" && lupaFullOpen()) {
        e.stopImmediatePropagation();
        e.preventDefault();
        closeLupaFull();
      }
    }, { capture: true });
  }
  full.innerHTML = `<button type="button" class="icon-btn close-fixed" aria-label="Cerrar la vista en grande (Esc)" title="Cerrar (Esc)">${icon("close")}</button>
    <canvas aria-label="Vista con lupa en grande"></canvas><p></p>`;
  full.querySelector("p")!.textContent = caption;
  full.hidden = false;
  const canvas = full.querySelector("canvas")!;
  const css = Math.min(window.innerWidth * 0.92, window.innerHeight - 120, 900);
  canvas.width = canvas.height = Math.max(240, Math.min(1400, Math.round(css * Math.min(window.devicePixelRatio || 1, 2))));
  drawLupa(canvas, unit, seedText, alteration);
  full.querySelector<HTMLElement>(".close-fixed")!.onclick = closeLupaFull;
  canvas.onclick = closeLupaFull;
}
