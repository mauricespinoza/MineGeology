# Work package 5: field tools, notebook and local save

## What was built

- `game/src/tools/compass.ts`: readings with scatter. `random.ts` gives the seeded numbers behind them.
- `game/src/tools/fieldwork.ts`: the five tools. Each reads what the outcrop shows, writes it in the notebook and returns its cost in field minutes.
- `game/src/state/state.ts`: the attempt now holds stations, measurements, notes, sketches and samples. `save.ts` writes it to the browser.
- `game/src/ui/fieldPanel.ts`: the panel that opens at an outcrop (key E). `notebook.ts`: the notebook (key N), with export of measurements as CSV and of the whole notebook as JSON.
- The map view plots stations with their number and the mean bedding as a strike-and-dip symbol.
- `geomapper publish --practice`: ships the answer key, lightly obfuscated, so that practice mode can return lab ages.

## The tools

| Tool | Returns | Field minutes |
| --- | --- | --- |
| Hammer and hand lens | field description, hand-lens description, fossils, the features of this outcrop, outcrop quality | 5 |
| Compass | one reading of the plane or lineation the student picks | 3 per reading |
| Way-up check | the indicator and what it means, or that none is visible | 5 |
| Contact inspection | the kind of contact, its evidence and the rock on the other side | 15 (5 if there is no contact) |
| Sample | thin section or radiometric age, back the next field day | 30, limited per scenario |

The game never names a formation or an age. The student types what they call the rock at each station, and earlier names are offered again; these names become the map units in work package 6.

## Measurement scatter

- A reading is the true value plus normal scatter: `rules.scatter` in the manifest (5 degrees on strike and 3 on dip by default), times `poor_quality_factor` on poor outcrops.
- Strike scatter grows as the dip falls below 30 degrees, up to four times, because strike is hard to read on a nearly flat bed.
- Each reading is seeded by the student's seed, the outcrop, the plane and the reading's number. Measuring again gives a new reading, two students get different numbers, and a reload continues the same series.

## Local save

The attempt is saved after every tool use and notebook edit, every five seconds while walking, and when the page closes. On reopening, the game offers to continue or to start over. If the browser refuses to store (private mode, full storage) the game says so and the notebook can still be exported.

## Done when

"A full traverse can be recorded, closed and reopened with nothing lost."

- Unit test `brings back a whole traverse with nothing lost`: three stations with notes, measurements, a sample, rock names, text and a sketch come back equal after a save and a load.
- End-to-end walk (`npm run e2e`): in a real browser, work an outcrop, reload the page, continue, and find the stations, samples, clock, position and discoveries identical. It passed three times in a row.

## Choices made here

- **One station per outcrop.** Returning to an outcrop reopens its station.
- **Lab ages need the answer key.** `units.json` carries no ages, so practice mode reads them from `practice.bin` (see `format/SPEC.md`). Without it, an age request says the result is not available.
- **Sampling a dyke.** Where a dyke cuts the outcrop, the student chooses whether to sample the host rock or the dyke.
- **Contact inspection states the kind of contact.** The architecture lists "contact type and evidence" as what the tool returns, so the student is told, not asked.
- **A slow frame no longer slows the walk.** Frame time was capped at 0.1 s, which turned low frame rates into slow motion; the cap is now 0.25 s.

## Left open

- **Saves are per browser.** Another device or a cleared browser starts over; accounts are work package 9. The JSON export is the only backup, and there is no import yet.
- **Sampling a dyke works only where the dyke is the outcrop's only contact.** An outcrop that shows both a contact between units and a dyke reports the contact, and the dyke cannot be sampled there.
- **No undo.** A measurement or a sample cannot be deleted from the notebook.
- **Sketches are simple line drawings** in one colour, without an eraser other than clearing the whole sketch.
- **The end-to-end walk is still not in CI.**

## Publishing

The game is built and deployed to GitHub Pages by `.github/workflows/pages.yml`, which runs the game's unit tests and `npm run build` first. Vite's `base` is `./` and `baked/` is its public directory, so the site works under any path; the end-to-end walk was run against the built site served at `/MineGeology/` before publishing. Enabling Pages (Settings > Pages > Source: GitHub Actions) is a one-time step that the workflow cannot do with its own token.
