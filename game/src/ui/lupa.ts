// What the hand lens shows: a few millimetres of the rock, drawn from its texture and colour.
// The picture is generated, the same every time for the same outcrop.

import type { Unit } from "../format/types";
import { generator, hash } from "../tools/random";

function shade(hex: string, factor: number, alpha = 1): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * factor)));
  return `rgba(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)},${alpha})`;
}

/** Draws the view through a 10x lens: the circle is about 8 mm across. */
export function drawLupa(canvas: HTMLCanvasElement, unit: Unit, seedText: string): void {
  const ctx = canvas.getContext("2d")!;
  const size = canvas.width, c = size / 2, R = size / 2 - 10;
  const random = generator(hash("lupa", seedText, unit.key));
  const between = (a: number, b: number) => a + (b - a) * random();
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)]!;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, R, 0, 2 * Math.PI);
  ctx.clip();

  const base = unit.colour;
  const texture = unit.texture;
  const dark = /lava|shale/.test(texture);
  ctx.fillStyle = shade(base, texture === "dyke_fine" ? 1.25 : dark ? 0.72 : 1.05);
  ctx.fillRect(0, 0, size, size);
  // Fine grain of the groundmass or matrix.
  for (let i = 0; i < size * size * 0.06; i++) {
    ctx.fillStyle = shade(base, between(0.6, 1.35), between(0.25, 0.6));
    const d = between(0.8, 2.2);
    ctx.fillRect(between(0, size), between(0, size), d, d);
  }

  const lath = (x: number, y: number, length: number, width: number, angle: number, colour: string) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = colour;
    ctx.fillRect(-length / 2, -width / 2, length, width);
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 0.8;
    ctx.strokeRect(-length / 2, -width / 2, length, width);
    ctx.restore();
  };
  const blob = (x: number, y: number, r: number, colour: string, corners: number, rough: number) => {
    ctx.beginPath();
    for (let k = 0; k < corners; k++) {
      const a = (k / corners) * 2 * Math.PI + between(-0.2, 0.2), rr = r * between(1 - rough, 1 + rough);
      (k === 0 ? ctx.moveTo : ctx.lineTo).call(ctx, x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 1;
    ctx.stroke();
  };
  const grains = (n: number, rMin: number, rMax: number, colours: string[], rough = 0.25) => {
    for (let i = 0; i < n; i++) blob(between(0, size), between(0, size), between(rMin, rMax), pick(colours), 7, rough);
  };

  if (texture === "lava_megaporphyritic") {
    const flow = between(0, Math.PI);
    for (let i = 0; i < 26; i++) lath(between(0, size), between(0, size), between(size * 0.12, size * 0.26), between(size * 0.03, size * 0.05), flow + between(-0.35, 0.35), pick(["#f3eee0", "#ece4cf", "#fbf8ef"]));
    for (let i = 0; i < 5; i++) blob(between(0, size), between(0, size), between(4, 8), "#8a3b26", 6, 0.3);
  } else if (texture.startsWith("lava")) {
    for (let i = 0; i < 46; i++) lath(between(0, size), between(0, size), between(size * 0.04, size * 0.09), between(size * 0.012, size * 0.025), between(0, Math.PI), pick(["#ece7d8", "#f6f2e6"]));
    for (let i = 0; i < 12; i++) lath(between(0, size), between(0, size), between(5, 9), between(4, 6), between(0, Math.PI), "#2f4a33");
    for (let i = 0; i < 6; i++) {
      const x = between(0, size), y = between(0, size), r = between(5, 11);
      blob(x, y, r, "#cfe0c8", 12, 0.08);
      blob(x, y, r * 0.55, "#7da36f", 10, 0.1);
    }
  } else if (texture === "dyke_fine") {
    for (let i = 0; i < 18; i++) lath(between(0, size), between(0, size), between(4, 8), between(1.2, 2.2), between(0, Math.PI), "#dcd8cc");
    for (let i = 0; i < 14; i++) lath(between(0, size), between(0, size), between(5, 10), between(1, 1.6), between(0, Math.PI), "#101010");
  } else if (texture.startsWith("breccia")) {
    for (let i = 0; i < 16; i++) blob(between(0, size), between(0, size), between(size * 0.06, size * 0.16), pick(["#5e6f64", "#6a5475", "#7b4b3e", "#8d8a7c", "#4f5a52"]), Math.floor(between(4, 7)), 0.45);
    for (let i = 0; i < 30; i++) lath(between(0, size), between(0, size), between(3, 7), between(1.5, 3), between(0, Math.PI), "#e9e3d2");
  } else if (texture === "conglomerate" || texture === "redbeds") {
    grains(texture === "redbeds" ? 420 : 260, 2, 5, ["#d9d2c3", "#b9a58a", "#6d6a63", "#c98d6a", "#efe9dc"]);
    grains(texture === "redbeds" ? 3 : 9, size * 0.07, size * 0.14, ["#5e6f64", "#6a5475", "#8d8a7c", "#7b5a48"], 0.12);
    ctx.fillStyle = texture === "redbeds" ? "rgba(140,50,30,0.22)" : "rgba(0,0,0,0)";
    ctx.fillRect(0, 0, size, size);
  } else if (texture === "ignimbrite") {
    for (let i = 0; i < 14; i++) lath(between(0, size), between(0, size), between(size * 0.12, size * 0.24), between(3, 6), between(-0.15, 0.15), "#4a3a37");
    for (let i = 0; i < 30; i++) blob(between(0, size), between(0, size), between(2, 4), pick(["#f2f0ea", "#1f1f1f"]), 6, 0.2);
  } else if (texture === "plutonic_granular") {
    // Interlocking crystals: plagioclase, quartz, pink feldspar and biotite flakes.
    grains(150, size * 0.035, size * 0.07, ["#f1ece4", "#e9e2d6", "#b9b4ac", "#a9a49c", "#e2b4a0"], 0.18);
    for (let i = 0; i < 30; i++) lath(between(0, size), between(0, size), between(5, 11), between(3, 6), between(0, Math.PI), "#1c1a1a");
    for (let i = 0; i < 6; i++) lath(between(0, size), between(0, size), between(8, 14), between(3, 5), between(0, Math.PI), "#2e3a2c");
  } else if (texture === "slate" || texture === "metasandstone" || texture === "hornfels_spotted") {
    const tilt = between(-0.3, 0.3);
    if (texture === "metasandstone") {
      for (let i = 0; i < 260; i++) lath(between(0, size), between(0, size), between(5, 10), between(2, 3.5), tilt + between(-0.15, 0.15), pick(["#e6e1d6", "#cfc8b9", "#a7a196"]));
    }
    // Foliation: thin wavy sheets of white mica that catch the light.
    for (let k = 0; k < (texture === "metasandstone" ? 14 : 40); k++) {
      const y0 = between(-size * 0.2, size * 1.2);
      ctx.strokeStyle = texture === "hornfels_spotted" ? shade(base, 1.25, 0.35) : `rgba(220,225,232,${between(0.18, 0.45)})`;
      ctx.lineWidth = between(0.6, 1.8);
      ctx.beginPath();
      for (let x = 0; x <= size; x += 8) {
        const y = y0 + Math.tan(tilt) * x + Math.sin(x / between(14, 22) + k) * 1.6;
        (x === 0 ? ctx.moveTo : ctx.lineTo).call(ctx, x, y);
      }
      ctx.stroke();
    }
    if (texture === "slate") for (let i = 0; i < 3; i++) lath(between(0, size), between(0, size), 7, 7, between(0, Math.PI / 2), "#9b6a2c");
    if (texture === "hornfels_spotted") {
      // Cordierite spots and square andalusite (chiastolite) sections that overgrow the foliation.
      for (let i = 0; i < 26; i++) blob(between(0, size), between(0, size), between(3, 7), shade(base, 0.55, 0.9), 9, 0.25);
      for (let i = 0; i < 8; i++) {
        const x = between(0, size), y = between(0, size), w = between(8, 13), a = between(0, Math.PI);
        lath(x, y, w, w, a, "#cfc4b4");
        ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.strokeStyle = "#2a2528"; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(-w / 2, -w / 2); ctx.lineTo(w / 2, w / 2); ctx.moveTo(w / 2, -w / 2); ctx.lineTo(-w / 2, w / 2); ctx.stroke(); ctx.restore();
      }
    }
  } else if (texture === "limestone") {
    for (let i = 0; i < 900; i++) { ctx.fillStyle = shade(base, between(0.85, 1.15), 0.5); ctx.fillRect(between(0, size), between(0, size), 1.5, 1.5); }
    for (let i = 0; i < 12; i++) {
      // Shell fragments and a crinoid ossicle or two.
      ctx.strokeStyle = "#f8f5ec"; ctx.lineWidth = 2.4; ctx.beginPath();
      const x = between(0, size), y = between(0, size), r = between(6, 16), a = between(0, 2 * Math.PI);
      ctx.arc(x, y, r, a, a + between(0.8, 2.2)); ctx.stroke();
    }
    for (let i = 0; i < 3; i++) { const x = between(0, size), y = between(0, size); blob(x, y, 7, "#ece6d8", 10, 0.05); blob(x, y, 1.6, "#6d6457", 6, 0.1); }
  } else if (texture === "gypsum") {
    for (let i = 0; i < 70; i++) lath(between(0, size), between(0, size), between(10, 26), between(2, 5), between(0, Math.PI), pick(["rgba(255,255,255,0.75)", "rgba(240,236,228,0.8)"]));
  } else if (texture === "tuff_lapilli") {
    for (let i = 0; i < 300; i++) { ctx.fillStyle = pick(["#efe9da", "#d8cfbb", "#3b3b38"]); ctx.fillRect(between(0, size), between(0, size), 1.6, 1.6); }
    for (let i = 0; i < 14; i++) blob(between(0, size), between(0, size), between(4, 10), pick(["#7f8a6f", "#6e5a63", "#c9c1ad"]), 6, 0.3);
    for (let i = 0; i < 6; i++) lath(between(0, size), between(0, size), between(10, 18), between(3, 5), between(-0.2, 0.2), "#55655a");
  } else if (texture === "shale") {
    for (let y = 0; y < size; y += between(3, 7)) {
      ctx.strokeStyle = shade(base, between(0.6, 1.2), 0.6);
      ctx.lineWidth = between(0.6, 1.6);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y + between(-2, 2));
      ctx.stroke();
    }
  } else {
    // Sandstone and anything else made of grains.
    grains(520, 2.2, 4.8, ["#efeadf", "#e4dccb", "#d6c39f", "#cfa58a", "#6c6a63", "#f7f4ec"]);
    if (unit.fossils?.length) {
      for (let i = 0; i < 7; i++) {
        ctx.strokeStyle = "#fbf9f3";
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        const x = between(0, size), y = between(0, size), r = between(8, 18), a = between(0, 2 * Math.PI);
        ctx.arc(x, y, r, a, a + between(1.2, 2.4));
        ctx.stroke();
      }
    }
  }
  // Lens: a soft vignette and a rim.
  const glow = ctx.createRadialGradient(c, c, R * 0.55, c, c, R);
  glow.addColorStop(0, "rgba(0,0,0,0)");
  glow.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
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
  ctx.fillRect(c - mm, size - 30, 2 * mm, 3);
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.strokeText("2 mm", c, size - 35);
  ctx.fillText("2 mm", c, size - 35);
}
