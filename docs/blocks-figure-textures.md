# Blocks broken by the hammer, a bigger figure, textures, compass in the toolbar

## Compass button in the toolbar
The «Brújula» button now sits in the side toolbar with the other tools, just under the notebook. It lights up
(gold) by an outcrop with a plane to measure, and opens the compass sheet there (key B as well). Away from one it
says to go closer. On narrow screens the toolbar buttons are 40 px, so that eleven fit above the look stick.

## Hammer blows break blocks
As in a block game, each blow of the hammer breaks the near block struck (5 × 5 m, one terrain step of 2.5 m):
it drops one step, down to four steps (`MAX_DIG_STEPS`). The student can walk down into the hole.
- `Grid.dug` holds how many steps each near block has been lowered. `blockHeight` subtracts it for the near level
  of detail only, so far away the land keeps its shape. `heightAt`, aiming and walking follow the broken blocks.
- The mesh worker keeps its own copy, updated block by block. Only the chunks the block touches are meshed again.
- The broken blocks are saved with the attempt (`GameState.dug`, pairs of block index and steps) and mended for a
  new one.
- Rock still opens the hand lens as before. Soil breaks too, with a note that it is not rock.

## A bigger figure
The figure stands about two terrain steps tall (about 5 m against 2.5 m steps, as a block game's player against
its blocks). The eyes are at `EYE_HEIGHT` = 4.6 m (was 3.2), and the third-person camera follows further back.

## Textures
`src/world/materials.ts` draws small procedural textures once, grey and near white, so each part keeps its colour:
cloth twill, denim, a canvas weave for the vest and the pack, pebbled leather for boots, belt and straps, ridged
rubber for the grip and soles, brushed steel for the hammer, smooth helmet plastic, felt, hair strands and soft
skin. Leather, rubber, plastic and steel shine. The figure also gained a buckle, pack straps, lugged soles, eyes
with irises, eyebrows, a nose, ears and a ridge on the helmet.

## Profile legend
The legend of the profile solution moves by dragging its title anywhere on the screen. A tap on the title folds
it to one line, so it never has to cover the profile.

## Checks
- `npm test` passes (104), including a new test of broken blocks.
- e2e: `aim` checks that a blow breaks the block one step down; `compass-section` checks the toolbar button and
  moving and folding the legend. `walk`, `touch`, `kinematics` and `notebook-gyro` pass.
