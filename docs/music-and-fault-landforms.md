# Choice of music, and faults that show in the landscape

## What was built

### Music to choose

The sound button now opens a small menu, «Música de fondo». The start screen has the same choice in a list.
The choice is kept in this browser (`geomapper:music`).

| Style | What it is |
| --- | --- |
| **Lo-fi** | A lazy, swung beat at 76 per minute. Electric-piano chords (sevenths and ninths, two four-bar progressions that alternate), a round bass, a few high notes of melody, all through a dull filter, with a slow tape wobble and the crackle and hiss of an old record. |
| **Calma** | The earlier music: slow notes of the D major pentatonic over a quiet drone, in a soft hall. Still the default. |
| **Andina** | A charango strumming in 6/8 (A minor, C, G, Dm and E), a bombo on the beats, a guitar bass and a quena that plays phrases of its own in the A minor pentatonic, with a breathy attack and vibrato. |
| **Solo naturaleza** | No music: only the wind, and the birds more often. |

«Silenciar todo» turns all sound off, as the button did before. Picking a style turns the sound back on.

- Everything is still synthesised with Web Audio, with nothing to download, and every tune is generated as it plays from fixed chords and a little chance.
- The beat is scheduled about 0.3 s ahead on the audio clock, so it keeps time while the page is busy. After the sound was suspended the beat starts again from that moment, so no notes pile up.
- Changing style fades the old tune out over 1.5 s while the new one fades in. Each style sets how much goes to the reverb: little for lo-fi, a lot for the calm notes.
- The levels were measured in the browser over 7 s each. RMS: lo-fi 0.044, calma 0.03 to 0.05 (it varies with chance), andina 0.037, naturaleza 0.005.

### Faults you can find from the landscape (`bake/geomapper_bake/faultzone.py`)

A student should be able to suspect a fault before finding its plane in an outcrop, as on an air photo or from a ridge. Where a fault offsets the rock at the surface, the bake now adds:

1. **A scarp.** The upthrown block stands about 20 m higher near the trace and fades back into the land over a few hundred metres. The upthrown block is the hanging wall for reverse faults and thrusts and the footwall for normal faults. Strike-slip and oblique faults get no scarp. The bake tells the hanging wall by evaluating the model 60 m below the ground: going straight down from the hanging wall crosses the fault plane.
2. **A trough of crushed rock.** It is about 8 m deep and 30 m wide along the trace. It shows as aligned saddles and a straight valley. Both relief changes are settled with the rock resistance, before the streams cut their valleys, so streams can follow the trough.
3. **A strip of fault breccia**, a new cover class (`fault_zone`, format 1.5.0). It is about 25 m wide, with a few gaps, and nothing grows on it. Along it, the strip is decided in stretches about 50 m long: each stretch is kept whole as an outcrop or given to the breccia, about half each way, and a fault always keeps at least its largest crossing. The outcrops kept show the fault plane: in Estero Las Tobas 14 and 10 outcrops show it in variants a and b (24 and 21 before the strip).

Where younger beds seal the fault there is none of this. The expression fades out over a few cells at the edge of the sealed area.

In the game:

- **3D view.** The strip has its own pattern: angular fragments of every size in a reddish clay gouge, stained by iron oxides. Its colour is a rusty red-brown in every environment. In a forest it shows as a clearing without trees.
- **Map, minimap and PDF.** The base marks the strip as a geologist marks a breccia zone: a reddish tint with small open triangles. It is what one sees on the ground or on an air photo, not the fault line. Drawing the fault is still up to the student.
- **Hammer and lens.** Hammering the strip opens «Zona de falla: roca triturada». The card describes the breccia and gouge and says how to follow the fault in the landscape and what outcrop to look for. Through the lens it shows a clast of the nearby rock.

Each fault can tune or turn off its relief in `scenario.yaml` (`faults.<name>.relief`), and `bake.fault_relief: false` turns it off for a whole scenario (see `docs/scenario-authoring.md`).

### Re-baked scenarios

- `estero-las-tobas-a` and `-b` (the inverted border fault, reverse). They now have the scarp, the trough and the breccia strip. Their lithology block and answer key geometry are unchanged; the relief, cover and outcrops changed.
- `valle-del-yeso-blanco-a` (the thrust) was re-baked too, with the same expression (its fault-plane outcrops are now fewer, as the strip covers part of them).
- Quebrada Los Litres and Cerro Pizarras have no faults and were not re-baked.

## Checks

- Python: `pytest` passes, including 7 new tests in `tests/test_faultzone.py`:
  - which block goes up for reverse, normal and strike-slip faults;
  - that a sealed fault shows nothing;
  - the strip follows the trace and can be turned off;
  - the hanging wall is found from below the ground;
  - the exposure keeps outcrops and valley floors.
- Game: `npm run typecheck` and `npm test` pass.
- In a browser (Estero Las Tobas, free mode):
  - the breccia strip and the scarp are seen from the air;
  - the map base shows the strip with its triangles;
  - the music menu opens, switches between the four styles and closes with Esc;
  - the choice is kept;
  - no console errors.

## Left open

- The music was checked for levels and errors, not by ear on real speakers or phones.
- The breccia strip is drawn on the whole map base from the start, as on an air photo. If that gives too much away in campaign mode, it could be drawn only where the student has walked.
