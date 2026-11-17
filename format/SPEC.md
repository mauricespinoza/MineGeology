# Baked scenario format, version 1.3.0

A baked scenario is a folder of static files. It is the only thing the offline bake (Python, GemPy) and the game (TypeScript) share. The JSON Schemas in `schemas/` are normative for the JSON files; this document is normative for the binary files and for the rules that link files together.

`examples/toy/` is a complete, valid scenario built by `examples/make_toy.py`.

## Files

| Role | File | Encoding | Visibility |
| --- | --- | --- | --- |
| manifest | `manifest.json` | JSON | public |
| terrain | `terrain.bin` | `u16le+gzip` | public |
| cover | `cover.bin` | `u8+gzip` | public |
| outcrops | `outcrops.json` | JSON | public (observations stripped in graded mode) |
| units | `units.json` | JSON | public |
| litho | `litho.bin` | `rle8+gzip` | reveal |
| orient | `orient.bin` | `i8x3+gzip` | reveal |
| truth | `truth.json` | JSON | truth |

`manifest.json` is always named so. Every other file is found through `manifest.files[role].path`, and must match the `bytes` and `sha256` recorded there. The manifest lists all seven files even in a bundle that ships only the public ones.

Visibility says who may receive a file: `public` always, `reveal` only once the teacher unlocks reveal mode, `truth` never before grading. In practice mode (static hosting) everything is downloadable and this is only a convention; in graded mode the server enforces it.

## Grid and coordinates

- Axes: x east, y north, z up. Cell `(ix, iy, iz)` covers `origin + (ix..ix+1) * cell_size_m.x` and so on; `origin` is the south-west-bottom corner of cell `(0, 0, 0)`.
- Coordinates are a fictional local metric grid (easting, northing, elevation in metres). They look like UTM but match no real place.
- 2D arrays (`terrain`, `cover`, the truth map) hold `nx * ny` values at index `ix + nx * iy`. The southern row comes first.
- 3D arrays (`litho`, `orient`) hold `nx * ny * nz` cells at index `ix + nx * (iy + ny * iz)`. The bottom layer comes first.
- Values describe cell centres.

## Angles

- Planes use strike and dip with the right-hand rule: strike is an azimuth in `[0, 360)` and the plane dips toward `strike + 90`. Dip is in `[0, 90]`. An overturned bed keeps its geometric strike and dip and carries `"overturned": true`.
- Lines use trend in `[0, 360)` and plunge in `[0, 90]`.
- All orientations in the files are true values. Measurement scatter is added by the game from `manifest.rules.scatter`, seeded per student.

## Binary encodings

All binary files are gzip streams. Bakes write them with a zero timestamp and the header's operating-system byte set to 255, so the same input gives the same content and, on the same zlib build, the same bytes. The hashes in the manifest are those of the files as written.

- **`u16le+gzip`** (terrain). Unsigned 16-bit little-endian integers. `elevation_m = terrain.offset_m + value * terrain.scale_m`. Every elevation must lie inside the block, between `origin.elevation` and `origin.elevation + nz * cell_size_m.z`.
- **`u8+gzip`** (cover). One byte per surface cell: `0` bare rock, `1` soil, `2` alluvium, `3` scree, `4` vegetation.
- **`rle8+gzip`** (litho). Three-byte records: a unit index (uint8) and a run length (uint16 little-endian, 1 to 65535). A unit index is a position in `units.json`. The block holds geology for every cell, including cells above the terrain; the game cuts it with the terrain.
- **`i8x3+gzip`** (orient). For each series in `manifest.series`, in order, one block of `nx * ny * nz` cells with three signed bytes per cell: the east, north and up components of the unit pole to bedding, multiplied by 127. The pole is the normalised gradient of the series' scalar field, so it points toward younger beds: a negative up component means the bed is overturned. `(0, 0, 0)` marks a cell with no reliable orientation (outside the series, or inside the buffer around a fault or unconformity). For a series of kind `metamorphic` the pole is that of the foliation.

## Rules across files

1. A unit's index is its position in `units.json`. `truth.json` lists the same keys in the same order.
2. Unit keys (`u07`) and series keys (`s01`) are opaque. They must not follow stratigraphic order, because the student's browser sees them.
3. `units.json` carries no formation names and no ages. Those, and radiometric lab ages, live in `truth.json`.
4. Every cell of an outcrop footprint is bare rock in `cover.bin`, every bare-rock cell belongs to exactly one outcrop, and no cell belongs to two.
5. An outcrop's `observation` is present in practice bundles. For graded mode the server serves `outcrops.json` without it and answers through `observe`.
6. Every unit key, series key, plane id and outcrop id used anywhere refers to something that exists.
7. `truth.map` covers exactly `nx * ny` cells.
8. Dykes (since 1.1.0) are sheet intrusions too thin for the lithology block. Their rock is a unit in `units.json` that never appears in `litho.bin` or in the truth map; `truth.dykes` holds each one's trace, strike, dip and thickness. An outcrop crossed by a dyke lists a plane of kind `dyke`.
9. Photos (since 1.2.0) are optional JPEG files under `photos/`. Each is listed in the manifest's `assets` with its size and sha256, and named by a unit's `photos` entry in `units.json` with its kind (hand sample, thin section in plane or crossed polarised light, outcrop), credit and licence. They are reference photos of a similar rock, public, and carry no metadata (no GPS).

10. Kinematic indicators (since 1.3.0): an outcrop's `observation.kinematic` names a shear-sense indicator (`steps`, `riedel`, `drag`, `tension_gashes`, `sc_fabric`, `sigma_clast`), the fault plane of the same outcrop it is seen on, and the sense of slip (`normal`, `reverse`, `dextral`, `sinistral`). The game draws the indicator; it does not tell the student the sense. Thrusts are `reverse`.
11. Contact aureoles (since 1.3.0): a contact of type `gradational` is the outer limit of a metamorphic aureole against its unmetamorphosed host. It appears in `truth.contacts` and in outcrop contacts, never as a `base_contact` in the column.
12. The manifest may carry a one-line `summary` (since 1.3.0) for a start screen. It must not give the answer away.

`geomapper validate <folder>` checks all of the above; add `--public` for a bundle without reveal and truth files.

## Practice bundles

For ungraded practice on static hosting, `geomapper publish --practice` adds one file next to the public ones: `practice.bin`, which is `truth.json` gzipped and then XORed byte by byte with the 32 bytes of its sha256 from the manifest. It is not listed in the manifest and is not part of the format. It keeps the answer key from being read at a glance and nothing more; graded work must not ship it. `practice-litho.bin` is `litho.bin` packed the same way, keyed by its own sha256, so that practice mode can cut the true cross-section.

## Versioning

`format_version` is `major.minor.patch`.

- **Major** changes when an existing reader would misread a scenario (a file changes meaning, layout or name). A reader refuses any scenario with a major version above its own and says so.
- **Minor** changes when optional content is added that older readers can ignore.
- **Patch** is for clarifications of this document.

## History

- **1.3.0**: optional `kinematic` indicators in outcrop observations; contact type `gradational` (aureole limits); optional `summary` in the manifest; `foliation` planes are now written for metamorphic series. A 1.2 reader shows a gradational contact without a label and ignores the rest.
- **1.2.0**: optional reference photos: `photos` in `units.json`, `assets` in the manifest.
- **1.1.0**: optional `dykes` in `truth.json`.
- **1.0.0**: first version.

Any change to this folder that alters what a valid scenario is must raise the version and update both `bake/geomapper_bake/scenario_format.py` and `game/src/format/`.
