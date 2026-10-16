# Sakura coastal voyage

Stacked on PR #99, `bae5478`. Only Sakura pack data, PNGs and offline authoring/evidence
change. The parent water, stars, moon, opaque umibozu poses, ship, crew and departures
remain intact. No engine, Ship's deck or Sky pirates changes.

The 2,880-pixel coast drifts right at 2.4 world pixels/second: a **20-minute lap**,
opposite the ship's left-facing bow. It passes cherry-blossom isles and a torii in
the shallows, a hill pagoda, a fishing village with moored boats, a complete snowy
peak, a cliff castle, and bamboo with a small shrine. Open-water gaps separate the
landmarks. The boats and torii are part of their shoreline sprites, so their
relative positions cannot drift or become pinned to the pane.

The old stationary island foreground is replaced by this voyage, rather than
drawing two competing coasts. The parent's independent six-phase sky/sea plates,
viewport weather fill and layered bay remain unchanged. The transparent strip is
never responsible for filling the pane. Its storm matte shares its exact silhouette,
period and voyage clock. All six day phases use the same alpha mask. Small warm
windows and lanterns appear only in the night phase and twinkle on a registered
three-frame light strip, behind the ship and crew.

The umibozu shares the coast's drift and 2,880-pixel period, at three open-water
berths separated by 960 pixels. Each retains all 15 approved opaque rise/settle
poses, offset by five poses from its neighbour, with a world waterline at y=178.
The coast registration audit checks every pixel of each 72-pixel berth against
the island mask. The body reaches full strength above the storm threshold; lite,
still and reduced motion hide it. These are scenery-bound strips, not viewport
placements. The existing suggestion shark and departure dragon remain ship-bound
interactive effects in their approved water positions.

## Evidence and gates

`evidence/` contains wide, tall-narrow and square day/dusk/night/storm views,
full/lite/reduced motion, and the authoring overlay. `coast-native-motion.gif`
shows ten seconds at the **shipped 1x rate**. The three `*-full-lap-60x.gif` clips
are explicitly accelerated review fixtures: only the four shared voyage drifts
are multiplied by 60, showing a whole 20-minute coast lap in 20 seconds. Water,
weather, light and spirit pose clocks remain at their native rates. The pack
itself always uses 2.4 px/s. `*-sample-*.png` frames make every landmark reviewable.

`audit.json` verifies the parent contracts and unchanged images, registered phase
geometry, night-only lights, shared drift, open-water berths, exact original spirit
pixels, wrap gaps and the **977,432 / 1,000,000 byte** raw image budget.

`validation.json` records the final checks: **69 pack checks**, TypeScript, both
bundles parsing in Hermes with zero bundle growth, **81 pixel-identical frozen Ship
shots** with no flakes/errors, **192 exact crew clicks**, the actual software WebGL
keyboard check, and the serial full suite: **101 files, 1,184 passed, 3 skipped,
zero failures** in 73.49 seconds. No tests were edited. `motion-audit.md` maps each
moving layer to its clock, world registration and reduced-motion policy.

The applicable ghost-ship section 8 gates are covered as follows:

- Level broadside, plank/deck bounds, ladder, crew variety and lantern depth retain
  the parent's stage/cast contracts; the 24-crew click fixture is rerun.
- Scenery, boats, lights and horizon spirit move together; no shore prop stays
  pinned to the frame. Water and existing ship animation retain their clocks.
- The spirit rises and fully submerges in the sea, with unchanged pose pixels and
  staggered cycles. The shark and dragon retain their existing medium and timing.
- Tall panes retain independent sky, stars, sea and weather coverage; the coast
  has transparent wrap boundaries and broad open-water gaps.
- Six phase palettes, smooth sky, night moon/stars, rough storm water, attention
  carrier, display name and picker presentation retain the parent pack behaviour.
- No plugin install or reload is part of the fixture validation.

## Reproduce

```powershell
node docs/settings/japanese-ship/coast/build.mjs
node docs/settings/japanese-ship/coast/audit.mjs
npm.cmd run lint:deck-packs
node docs/ship-deck-canvas/compile.mjs
node docs/settings/japanese-ship/coast/render.mjs
$env:COAST_PREVIEW='60'
node docs/settings/japanese-ship/coast/render.mjs
Remove-Item Env:COAST_PREVIEW
$env:SAKURA_LANTERNS='after'
node docs/deck-settings/render.mjs '?setting=japanese-ship'
Remove-Item Env:SAKURA_LANTERNS
$env:CHECK_JAPANESE_LITE='1'
node docs/deck-settings/render.mjs '?setting=japanese-ship'
Remove-Item Env:CHECK_JAPANESE_LITE
node docs/deck-settings/gate.mjs
npm.cmd run typecheck
npm.cmd test -- --maxWorkers=1
```

The renderer reuses the established compiled-client/RPC scaffold and reads only
public canvas metadata, screenshots and the authoring overlay. It does not inspect
Pixi internals. The historical crew/lite/gate tools write to their existing output
folders; their final results are copied here and those historical files restored.
Dependencies are the repo's normal npm install, `docs/board-list` render dependencies,
and `gifenc@1.0.3` installed under ignored `.generated/motion-tools`.

## Art provenance

`sources/` contains the unchanged built-in imagegen outputs for this task. The
source hashes and exact registration/crops are in `registration.json`; prompts
are in `prompts.md`. The reference was the parent's Sakura coast, used for style.
The night generation contributes warm window/lantern ink only, transferred onto
the daylight alpha mask; buildings cannot jump between phases. The snow peak is
a separate complete sprite so no clipped cell edge reaches the shipped coast.
Existing nearest-neighbour/palette/PNG helpers register the art offline. Sources,
scripts, review clips and evidence do not ship in the installed pack.
