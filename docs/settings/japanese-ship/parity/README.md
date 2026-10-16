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

Verification and visual review are in progress; this is not yet a completed acceptance report.
