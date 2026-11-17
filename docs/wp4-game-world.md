# Work package 4: game world

## What was built

The game now loads a baked scenario and lets a student walk it.

- `game/src/world/`: the blocky world. `blocks.ts` turns the elevation grid into stepped blocks, `mesher.ts` builds the triangles of one 32 x 32 cell chunk, `mesh.worker.ts` runs the mesher in a web worker, `bedding.ts` draws bedding on outcrop blocks, and `world.ts` is the three.js scene.
- `game/src/explore/`: `movement.ts` (walking speed and its cost in field time), `clock.ts` (field days), `discovery.ts` (fog of war), `controls.ts` (keyboard, mouse and touch).
- `game/src/ui/mapview.ts`: the map view, a shaded topographic base with 50 m contours and a 500 m coordinate grid.
- `game/src/state/state.ts`: the single state object of an attempt.
- `geomapper publish`: copies the public files of a bake into `baked/`, which the game serves.
- `game/e2e/walk.mjs`: one end-to-end walk in a real browser (`npm run e2e` with the dev server running).

## How the world is drawn

- **Blocks.** Near the student each 10 m scenario cell is drawn as four 5 m blocks with 2.5 m steps; beyond about 330 m, as one 10 m block with 5 m steps. Fine chunks are meshed on demand and released when the student walks away. The elevation of the fine blocks is interpolated from the baked grid, so no new terrain is invented.
- **Cover** colours the block tops: soil, alluvium, scree, vegetation (with a bush on some cells). **Outcrops** take the colour of their rock.
- **Bedding** is drawn as real planes one metre apart, cut by each block face: strike lines on top faces and the true apparent dip on side faces. The lines join from face to face and from block to block.
- The camera sits 3.2 m above the ground. At a person's eye height, a single 2.5 m step filled the screen when walking uphill.

## Rules of exploration

- **Walking** follows Tobler's hiking function: about 5 km/h on flat ground, slower on slopes in both directions, and 40 % slower in vegetation. That speed sets the cost in field time. On screen the student moves faster (14 m/s on flat ground) and slopes slow the movement less than they cost, so steep ground is expensive without being tedious.
- **Field clock.** Days start at 08:00 and last `rules.minutes_per_day`. When a day ends the student starts the next one from the same place; after the last day only the map remains.
- **Fog of war.** The map shows topography from the start. An outcrop appears in grey when seen from within 450 m along a clear line of sight, and in the colour of its rock once the student has been within 60 m.
- **Camp.** The attempt starts on the valley-floor cell closest to the middle of the area.

## Done when

"Scenario 1 loads and holds 30 frames per second on a mid-range laptop."

Scenario 1 loads. The frame rate was measured only in a headless browser with **software rendering and no GPU**, where it ran at 25 to 33 frames per second with about 170 000 triangles in view. A laptop with any GPU should do far better, but **this has not been checked on real hardware**.

## Choices made here

- **Two levels of detail** instead of one block size. Blocks of 10 m everywhere made every slope a wall; blocks of 5 m everywhere would be about 1.2 million triangles and too much memory for a tablet.
- **Outcrops are visible in the 3D view from any distance**, as in the field. The fog of war applies to the map only.
- **Practice mode only.** The game reads the public files. Graded mode, where observations come from the server, is work package 9.

## Left open

- **Field tools.** Standing at an outcrop shows its number and nothing else until work package 5.
- **No save yet.** Reloading the page starts a new attempt (work package 5).
- **End of day.** The student does not have to walk back to camp, and the next day starts where the last one ended.
- **Photo-interpretation layer** (the synthetic satellite image of the architecture) is not built.
- **Reveal mode** is not built.
- **The end-to-end walk is not in CI**, because it needs a browser; CI runs the unit tests and the production build.
- **Hosting.** The game is not deployed anywhere. GitHub Pages is the plan for stage A; publishing it is Mauricio's call.
- **Touch controls** exist but were not tried on a tablet.
