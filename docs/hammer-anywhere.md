# Hammer anywhere, "Ver con lupa", and outcrop quality

## What was built

- **Hammer anywhere.** A tap on the 3D view (touch), a click (mouse free), or a click with the mouse captured (at the crosshair) swings the hammer at the ground under that point, with chips flying from where it strikes. It works only on rock within 7 m of the student's feet and on the ground (not flying). Otherwise a short message says why: too far, land first, or soil and vegetation rather than rock. A free-mouse click that cannot hammer captures the mouse, as before. The hammer no longer swings by itself when pointing at rock.
- **"Ver con lupa".** After a blow a button appears where the hammer struck (E does the same; with the mouse captured, hammering the same rock again also opens it). It lasts 12 s or until the student walks away.
  - Outcrop: opens the station panel with the hand-lens description already written in the notebook.
  - Loose weathered rock or scree: opens the rock card with a partial description of the rock nearby.
- **Outcrop quality** (`wellExposed` in `tools/fieldwork.ts`):
  - good and fair outcrops: complete description (field, hand lens, fossils, features, quality) and every tool: compass on bedding, faults and other planes, way-up, contact, kinematic indicators;
  - poor outcrops: a partial description (the first clause of the field and hand-lens descriptions, marked as a weathered surface) and a note that the outcrop is of poor quality; no compass, way-up, contact or kinematic indicators.

## Fix: the panel's buttons stopped answering

The mouse could be captured (pointer lock) while a panel was open: when the browser granted a capture late, after the panel opened, when the student clicked the 3D view beside the panel, or on touch screens. Every click then went to the 3D view and the panel, with its "Polaridad" button, seemed frozen. Now the mouse is captured only while playing with nothing open, never on touch screens, and a capture granted late is given back at once. The hammer no longer blocks the other tools while it swings.

## Checks

- Unit tests: the poor outcrop gets a partial description and no measurements; the good one the full description (`tests/tools.test.ts`); one figure, and the fist and hammer (`tests/avatar.test.ts`).
- End-to-end: `e2e/aim.mjs` (out of reach, click to hammer, "Ver con lupa", mouse free in the panel, partial card for loose rock), `e2e/touch.mjs`, `e2e/walk.mjs`, `e2e/kinematics.mjs`.
