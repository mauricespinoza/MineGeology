# Walk with the notebook open, and look by turning the tablet

## What was built

- **The notebook no longer stops the walk** (`main.ts`). With the notebook open, the student can still do all of these:
  - walk with the keys or the cross;
  - turn the view by dragging the landscape, with the stick, or with the gyroscope;
  - zoom.
  
  The other screens still stop the walk while they are open: the station, the map, the net, the profile, the column, the evaluation and the rock card. The hammer still waits until the notebook is closed. The notebook is narrower where the screen allows it, at least 360 px wide but leaving about 330 px of the view. The «Mirar» stick moves out from under it, and the arm in the view moves left to stay visible. On phones narrower than 700 px the notebook fills nearly the whole width. There the stick is hidden while it is open, and the view still turns with a finger on what remains of it, or with the gyroscope.
- **Gyroscope on tablets and phones** (`explore/gyro.ts`). A round button with a tablet and two arrows, beside the «Mirar» stick, turns the gyroscope on or off. Once it is on, turning the device turns the view, as if looking through a window onto the field.
  - Turning to the right turns right; tilting the device back looks down.
  - It allows for the screen being in portrait or landscape.
  - Only the change since the last reading is added to the view. The stick and the finger still work, switching it on does not make the view jump, and the zoom does not change how far the device turns the view.
  - Held straight up or down, only the tilt counts. Its heading there is undefined and would swing.
  - The button appears only on touch screens whose browser has orientation events.
  - iOS Safari, and recent Chrome, ask permission the first time, at the tap on the button. If it is refused, or the device sends no readings within 1.5 s, a message says so and the button stays off.
  - The browser needs HTTPS, which the published site has.
  - The setting is not kept between visits: iOS asks for permission again each visit.

## Checks

- `npm run typecheck` and `npm test` pass, including 4 new tests of the direction worked out from the orientation (`tests/gyro.test.ts`).
- `e2e/notebook-gyro.mjs`, new, 10 checks:
  - on a computer: with the notebook open the student walks 19 m with W and turns 32° with a drag;
  - on an emulated iPad: fake orientation events turned by 30° turn the view by 30°, also with the notebook open;
  - on the iPad the stick sits beside the notebook.
- `e2e/walk.mjs` (61), `aim.mjs` (11), `touch.mjs` (50) and `kinematics.mjs` (8) pass.
  - `touch.mjs` caught the first placement of the gyroscope button, in the right-hand column, overlapping the stick on a phone held upright. It moved beside the stick.
  - `kinematics.mjs` had broken with the re-baked Estero Las Tobas. Its first fault outcrop is now of poor quality, without the kinematics tool, and the crosshair could meet a neighbouring outcrop first. It now picks a fault outcrop that is not poor and opens that outcrop's station.

## Left open

- The gyroscope was checked with simulated readings, not on a real tablet. How fast the view should follow, and whether the readings need smoothing, should be tried by hand.
