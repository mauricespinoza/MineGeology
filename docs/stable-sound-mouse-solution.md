# Stable sound, a free mouse, the solution map, «Listo», rock patterns and a larger lens

## What was built

- **Sound that comes back on phones** (`audio/sound.ts`). Phones stop Web Audio on their own: a call, the lock screen, another app, a long time in the background. Safari also leaves the context "interrupted", or running but silent. Now:
  - every tap, click or key wakes the sound (`wake()`), and so do returning to the page, `pageshow` and focus;
  - a context that does not resume, or that comes back after more than a minute hidden, is closed and rebuilt;
  - a silent one-sample buffer is played inside the gesture, which older iOS needs before it makes any sound;
  - `navigator.audioSession.type = "playback"` where Safari supports it, so the silent switch does not mute the game (the in-game sound button still does);
  - while the sound is suspended no notes are scheduled, so nothing piles up and plays all at once on waking;
  - the reverb is shorter (2 s instead of 3.2 s), lighter for a phone to run in real time.
- **The mouse stays free on a computer** (`explore/controls.ts`, `main.ts`). The game no longer captures the mouse when play starts or a panel closes, so every button can be clicked. Dragging the landscape turns the view; a click without dragging still hammers the rock under the pointer. The wheel zooms. Those who prefer to look by moving the mouse can press **L** to capture it (L or Esc frees it).
- **Zoom in the 3D view**. Two fingers pinched apart or together zoom the view on phones and tablets (from 0.8× to 5×), and so does the mouse wheel. A pinch neither turns the view nor counts as a tap on the rock. Zoomed in, a drag turns the view less, as with binoculars. The arm keeps its normal size. Safari's own page zoom is blocked, so pinching on the buttons does not enlarge the whole page.
- **Map toolbar** (`ui/icons.ts`, `ui/mapboard.ts`). Clearer icons: a hand to move, a contact between two units, a fault with its offset arrows, a hatched area, the profile line with A and A′, and PDF and GeoJSON written on their documents. On screens wider than 900 px each button carries a short caption under its icon. On narrower screens the icon stands alone, with the name as its tooltip and accessible name.
- **«Listo»** on the map and the profile. A labelled button floats at the bottom of the board while a drawing tool is in use:
  - Map: while a line or area is being drawn, it finishes it (as Enter or a double click does). With nothing being drawn, it puts the tool away and goes back to Mover, so there is always a clear way out of a tool.
  - Profile: it finishes the line or body being drawn. With nothing being drawn, it closes the profile.
  - It pulses while a line is open.
  - On the map it sits at the bottom centre (bottom left on phones, clear of the folded units panel), and the hint stays to its left. On the profile it sits under the close button, clear of the ground and the bodies drawn near it.
- **Solution map in free mode**. A «Solución» button appears in the map toolbar in free mode, when the scenario carries its answer key (practice bundles). It lays over the base:
  - the true geological map, multiplied over the relief;
  - the true contacts (black), faults (red) and dykes (green);
  - a legend of the units present, with their names, lithologies and ages, youngest first.
  It is never offered in campaign mode.
- **Rock patterns in the 3D view** (`world/rockPattern.ts`). Block faces were flat colour. Now each rock and cover has a pattern drawn by the GPU from the world position, with no textures to download:
  - granite crystals, phenocrysts and amygdales in lavas, angular clasts in breccia, pebbles in conglomerate, grains in sandstone, joints in fine-grained rocks, spots in hornfels, shell fragments in limestone, lapilli and pumice in tuffs and ignimbrites, sparkle in gypsum;
  - soil, gravel, angular scree of mixed sizes and grass on the cover.
  - Every pattern is isotropic on purpose. A pattern with a direction would read as bedding or foliation that is not in the model; the true bedding is still drawn as lines at the true apparent dip.
  - The patterns fade to plain colour between about 10 and 45 m, so the far hills keep the map colours and do not shimmer.
  - **Adaptive quality.** After about two seconds of frames slower than 20 per second, the patterns are switched off for the rest of the visit: the shader is rebuilt without them and the blocks go back to plain colour. Some GPUs, and software renderers, run both sides of a branch, so only a shader without the pattern code is cheap. In the test browser (software rendering) the patterns tripled the frame time, from 100 ms to 320 ms. With the switch, the frame time returns to the earlier level.
- **A more realistic hand lens** (`ui/lupa.ts`). The view is built in three passes:
  1. a groundmass painted from noise, or for granite and gypsum a mosaic of interlocking crystals (quartz, twinned plagioclase, perthitic K-feldspar, mafic minerals);
  2. grains on top, lit from the upper left and casting shadows: tapered feldspar laths with twin planes, pyroxene prisms, amygdales, packed sand grains, clasts with their own texture, mica flakes, pyrite cubes, chiastolite crosses, fossils;
  3. a gentle relief of the broken surface and a fine grain.
  Everything is placed in a fixed 240-unit frame (about 8 mm) and then scaled, so the same rock is drawn at any size.
- **Maximise the lens view**. A button on the lens picture, or a tap on the picture, opens it over the whole screen, redrawn at the screen's resolution. A tap, the X or Esc closes it. This works at outcrops and on loose weathered rock.

## Checks

- Unit tests: `npm test` (99 tests) and `npm run typecheck` pass.
- In a browser at 1280 × 800 (mouse), the checks covered:
  - the mouse is not captured after starting or after a click on the landscape;
  - a drag turns the view and the wheel zooms;
  - the map button opens the map with a mouse click;
  - a contact is finished with «Listo», and a second «Listo» returns to Mover;
  - the solution map shows the true units, traces and legend.
- On an emulated Pixel 7 (touch), the checks covered:
  - a pinch zooms in and out without turning the view or hammering;
  - one finger still turns the view;
  - a contact can be drawn and finished with «Listo» on the map.
- The lens view was drawn for all 15 textures of the published scenarios. It takes about 35 ms at 240 px and under 1 s at 1400 px, in the software renderer.
- End-to-end: `e2e/walk.mjs` (61 checks), `e2e/aim.mjs` (11), `e2e/touch.mjs` (50) and `e2e/kinematics.mjs` (8) pass, each run on its own.

## Left open

- The sound fixes target the known causes on iOS Safari and Android Chrome, but they were checked only in an emulator, not on a real phone.
- The rock patterns cost GPU time near the student. A slow device switches them off by itself, but the threshold (20 frames per second) should be checked on real tablets.
