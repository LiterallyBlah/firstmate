# Sakura parity work

This directory contains new generated art, offline registration, and real-canvas evidence for the Sakura coast parity review. Only derived PNGs and pure manifest data ship. The approved broadside hull, island geometry, sail/rig motion, suggestion shark waterline, and footer are retained. No Ship or airship pack changes.

Sources were generated with the built-in imagegen tool on 2026-10-16. Their exact source hashes are recorded in registration.json. Production registration uses the established nearest-neighbour, bounded-palette, binary-alpha pipeline in ../build-art.mjs. No generated source is shipped directly.

## Generation briefs

All prompts required crisp enlarged low-resolution pixel art, restrained navy/teal/ivory/Sakura colours, isolated sprites, no labels/grid, and transparent backgrounds except the dusk reference.

| Source | Prompt content and registration |
| --- | --- |
| sea-dragon.png | Four equal side-view cells: emerging crest, rising open mouth, closed-jaw swallow, submerging crest; Japanese teal sea dragon with ivory horns/whiskers; no gore. Common source bounding region retains relative emergence height. Four 80×72 frames. |
| umibozu.png | Four equal cells of a giant rounded black-blue sea spirit with tiny pale eyes, emerging to shoulders and settling; no mouth/horns/tentacles. Four 72×80 frames. |
| accessories.png | 4×3 atlas: cedar plank, masthead perch, chochin, petal; three crane wing poses and crescent moon; two splashes and two lightning poses. Each asset separately cropped and registered. |
| climbers.png | 6×3 atlas: six consistent indigo/russet/moss/plum/ochre/teal sailors, two back-view climbing poses and one lookout pose; no ladder in sprite. Frames appended to each crew lane. |
| crew-variety.png | Existing indigo crew sheet supplied as exact style/pose reference. Four rows of twelve poses: moss/straw hat, plum/headband, ochre/white hair, teal/braid. Registered to the existing 32×36 cells and role anchors. |
| weather.png | 2×2 atlas: sparse stars, overcast bank, two rain/spray frames; logical 96×64 tile scale. Alpha cleanup removes generation haze. |
| dusk-reference.png | Existing coast supplied as edit target; change only lighting to pink/gold dusk, preserve island/mountains/water geometry, add no objects. Used only to derive a colour lookup against the approved daytime palette; all actual coastal pixels remain registered to the original. |

## Reproduce

After the existing base art/motion builds, run `node docs/settings/japanese-ship/parity/build-art.mjs`, then `node docs/settings/japanese-ship/build-pack.mjs`. The ordinary pack lint and compiler/render workflow applies. `SAKURA_PARITY=before` or `after` enables the parity capture hook in the existing render harness. It uses screenshots, fixture fleet controls, and public DOM metadata, without a Pixi observer.

The baseline capture also sets `SHARK_REVIEW=before`, which selects the compiler's
pinned main bundle and original pack blobs. Clear that variable for the after and
repeat runs. `SAKURA_PARITY=repeat` captures the four scene comparisons without the
long interaction/clip pass. `SAKURA_TRANSIT=1` separately runs the three moving ladder
clicks after the main after-pass has built the pure geometry helper. GIF capture uses
the existing `gifenc@1.0.3` documentation dependency under `.generated/motion-tools`.
Run `parity/audit-captures.mjs` to write exact hashes/differences and the night pixel
audit, and `parity/preservation.mjs` for unchanged source pixels and the payload cap.

## Before and after

The baseline is pinned to `47e305d`, including its original PNG blobs. Both sides use
the same 1440×900 viewport, DPR 2, UTC wall clock and fixture fleet. The day capture
uses the normal fixture; storm/dusk/night use 24 working sailors. Storm is full motion
at intensity 1.00; day/dusk/night are reduced motion so geometry and lighting are stable.
The four final screenshots were independently reproduced byte-for-byte after final
art cleanup. [Expected changes](expected-changes.json) records exact before/after
SHA-256s, differing-pixel counts and the reason for each intentional Sakura change.
Ship's gate needs no exceptions or baseline updates.

| Scene | Before | After | Difference |
| --- | --- | --- | --- |
| Day | [PNG](review/before/day.png) | [PNG](review/after/day.png) | [PNG](review/after/day-difference.png) |
| Dusk | [PNG](review/before/dusk.png) | [PNG](review/after/dusk.png) | [PNG](review/after/dusk-difference.png) |
| Night | [PNG](review/before/night.png) | [PNG](review/after/night.png) | [PNG](review/after/night-difference.png) |
| Storm peak | [PNG](review/before/storm.png) | [PNG](review/after/storm.png) | [PNG](review/after/storm-difference.png) |

[Plank and sea dragon clip](review/after/sea-dragon-departure.gif) ·
[Umibozu storm clip](review/after/storm-peak.gif) ·
[Lookout climb clip](review/after/lookout-climb.gif) ·
[Night motion clip](review/after/night-motion.gif).

These GIFs are real canvas captures: the departure is sampled every 100 ms, the others
every 250 ms. Crops/resizing and GIF quantization affect review previews only. Their
JSON siblings record frame times and original full-canvas hashes, with PNG keyframes
beside them. The audit reads captured pixels, not a private renderer scene graph.

## Motion and parity with Ship's deck

| Element | Ship's deck | Sakura coast now | Still static / limitation |
| --- | --- | --- | --- |
| Departure | Plank walk, fall, splash, shark sequence | Same finite choreography, new sea dragon; every departure reason; right-side water at [350,305] | Discrete four-frame eater; no skeletal animation. Hold remains the unchanged rising arrival. |
| Lookout | Reversible mast access and settled lookout pose | Visible ladder route from [252,236] to [241,65], two climb poses and lookout pose for all six looks | Ladder and perch themselves are fixed; lookout's settled body is static. |
| Storm | Overcast, rough water, spray, lightning, serpent/kraken variants | Overcast and rain/spray grow with busyness, capped lightning, four-frame umibozu emergence variant at peak | Coast/island geometry is static; approved base water still uses scrolling ripple pixels, not new rough-water frame art. |
| Day | Dawn, morning, midday, afternoon, dusk, night | Same six phase times and 90-minute crossfades; generated dusk palette registered to unchanged coastal geometry; phase tints | No moving sun; morning/afternoon are restrained palette changes. |
| Night sky | Static star texture fading with night's share | Two independently timed bright/dim star fields and crescent moon | Moon shape is static. This layer reveals when the night backdrop takes over at 21:00, then is covered by dawn's crossfade; no new day-gated animation capability. |
| Lanterns | Native pixel-glyph glass/glow flicker | Three chochin registered from generated art into the same flicker vocabulary | Fixed lamp positions; glass/glow also run in daylight, as Ship's do. |
| Flybys | Three gull poses, glide/flap bursts | Three generated crane poses with the same flyby rules | Flight follows the existing horizontal path and gentle wobble; no free steering. |
| Drifters | Clouds | Approved clouds plus three-colour Sakura petals driven by wind | Petals drift horizontally on seeded lanes; they do not tumble or fall vertically. |
| Crew | Multiple looks, walks and working/waiting/blocked fidgets | Six looks, preserved original twelve indigo/russet frames, new climb/lookout poses and existing fidgets | Settled sleeping-window bodies remain static; engine-owned Zs animate. |
| Sail and rig | Billow cycle, upper rig sway, hull heave | Approved Sakura billow/rig/heave unchanged | Lower rig, main mast and hull geometry are fixed relative to the ship. |
| Suggestion shark | Swim/loiter with submerged rows and ripple | Entire existing carrier manifest and both PNGs unchanged, including [100,274] | Lite/still freeze swim and ripple under the existing policy. |

Full mode animates the above. Lite retains crew transit, sail/rig/heave and lantern
flicker, freezes weather frames, star cycles and drifters, and hides flybys/lightning.
Reduced motion snaps arrivals/posts, freezes animation and stays calm even with a busy
fleet; wall-clock day phases still update. No engine, schema, client or server behavior
was added or changed. The full package uses 26 existing capabilities.

## Verification

- Pack lint: 51/51 tests; all declared crops, hashes, dimensions, paths, effect bounds
  and 24-worker packing checks pass. **51 PNGs, 869,086 bytes**, including the actual-render preview.
- Typecheck passes. Full suite passes with one worker: **1,140 passed, 3 skipped** across
  97 files. The first highly parallel run hit timing-sensitive `pr-watch` and
  `update-source` tests; the complete serial run passed without changing those tests.
- Paseo 0.11 compiler: **703,669-byte client, 354,567-byte server**, zero bundle growth.
  Both branch/main client bundles parse under the installed React Native 0.81.5 Hermes.
- [Ship gate](../../../deck-settings/gate-results.json): **81/81 pixel-identical**,
  zero flakes, zero page errors and no intentional exemptions.
- Actual `?setting=japanese-ship` and `&overlay=1` renders; full, still and SwiftShader
  lite. [Lite evidence](../lite.json) includes keyboard focus/Escape.
- [96 actual pointer checks](review/after/interactions.json): 24 idle, 24 working,
  24 waiting and 24 blocked sailors each open their own details. Shark opens its
  independent empty-suggestion bubble. The masthead worker remains clickable.
- [Moving transit checks](review/after/transit.json): hover and click the actual
  climbing worker at three heights, [251,161], [251,122] and [251,89].
- [Preservation audit](preservation.json): fourteen approved PNGs are byte-identical;
  both original crew lanes' first twelve frames, hold arrival and complete suggestion
  carrier (including ripple) are unchanged. Ship and airship packs are untouched.
- [Night pixel audit](review/after/night-pixels.json) checks the generated star pixels
  alternate between their exact bright/dim RGB values in the real capture and the
  interior of a lantern changes glass colour, beyond whole-scene bob: **12 verified
  twinkling source pixels and three captured lantern-glass colours**.

These are real compiled-client browser fixtures, not claims of an installed desktop
or physical-device session. No plugin installation, reload or merge was performed.
