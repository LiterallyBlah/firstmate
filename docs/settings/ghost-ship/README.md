# Ghost ship

Fourth installed Deck setting, `ghost-ship`, displayed as **Ghost ship**. The shipped change is data and PNGs only, under `art/settings/ghost-ship/`. No engine changes or changes to the other three packs. Image payload: **902,142 bytes**, including the picker preview. All 26 required capabilities already exist. The final pack is built on the merged all-pane weather engine fix.

The approved broadside galleon has eight spectral crew looks, four crew stations, 24 independent cabin sleeper targets, a mast transit behind the sail, mist arrival, and a bow spar departure into a skeletal kraken. The bottom-right anglerfish uses `carrier-surface@1`. The separate distant kraken, breaching ghost whale and passing spectral ship appear at peak weather. The haunted coast and its lighthouse beam share a 1,800-pixel strip and a constant 1,200-second voyage clock.

## Review correction: storm seams and calm life

The former 160?42 storm fog reused an isolated mist sprite, exposing its cropped edges across the expanded viewport. The replacement uses a 512?256 low-contrast field with opposite edges blended before quantization. Rough-sea frames use a 384-pixel period with cyclic atlas padding; all three wave layers retain their separate clocks and drift. Uniform overcast attenuation removes stretched edge stripes. [Weather audit](weather-audit.json) checks both axes for every storm frame and verifies that all calm sea pixels are unchanged. Repeat sheets and actual wide, square and tall-narrow renders provide the visual seam check.

Four glowing jellyfish now remain submerged and visible in calm day, night, lite and still, with gentle drift/pulse in moving modes. The coast and attached beam share a 1,800-pixel period, keeping the lighthouse from repeating at common wide sizes while preserving the 20-minute voyage.

## Review evidence

| Render | Evidence |
| --- | --- |
| Moody day | [Midday](review/midday-wide.png) |
| Dusk | [Dusk](review/dusk-wide.png) |
| Night showpiece | [Night](review/night-wide.png), [spectral crew close-up](review/spectral-crew-close.png) |
| Peak storm | [Storm](review/storm-wide.png), [green lightning](review/storm-lightning.png) |
| Tall and narrow | [Night](review/night-tall-narrow.png), [storm](review/storm-tall-narrow.png) |
| All phase/shape overlays | [Matrix results](matrix.json); `review/<phase>-<wide|square|tall-narrow>-overlay.png` |
| Crowded bow | [Before](review/bow-before.png), [24 blocked crew](review/bow-after-24.png) |
| Calm underwater life | [Day jellyfish](review/jellyfish-calm-day.png), [night jellyfish](review/jellyfish-calm-night.png), [tall day](review/midday-tall-narrow.png) |
| Sleeping cabins | [24 sleepers](review/cabins-24-close.png), [96 exact focus receipts](crowd-focus.json) |

| Clip | Evidence |
| --- | --- |
| Scene alive | [Full scene](review/scene-alive.gif) |
| Plank departure | [Full walk/drop/swallow](review/plank-kraken-departure.gif), [close-up](review/plank-kraken-close.gif), [contact sheet](review/kraken-close-contact.png) |
| Storm peak | [Whale and spectral ship](review/storm-peak-whale-and-ship.gif), [contact sheet](review/storm-contact.png), [registered whale surface](review/whale-contact.png) |
| Night crew and lighthouse | [Night clip](review/night-spectral-crew.gif) |
| Arrival and lookout | [Hatch and ladder](review/hatch-and-lookout.gif), [ladder contact sheet](review/lookout-contact.png) |
| Lite | [Lite motion](review/lite-alive.gif), [lite storm](review/lite-storm.png), [checks](lite.json) |

## Section 7 motion audit

Ship's deck is the parity reference. Regions are sampled from rendered frames in [motion-regions.json](motion-regions.json); these establish visible change, not isolation from surrounding motion. [art-audit.json](art-audit.json) separately checks distinct authored frames and crew alpha. Clips above provide visual review.

| Element | Ghost ship behavior | Comparison with Ship's deck / static justification |
| --- | --- | --- |
| Hull | Bob and whole-stage rock; stronger in storm | Same existing bob/rock capabilities |
| Main and aft sails | Four registered wind-clock billow frames each | Animated sail parity |
| Rigging | Wind-clock sway frames | Rigging moves; climb remains behind cloth |
| Both flags | Four wind-clock flutter frames | Flag parity |
| Green lanterns | Seeded flicker and glow | Flicker parity; depth rows precede nearby crew |
| Hull seams | Slow four-frame pulse, intensified by busyness | Additional ghost lighting |
| Fog and mist | Two drifting phase strips at different speeds; denser night frames; storm fog tile | Layered parallax, plus night variation |
| Will-o'-the-wisps | Offset mist cycles and changing silhouette/alpha | Replaces ordinary ambient sea life |
| Floating candles | Four frames with vertical bob | Water life motion |
| Ravens | Rest/turn/rest cycle on the yard | Perched-bird parity |
| Bats | Night-only passage frames separated by empty frames | Flyby parity; no stationary bat in daylight |
| Jellyfish | Eight-frame gentle drift and wide/narrow pulses below the surface | Ambient at every weather level; runs in full/lite and rests submerged in still |
| Ghost whale | Rise, breach, dive, splash, empty ripple, then blank pause | Explicit clean resting end; hidden in lite/still |
| Spectral ship | Faded passage across an 800-pixel lane, then blank pause | Passing ship parity; not pinned to the coast |
| Distant kraken | Separate small surfacing/sinking cycle, ending in a ripple and blank pause | Separate from departure effect; hidden in lite/still |
| Working crew | Walking, climbing, hauling/cranking poses | Pose/fidget parity |
| Waiting/blocked crew | At-ease breath and timed pose changes | Fidget parity |
| Idle crew | Fixed translucent bodies, engine-owned animated Zs | Fixed zone appearance preserves 24 independent targets, as approved |
| Anglerfish | Swim frames, loiter, lure and speech marker; animated surface ripple | Existing carrier and real upper/lower surface split |
| Departure | Visible spar walk, fall, eight 250-ms kraken frames; wrap, conceal, sink, ripple | Two-second eater, independent finite choreography |
| Water | Three wave depths with different drift/frame speeds and storm variants | Layered wave shapes rather than uniform dashes |
| Coast | Phase strip, 20-minute loop; night windows | Voyage parity |
| Lighthouse | Night beam cycle on a phase strip with identical voyage period/offset | Moves exactly with its landmark |
| Sky, stars, sun/moon | Static within each phase; crossfade at phase boundaries | Deliberate backdrop, with moving clouds crossing it |
| Underwater wreck | Static scenery below moving waves and jellyfish | A seabed wreck should not articulate |
| Wheel, capstan housing, cabin structure, figurehead, spar | Rigid furniture carried by stage rock | Mechanical/structural fixtures; crew supply the work motion |

## Section 8 acceptance gates

| # | Gate | Result and evidence |
| --- | --- | --- |
| 1 | Level broadside | **Pass** — [day render](review/midday-wide.png); approved level silhouette, only gentle whole-stage rocking |
| 2 | Animated, not static | **Pass** — [motion audit](motion-regions.json), [scene clip](review/scene-alive.gif); constant spectral crew alpha and night tint follow the approved amendment |
| 3 | Creatures in their medium | **Pass** — [angler close-up](review/anglerfish-close.png), carrier surface row 39; kraken frames register to row 110 with tinted translucent lower water, [departure close-up](review/plank-kraken-close.gif) |
| 4 | Real plank and large eater | **Pass** — [departure](review/plank-kraken-departure.gif); horizontal bow spar, visible walk/drop, 156-by-132 kraken, eight frames over 2,000 ms |
| 5 | Ladder behind sails | **Pass** — [climb contact sheet](review/lookout-contact.png); transit is flat against mast, with foreground sail depth above the climber |
| 6 | Lights behind crew | **Pass** — all six authored light rows precede nearby crew; [crowd](review/crowd-working-24.png), [night crew](review/spectral-crew-close.png) |
| 7 | Crew inside rail at 24 | **Pass** — pack floor/crowd lint, [before bow](review/bow-before.png), [after 24](review/bow-after-24.png); four-state crowd renders and [focus receipts](crowd-focus.json) |
| 8 | Every pane shape filled, no band or seam | **Pass** ? corrected storm [wide](review/storm-wide.png), [square](review/storm-square.png), [tall-narrow](review/storm-tall-narrow.png), inspected at native resolution; [wrap audit](weather-audit.json), [fog repeat](review/storm-fog-wrap.png), [sea repeat](review/storm-water-0-wrap.png). Full six-phase/three-shape [matrix](matrix.json) retained |
| 9 | Weather fills whole pane | **Pass** — rebased onto PR #98 (`4024114`); [tall storm](review/storm-tall-narrow.png), [wide storm](review/storm-wide.png), [square storm](review/storm-square.png); changed weather pixels in all ten vertical bands per shape |
| 10 | Scenery-bound life travels | **Pass** — coast and beam have identical 1,200-second scroll; whale/ship/bats are intermittent with blank rests, [night](review/night-spectral-crew.gif), [storm](review/storm-peak-whale-and-ship.gif) |
| 11 | Spread-out life, safe lite/still | **Pass** — whale left, distant kraken off the stern, angler lower right; jellyfish across the underwater width; set pieces hidden in lite/still, [lite storm](review/lite-storm.png), [reduced storm](review/storm-reduced.png) |
| 12 | Clean animation ends | **Pass** — empty ripple then blank whale/kraken endings, empty ship/bat intervals; [whale contact](review/whale-contact.png), [kraken contact](review/kraken-close-contact.png) |
| 13 | Full star field | **Pass** — [wide night](review/night-wide.png) and [tall night](review/night-tall-narrow.png) |
| 14 | Water with depth | **Pass** — [day](review/midday-wide.png), [scene clip](review/scene-alive.gif); separate far/middle/near wave shapes and underwater cutaway |
| 15 | Smooth sky | **Pass** — dithered phase gradients, [dawn](review/dawn-wide.png), [dusk](review/dusk-wide.png); no hard color bands |
| 16 | Storm intensity | **Pass** — dark green overcast, heavy all-pane rain/fog, rough waves, green flashes and peak creatures, [storm clip](review/storm-peak-whale-and-ship.gif) |
| 17 | Six to eight crew looks | **Pass** — eight distinct atlases, [alpha audit](art-audit.json), [24 crew](review/crowd-working-24.png) |
| 18 | Every crewmate clickable at 24 | **Pass** — 96 exact focus assertions: 24 each idle, working, waiting and blocked; [receipts](crowd-focus.json), [full checks](motion.json) |
| 19 | Thumbnail and name | **Pass** — `preview.png`, display name **Ghost ship**, picker assertion in [full checks](motion.json) |
| 20 | Approved concept quality | **Pass** — [approved studies](concepts/README.md) compared with [day](review/midday-wide.png), [night](review/night-wide.png), [storm](review/storm-wide.png), registered pixel art and retained cutaway |

## Validation and reproduction

- Pack lint: **85 passed**. Latest registered payload: 158 PNGs, 902,142 bytes.
- `npm.cmd test -- --maxWorkers=1`: **1,200 passed, 3 skipped**, 101 files. No timing flake occurred.
- `npm.cmd run typecheck`: passed.
- Paseo compiler and Hermes: [compile-results.json](compile-results.json), both client/server bundles compile; client growth is zero. The vendor Pixi parser refusal is the existing expected native boundary, not a new failure.
- Frozen Ship gate: [gate-results.json](gate-results.json), **81/81 pixel-identical**. Its recorded pre-correction engine has the same client tree as the final data-only branch; neither the frozen fixture nor expectations were edited.
- Actual RPC loader, compiled client and Edge WebGL: full/lite/still checks, 42 phase/storm/overlay captures, 96 real UI focus clicks, finite departure and peak weather clips. These are fixture tests, not a claim of installation in the captain's live workspace.
- Weather integration: `4024114` is an ancestor; final branch rebased onto `88b8e1b`, which also contains the timing-test fix.

```powershell
node docs/settings/ghost-ship/build-art.mjs
node docs/settings/ghost-ship/build-pack.mjs
npm.cmd run lint:deck-packs -- --maxWorkers=1
node docs/ship-deck-canvas/compile.mjs
node docs/settings/ghost-ship/render.mjs
$env:GHOST_REVIEW='matrix'; node docs/settings/ghost-ship/render.mjs
Remove-Item Env:GHOST_REVIEW
$env:GHOST_LITE='1'; node docs/settings/ghost-ship/render.mjs
Remove-Item Env:GHOST_LITE
node docs/settings/ghost-ship/audit-art.mjs
node docs/settings/ghost-ship/audit-weather.mjs
node docs/deck-settings/gate.mjs
npm.cmd test -- --maxWorkers=1
```

The render harness uses the existing `docs/board-list` Playwright/esbuild dependencies. Evidence encoding uses `gifenc` and `omggif` installed only under ignored `.generated/motion-tools/`. Sources, prompts and offline registration stay under this documentation directory. [Production prompts](production-prompts.json) and the [Jolly Roger correction](sources/jolly-roger-prompt.json) record built-in image generation; the original ship's generic rain is reused with provenance. The storm texture correction is recorded in the same prompts file; its wrap registration and uniform overcast fill are reproducible in `build-art.mjs`.

## Known limits

- Crew alpha is deliberately constant: all ghost/skeleton pixels are partially translucent, with paler green `stage.tintByPhase.night`. Extra **night-only** transparency needs a later engine capability and is not simulated with duplicate crew or stale state.
- Cabin bodies remain fixed because the existing zone appearance owns their stable hit targets. Animated Zs provide idle life; this is the approved sleeper behavior.
- Reduced motion deliberately hides the whale, distant kraken, spectral passage, and bats. Submerged jellyfish remain visible at rest. It does not freeze a breaching creature above the surface.

No merge or installation is performed by this change.
