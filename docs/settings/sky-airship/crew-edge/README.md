# Sky pirates: crew margins, falling rain and forward whale

The crew floor and bow posts now sit inboard of the eagle and front lip. Crowds
spread from bow to amidships and stern rather than stacking beside the figurehead.
Standing overflow uses 14×40 spacing: its vertical separation exceeds the deck's
depth, so it allocates different x positions instead of a second obscuring row.
The extra two pixels at the stair foot keep that interior position walkable.

The cast's frame rectangles trim **only transparent side columns**. Foot anchors
move by the same amount, preserving every painted pixel's original position,
scale, height, animation and mirroring. This removes oversized invisible hit
padding without changing the engine or its hit-test rules. `verify.mjs` checks
that no painted pixel is removed or displaced. The hammock windows, lookout
route and departure choreography remain intact.

## Bow evidence

These crops retain the normal wide renderer's pixel scale.

| Crew | Before | After |
| --- | --- | --- |
| Three | ![Before](before/wide-blocked-3-bow.png) | ![After](after/wide-blocked-3-bow.png) |
| 24 | ![Before](before/wide-blocked-24-bow.png) | ![After](after/wide-blocked-24-bow.png) |

Full canvases and authoring overlays in `before/` and `after/` cover 1440×900 and
900×1400, with 24 blocked, working, waiting and idle crew. `after/results.json`
records all resolved positions, hit rectangles and centre winners.

The browser check uses the existing `(x, y - 8)` centre target. All **192 clicks**
(24 crew × four states × two viewports) select their exact sailor. Three-person
bow checks also pass. Partial hit-box overlap is allowed; there is no corner
search, substitute target or zero-overlap requirement.

[Rain, whale and serpent evidence](../art-motion/README.md) covers the accompanying art fixes.

## Reproduction

```powershell
node docs/settings/sky-airship/crew-edge/apply.mjs
node docs/settings/sky-airship/art-motion/build.mjs
node docs/settings/sky-airship/art-motion/serpent.mjs
node docs/settings/sky-airship/art-motion/serpent-verify.mjs
node docs/settings/sky-airship/crew-edge/verify.mjs
node docs/ship-deck-canvas/compile.mjs
node docs/settings/sky-airship/crew-edge/render.mjs
node docs/settings/sky-airship/art-motion/render.mjs
node docs/settings/sky-airship/review.mjs
node docs/deck-settings/gate.mjs
npm.cmd run lint:deck-packs
npm.cmd run typecheck
npm.cmd test -- --maxWorkers=1
```

The render wrappers reuse the established compiled-client/RPC host and public
overlay. No Pixi internals are inspected. These are synthetic browser fixtures,
not installed-plugin/device tests. No plugin was installed or reloaded.

The older overlap dumps and spacing trials record the investigation before the
requirement was clarified to centre selection; their disjoint-box criterion is
not the acceptance test. Current results are in `verified-geometry-art.json` and
`after/results.json`.
