// A small PDF writer: one or more pages of vector graphics, Helvetica text and JPEG images.
// No dependencies, no dates and no random ids, so the same input gives the same bytes.

type Rgb = [number, number, number];

export function rgb(hex: string): Rgb {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const num = (v: number) => (Math.round(v * 100) / 100).toString();

/** Latin-1 bytes; characters outside it become "?". Spanish text fits in Latin-1. */
export function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) < 256 ? text.charCodeAt(i) : 63;
  return out;
}

const escapeText = (text: string) => Array.from(latin1(text), (b) => (b === 40 || b === 41 || b === 92 ? `\\${String.fromCharCode(b)}` : b < 32 ? " " : String.fromCharCode(b))).join("");

/** Approximate width of Helvetica text in points. Good enough to centre or right-align a label. */
export function textWidth(text: string, size: number): number {
  let em = 0;
  for (const ch of text) {
    em += "iljtfI.,:;!|' ".includes(ch) ? 0.27 : "mMW".includes(ch) ? 0.85 : /[0-9]/.test(ch) ? 0.556 : /[A-ZÁÉÍÓÚÑ]/.test(ch) ? 0.68 : 0.52;
  }
  return em * size;
}

export type FontName = "regular" | "bold" | "italic";
const FONT_ID: Record<FontName, string> = { regular: "F1", bold: "F2", italic: "F3" };

export interface TextOptions {
  size: number;
  font?: FontName;
  colour?: string;
  align?: "left" | "center" | "right";
  /** White outline behind the letters, in points, for text over a busy map. */
  halo?: number;
}

/** Builds the content stream of one page. Coordinates are points from the bottom-left corner. */
export class Content {
  private readonly ops: string[] = [];
  readonly alphas = new Set<number>();
  readonly images = new Set<string>();

  private push(op: string): this {
    this.ops.push(op);
    return this;
  }
  save() { return this.push("q"); }
  restore() { return this.push("Q"); }
  clipRect(x: number, y: number, w: number, h: number) { return this.push(`${num(x)} ${num(y)} ${num(w)} ${num(h)} re W n`); }
  rect(x: number, y: number, w: number, h: number) { return this.push(`${num(x)} ${num(y)} ${num(w)} ${num(h)} re`); }
  strokeColour(hex: string) { return this.push(`${rgb(hex).map(num).join(" ")} RG`); }
  fillColour(hex: string) { return this.push(`${rgb(hex).map(num).join(" ")} rg`); }
  lineWidth(w: number) { return this.push(`${num(w)} w`); }
  dash(pattern: number[], phase = 0) { return this.push(`[${pattern.map(num).join(" ")}] ${num(phase)} d`); }
  cap(round: boolean) { return this.push(`${round ? 1 : 0} J`); }
  alpha(a: number) {
    const key = Math.round(a * 100);
    this.alphas.add(key);
    return this.push(`/GA${key} gs`);
  }
  moveTo(x: number, y: number) { return this.push(`${num(x)} ${num(y)} m`); }
  curve(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
    return this.push(`${num(x1)} ${num(y1)} ${num(x2)} ${num(y2)} ${num(x)} ${num(y)} c`);
  }
  /** A circle as four Bezier curves, without painting it. */
  circle(cx: number, cy: number, r: number): this {
    const k = 0.5523 * r;
    return this.moveTo(cx + r, cy)
      .curve(cx + r, cy + k, cx + k, cy + r, cx, cy + r)
      .curve(cx - k, cy + r, cx - r, cy + k, cx - r, cy)
      .curve(cx - r, cy - k, cx - k, cy - r, cx, cy - r)
      .curve(cx + k, cy - r, cx + r, cy - k, cx + r, cy)
      .close();
  }
  lineTo(x: number, y: number) { return this.push(`${num(x)} ${num(y)} l`); }
  close() { return this.push("h"); }
  stroke() { return this.push("S"); }
  fill() { return this.push("f"); }
  fillStroke() { return this.push("B"); }

  /** A path through flat x, y pairs, without painting it. */
  path(points: number[], closed = false): this {
    for (let i = 0; i + 1 < points.length; i += 2) (i === 0 ? this.moveTo : this.lineTo).call(this, points[i]!, points[i + 1]!);
    return closed ? this.close() : this;
  }
  polyline(points: number[]) { return this.path(points).stroke(); }

  image(name: string, x: number, y: number, w: number, h: number) {
    this.images.add(name);
    return this.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(y)} cm /${name} Do Q`);
  }

  text(x: number, y: number, text: string, o: TextOptions): this {
    const width = textWidth(text, o.size);
    const left = o.align === "center" ? x - width / 2 : o.align === "right" ? x - width : x;
    const show = (mode: number) => this.push(`BT /${FONT_ID[o.font ?? "regular"]} ${num(o.size)} Tf ${mode} Tr ${num(left)} ${num(y)} Td (${escapeText(text)}) Tj ET`);
    if (o.halo) {
      this.save().strokeColour("#ffffff").lineWidth(o.halo).push("1 j");
      show(1);
      this.restore();
    }
    this.fillColour(o.colour ?? "#000000");
    show(0);
    return this;
  }

  toString(): string {
    return this.ops.join("\n");
  }
}

export interface Jpeg {
  bytes: Uint8Array;
  width: number;
  height: number;
}

export interface PageSpec {
  width: number;
  height: number;
  content: Content;
}

export interface DocumentSpec {
  title: string;
  pages: PageSpec[];
  /** Images by the name the content refers to them with. */
  images?: Record<string, Jpeg>;
}

/** The finished file. Objects are numbered in a fixed order: catalogue, page tree, fonts, images, pages. */
export function buildPdf(doc: DocumentSpec): Uint8Array {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const write = (data: Uint8Array | string) => {
    const bytes = typeof data === "string" ? latin1(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = length;
    write(`${id} 0 obj\n${body}`);
    if (stream) {
      write("\nstream\n");
      write(stream);
      write("\nendstream");
    }
    write("\nendobj\n");
  };

  const imageNames = Object.keys(doc.images ?? {});
  const imageId = (name: string) => 6 + imageNames.indexOf(name);
  const firstPage = 6 + imageNames.length;
  const pageIds = doc.pages.map((_, i) => firstPage + 2 * i);

  write("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  object(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  object(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  object(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>");
  for (const name of imageNames) {
    const image = doc.images![name]!;
    object(imageId(name), `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>`, image.bytes);
  }
  doc.pages.forEach((page, i) => {
    const stream = latin1(page.content.toString());
    const states = [...page.content.alphas].sort((a, b) => a - b).map((k) => `/GA${k} << /ca ${k / 100} /CA ${k / 100} >>`);
    const images = [...page.content.images].map((name) => `/${name} ${imageId(name)} 0 R`);
    const resources = `<< /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> /ExtGState << ${states.join(" ")} >> /XObject << ${images.join(" ")} >> >>`;
    object(pageIds[i]!, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] /Resources ${resources} /Contents ${pageIds[i]! + 1} 0 R >>`);
    object(pageIds[i]! + 1, `<< /Length ${stream.length} >>`, stream);
  });
  const infoId = firstPage + 2 * doc.pages.length;
  object(infoId, `<< /Title (${escapeText(doc.title)}) /Creator (MineGeology) >>`);

  const xref = length;
  write(`xref\n0 ${infoId + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= infoId; id++) write(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  write(`trailer\n<< /Size ${infoId + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) (out.set(chunk, at), (at += chunk.length));
  return out;
}
