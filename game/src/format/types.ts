// Types for the baked scenario format. The schemas in format/schemas are the
// source of truth; keep these in step with them.

export type UnitKey = string;

export interface FileEntry {
  path: string;
  sha256: string;
  bytes: number;
  encoding: "json" | "u16le+gzip" | "u8+gzip" | "rle8+gzip" | "i8x3+gzip";
  visibility: "public" | "reveal" | "truth";
}

export type FileRole = "terrain" | "cover" | "outcrops" | "units" | "litho" | "orient" | "truth";

export interface Grid {
  nx: number;
  ny: number;
  nz: number;
  cell_size_m: { x: number; y: number; z: number };
  origin: { easting: number; northing: number; elevation: number };
}

export interface Manifest {
  format_version: string;
  scenario_id: string;
  variant: string;
  title: string;
  level: number;
  language: string;
  seed: number;
  grid: Grid;
  terrain: { scale_m: number; offset_m: number };
  series: { key: string; kind: "sedimentary" | "volcanic" | "volcaniclastic" | "metamorphic" }[];
  rules: {
    field_days: number;
    minutes_per_day: number;
    sample_limit: number;
    scatter: { strike_sigma_deg: number; dip_sigma_deg: number; poor_quality_factor: number };
  };
  exposure_fraction?: number;
  files: Record<FileRole, FileEntry>;
}

export const COVER_CLASSES = ["bare_rock", "soil", "alluvium", "scree", "vegetation"] as const;
export type CoverClass = (typeof COVER_CLASSES)[number];

export interface Unit {
  key: UnitKey;
  rock_class:
    | "sedimentary"
    | "volcanic"
    | "volcaniclastic"
    | "plutonic"
    | "hypabyssal"
    | "metamorphic"
    | "evaporite"
    | "fault_rock";
  lithology: string;
  colour: string;
  texture: string;
  resistance: number;
  description: { field: string; hand_lens: string };
  fossils?: string[];
  thin_section?: string;
}

export interface Plane {
  id: string;
  kind: "bedding" | "foliation" | "cleavage" | "fault_plane" | "dyke" | "joint" | "contact" | "axial_plane";
  /** Right-hand rule: the plane dips toward strike + 90. */
  strike: number;
  dip: number;
  overturned?: boolean;
  lineation?: {
    kind: "striae" | "fold_hinge" | "mineral" | "intersection" | "stretching";
    trend: number;
    plunge: number;
  };
}

export type ContactType = "depositional" | "unconformity" | "intrusive" | "fault";

export interface Observation {
  quality: "good" | "fair" | "poor";
  unit: UnitKey;
  features: string[];
  planes: Plane[];
  way_up?: {
    indicator: "graded_bedding" | "cross_bedding" | "pillow_shapes" | "load_casts" | "vesicle_zoning" | "scour_marks";
    younging: "upright" | "overturned";
  };
  contact?: { type: ContactType; units: [UnitKey, UnitKey]; evidence: string[]; plane?: string };
  sampleable: boolean;
}

export interface Outcrop {
  id: string;
  position: { easting: number; northing: number; elevation: number };
  cells: [number, number][];
  /** Absent in graded mode, where the server answers through `observe`. */
  observation?: Observation;
}

export interface LineString {
  type: "LineString";
  coordinates: [number, number][];
}

export interface Truth {
  units: {
    key: UnitKey;
    name: string;
    series?: string;
    age: { label: string; from_ma: number; to_ma: number };
    lab_age?: { method: string; material?: string; value_ma: number; error_ma: number };
  }[];
  column: { unit: UnitKey; thickness_m?: number; base_contact: ContactType | "not_exposed" }[];
  events: {
    id: string;
    type: "deposition" | "tilting" | "folding" | "faulting" | "intrusion" | "erosion" | "metamorphism" | "uplift";
    rank: number;
    label: string;
    units?: UnitKey[];
    structures?: string[];
  }[];
  map: { encoding: "rle"; runs: [number, number][] };
  contacts: {
    type: "FeatureCollection";
    features: {
      type: "Feature";
      geometry: LineString;
      properties: {
        id: string;
        type: ContactType;
        units?: [UnitKey, UnitKey];
        kinematics?: "normal" | "reverse" | "thrust" | "dextral" | "sinistral" | "oblique";
        strike?: number;
        dip?: number;
      };
    }[];
  };
  fold_axes: {
    id: string;
    type: "anticline" | "syncline" | "monocline";
    trend: number;
    plunge: number;
    trace: LineString;
  }[];
  /** Since format 1.1.0: sheet intrusions drawn as lines, not map units. */
  dykes?: { id: string; unit: UnitKey; strike: number; dip: number; thickness_m: number; trace: LineString }[];
  lumpable: UnitKey[][];
  key_outcrops: string[];
}

/** What every mode can load: the public part of a scenario. */
export interface Scenario {
  manifest: Manifest;
  /** Raw uint16 values, row-major with the southern row first; see `elevationAt`. */
  terrain: Uint16Array;
  cover: Uint8Array;
  units: Unit[];
  outcrops: Outcrop[];
}

/** Reveal mode: the full block and the bedding poles. */
export interface RevealData {
  /** Unit index per cell; index = ix + nx * (iy + ny * iz). */
  litho: Uint8Array;
  /** One block per series, three int8 per cell (east, north, up) scaled by 127; (0,0,0) is masked. */
  orient: Int8Array;
}
