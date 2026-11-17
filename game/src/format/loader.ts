// Loads a baked scenario (format/SPEC.md). Works in the browser and in Node 22+:
// it relies only on DecompressionStream and crypto.subtle.

import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import manifestSchema from "../../../format/schemas/manifest.schema.json";
import outcropsSchema from "../../../format/schemas/outcrops.schema.json";
import truthSchema from "../../../format/schemas/truth.schema.json";
import unitsSchema from "../../../format/schemas/units.schema.json";
import type { FileRole, Manifest, Outcrop, RevealData, Scenario, Truth, Unit } from "./types";

export const SUPPORTED_MAJOR = 1;

export class FormatError extends Error {
  override name = "FormatError";
}

/** Returns the bytes of one file of the scenario folder, by its relative path. */
export type FileReader = (path: string) => Promise<Uint8Array>;

const ajv = new Ajv2020({ allErrors: true });
const validators = {
  manifest: ajv.compile(manifestSchema),
  outcrops: ajv.compile(outcropsSchema),
  units: ajv.compile(unitsSchema),
  truth: ajv.compile(truthSchema),
};

function check<T>(name: keyof typeof validators, doc: unknown): T {
  const validate: ValidateFunction = validators[name];
  if (!validate(doc)) {
    const first = validate.errors?.[0];
    throw new FormatError(`${name}.json: ${first?.instancePath || "(root)"} ${first?.message ?? "is invalid"}`);
  }
  return doc as T;
}

function parseJson(name: string, bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (cause) {
    throw new FormatError(`${name}: not valid JSON`, { cause });
  }
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Records of (value: uint8, run length: uint16 little-endian). */
export function decodeRle8(raw: Uint8Array, expected: number): Uint8Array {
  if (raw.length % 3 !== 0) throw new FormatError("run-length data is not a whole number of records");
  const out = new Uint8Array(expected);
  let at = 0;
  for (let i = 0; i < raw.length; i += 3) {
    const run = raw[i + 1]! | (raw[i + 2]! << 8);
    if (run === 0 || at + run > expected) throw new FormatError("run-length data does not fit the grid");
    out.fill(raw[i]!, at, at + run);
    at += run;
  }
  if (at !== expected) throw new FormatError(`run-length data holds ${at} cells, grid needs ${expected}`);
  return out;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function readFile(read: FileReader, manifest: Manifest, role: FileRole): Promise<Uint8Array> {
  const entry = manifest.files[role];
  const bytes = await read(entry.path);
  if (bytes.length !== entry.bytes || (await sha256(bytes)) !== entry.sha256) {
    throw new FormatError(`${entry.path} does not match the manifest (size or sha256)`);
  }
  return bytes;
}

function sized(name: string, values: Uint8Array, expected: number): Uint8Array {
  if (values.length !== expected) throw new FormatError(`${name}: ${values.length} bytes, grid needs ${expected}`);
  return values;
}

export async function loadManifest(read: FileReader): Promise<Manifest> {
  const doc = parseJson("manifest.json", await read("manifest.json"));
  const version = (doc as { format_version?: unknown } | null)?.format_version;
  const major = typeof version === "string" ? Number.parseInt(version, 10) : Number.NaN;
  if (Number.isNaN(major)) throw new FormatError("manifest.json has no usable format_version");
  if (major > SUPPORTED_MAJOR) {
    throw new FormatError(
      `This scenario uses format ${version}; this version of the game reads up to ${SUPPORTED_MAJOR}.x. Update the game.`,
    );
  }
  return check<Manifest>("manifest", doc);
}

/** Loads the public part of a scenario: all that a student's browser needs to explore. */
export async function loadScenario(read: FileReader): Promise<Scenario> {
  const manifest = await loadManifest(read);
  const { nx, ny } = manifest.grid;
  const [terrainFile, coverFile, unitsFile, outcropsFile] = await Promise.all(
    (["terrain", "cover", "units", "outcrops"] as const).map((role) => readFile(read, manifest, role)),
  );

  const terrainBytes = sized("terrain", await gunzip(terrainFile!), nx * ny * 2);
  const view = new DataView(terrainBytes.buffer, terrainBytes.byteOffset, terrainBytes.byteLength);
  const terrain = new Uint16Array(nx * ny);
  for (let i = 0; i < terrain.length; i++) terrain[i] = view.getUint16(i * 2, true);

  const cover = sized("cover", await gunzip(coverFile!), nx * ny);
  const units = check<{ units: Unit[] }>("units", parseJson("units.json", unitsFile!)).units;
  const outcrops = check<{ outcrops: Outcrop[] }>("outcrops", parseJson("outcrops.json", outcropsFile!)).outcrops;

  const keys = new Set(units.map((u) => u.key));
  for (const outcrop of outcrops) {
    for (const [ix, iy] of outcrop.cells) {
      if (ix >= nx || iy >= ny) throw new FormatError(`outcrop ${outcrop.id} lies outside the grid`);
    }
    if (outcrop.observation && !keys.has(outcrop.observation.unit)) {
      throw new FormatError(`outcrop ${outcrop.id} refers to unknown unit ${outcrop.observation.unit}`);
    }
  }
  return { manifest, terrain, cover, units, outcrops };
}

export async function loadReveal(read: FileReader, manifest: Manifest): Promise<RevealData> {
  const { nx, ny, nz } = manifest.grid;
  const cells = nx * ny * nz;
  const litho = decodeRle8(await gunzip(await readFile(read, manifest, "litho")), cells);
  const orient = sized(
    "orient",
    await gunzip(await readFile(read, manifest, "orient")),
    cells * 3 * manifest.series.length,
  );
  return { litho, orient: new Int8Array(orient.buffer, orient.byteOffset, orient.byteLength) };
}

export async function loadTruth(read: FileReader, manifest: Manifest): Promise<Truth> {
  return check<Truth>("truth", parseJson("truth.json", await readFile(read, manifest, "truth")));
}

/**
 * Practice mode: the answer key shipped next to the public files as practice.bin, lightly obfuscated
 * (gzip, then XOR with the bytes of truth.json's sha256). Returns null when the bundle has none.
 */
export async function loadPracticeTruth(read: FileReader, manifest: Manifest): Promise<Truth | null> {
  let packed: Uint8Array;
  try {
    packed = await read("practice.bin");
  } catch {
    return null;
  }
  const hex = manifest.files.truth.sha256;
  const key = Uint8Array.from({ length: 32 }, (_, i) => Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16));
  const bytes = await gunzip(packed.map((b, i) => b ^ key[i % 32]!));
  if ((await sha256(bytes)) !== hex) throw new FormatError("practice.bin does not match the manifest");
  return check<Truth>("truth", parseJson("truth.json", bytes));
}

/** Expands the true map into one unit index per surface cell. */
export function expandTruthMap(truth: Truth, manifest: Manifest): Uint8Array {
  const out = new Uint8Array(manifest.grid.nx * manifest.grid.ny);
  let at = 0;
  for (const [index, run] of truth.map.runs) {
    if (at + run > out.length) throw new FormatError("truth map is larger than the grid");
    out.fill(index, at, at + run);
    at += run;
  }
  if (at !== out.length) throw new FormatError("truth map is smaller than the grid");
  return out;
}

export function elevationAt(scenario: Scenario, ix: number, iy: number): number {
  const { terrain, grid } = scenario.manifest;
  return terrain.offset_m + scenario.terrain[ix + grid.nx * iy]! * terrain.scale_m;
}
