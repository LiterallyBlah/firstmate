# Tall-pane cloud sea

The near cloud bank used to end at world row **446** (`286 + 160`), exposing
the coarser cloud sea painted into the sky backdrop. At still 900×1400 this
produced a straight boundary about 1107 pixels down the canvas. At more extreme
heights the backdrop itself also runs out, exposing the renderer's flat colour.

The four-pixel fit overhang was not the cause. `deckBox` in `client/deck-pixi.ts`
uses the 480×320 stage when the compiled parts' top is nonnegative, as here.
`fitDeck` centers that stage using the smaller width/height scale; the visible
world can extend far beyond it. The fixture's 900×1400 viewport gives an 874×1235
canvas, scale 1.7115833, y=344, and visible bottom 520.57. Its 650×1900 viewport
extends to world row 869.89. Setting the fit to 0…320 would not fix either case.

`stripLayer` in `client/deck-environment.ts` repeats horizontally only: far,
mid and near end at rows 387, 363 and 446 respectively. `backdropPlacement`
in `client/deck-sky.ts` enlarges the separate **600×400 sky** to cover its top and
sides, anchored on its horizon, without a bottom-coverage constraint. Neither
renderer repeats a backdrop's last row; the apparent band is exposed artwork
and, farther down, the background colour. The 480×320 stage art is separate.

## Data and art change

The original near bank's top 112 rows (through world row 397), all other original
images, all original ambience definitions, and all stage/cast/portal/weather/
day-cycle data remain unchanged. Its opaque last 48 rows transition to a new
generated cloud floor in the original palette. This is the only intended change
to existing pixels, below the normal wide view. `audit.mjs` verifies these facts.

The new `sea-floor` uses the existing `tile@1` behavior, from world row 398 to
the visible bottom, behind the near bank. It has an opaque 704×192 texture and
registered storm variant, the same wind clock and 3.8 px/s drift, and the same
0.35…0.95 weather crossfade as the near bank. Its period divides the bank's 1408
pixels, keeping the join registered through every scroll wrap. The bank's final
row is exactly tile row 47; world row 446 continues with tile row 48.

The generated source is `../sources/cloud-floor.png`; `build-floor.mjs` crops
at the target aspect before nearest-neighbour registration (no anisotropic
stretch), overlaps tile edges, and maps colours to the approved bank palette.
Storm colours follow the existing day/storm palette registration. No repeated
single rows, enlarged edge pixels, new capabilities, engine changes or plugin
dependencies. The image budget is **966,489 / 1,000,000 bytes**, 91 PNGs.

## Evidence and reproduction

`render.mjs` reuses the established `docs/deck-settings/render.mjs` compiled-client,
host and real pack RPC loader. Only the viewport/clock/capture sequence differs;
there are no Pixi observers or substitutes. The baseline manifest and images
come from the main commit pinned by the compile harness. Canvas dimensions,
fit, visible bottom and weather are recorded in each `results.json`.

```powershell
node docs/ship-deck-canvas/compile.mjs
$env:ASPECT_REVIEW='before'
node docs/settings/sky-airship/narrow/render.mjs
Remove-Item Env:ASPECT_REVIEW
node docs/settings/sky-airship/build-art.mjs
node docs/settings/sky-airship/build-pack.mjs
node docs/settings/sky-airship/narrow/render.mjs
node docs/settings/sky-airship/narrow/audit.mjs
npm.cmd run lint:deck-packs
node docs/settings/sky-airship/review.mjs
node docs/deck-settings/gate.mjs
npm.cmd run typecheck
$env:FIRSTMATE_RECEIPT_JOURNAL='1'
npm.cmd test -- --maxWorkers=1
```

| Viewport | Before | After |
| --- | --- | --- |
| 1440×900 wide | [Day](before/wide-day.png), [night](before/wide-night.png), [storm](before/wide-storm.png) | [Day](after/wide-day.png), [night](after/wide-night.png), [storm](after/wide-storm.png) |
| 1000×1000 square | [Day](before/square-day.png), [night](before/square-night.png), [storm](before/square-storm.png) | [Day](after/square-day.png), [night](after/square-night.png), [storm](after/square-storm.png) |
| 900×1400 tall | [Day](before/tall-day.png), [night](before/tall-night.png), [storm](before/tall-storm.png) | [Day](after/tall-day.png), [night](after/tall-night.png), [storm](after/tall-storm.png) |
| 650×1900 very tall | [Day](before/very-tall-day.png), [night](before/very-tall-night.png), [storm](before/very-tall-storm.png) | [Day](after/very-tall-day.png), [night](after/very-tall-night.png), [storm](after/very-tall-storm.png) |

These are browser fixture checks of the real renderer, not an installed desktop test.

`audit.json` records **zero changed pixels** in all three wide and all three square
captures. Tall and very-tall differences start at canvas rows 1027 and 1159,
respectively, below the unchanged stage and foreground crests. All twelve final
captures were visually inspected: cloud depth continues to the bottom, including
the multiple tile wraps in the very-tall pane, without a flat band or seam.

The existing scene review also passed all 24 exact sleeper target clicks, zero
overlaps, 24 working sailors, whale interaction, keyboard focus, dawn/dusk/night,
arrival/lookout, departure, live motion, peak weather/lightning and calm recovery.
See `crowd-focus.json` and `motion-full.json`. The compiled implementation commit
and Hermes results are in `compile-results.json`; client/server byte sizes are
unchanged. Pack lint: 66/66. Typecheck: passed. Full local suite: 1,155 passed,
three skipped (97 files), with receipt journaling enabled at launch to exercise
the test isolation boundary.

Ship gate: **81/81 pixel-identical**, zero page errors, no expected-change overrides
(`ship-gate.json`). The gate began with the completed pack changes still uncommitted;
its baseline and compiled runtime are labelled `96d5914`. No runtime source changed,
and the subsequent compile of implementation commit `52cec40` reconfirmed unchanged
bundles and Hermes parsing. The software-rendered lite scene review also passed
(`lite.json`), including stable reduced motion and visible movement in each region.
