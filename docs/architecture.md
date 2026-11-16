# GeoMapper Chile — Architecture for a geological mapping simulator

Nov 16, 2026 · @Mauricio Espinoza

## 1. Purpose and design principles

GeoMapper Chile is a browser game where a student walks a fictional terrain, finds outcrops, measures them and builds a geological map, a cross-section and a geological history. Each area is invented, but its geology is authored in GemPy and follows patterns seen in Chilean geology. The working name is a placeholder.

This document is the build specification. Fable 5.2 wrote the architecture; Opus 5.5 implements it work package by work package (section 10).

Six rules shape every decision below:

1. **One hidden truth.** Every scenario is a complete 3D geological model. The student only ever sees what an outcrop exposes. Map, stereonet, section and grading all read from the same model, so they can never disagree.
2. **GemPy runs offline, never in the game.** Scenarios are computed once in Python and exported ("baked") into static files. The browser only reads those files. This keeps the game fast, cheap to host and free of a Python server.
3. **The baked scenario is the contract.** Python and the browser share one versioned file format (section 5). Either side can be rebuilt without touching the other.
4. **Field realism over game realism.** Outcrop is scarce and uneven, measurements carry scatter, time is limited, and cover hides contacts. The difficulty of real mapping is the lesson.
5. **Static first, accounts second.** The game works as a static site with local saves. Accounts, the teacher dashboard and Canvas are added on top without changing the game.
6. **Scenarios are data, not code.** A new area is a GemPy script plus a configuration file. Adding one requires no change to the game.

## 2. System overview

The system has an offline half that produces scenarios and an online half that students use, joined only by the baked scenario files.

&#91;embedded content: system overview · 7 components, offline and online\]

Read it left to right, then down: the teacher's GemPy model is baked once into static files. The public files go to the game; the answer key goes only to the backend, which grades and reports to Canvas and to the teacher. Without the backend (practice mode), the game loads everything itself and grades locally.

## 3. Scenario pipeline: from GemPy to game data

A scenario is authored in three files and baked by one command, `geomapper bake <scenario>`.

**What Mauricio writes**

- `model.py`: a normal GemPy 3 script. It defines the structural frame (series, faults, unconformities, intrusions) from surface points and orientations, exactly as in research use.
- `scenario.yaml`: everything GemPy does not know. Extent and resolution, lithology of each unit (rock type, texture, fossils, hand-lens description), ages, the true event sequence, lab results per unit, exposure settings and difficulty.
- `terrain`: either a real DEM clipped from Chile and relocated, or a procedural terrain generated from the model so that resistant units form ridges.

**What the bake step computes**

1. **Lithology block.** Run GemPy on a regular grid (default 256 x 256 x 96 cells, about 10 m cells for a 2.5 km square area). Store one unit id per cell.
2. **Bedding field.** For each sedimentary or volcanic series, take the gradient of GemPy's scalar field. Its direction is the pole to bedding, which gives strike and dip at every cell. This is the key trick: orientations come from the model itself, so they are consistent with the map pattern.
3. **Younging and overturning.** The sign of the scalar gradient against the vertical marks overturned beds, which feeds way-up indicators.
4. **Geological map and contacts.** Intersect the block with the terrain to get the true bedrock map. Extract contact and fault traces as vector lines, each tagged with its type (depositional, unconformity, intrusive, fault and its kinematics).
5. **Exposure model.** Compute an outcrop probability per surface cell from slope, stream incision, ridges, rock resistance and a cover layer (soil, alluvium, vegetation). Sample it with a fixed seed to place outcrops. Target: 3 to 8 % of the area exposed.
6. **Outcrop catalogue.** For each outcrop, record its unit, true bedding, structures present (cleavage, fault plane with striae, fold hinge, contact) and the features a student can observe.
7. **Validation report.** An HTML page with the true map, three sections, a stereonet per domain and exposure statistics, so the scenario can be checked before students see it.

**Design choices worth knowing**

- Measurement scatter is not baked. The game adds it at measurement time (default: 3 degrees on dip, 5 degrees on strike, more on poor outcrops), seeded per student so that two students get slightly different readings.
- Minor structures that GemPy cannot model (parasitic folds, cleavage, slickensides) are derived by rule: cleavage is set axial-planar to the nearest fold, striae follow the fault's stated kinematics.
- The bake is deterministic. The same inputs and seed always give the same files, which makes scenarios reproducible and testable.

## 4. Scenario library: fictional areas, Chilean geology

Six scenarios cover the main structural styles of the Chilean margin, ordered by difficulty. Place names and unit names are invented; the rock associations, structural styles and histories follow the real analogue. The first scenario is the test bed for the whole pipeline.

| Level | Fictional area | Chilean analogue | Geology the student must solve | Skills trained |
| --- | --- | --- | --- | --- |
| 1 | Quebrada Los Litres | Coastal Cordillera of central Chile: Jurassic to Lower Cretaceous volcano-sedimentary pile | East-dipping homocline of lavas, breccias and marine sandstones, cut by a few dykes | Strike and dip, rule of V's, stratigraphic column, true thickness |
| 2 | Cerro Pizarras | Coastal Cordillera near Concepción: Paleozoic metamorphic basement, Carboniferous batholith, Triassic cover | Foliated schists intruded by granitoid with a contact aureole, both under an angular unconformity with continental Triassic beds | Unconformities, intrusive contacts, foliation versus bedding, relative ages |
| 3 | Valle del Yeso Blanco | Main Cordillera at 33 to 36°S: Mesozoic back-arc succession in a fold-and-thrust belt | Red beds, gypsum and fossil-bearing limestones folded into an anticline-syncline pair, with an overturned limb and one thrust | Fold geometry on a stereonet, way-up criteria, repeated stratigraphy, cross-section balancing |
| 4 | Estero Las Tobas | Cenozoic intra-arc basins of the Main Cordillera (Abanico and Cura-Mallín style) | A thick volcaniclastic basin fill that thickens toward a normal fault later reactivated as a reverse fault, with a Miocene pluton sealing part of it | Basin inversion, growth strata, fault reactivation, using ages to bracket deformation |
| 5 | Cordón de la Sal | Salar de Atacama basin and Cordillera de la Sal | Evaporite-cored tight folds in Oligocene to Miocene continental beds, Cretaceous red beds on the basin margin, and flat ignimbrites sealing the folds | Detachment folding, salt-related geometries, dating deformation with an unconformable cover |
| 6 | Falla El Tigre | Margin-parallel strike-slip systems (Atacama and Liquiñe-Ofqui style) | A strike-slip duplex with mylonites and cataclasites, a displaced pluton and fault-bounded slivers of different units | Kinematic indicators, offset markers, fault-rock types, stress inversion from fault-slip data |

Each scenario ships in two or three variants built from the same GemPy script with different parameters (fold tightness, fault throw, erosion level, outcrop seed). Students in the same section can then receive different maps of the same geology, which limits copying without extra authoring.

Scenario 6 exports its fault-slip measurements in a format MesoFaultKin can read, so the stress-inversion exercise uses the students' own data.

## 5. Baked scenario format

A baked scenario is a folder of static files, about 3 to 8 MB compressed. It splits into a public part the browser downloads and an answer key that stays on the server.

| File | Content | Format | Sent to student |
| --- | --- | --- | --- |
| `manifest.json` | Scenario id, format version, extent, grid size, seed, difficulty, file hashes | JSON | Yes |
| `terrain.bin` | Elevation grid | 16-bit integers, gzip | Yes |
| `cover.bin` | Surface cover class per cell (soil, alluvium, scree, vegetation, bare rock) | 8-bit, gzip | Yes |
| `outcrops.json` | Outcrop catalogue: position, footprint, quality, observable features, true orientations | JSON | Yes, but see below |
| `units.json` | Unit descriptions, hand-lens text, fossils, lab results, textures and colours | JSON | Yes, without names or ages |
| `litho.bin` | Full 3D lithology block | 8-bit, run-length encoded | Only in reveal mode |
| `orient.bin` | Bedding pole per cell for each series | 3 x 8-bit, gzip | Only in reveal mode |
| `truth.json` | True map raster, contact and fault traces, column, event sequence, fold axes | JSON plus GeoJSON | Never before grading |

**Keeping the answer hidden.** Geology students will open the browser developer tools. Two levels are supported:

- **Practice mode (static hosting).** Everything is downloaded and lightly obfuscated. Acceptable for ungraded exercises.
- **Graded mode (with backend).** The browser receives terrain and outcrop positions only. Each observation is requested from the server when the student reaches the outcrop, and `truth.json` never leaves the server. Grading runs server-side.

**Coordinates.** Each scenario uses a local metric grid with a fictional UTM-like origin, so students practise real coordinate reading without the area being findable on a real map.

**Versioning.** `manifest.json` carries a `format_version`. The game refuses a scenario with a newer major version and reports it clearly.

## 6. Client simulator

The game is a single-page web app with two linked views of the same world: a 3D field view for exploring and a 2D map view for interpreting. A student switches between them as a geologist switches between the outcrop and the map board.

**World rendering**

- The terrain is a blocky, Minecraft-style surface built from the elevation grid, at 5 to 10 m per block. It is a heightfield with visible block steps, not a full voxel world: students do not dig, so a full voxel engine would add cost without teaching value.
- Cover is drawn as soil, scree, alluvium or vegetation blocks. Outcrops are rock blocks textured by lithology, with bedding drawn as lines at the true apparent dip on each block face.
- The terrain is split into chunks of 32 x 32 blocks and meshed in a web worker, so it runs on a mid-range laptop and on a tablet.
- Reveal mode, unlocked by the teacher, lets the student slice the terrain and see the full 3D lithology block.

**Exploration**

- First-person walking with a simple speed model: slower on steep slopes and in vegetation.
- Fog of war on the map view: terrain is visible from the start as a topographic base, but outcrops only appear within about 60 m of the student, or farther along a clear line of sight on bare ridges.
- A field-day clock. Walking, measuring and sampling all cost time; each scenario gives a fixed number of field days. This forces traverse planning.
- An optional photo-interpretation layer: a synthetic "satellite image" shaded by rock colour and cover, with lineaments, studied before the first field day.

**Field tools at an outcrop**

| Tool | What it returns | Cost |
| --- | --- | --- |
| Hammer and hand lens | Rock description: colour, grain size, minerals, texture, fossils | Low |
| Compass | Strike and dip of bedding, foliation, fault plane or dyke, with scatter; trend and plunge of lineations | Low |
| Way-up check | Graded bedding, cross-bedding, pillow shapes or load casts where present | Low |
| Contact inspection | Contact type and evidence: baked margin, basal conglomerate, breccia, striae and steps | Medium |
| Sample | Sends a rock to the "lab": thin section or age, returned the next field day | High, limited per scenario |
| Notebook | Station number, coordinates, free notes, sketch, all measurements | None |

The student chooses which plane to measure and what to call the rock. The game never labels a unit by its formation name; correlation between outcrops is the student's job.

**State.** One state object holds the position, clock, visited outcrops, stations, measurements, drawn map and section. It is saved locally after each action and synced to the server when a backend is present, so a lost connection never loses field work.

## 7. Interpretation and assessment

The student delivers four products, and each one is graded against the hidden model.

**Interpretation tools**

- **Map board.** Stations plot automatically with their strike-and-dip symbols. The student defines map units, draws contacts and faults (solid, dashed or inferred), fills polygons and builds the legend. The drawing layer reuses the FieldDraw approach and exports GeoJSON and a print-ready PDF.
- **Stereonet.** Plots the student's own measurements as poles or great circles, filtered by unit or map domain, with a best-fit girdle and fold axis.
- **Cross-section.** The student picks a section line; the game draws the topographic profile and projects nearby measurements as apparent dips. The student draws the units and faults at depth.
- **Stratigraphic column and history.** The student orders their units, sets thicknesses and contact types, then arranges event cards (deposition, folding, faulting, intrusion, erosion) into a sequence.

**Automatic grading**

| Product | Compared with | Metric | Default weight |
| --- | --- | --- | --- |
| Geological map | True bedrock map | Area agreement after matching student units to true units, plus mean distance between drawn and true contacts | 35 % |
| Structures | True fault traces and fold axes | Faults found, trace distance, kinematics; fold axis angular error | 20 % |
| Cross-section | True section cut from the 3D block | Area agreement along the section, weighted toward the top 500 m | 20 % |
| Column and history | True column and event sequence | Order correlation of units and events; contact types | 15 % |
| Field practice | Activity log | Coverage of key outcrops, measurement density, notebook completeness | 10 % |

Two details make the grading fair:

- **Unit matching.** Students name units freely, so the grader first finds the best one-to-one match between student units and true units, and tolerates lumping of units that the scenario marks as hard to separate.
- **Uncertainty credit.** A dashed or inferred contact under cover is scored with a wider distance tolerance than a solid one. Confident lines in the wrong place lose more than honest inferred lines.

The automatic score is a proposal. The teacher sees it with the student's map overlaid on the true map and can adjust any item before it is released. After release, the student sees the same overlay plus the true section, which is the main learning moment of the exercise.

## 8. Backend, student accounts and Canvas

Accounts arrive in three stages, and the game itself is identical in all three.

| Stage | How a student is identified | What it needs | What it gives |
| --- | --- | --- | --- |
| A. Static | Not identified; work saved in the browser | GitHub Pages only | Practice mode, embeddable in Canvas as an iframe, export of the map as a file to upload as a Canvas assignment |
| B. Own accounts | Sign-in by email link, restricted to UdeC addresses | A hosted backend (Supabase: database, sign-in, file storage, server functions) | Saved progress on any device, graded mode, teacher dashboard |
| C. Canvas (LTI 1.3) | Canvas launches the game and passes the student's identity and course | Stage B plus registration of the tool by the UdeC Canvas administrators | No separate login, one click from the course module, grades written back to the Canvas gradebook |

Stage B already meets the goal of one account per student. Stage C removes the second login and should be requested from the Canvas administrators early, because approval is outside our control.

**Data kept per student**

- `attempt`: student, scenario and variant, seed, field days used, status.
- `station`, `measurement`, `sample`: the field notebook, one row per action.
- `map_state`: the drawn map, section, column and history as JSON, versioned.
- `event_log`: timestamped path and actions, used for the field-practice score and the teacher's traverse replay.
- `grade`: automatic scores per item, teacher adjustments, release status.

**Server functions**

- `observe`: returns what an outcrop shows, only if the student's logged position is within reach. This is what keeps the answer key off the browser in graded mode.
- `grade`: runs the comparison in section 7 against `truth.json`.
- `lti-launch` and `lti-grade`: the Canvas handshake and grade passback.

**Teacher dashboard.** Class list with progress, each student's traverse replayed on the map, the map-versus-truth overlay, score adjustment, and release of reveal mode per group.

**Privacy.** The system stores name, institutional email and course work only, and student records can be exported or deleted per course at the end of the semester.

## 9. Tech stack and repository layout

The stack stays close to tools already in use (Python, GemPy, GitHub Pages) and adds as little as possible.

| Layer | Choice | Reason |
| --- | --- | --- |
| Scenario authoring | Python 3.11+, GemPy 3, NumPy, SciPy, rasterio | Already the research toolchain |
| Bake command | Python package `geomapper_bake` with a command-line entry | One command per scenario, runs on a laptop |
| Game | TypeScript, Vite, Three.js | Runs in any modern browser, no install, static hosting |
| 2D map and drawing | HTML canvas with a small custom drawing layer | Full control of geological symbols; no web-map library needed for a local grid |
| Stereonet | Own TypeScript module | Small, testable, reusable in other tools |
| Grader | TypeScript, shared by browser and server | The same code gives practice feedback and official grades |
| Backend (stages B and C) | Supabase; LTI 1.3 through a maintained open-source library | Managed service, little operations work |
| Tests | pytest for the bake, Vitest for game logic, Playwright for one end-to-end walk | Each work package ships with tests |

**Repository layout (one repository)**

```
geomapper/
  scenarios/            one folder per scenario: model.py, scenario.yaml, terrain
  bake/                 Python package: gempy runner, orientation field, exposure, exporters
  format/               the scenario format: JSON Schemas and a written spec
  game/
    src/world/          terrain meshing, chunks, textures
    src/explore/        movement, fog of war, field clock
    src/tools/          compass, hand lens, sampling, notebook
    src/interpret/      map board, stereonet, cross-section, column, history
    src/grade/          unit matching and metrics (shared with server)
    src/state/          state store, local save, sync
  server/               database schema, server functions, LTI
  dashboard/            teacher views
  baked/                output of the bake (public parts only)
  docs/                 this architecture, scenario authoring guide
```

The `format/` folder is the single source of truth for the contract in section 5. Both the Python exporters and the TypeScript loaders are validated against its schemas in the test suite.

## 10. Build plan for Opus 5.5

The work is cut into ten packages. Each one is small enough for a single Opus 5.5 session, ends in something that can be tried, and has a test that says it is done. Packages 1 to 6 give a playable practice version of scenario 1; nothing after that is needed to start testing with students.

| WP | Deliverable | Depends on | Done when |
| --- | --- | --- | --- |
| 1 | Scenario format: schemas and written spec in `format/` | none | A hand-made toy scenario validates against the schemas |
| 2 | Bake core: GemPy runner, lithology block, bedding field, true map and contact traces | 1 | For a planar homocline, baked strike and dip match the input within 1 degree at every cell |
| 3 | Exposure model, outcrop catalogue, validation report; scenario 1 (Quebrada Los Litres) authored | 2 | The report shows 3 to 8 % exposure and Mauricio approves the true map and sections |
| 4 | Game world: blocky terrain, cover, outcrops, walking, fog of war, field clock | 1 | Scenario 1 loads and holds 30 frames per second on a mid-range laptop |
| 5 | Field tools and notebook, local save | 4 | A full traverse can be recorded, closed and reopened with nothing lost |
| 6 | Map board and stereonet, export to GeoJSON and PDF | 5 | A complete map of scenario 1 can be drawn and exported |
| 7 | Cross-section, column and history tools; grader with unit matching | 6 | The true map scores above 95 %; a random map scores below 20 % |
| 8 | Scenarios 2 to 4 and their variants | 3, 7 | Each passes its validation report and one full playthrough |
| 9 | Backend stage B: sign-in, sync, graded mode, teacher dashboard | 7 | Two test students on two devices keep separate, resumable attempts; the answer key is absent from browser traffic |
| 10 | Canvas LTI 1.3 and grade passback; scenarios 5 and 6 | 9 | A launch from a Canvas test course opens the right attempt and a released grade appears in the gradebook |

**Working rules for the implementing model**

- Read this document and `format/` before each package. Do not change the scenario format without raising the format version and updating both sides.
- Keep GemPy out of the game and out of the server. If a feature seems to need it at run time, bake the result instead.
- Every package ships with its tests and a short note in `docs/` on what was built and what was left open.
- Geological correctness outranks visual polish. If a baked result looks geologically wrong (bedding not parallel to contacts, a fault that does not offset units), stop and report it instead of patching the display.
- Decisions listed as open in section 11 belong to Mauricio. Use the stated default and flag it; do not settle them silently.

## 11. Risks and open decisions

**Risks**

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| GemPy cannot express a structure cleanly (overturned limbs, salt-cored folds, strike-slip duplexes) | Scenarios 3, 5 and 6 depend on them | Prototype the hard structure of each scenario early in WP 8; where GemPy fails, deform the baked block with an analytic kinematic step after GemPy |
| Bedding from the scalar-field gradient is noisy near faults and unconformities | Students would measure nonsense at the most instructive outcrops | Compute orientations per series and per fault block, and mask a buffer around discontinuities |
| Grading a drawn map is harder than it looks | An unfair score undermines trust in the tool | Unit matching, uncertainty credit, and the teacher always confirms before release |
| Canvas LTI approval is slow or refused | Stage C would stall | Stages A and B work without it; ask the administrators at the start |
| Performance on student laptops and tablets | A slow game is not used | Heightfield instead of full voxels, chunked meshing, a low-detail setting |
| Scope | Ten packages is a large build | Packages 1 to 6 are a complete, useful product on their own |

**Decisions for Mauricio** (the default is used until changed)

- [ ] Interface language. Default: Spanish interface and rock descriptions, with code and documentation in English.
- [ ] Field view. Default: first-person blocky 3D. Alternative: a top-down 2.5D view, cheaper and better on phones.
- [ ] Unit names. Default: fully invented formation names. Alternative: names that hint at the real analogue.
- [ ] Individual or brigade work. Default: individual attempts, with variants per student. Team mode would be a later package.
- [ ] Course of first use. Default: Cartografía Geológica with scenarios 1 to 3; Geología Andina uses 4 to 6 as guided case studies.
- [ ] Hosting of the backend. Default: Supabase. Alternative: a UdeC server, if the university requires student data to stay on its systems.
