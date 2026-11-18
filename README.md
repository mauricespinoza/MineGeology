# GeoMapper Chile

A browser game where a student walks a fictional terrain, finds outcrops, measures them and builds a geological map, a cross-section and a geological history. Each area is invented; its geology is authored in GemPy and follows patterns seen in Chilean geology.

The design is in [docs/architecture.md](docs/architecture.md). The scenario format that joins the Python and browser halves is in [format/SPEC.md](format/SPEC.md).

## Play

The game is published at https://mauricespinoza.github.io/MineGeology/ (practice mode, ungraded). It is deployed by `.github/workflows/pages.yml` whenever `game/`, `baked/` or `format/` change on `main`. The repository needs Settings > Pages > Source set to GitHub Actions once. The site includes `practice.bin`, the answer key in lightly obfuscated form, so it must not be used for graded work.

## Status

| WP | Deliverable | State |
| --- | --- | --- |
| 1 | Scenario format: schemas, spec, toy scenario | Done ([notes](docs/wp1-format.md)) |
| 2 | Bake core: GemPy runner, lithology block, bedding field, true map and traces | Done ([notes](docs/wp2-bake-core.md)) |
| 3 | Exposure model, outcrop catalogue, validation report, scenario 1 | Done ([notes](docs/wp3-exposure.md)) |
| 4 | Game world: blocky terrain, cover, outcrops, walking, fog of war, field clock | Built; frame rate on a real laptop not yet checked ([notes](docs/wp4-game-world.md)) |
| 5 | Field tools and notebook, local save | Done ([notes](docs/wp5-field-tools.md)) |
| 6 | Map board and stereonet, export to GeoJSON and PDF | Done ([notes](docs/wp6-map-board.md)) |
| 6b | Field feel: two modes, on-screen controls, slope, reading the compass, hammer and lens | Done ([notes](docs/field-feel.md)) |
| 7 | Cross-section, column and history tools; grader with unit matching | Done ([notes](docs/wp7-section-grader.md)) |
| 8 | Scenarios 2 to 4 and variants; kinematic indicators on fault planes; start screen | Done, pending approval of the three reports ([notes](docs/wp8-scenarios.md)) |
| 8b | Tablets and phones: touch interface with icons, pinch zoom | Done on emulated devices ([notes](docs/mobile-ui.md)) |
| 8c | Characters: figure, skin tone, field gear, third-person view | Done ([notes](docs/characters.md)) |
| 8d | MineGeology: sound, units at stations, fault symbols, pointing at rock | Done ([notes](docs/field-feel-2.md)) |
| 8e | Flying pose, minimap, desert and forest environments, levels by difficulty | Done ([notes](docs/flight-map-biomes.md)) |
| 9 to 10 | See section 10 of the architecture | Not started |

## Layout

```
scenarios/   one folder per scenario: model.py, scenario.yaml, terrain
bake/        Python package geomapper_bake
format/      the scenario format: JSON Schemas, spec, toy example
game/        the browser game (TypeScript, Vite, Three.js)
server/      database schema, server functions, LTI (stage B and C)
dashboard/   teacher views
baked/       public files of baked scenarios, served with the game
docs/        architecture and one note per work package
```

## Running the tests

Python (3.11 or newer):

```bash
cd bake
pip install -e ".[dev]"
pytest
geomapper validate ../format/examples/toy
geomapper bake tests/scenarios/faulted_cover --out ../build/faulted
geomapper bake ../scenarios/quebrada-los-litres --coarsen 4 --report   # quick draft, about a minute
geomapper bake ../scenarios/quebrada-los-litres --report               # full resolution, about half an hour
```

Writing a scenario is described in [docs/scenario-authoring.md](docs/scenario-authoring.md).

Game (Node 22 or newer):

```bash
cd game
npm install
npm run typecheck
npm test
npm run dev        # then open http://localhost:5173
```

The game loads `baked/quebrada-los-litres-a` by default; add `?s=<folder>` to the address for another scenario in `baked/`. After re-baking a scenario, refresh its files with `geomapper publish --practice build/<name> baked/<name>`. `npm run e2e` walks the game in a real browser while the dev server is running.
