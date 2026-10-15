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
| Portals and effects | `rise`, `sink`, `choreography` |
| Stage motion and light | `bob`, `sway`, `cycle`, `flicker` |
| Atmosphere layers | `backdrop-cycle`, `overlay`, `flash`, `drifters`, `flyby`, `tile`, `strip`, `variants` |
| Time and activity | `day-cycle`, `atmosphere` |

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
2. Author the stage, zones and portals against those pixels. Every post and portal must be on open,
   reachable floor; packing zones need enough visible space. Set the fit box to contain every part and
   effect. Define cast lanes/looks/roles, `copy` for the pane and zone descriptions, and optional ambience,
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

Walking entry, phase tint and phase frames still require separate engine PRs. Keep choreography finite;
do not add hooks to work around a missing behavior. The actual office art and installable pack remain
pending. The draft contains no placeholder pixels and cannot be selected as an installed pack.
