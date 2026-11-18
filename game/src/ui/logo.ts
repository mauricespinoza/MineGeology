// The MineGeology title, built of stone blocks from a small pixel font: each letter is a 5 x 7 grid,
// every pixel a block with a lit top, a shaded side and a dark outline, drawn as SVG so it works offline.

const GLYPHS: Record<string, string[]> = {
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  I: ["111", "010", "010", "010", "010", "010", "111"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
};

/** Stone for "Mine", and the colours of rock strata for "Geology", block by block. */
const STONE = ["#a7a7a2", "#9a9a95", "#8d8d88", "#b1b1ab"];
const STRATA = ["#c9a46a", "#b9814f", "#a3603e", "#8e6b4a", "#c2b089", "#9a8c6c", "#7d6a52"];

function shade(hex: string, f: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/** Each letter made bold: a pixel also fills the one to its right, as block-game titles are two blocks thick. */
function bold(g: string[]): string[] {
  return g.map((row) => {
    const out = [...row, "0"];
    for (let i = 0; i < row.length; i++) if (row[i] === "1") out[i + 1] = "1";
    return out.join("");
  });
}

/** SVG markup of the title; `px` is the size of one block. */
export function logoSvg(px = 9): string {
  const words: [string, (row: number, i: number) => string][] = [
    ["MINE", (_row, i) => STONE[(i * 7) % STONE.length]!],
    ["GEOLOGY", (row) => STRATA[row % STRATA.length]!], // horizontal beds through the letters
  ];
  const depth = Math.max(2, Math.round(px * 0.45)), edge = Math.max(1.5, px * 0.22);
  const outline: string[] = [], sides: string[] = [], faces: string[] = [];
  let x = 0;
  let count = 0;
  for (const [w, [word, colour]] of words.entries()) {
    if (w) x += px; // MineGeology is one word: a narrow gap, and the colour changes
    for (const ch of word) {
      const g = bold(GLYPHS[ch]!);
      for (let row = 0; row < g.length; row++) {
        for (let col = 0; col < g[row]!.length; col++) {
          if (g[row]![col] !== "1") continue;
          const bx = x + col * px, by = row * px, fill = colour(row, count++);
          outline.push(`<rect x="${bx - edge}" y="${by - edge}" width="${px + 2 * edge + depth}" height="${px + 2 * edge + depth}"/>`);
          sides.push(`<rect x="${bx + depth}" y="${by + depth}" width="${px}" height="${px}" fill="${shade(fill, 0.42)}"/>`);
          faces.push(`<rect x="${bx}" y="${by}" width="${px + 0.6}" height="${px + 0.6}" fill="${fill}"/>`);
          faces.push(`<rect x="${bx}" y="${by}" width="${px}" height="${px * 0.2}" fill="${shade(fill, 1.18)}"/>`);
        }
      }
      x += (g[0]!.length + 1) * px;
    }
  }
  const pad = Math.ceil(edge) + 1;
  const width = x - px + depth + 2 * pad, height = 7 * px + depth + 2 * pad;
  return `<svg class="logo" viewBox="${-pad} ${-pad} ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="MineGeology"><g fill="#151515">${outline.join("")}</g>${sides.join("")}${faces.join("")}</svg>`;
}
