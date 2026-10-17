# Sakura bay, stars and storm spirit

## Current water polish

The commissioned `-ib` atlases replace the six-pose sheets with 24 poses in a
4-by-6 row-major layout. Each hold is 80 ms on the existing water clock, preserving
the 1920 ms loop. All six original poses are byte-identical at indices 0, 4, 8,
12, 16 and 20. The layer geometry, drift, phase palettes, alpha and storm blend
are unchanged. `inbetweens.mjs` registers the new files; the superseded sheets
are removed from the pack. The regression fixture hashes the original poses and
checks every adjacent transition, including the wrap, changes under 15% of pixels.

At 1x the original 320 ms poses held about 711 ms in calm and 178 ms in a storm.
The render cadence and whole-pixel scroll were steady; the large pose transitions
caused the visible stepping. The new holds are about 178 ms and 44 ms respectively.
No engine timing or pixel-snapping change was needed.

The storm spirit now uses the scene's sea surface; see [coast](../coast/README.md).
Current review evidence is kept outside git in
`C:\Users\micha\.paseo\plugin-data\firstmate\home\data\sakura-water-smooth\evidence\`.
The remaining sections document the earlier water rebuild and its historical checks.

This revision changes only the Sakura pack and its offline authoring/evidence files.
Ship's deck, Sky pirates, the renderer, and the runtime contracts are unchanged.

## Water

The single 96 × 64 dash tile is replaced by three scales of generated swell art:

| Layer | World rows | Drift on the existing water clock | Treatment |
| --- | --- | --- | --- |
| Far | 212–244 | 0.55 px/s | Fine, pale shimmer, feathered edges |
| Middle | 232–296 | 1.35 px/s | Small curved crests, feathered edges |
| Near | 276 to visible bottom | 2.7 px/s | Larger swells and troughs, stronger storm variant |

The far and middle layers use `phase-strip@1`, with day, twilight and night palettes
mapped across all six day phases. The near layer uses `tile@1`; its transparent
troughs preserve the existing backdrop's depth gradient and six-phase colours.
The original shoreline and reflections remain visible. All swell frames and drift
use `water`, so the existing turning wake, shark waterline/ripple and departure
splashes retain their shared pace. Six registered frames bend the crests gently;
the atmosphere speeds the clock up in a storm. Lite runs the water at its existing
lower frame rate; reduced motion holds frame zero.

The near tile repeats in both axes to the visible bottom. Its back and front bands
share origin 276; the front band is cropped at 290 rather than restarting its texture.
Offline overlapping edges avoid a border at each tile wrap. The transparent strips
fade into the near field instead of leaving an opaque horizontal plate.

## Night sky

A generated star field fills the coast backdrop's entire sky area. Its overlay uses
the same horizon-anchored placement, which expands to cover the visible top and sides
at any aspect ratio. Stars remain behind the coast, island, clouds and sail, and fade
with the existing night share. The crescent moon is unchanged. Many faint stars and
fewer bright stars replace the two dense patches; those patches now contain only
three sparse generated twinkles each. The field has no tiled grid.

The PNG audit counts 420–452 visible star pixels in each of six equal sky sectors.
The tiny twinkle frames are nonempty and distinct. Wide, tall-narrow and ultrawide
night captures show the field across the visible sky.

## Why the umibozu was transparent

The sprite's body pixels were already fully opaque. The cause was compounded
manifest opacity: the element's weather curve topped out at **0.85**, while its
`umibozu-rises` crossfade independently faded the risen frames over a low dome.
At intensity **0.9**, the element strength multiplied by the rise-variant share
was **0.1527593**, leaving the risen body about **15.3% opaque**. Even at peak,
its maximum was 85%.

Overcast was not covering it: overcast has back order 0.5, the spirit back order
6.5. Rain remains in front, but consists of sparse streaks at at most 55% opacity;
it is not an overall translucent wash. Its pixels and settings are unchanged.

The correction removes the rise crossfade and sequences the opaque art directly:
fully risen, settled, low dome, clipped sinking poses, submerged, then the reverse
rise. The original dark silhouette, glowing eyes and base spray are preserved.
Two sinking crops and an empty frame complete the waterline transition without
fading the body. Its behind-ship slot and swell clock stay the same. Lite, still and
reduced motion hide the spirit completely.

A narrow reveal interval from 0.78 to 0.780001 replaces the long body fade. No
attainable steady crew intensity lies inside it: the engine's weighted targets are
multiples of 1/24. Every steady target therefore gives either zero or full opacity,
and storm targets have full strength. The existing clock remains continuous; this
is a repeating rise/settle/submerge cycle, not a new weather-triggered animation API.

The initial tall capture exposed a second bug: the coast backdrop enlarged to fill
the pane while the spirit's world anchor stayed fixed. The engine's cycle was
already world-anchored; its water/land reference was moving with viewport shape.
The correction puts the approved island in a stationary world phase strip and
uses a separate open-sky/sea fill plate to cover the pane. The spirit's world
waterline is now `[100, 178]`, in the open gap left of the island and behind the
ship. Its position is independent of viewport edges and the backdrop's cover scale.
The six phase sets retain the island's pixels through row 245, with a mirrored
far shore outside the normal view and a feathered water edge. A synchronized
weather matte retains storm shading without dimming the later spirit.
See [the anchor correction and before/after evidence](anchor/README.md).

`audit.mjs` evaluates the old multiplication with the engine's pure curve/blend
functions, checks all 25 steady intensity values, binary sprite alpha, hidden lite
and still states, world placement, and preservation of island pixels and unrelated data.

## Evidence

These are real compiled-client renders through the established fixture host and
pack RPC loader, with public canvas attributes and PNGs only. No Pixi observer,
engine patch, installed-plugin reload or device-test claim is involved.

| Viewport | Before | After |
| --- | --- | --- |
| Wide 1440 × 900 | [Midday](before/wide-day.png), [night](before/wide-night.png), [storm](before/wide-storm.png) | [Midday](after/wide-day.png), [night](after/wide-night.png), [storm](after/wide-storm.png), [spirit at peak](after/wide-storm-peak.png) |
| Tall-narrow 650 × 1900 | [Midday](before/tall-day.png), [night](before/tall-night.png), [storm](before/tall-storm.png) | [Midday](after/tall-day.png), [night](after/tall-night.png), [storm](after/tall-storm.png), [spirit at peak](after/tall-storm-peak.png) |
| Ultrawide 2400 × 800 | [Midday](before/ultrawide-day.png), [night](before/ultrawide-night.png), [storm](before/ultrawide-storm.png) | [Midday](after/ultrawide-day.png), [night](after/ultrawide-night.png), [storm](after/ultrawide-storm.png) |

Also captured: dawn and dusk at all three sizes, [overlay](after/wide-overlay.png),
[water motion](after/water-motion.gif), and the spirit's complete cycle
([wide](after/wide-spirit.gif), [tall](after/tall-spirit.gif)). Spirit sampling counts
the original opaque dark sprite colours surviving the front rain in actual canvas
PNGs; the peak image is the sample with the largest visible body. Water movement
is checked in an isolated sea crop, not just by changing crew pixels.

`crew.json` records 192 exact target clicks: all 24 workers in each of four states,
by day and night. `lite.json` records the established SwiftShader and keyboard
focus check. `audit.json` records the image budget: **904,476 / 1,000,000 bytes**.

`ship-gate.json` records all **81 frozen Ship shots pixel-identical to main**, with
no browser errors, flakes, masks or intentional-difference allowances used.
`compile-results.json` records both bundles parsing in Hermes and zero bundle
growth against current main. This PR changes pack data/art and offline authoring
files, so its runtime source is identical to main.
The render harness loads the final pack from this worktree through the pack RPC.
The final pack also passed the 69 pack/schema checks and TypeScript checking.

The initial local suite had two known timing failures, both passing in isolated
reruns. The anchor correction is based on current main, which already contains
the independent test timing fixes and viewport-weather fix. `validation.json`
records final commands and outcomes; Linux and Windows CI run the complete suite.

## Reproduce

```powershell
npm.cmd ci
npm.cmd --prefix docs/board-list ci
npm.cmd --prefix .generated/motion-tools install --no-save --package-lock=false gifenc@1.0.3
node docs/settings/japanese-ship/water/build.mjs
node docs/settings/japanese-ship/water/audit.mjs
npm.cmd run lint:deck-packs
node docs/ship-deck-canvas/compile.mjs
$env:ASPECT_REVIEW='before'
node docs/settings/japanese-ship/water/render.mjs
Remove-Item Env:ASPECT_REVIEW
node docs/settings/japanese-ship/water/render.mjs
$env:CHECK_JAPANESE_LITE='1'
node docs/deck-settings/render.mjs '?setting=japanese-ship'
Remove-Item Env:CHECK_JAPANESE_LITE
$env:SAKURA_LANTERNS='after'
node docs/deck-settings/render.mjs '?setting=japanese-ship'
Remove-Item Env:SAKURA_LANTERNS
node docs/deck-settings/gate.mjs
npm.cmd run typecheck
npm.cmd test -- --maxWorkers=1
```

Run the suite after the render/compile processes finish. The original fixture
checks write into their historical output folders; this review copies their JSON
results here and restores those historical files. `render.mjs` reuses the common
scaffold with only the viewport, clock, capture and assertion sequence replaced.
Its before mode uses the main revision pinned by the compile harness; the authoring
script separately pins its original pack input to `b1458b4`.

## Art provenance

`sources/swell.png` and `sources/stars.png` are the unchanged built-in imagegen
outputs generated for this task. `prompts.json` records their prompts.
`registration.json` records source SHA-256 hashes. Registration uses the repository's
existing nearest-neighbour, palette and PNG pipeline; cyclic displacement, edge
overlaps, transparency and atlas crops are computed offline. No generated source,
script or evidence file ships inside the installed pack.
