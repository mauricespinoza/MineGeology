# GeoMapper Chile

A browser game where a student walks a fictional terrain, finds outcrops, measures them and builds a geological map, a cross-section and a geological history. Each area is invented; its geology is authored in GemPy and follows patterns seen in Chilean geology.

The design is in [docs/architecture.md](docs/architecture.md). The scenario format that joins the Python and browser halves is in [format/SPEC.md](format/SPEC.md).

## Status

| WP | Deliverable | State |
| --- | --- | --- |
| 1 | Scenario format: schemas, spec, toy scenario | Done ([notes](docs/wp1-format.md)) |
| 2 | Bake core: GemPy runner, lithology block, bedding field, true map and traces | Done ([notes](docs/wp2-bake-core.md)) |
| 3 | Exposure model, outcrop catalogue, validation report, scenario 1 | Next |
| 4 to 10 | See section 10 of the architecture | Not started |

## Layout

```
scenarios/   one folder per scenario: model.py, scenario.yaml, terrain
bake/        Python package geomapper_bake
format/      the scenario format: JSON Schemas, spec, toy example
game/        the browser game (TypeScript, Vite, Three.js)
server/      database schema, server functions, LTI (stage B and C)
dashboard/   teacher views
baked/       output of the bake (public parts only)
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
```

Writing a scenario is described in [docs/scenario-authoring.md](docs/scenario-authoring.md).

Game (Node 22 or newer):

```bash
cd game
npm install
npm run typecheck
npm test
```
