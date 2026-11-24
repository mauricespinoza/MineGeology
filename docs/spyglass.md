# Spyglass (catalejo)

A spyglass to look closely at what is far away: the hills across the valley, a ridge with dark rock, the scarp of a fault. It helps plan the walk before spending field time on it.

## Use

- **Z**, or the spyglass button in the toolbar (under the compass), holds it to the eye. **Z** again, **Esc** or the ✕ on its bar puts it away. Any other tool (map, notebook, and so on) puts it away first.
- It starts at **×8**. The mouse wheel, a pinch, or the − and + buttons on its bar set the power from ×4 to ×20.
- The student stands still while looking through it: the walking pad, the crosshair, the hammer and the slope line are put away. The view turns with the look stick, a drag, the captured mouse or the gyroscope, more slowly the higher the power, as with real binoculars.
- It is not used in flight: above 3 m the game asks to land first. In third person the view moves to the student's own eye while it is held there.
- The bar under the eyepiece reads what lies under the middle of the reticle: power, bearing, horizontal distance (rounded to 10 m), elevation, and the kind of ground (outcrop, exposed rock, soil, alluvium, scree, vegetation, fault zone). It does not name the unit: that still takes a visit and the hand lens.

## How it is drawn (`world/spyglass.ts`)

- The camera's field of view is narrowed by the power (`World.magnification` = pinch zoom × spyglass power).
- The haze moves out: the view distance grows to 3.2 km and the fog starts 1.6 times further away, so the far side of the area shows clearly.
- Up to 20 far chunks inside the narrowed field of view are meshed with fine blocks, nearest first (`World.chunksInSight`); they are released again by the usual distance rule when the spyglass is put away.
- The scene is drawn into a small picture, about 220 big pixels across the shorter side of the screen, at twice that size each way and averaged 2 × 2, so thin cracks between block faces do not show as whole pixels of sky. A full-screen shader then draws it in big square pixels inside a round eyepiece: a stepped vignette towards the edge, a faint cold tint of the glass, a thin reticle with ticks every eighth of the radius, a brass rim in three rings of pixels lit from the upper left, and a dark, dithered tube around it.
- The arm, the hammer and the figure are hidden while it is held.

## Tests

- `e2e/spyglass.mjs`: Z holds it to the eye and narrows the view; the reading gives power and distance; the walking pad is hidden and W does not move the student; the wheel raises the power; Esc restores the view exactly; the toolbar button works and opening the map puts it away; on a phone the button and the ✕ work; no page errors.
