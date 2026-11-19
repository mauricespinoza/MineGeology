# Compass button, no accidental text selection, profile solution

## No accidental text selection
Dragging to look around, or a long press on a tablet, used to start selecting the text of the HUD and the panels.
The page now selects no text (`user-select: none` on `body`, with no long-press callout on iOS). Only fields the
student types in (inputs, notes, selects) can still be selected and copied.

## The compass, a button of its own
- Beside the hammer («Trabajar») there is now a **Brújula** button, also on the **B** key. It shows by any outcrop
  that has a plane to measure.
- It opens **the compass on its own**, in a narrower sheet at the side that leaves the outcrop in view: no hand lens,
  no other tools, no sample and no notebook fields. With a single plane, the compass goes on it at once. With
  several (bedding, a fault plane, striae…), the student picks which. It lists what this station's compass has
  written down, and «Ver la estación completa» goes to the full station.
- Next to the dial and the clinometer, a small **stereonet** (lower hemisphere, equal area) draws the reading:
  the great circle of a plane and its pole, or the point of a line. The station's earlier measurements show faint,
  as written down by the student, to compare. No numbers are printed: reading the compass is still the exercise.
- «Trabajar» opens the station without the compass choices, only a «Brújula» button that switches to it.
- **Bedding and faults can always be measured**, poor outcrops included. There the reading scatters more:
  the manifest's `poor_quality_factor`, ×2 in the published scenarios. A note says so. Lineations (striae, hinges)
  still need a good or fair outcrop, as they do not show on a weathered surface. Way-up criteria, contacts and
  kinematic indicators still need one too.

## Profile solution in free mode
The profile screen has a **Solución** button, only in free mode and only where the model's block ships with the
scenario (practice mode). It draws the true units along the line, from the model's lithology block, the same
section the evaluation uses. The student's lines and the outlines of their bodies are drawn on top, so the two
can be compared. A legend lists the units present, youngest first. A campaign does not offer it.

## Checks
`e2e/compass-section.mjs` (21 checks): text selection, the compass sheet on its own with the great circle, at a poor and at a good outcrop, B,
the profile solution and its absence in a campaign.
