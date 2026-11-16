# Work package 1: scenario format

## What was built

- `format/schemas/`: JSON Schemas (draft 2020-12) for `manifest.json`, `units.json`, `outcrops.json` and `truth.json`.
- `format/SPEC.md`: the written spec, covering the binary files, coordinates, angle conventions, cross-file rules and versioning.
- `format/examples/toy/`: a 16 x 16 x 8 toy scenario (homocline striking north, dipping 30° east, three units, a stream valley, three outcrops), built by `format/examples/make_toy.py`.
- `bake/geomapper_bake/scenario_format.py` and the `geomapper validate` command: schema, hash, size and cross-file checks.
- `game/src/format/`: TypeScript types and the loader the game will use, validated against the same schemas.

Done-when test: the toy scenario validates on both sides (`pytest` in `bake/`, `npm test` in `game/`). Both suites also check that broken scenarios are refused.

## Choices made here that the architecture left open

These follow from the architecture but were not spelled out in it. Each can be changed before more code depends on it.

- **Where lab ages live.** `units.json` holds the thin-section description; radiometric ages are in `truth.json` (`units[].lab_age`). This keeps "no ages in the public file" literally true. In graded mode the server returns the age when a sample comes back.
- **Outcrop observations are one optional block.** Each outcrop has a position and footprint, plus an `observation` object that graded mode strips. One schema covers both modes.
- **Opaque unit keys.** Keys such as `u07` are shuffled relative to stratigraphic order, since students can read them in the browser.
- **The lithology block holds geology above the terrain too.** The game cuts it with the terrain. This keeps the block a plain GemPy output and makes cross-sections trivial.
- **Bare rock means outcrop.** Every bare-rock cover cell must belong to an outcrop and the reverse. Scree and other cover never expose bedrock.
- **Level 0** is reserved for toy and test scenarios; the library uses 1 to 6.

## Left open

- The fault-slip export for scenario 6 (MesoFaultKin) is not in the format yet. It will be a minor version.
- `truth.json` has no cross-sections: the grader cuts them from `litho.bin`.
- The "light obfuscation" of practice bundles is not defined. It is a packaging step and does not change the format.
- The JSON Schemas are duplicated as hand-written TypeScript types in `game/src/format/types.ts`. Generating them is possible later if they drift.
