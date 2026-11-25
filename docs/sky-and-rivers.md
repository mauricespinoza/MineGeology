# Sky and rivers

Clouds, a sun in the northern sky, and streams in the main courses with the sound of running water.

## Clouds (`world/clouds.ts`)

- Flat, blocky clouds: patches of 24 m cells, 14 m thick, about 260 m above the highest ground of the area. One instanced box per cell.
- A slow wind of 3.5 m/s, from the west and turned a little by each scenario, carries them. They lie on a 4.2 km tile wrapped about the camera, so the sky never runs out; the wrap happens far out in the haze.
- Few clouds over the desert (18), more over temperate land (60), many and greyer over the forest (95). The shapes are seeded and the same on every load.

## Sun (`world/sun.ts`)

- A square disc with a soft glow, 1100 m from the camera, in the direction of the scene's light (`SUN_DIRECTION`). Clouds and hills pass in front of it; the fog does not wash it out.
- It stands in the northern sky, a little to the west, about 58° high, as in the early afternoon in Chile, south of the Tropic. The directional light comes from the same place, so the shading of the blocks in 3D changed with it: north-facing slopes are now the bright ones. The hillshade of the map board and the minimap keeps the cartographic light from the north-west.

## Rivers (`world/rivers.ts`)

- Read from the terrain when the grid is built (`buildGrid`, about 50 ms for 256 × 256 cells): the hollows are filled (priority flood with a small gradient across flats), each cell drains to its steepest neighbour (D8), and the drained area is added up downhill.
- A cell with more than 0.3 km² draining to it carries a stream, one cell (10 m) wide; with four times as much it is a river two cells wide. In the desert the threshold is 0.6 km², so only the main courses carry water and the rest stay dry quebradas. Where a course steps diagonally, the lower of the two cells between is wetted too, so the water never touches only at a corner.
- The bed lies below the banks: 0.9 m for a stream, 1.4 m for a river (`RIVER_DEPTH_M`, in `blockHeight`), so the student wades down into it. The top of a wet block is water (`WATER_COLOUR`, by environment) with an animated pattern of ripples and glints (`PATTERN.water`, time in `uTime`, kept out to 160 m); where the stream steps down a block, the step is drawn as white water. No trees or bushes grow in a stream.
- The minimap shows the streams in blue over the relief.
- The water is drawn only: it does not change the geology, the cover, the outcrops or the grading.

## Sound (`audio/sound.ts`)

- A stream, synthesised like the rest: two bands of noise for the hiss and the splashing, a low rush, and quick bubbles. It is silent until the student comes within 70 m of the water (`WATER_EARSHOT_M`), grows louder towards it, and is loudest standing in it. Flying, the height counts as distance.
- Walking in a stream adds the splash of the feet, about two steps a second.
- Both are set by `WATER_VOLUME` (0.7): the stream peaks at a gain of 0.22 standing in it.

## Tests

- `tests/clouds.test.ts`: clouds above the highest ground, seeded, fewer in the desert, the wrap; the sun high and inside the far plane.
- `tests/rivers.test.ts`: drainage gathers at the outlet; a valley carries a river on its floor, wider downstream, none on the slopes; fewer wet cells in the desert; on Quebrada Los Litres the courses are joined side to side and cover 0.2–3 % of the area; the bed lies below the banks, is drawn as water, and is heard near by; the sun shines from the north.
