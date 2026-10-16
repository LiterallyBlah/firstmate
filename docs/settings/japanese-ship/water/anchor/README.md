# Umibozu world-waterline correction

The original `cycle` was already placed in world coordinates (`cycleLayer` places
it at `at - anchor` and has no viewport layout). The island behind it was in a
cover-scaled backdrop: tall panes enlarged the trees into its fixed waterline.
Moving the creature nearer the ship hid its eyes behind the hull, so that trial
was rejected.

The approved island is now a stationary `phase-strip` in world coordinates, with
all six phase sets, and the creature stands at world `[100, 178]`. Island pixels
through original row 245 are unchanged. The source is mirrored beyond the far
shore to close the strip without a cut edge, and its water feathers into the bay.
A matching storm matte keeps the coast dark in storms. The spirit draws after
that matte and keeps its solid body, glowing eyes and spray.

An independent empty sky/sea backdrop covers any pane; it contains no land that
could slide beneath the spirit when resized. The stars and crescent moon keep
their backdrop-space placement. All water layers, crew, ship, wake, shark and
departures are unchanged. Lite, still and reduced motion hide the spirit.

| View | Before (500ac77) | Corrected peak storm |
| --- | --- | --- |
| Wide | [Before](before-wide.png) | [After](after-wide-full.png) |
| Tall-narrow | [Before](before-tall.png) | [After](after-tall-full.png) |
| Square | — | [After](after-square-full.png) |

Complete rise/submerge clips: [wide](wide-cycle.gif), [square](square-cycle.gif),
[tall](tall-cycle.gif). `results.json` records the real canvas samples, camera fit,
world waterline and full/lite/reduced-motion assertions. The check reuses the
established fixture host, pack RPC, overlay geometry and canvas PNGs; it has no
Pixi observer. Run `node docs/settings/japanese-ship/water/anchor/render.mjs` after
the standard compile step.

`sources/open-bay.png` was generated with the built-in imagegen tool from the
approved `coast.png`, then registered at 600 × 400 and mapped to the existing six
phase palettes. It is an offline source, not shipped in the pack. The prompt was:

> Edit this pixel-art environmental background to make its independent sky and sea fill plate. Preserve its exact clean pixel-art quality, colours, level horizon at 45% of the image height, soft blue sky gradient, turquoise distant water and deeper blue foreground water with fine ripples. Remove ALL land: the entire cherry blossom island, rocks, shoreline and distant mountain silhouettes. Replace them with continuous open sky above the horizon and open ocean below it. No trees, islands, clouds, stars, moon, ships, creatures, objects or text. Keep a beautiful smooth subtly dithered sky with no horizontal colour bands. Uniformly calm open sea, fine distant ripples, deeper foreground, seamless compatible left/right edges. The output is the same 3:2 landscape composition as the reference. This is a production sky/sea fill asset that will sit behind the unchanged original island art, not a new scene illustration.
