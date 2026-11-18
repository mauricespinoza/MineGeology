# Flying like a superhero, a minimap, desert and forest

## What changed

- **Flying pose.** In flight the figure lies flat with the right fist ahead, the left arm along the side and the legs together. Taking off switches to the third-person view so the figure can be seen flying; landing goes back to the view the student had. In flight the camera follows from above and a little to one side, so the outstretched figure reads as flying.
- **Minimap** (`game/src/ui/minimap.ts`), always in the top-left corner:
  - the relief, 700 m across, centred on the student, with north up;
  - the outcrops found (grey, or the colour of the rock once visited);
  - the student's areas and lines, and the stations in the colour of their unit;
  - an arrow for where the student stands and looks, with the heading in degrees, and a 200 m scale bar.
  A tap opens the full map. On phones it replaces the compass box, since it shows the heading. On a phone held sideways it stands beside the status lines.
- **Environments** (format 1.4.0, `environment:` in `scenario.yaml`):
  - **desert**: bare rock on about 42 % of the area; gravel and sand elsewhere, a few shrubs along the streams; a clear sky and a far horizon. The geology shows nearly everywhere, even from afar.
  - **forest**: bare rock on about 2.5 % of the area, only in crags and stream cuts. Trees cover most of the rest; their crowns hide the ground beyond them, so from afar only the rocky places show. A hazier sky and a nearer horizon.
  - **temperate**: as before, the default.
  The bake chooses how much rock is bare and what covers the rest. The game draws its colours, sky, haze and, in a forest, trees: two instanced meshes, a trunk and a crown on about half the vegetated cells. The validation report checks exposure against the range of each environment (temperate 3 to 8 %, desert 25 to 50 %, forest 1.5 to 4 %).
- **Two scenarios changed, and all four ordered by difficulty.** Exposure is now part of difficulty along with the structure:

| Level | Scenario | Environment | Why there |
| --- | --- | --- | --- |
| 1 | Quebrada Los Litres | temperate | A homocline with dykes |
| 2 | Estero Las Tobas | **desert** | Its inverted half-graben is subtle, but the growth wedge and the null point can be followed rock by rock |
| 3 | Valle del Yeso Blanco | temperate | Overturned folds and a thrust, under ordinary cover |
| 4 | Cerro Pizarras | **forest** | The geology is not the hardest, but the aureole and the unconformity have to be found between the trees |

  The start screen lists them in this order. Estero Las Tobas, high in the Main Cordillera, is plausible as a dry, bare range. Cerro Pizarras, in the Coastal Cordillera near Concepción, is wooded in reality.

## Checks

- Python (`tests/test_exposure.py`): on the same terrain, the desert exposes more than 30 % and has under 5 % plants; the forest has less exposure than temperate land and plants on more than 60 % of it.
- The touch walk now really checks that no HUD control covers another. It used to skip the elements fixed to the screen, which hid an overlap of the hammer button with the walking cross on phones. With the minimap and the hammer showing, it passes 47 checks on a phone held upright and sideways and on a tablet.
- The grade of the new bakes: see the PR.

## Left open

- In the desert, the large number of outcrops (about 1 600) makes `outcrops.json` about 0.9 MB.
- The trees are drawn but do not stop the student, and they do not cast shade.
- Valle del Yeso Blanco and Quebrada Los Litres keep their environment (temperate). Turning another scenario into desert or forest needs a new bake.
