# Authoring a built-in setting

A setting is `art/settings/<id>/setting.json` plus only the PNGs it names. The id is lowercase letters,
digits and dashes and must match the folder. The server discovers built-in folders; there is no external
pack installer. Settings > Plugins > FirstMate > Deck setting selects one for the whole fleet. The saved
`deckSetting` defaults to `ship`; no project override exists yet.

## The contract

`shared/deck-setting.ts` is the executable format specification: `firstmate.deck-setting`, format 1.
`ENGINE_CAPABILITIES` is the closed catalogue, and `requires` must exactly match `capabilitiesUsed(manifest)`.
Every fixed object is strict; unknown fields are errors. Maps of image, pose, zone, channel and mark ids
remain open, with each value checked. The server rejects malformed packs and lists unsupported formats
or capabilities as incompatible, with a reason. The pane falls back to ship and preserves the saved choice.

| Capability group | Version 1 vocabulary |
| --- | --- |
| Layout and workers | `stage`, `floor`, `zones`, `zone-appearance`, `post-transit`, `stable-posts`, `cast`, `pose-fidgets` |
| Portals and effects | `rise`, `walk-in`, `sink`, `choreography` |
| Stage motion and light | `phase-tint`, `bob`, `stage-rock`, `sway`, `cycle`, `flicker` |
| Atmosphere layers | `backdrop-cycle`, `overlay`, `flash`, `drifters`, `flyby`, `tile`, `strip`, `phase-strip`, `variants` |
| Time and activity | `phase-frames`, `day-cycle`, `atmosphere` |

Each entry is spelled `<name>@1` in `requires`. The schema and `settingProblems` define all parameters
and reference rules. A manifest contains numbers, ids, sprites, lookup curves, fixed path shapes and finite
timeline segments/events/effect keys. It cannot contain expressions, scripts, conditions, loops, shader
hooks or callbacks. Compute derived values offline and keep the derivation and its checks under `docs/`
or `test/`, outside the pack. No engine branch may check a setting id to change rendering behavior.

The engine owns activity states, badges, interactions, intensity, motion modes and pause while hidden.
The pack supplies geometry, art, pose roles, presentation words and activity-to-visual channel tables.
Reduced motion holds clocks and stays calm: no static storm variants or curve-driven layers. Flash limits
remain engine-enforced (one emitter, at most two frames and 3500 ms, opacity at most 0.6, at least four
seconds dark, hidden in lite and still).

`zone-appearance@1` adds optional `appearance: { sprite, feet, front }` to a zone. A settled worker uses
that fixed sprite, anchored at its post and drawn ahead of the named stage piece, while preserving its
identity and engine-owned badge/interaction. Cast fidgets, mirroring and breathing are held; walking and
portals still use the cast. Geometry, depth, focus and hit testing follow the actual representation.
A failed optional image leaves a clickable badge/mark. Explicit `pack` overflow areas for such a zone
may include non-spill floor; ordinary overflow still cannot enter it. Keep every handle in sight and in
the fit, clear of active workers and other foreground pieces. The pack linter checks this at 24 workers.

## Build and check

1. Commission new art separately. Agree the stage dimensions, actor scale, feet anchors, floor polygons,
   props, depth pieces, cast pose roles and entry/departure paths before laying out the manifest. Existing
   `art/settings/ship/setting.json` is a complete reference, not a requirement to use ship names or channels.
2. Author the stage, zones and portals against those pixels. Every post, entry endpoint and exit queue must
   be on open, reachable floor; a walk-in's source may be off-floor. Packing zones need enough visible space.
   Set the fit box to contain every part and effect. Define cast lanes/looks/roles, `copy` for the pane and zone descriptions, and optional ambience,
   day phases and atmosphere channels. Name each PNG in `images` with dimensions and SHA-256. The total
   image budget is 2,000,000 bytes; lint warns above 1,600,000 bytes (80%) without failing.
   See [transport limits and measurement](../deck-pack-budget/README.md). No unused image, source file or script belongs in the pack.
   Give each prop an explicit sprite `rect`, including whole-image props: the current prop texture path
   requires it. A doorway that stays open between finite effects needs an open-frame depth piece in the
   stage; effects are temporary, not persistent door state.
3. Run `npm run lint:deck-packs`. It checks all installed packs: strict schema, references and capabilities,
   file inventory/hashes/dimensions/crops, palettes and animation variants, floor pixels and paths, crowd
   visibility/hit targets, fit bounds including effects through their compiled timelines and alternatives.
4. Compile with `node docs/ship-deck-canvas/compile.mjs`, then render the chosen pack:

   ```sh
   node docs/deck-settings/render.mjs '?setting=<id>'
   node docs/deck-settings/render.mjs '?setting=<id>&overlay=1'
   ```

   These write `render-<id>.png` and `overlay-<id>.png` beside the harness. The selected id comes through
   the same global field as the app. Rendering fails if the actual canvas id differs, preventing a fallback
   ship screenshot from being mistaken for the requested setting. The overlay shows floor/obstacles,
   zone posts with ids and facing, overflow areas, label floors, portal marks and fit bounds.
   `CHECK_SELECTION=1` also checks missing-pack fallback and restoring the saved choice through the live UI.
5. Run typecheck and the full suite, inspect full/lite/still motion and depth order, and run
   `node docs/deck-settings/gate.mjs`: the frozen Ship fixture must remain 81/81 pixel-identical to main, except explicitly
   documented visual additions. For an intentional addition, inspect its before/after/difference images,
   record both exact screenshot hashes and a reason in `expected-changes.json`, then independently rerun
   all 81 shots. A changed baseline, unexpected screenshot or canvas metadata still fails; never accept
   a scenario by name alone or update hashes without review. Record results,
   review the PR and wait for CI. The gate loads `test/fixtures/ship-baseline/` into both engines, verifies
   its source hashes, and never loads the remastered installed Ship. Keep pack-specific renders and clips
   separate; do not re-hash the engine gate against new pack art. The fixture's original manifest and PNGs
   are byte-frozen from `890348a`, outside installed discovery and package delivery.
   New capabilities need their own generic tests and reviewed engine PRs;
   the subsequent setting-pack PR contains data and art only, no TypeScript.

## The installed examples

The ship is installed under `art/settings/`, with only a manifest and its PNGs.
Office was withdrawn after visual review to `docs/settings/office/withdrawn-pack/` and is not shipped or selectable.
The office's [art contract, historical draft and review](../settings/office/README.md) specify its commissioned
assets and layout. `stable-posts@1` and `pose-fidgets@1` are supported as of step 9a. Stable assignment
hashes agent identity to a preferred post; collisions choose the nearest free post to that preference,
ties in manifest order. Existing holders keep their places. Pose fidgets may name a pose on each key;
a key without one uses the settled pose, and all use the settled mirror rule. Still/stale workers keep
their settled role. Every lane must define every named fidget pose.

`walk-in@1` is supported as of step 9b, `phase-tint@1` as of step 9c and `phase-frames@1` as of step 9d.
Keep choreography finite; do not add hooks to work around a missing behavior. The office's commissioned
art is recorded under `docs/settings/office/art/`; the complete withdrawn manifest and PNGs remain in
`docs/settings/office/withdrawn-pack/` for reference. Neither that pack nor the historical draft can be selected.

A third built-in setting follows the same process: commission its own registered sprites, author a format-1
manifest using this catalogue, compute hashes and derived geometry offline, and add its folder under
`art/settings/`. Discovery and the global picker require no registration code. Run pack lint, the debug overlay,
full/lite/still and interaction checks, typecheck/the full suite and the ship gate. Any genuinely new behaviour
must land as a separate generic, versioned engine PR before the data-only pack. Packs cannot define behaviours,
change intensity semantics or install external code; per-project selection remains a future resolver change.

## Walking entry

```json
{ "kind": "walk-in", "from": [404, 112], "at": [392, 112] }
```

The actor walks the straight corridor from `from` to `at`, fully visible, using the floor's `walkSpeed`
and the cast's directional cycles. The engine derives its duration from distance, rounded to milliseconds;
zero-length walks are invalid. Only `at` enters floor navigation. The corridor may cross off-floor space
but must avoid all obstacle footprints and fit every walking frame; the linter checks it and the overlay
draws its source and line. Floor row depth follows the actor's feet throughout.

An optional `effects` array uses the same finite effect tracks as `choreography@1`: explicit positive depth
orders, frames, durations, anchors and named-point alignment. Available marks are **`from` / `at`**;
events are **`start` / `entered`** (zero and the corridor duration). There is no alternation: side is `-1`
and drift is `0`, so side mirroring is off and any approach comes from the left. Keys in a track cannot
overlap. The actor waits at `at` until the last effect ends, then follows the floor path to its reserved post.
Concurrent arrivals own independent effect tracks; a door shared by several workers should use the static
open art or tracks designed to overlap. There is no persistent door state or entry queue.

A card removed during entry reverses the same clock and corridor, including any effect tail; a returning
card reverses again continuously. First mount and reduced motion place actors directly at their posts
without portal effects. Turning reduced motion on discards entry effects and snaps present actors to posts;
an actor removed at that moment fades at its current position. Lite uses the same walk on its existing
lower frame budget, and hidden scenes retain their paused simulation clock.

## Whole-stage rocking

`stage-rock@1` adds optional `stage.motion.rock`, alongside or without `bob`:

```json
{ "pivot": [240, 220], "degrees": { "curve": [[0, 0.4], [1, 1.2]] },
  "drift": { "curve": [[0, 0.3], [1, 1]] }, "periodS": 8, "clock": "swell" }
```

`pivot` is an integer point inside the stage's fit. `degrees` is the maximum angle each way;
optional `drift` is pixels each way. Both accept a fixed number, an atmosphere channel (with optional
scale), or an intensity curve. Every possible value, including delivered channel values, must stay
within 0–5 degrees and 0–16 pixels. All fields are strict and finite; the period is positive.
The optional clock names an existing atmosphere clock; omission uses the simulation clock.
Rotation and drift follow the same sine, starting level. Bob remains an independent vertical offset.
Rotation and sideways drift are continuous rather than rounded, avoiding visible angular steps.

The ship and everything aboard share one rigid transform: the stage backdrop (hull), parts, props,
depth pieces, lights, crew bodies, badges, ground marks, reply markers, spotlight and focus veil.
The camera follows the transformed worker; pointer coordinates use the exact inverse transform.
Text labels and reply bubbles remain upright UI, with their anchor following the transformed worker.
The world stays level: sky/backdrop-cycle, far clouds, sea/cloud tiles and every other ambience layer,
the independent attention carrier, and the separate portal-effects slot (including actors once their
departure explicitly enters that slot). Those describe the surrounding world, not objects aboard.
Portal effects retain their authored world coordinates; moving an effect with the ship would need a
separate capability. Ordinary floor/piece-layer departures continue to rock until that transition.

Full and lite run this motion like bob, on the existing 30/12 fps simulation and atmosphere clocks.
Busyness changes the supplied amplitude/pace channels without resetting phase. Still/reduced motion
holds the stage level with zero drift and bob, including when enabled mid-motion. Hidden panes pause
the same clock. There are no added timers or pack-specific engine branches.

For opted-in packs, the camera always honors the authored vertical `stage.fit`, even without a tall
part. Fit horizontally remains 0 through `stage.size[0]`. Leave room for the full sweep: pack lint checks
all nontransparent furniture pixels (including alternatives), lights and glows, crew routes/poses and
24-worker crowds with reply markers. It bounds all intermediate rotation extrema plus maximum drift
and rounded bob, conservatively allowing their peaks together. World effects keep their existing checks.
Packs without `rock` keep their existing fit, motion and pixels.

## Phase tint

`stage.tintByPhase` maps day-phase ids to `#RRGGBB` multipliers, for example
`{ "dusk": "#D8C0B0", "night": "#8C94B0" }`. It requires `phase-tint@1` and a `dayCycle` defining every
named phase. Omitted phases use white (the original art); an empty map, unknown phase or non-RGB colour is invalid.
The engine blends each RGB channel with the same eased day blend as the backdrop, rounded to whole bytes.
It reads the local wall clock, including the midnight wrap; an invalid/throwing clock uses `dayCycle.fallback`.

The tint multiplies the stage backdrop, parts, props, depth pieces, lights and actor bodies in the floor/piece
layers. A focused body keeps its tint in the spotlight; stale tint multiplies with phase tint. Badges, state marks,
reply indicators and the focus veil retain their engine colours. Ambience and the separate effects slot keep their
own colours, including actors that move into that slot. No parent shared with interaction graphics is tinted.

Phase tint is independent of intensity and motion. Full/lite frames read the same wall clock; reduced motion
refreshes it on the existing minute timer, with no animation loop, bob, weather variants or flash. Hidden scenes
do not redraw. No extra timer, expression, shader hook or setting-specific branch is needed.

## Phase frames

An ambience element with `kind: "phase-frames"` declares a nonempty `frames` array of sprites, `at` and
`anchor` points, and `by: "local-hour"` or `"local-minute"`. It requires `phase-frames@1`; no `dayCycle` or
atmosphere clock is needed. The selector is closed: no seconds, expressions, variants, opacity or clock hooks.

The engine takes the local hour (0–23) or minute of the hour (0–59), then wraps it modulo the number of frames.
A twelve-frame dial uses frame zero at midnight/noon; a 24-frame list spans a day. Seconds never interpolate
frames. An invalid or throwing clock selects frame zero. Each frame has the same size, drawn at `at - anchor`
in its element's slot and order. The pack linter checks image crops, matching sizes and fit bounds.

Full motion follows the wall clock. Lite honors `run`, `freeze` (frame zero) or `hide`; reduced motion honors
`first-frame` or `hide`. Switching back to running selects the current wall-clock frame, without replaying
elapsed time. Hidden scenes do not redraw. The renderer shares its existing local-time sample with the backdrop
and phase tint; this behaviour adds no timer and reads neither simulation clocks nor intensity. All frames must
load or the element falls back under the usual ambience rules. Ambience keeps its own colours, outside stage tint.

## Phase strips

`phase-strip@1` adds a day-aware strip, without changing `strip@1` or opting any existing pack in:

```json
{ "kind": "phase-strip", "top": 40, "span": [-2048, 2560],
  "frames": { "sprites": [{ "image": "coast-day" }], "frameMs": 1000 },
  "drift": { "pxPerSecond": 1.7, "clock": "voyage" },
  "byPhase": {
    "day": [{ "image": "coast-day" }],
    "night": [{ "image": "coast-night" }]
  } }
```

The element keeps the usual `slot`, `order`, `lite`, `still`, `needs` and `fallback` fields. `frames`
is the required base and supplies the only frame count, `frameMs` and optional frame clock. Every
`byPhase` key must exist in `dayCycle`; every set has the base's frame count and every sprite has the
base's size. Crops must stay inside their declared images. The span must increase. All images use
the existing PNG inventory, SHA-256 and 2,000,000-byte pack budget. Fields are strict; intensity
variants are not part of this capability.

Placement, positive whole-pixel drift, horizontal wrap and fixed world span are exactly those of a
strip. All phase sets use **one frame index and one horizontal offset**, including when the frame
clock differs from the drift clock. The existing `dayBlend` supplies eased weights from the same
local-time sample as backdrops and phase tint. Phase colours and alpha are summed in a transparent
intermediate and composited once: opaque land stays opaque, and a transparent daytime beam can
fade both in and out. This uses Pixi's built-in alpha filter, clipped to the viewport; packs cannot
supply filters or shader code. Each phase strip adds one filtered layer, so prefer a few compact
layers and profile long repeat widths and resizes before shipping art.

An omitted phase uses the available defined set with the nearest anchor minute in the circular
24-hour day. Ties use the first candidate in `dayCycle.phases` order. If no phase sets remain,
every phase uses the base (`byPhase: {}` is valid). A set with any failed image is dropped whole,
recorded as missing, then resolved by the same rule; a failed base invokes the element's ordinary
fallback or omission. Identical resolved sets draw once at full weight. Define every phase explicitly
when a particular dusk/dawn treatment matters. Invalid wall time uses `dayCycle.fallback`.

For a small synchronized light/beam cycle, use a **second phase strip**, with the same repeat width,
`span`, drift speed and drift clock, and a shallow transparent plate whose light sits at the same
source x coordinate. Its `top` may differ. Give it its own frame cycle (e.g. three 16-pixel-high beam
frames) and explicit transparent sets for unlit phases. Those sets must match the beam base's count
and size, not the coast's. This keeps the large coast at one frame while both strips drift together;
there are no element-id links, route controllers or new clocks beyond the existing atmosphere table.

Full and lite `run` advance normally. Lite `freeze` and still `first-frame` reset the frame and
horizontal offset to zero while retaining the current day blend; `hide` draws nothing. Reduced
motion reads day changes on the existing minute refresh, and hidden panes use the existing pause.
No timer, pack-id branch, persistent voyage state or new behaviour language is added.

The small [test fixture](../../test/fixtures/phase-strip/scene.json) and
[render evidence](../deck-phase-strip/README.md) live outside `art/` and are not shipped.

## Access to a raised station

`post-transit@1` adds optional `transit` to a zone post:

```json
{ "path": [[211,98],[211,-35],[218,-35]], "speed": 24,
  "poses": ["climb-a","climb-b"], "stepMs": 260, "settled": "lookout",
  "front": "mast", "needs": ["mast-tall-mast","polish-ladder"] }
```

The post's `at` remains on reachable floor. The path continues from there through one or more points;
speed is world pixels per second. Only the primary post holder uses it; overflow remains on the floor.
Moving poses cycle on scalar route progress, then the endpoint uses `settled`. Every cast lane must
provide those poses. The actor draws immediately ahead of `front`, with the same depth for hit testing.
Place any occluding rim in a later piece. There is no ground mark while off-floor; badges remain visible.

State changes immediately, while the body descends before taking its new floor path. Reassignment back
to the station reverses its progress without teleporting. Elapsed time carries across floor/access
boundaries, including lite frames. First mount and reduced motion snap to the endpoint; reduced-motion
removal fades at its actual position. Hidden scenes use the existing paused clock. No new timer or hook.

Optional `needs` names image ids; a missing dependency leaves this post as an ordinary floor station.
The schema rejects unknown images/poses/pieces, nonpositive speed/frame time, zero-length segments,
routes outside the fit (every pose plus badge clearance), and combining transit with zone appearance.
Author the route and foreground pieces together so the worker stays visible and clickable throughout.

## Attention carrier

Optional top-level `attentionCarrier` requires **`attention-carrier@1`**. It describes one independently
placed suggestion target: `at` (top left), `size`, nonempty sprite `frames`, positive `frameMs`, and
`loiter: { amplitude: [dx,dy], periodMs }`. Amplitudes are nonnegative integer pixels. Every frame must
match `size`, fit its source image, and the entire target plus loiter must fit the stage's horizontal
bounds and `stage.fit` vertically. The strict schema validates these rules and all image references.

The carrier opens every first-mate suggestion in file order. Its legend button provides the keyboard
route to the same list. Picking one uses the board's suggestion handler, including its send gate and
failure handling. Crew markers, linked reply bubbles and click-to-focus remain independent. Packs cannot
choose a callback, action, attention condition or text expression.

Optional `bubbleHeight` gives the number of top rows containing only the speech marker. It must be
nonnegative and smaller than the sprite height. When there are no suggestions those rows are cropped
away, preserving the body's position; the carrier stays clickable and opens an empty-state bubble.
If omitted, the complete sprite stays visible. No image is rewritten.

Optional `surface` requires **`carrier-surface@1`**. It splits each frame at `row`, below `bubbleHeight`
and at least three rows above the bottom. The target must be at least 32 pixels wide. Lower rows use
`submergedTint` and `submergedAlpha` (0..1); upper rows and the speech marker remain clear. `ripple`
specifies two pixel-arc inks (`colour`, `shade`), a positive `periodMs`, and an existing atmosphere `clock`.
The arcs cross the waterline and travel with the target. The surface, swim frames and loiter all use that
clock, so they follow the water's pace together. Ripple ink follows the stage's day tint. Lite and still
hold the surface and target at their first pose. Packs without `surface` retain their existing drawing.

The carrier draws above the foreground, outside stage bob/tint. It hides during ordinary worker focus.
On full motion its frames cycle and its position follows whole-pixel sines (`x = dx·sin(phase)`,
`y = dy·sin(2·phase)`) on the existing simulation clock. Lite and reduced motion hold frame zero at `at`;
hidden scenes pause. A missing frame uses the first loaded frame; if none load, the engine draws its own
reply bubble at the same target. The keyboard action remains available. No extra timer or pack scripting.
