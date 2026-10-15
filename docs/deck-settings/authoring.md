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
| Layout and workers | `stage`, `floor`, `zones`, `stable-posts`, `cast`, `pose-fidgets` |
| Portals and effects | `rise`, `walk-in`, `sink`, `choreography` |
| Stage motion and light | `phase-tint`, `bob`, `sway`, `cycle`, `flicker` |
| Atmosphere layers | `backdrop-cycle`, `overlay`, `flash`, `drifters`, `flyby`, `tile`, `strip`, `variants` |
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

## Build and check

1. Commission new art separately. Agree the stage dimensions, actor scale, feet anchors, floor polygons,
   props, depth pieces, cast pose roles and entry/departure paths before laying out the manifest. Existing
   `art/settings/ship/setting.json` is a complete reference, not a requirement to use ship names or channels.
2. Author the stage, zones and portals against those pixels. Every post, entry endpoint and exit queue must
   be on open, reachable floor; a walk-in's source may be off-floor. Packing zones need enough visible space.
   Set the fit box to contain every part and effect. Define cast lanes/looks/roles, `copy` for the pane and zone descriptions, and optional ambience,
   day phases and atmosphere channels. Name each PNG in `images` with dimensions and SHA-256. The total
   image budget is 1,000,000 bytes; no unused image, source file or script belongs in the pack.
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
   `node docs/deck-settings/gate.mjs`: the ship must remain 81/81 pixel-identical to main. Record results,
   review the PR and wait for CI. New capabilities need their own generic tests and reviewed engine PRs;
   the subsequent setting-pack PR contains data and art only, no TypeScript.

## The second setting

The office's [art contract and uninstalled draft](../settings/office/README.md) specify the commissioned
assets and layout. `stable-posts@1` and `pose-fidgets@1` are supported as of step 9a. Stable assignment
hashes agent identity to a preferred post; collisions choose the nearest free post to that preference,
ties in manifest order. Existing holders keep their places. Pose fidgets may name a pose on each key;
a key without one uses the settled pose, and all use the settled mirror rule. Still/stale workers keep
their settled role. Every lane must define every named fidget pose.

`walk-in@1` is supported as of step 9b, `phase-tint@1` as of step 9c and `phase-frames@1` as of step 9d.
Keep choreography finite; do not add hooks to work around a missing behavior. The office's commissioned
art is delivered under `docs/settings/office/art/`; final pack wiring remains pending. The draft cannot be selected
as an installed pack.

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
