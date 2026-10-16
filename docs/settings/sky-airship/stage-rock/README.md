# Sky pirates: whole-stage rocking review

This data-only opt-in is stacked on engine PR https://github.com/LiterallyBlah/firstmate/pull/89,
branched from `fm/deck-stage-sway`. Ship's deck and Sakura coast are not opted in.

The airship rocks about [240,220], from 0.4 degrees each way when calm to 1.2 at peak.
Sideways drift grows from 0.3 to 1 logical pixel. Both use an eight-second sine on
`swell`, about ten real seconds at calm pace and 6.15 at peak. Existing vertical
bob remains independent. Extra fit clearance contains the full swept extents,
including the rightmost propeller vapour. No PNG, floor, post or portal changes.

## Clips and visual review

- [Calm GIF](rock-calm.gif): 50 frames, ten seconds.
- [Storm GIF](rock-storm.gif): 80 frames, eight seconds, with the busy crew aboard.
- [Calm contact sheet](rock-calm-contact.png) and [storm contact sheet](rock-storm-contact.png):
  eight evenly spaced frames from each clip, reviewed for the whole craft's sweep.
- [Standard render](render.png), [authoring overlay](overlay.png), [24 sleeping workers](sleepers-24.png),
  [24 working workers](workers-24.png), [storm](storm.png) and [lite mode](lite.png).

The hull, balloon, rig, lamps and workers remain registered during the roll.
The sky, distant islands and cloud-bank horizons stay level. The calm motion is
small; the storm has a visibly broader sweep without changing the ship's layout.
The viewport contains the masthead, prow, propeller and vapour throughout.

## Checks

- Typecheck passes; full suite **1,166 passed, three skipped**, across 98 files
  (`npm.cmd test -- --maxWorkers=2`). Pack lint: **69/69**, including rocked bounds.
- [Full browser review](full.json) and [lite review](lite.json): no page errors.
  Reduced motion is pixel-stable; returning from full motion holds the ship level.
  Arrival, raised lookout, departure, day phases, storm and return to calm pass.
- [24 still clicks](crowd-still.json) and [24 moving clicks](crowd-moving.json):
  every resolved sleeping worker opens its exact focus panel. Moving clicks use
  visible hover labels around each resolved post, then assert the clicked focus
  identity, over successive phases of the calm roll. No Pixi internals are read.
- [Compiler/Hermes](compile-results.json): both full bundles parse. The opt-in
  adds zero bytes to either bundle relative to the engine PR.
- [Ship gate](ship-gate.json): **81/81 pixel-identical** to pinned main `b0152f3`.

The manifest was compiled at `7aa3429`; later commits record evidence and fix
review-document typography. End-to-end self-review checked the manifest diff,
version/capability declaration, fit clearance, motion audit, clips and evidence.
The only runtime file changed relative to the engine branch is
`art/settings/sky-airship/setting.json`.

Reproduce with the established compiler, deck-settings render/overlay, Sky pirates
`review.mjs` (also `AIRSHIP_LITE=1`) and deck-settings gate. The review harness uses
`gifenc` in the ignored `.generated/motion-tools` directory. Contact sheets decode
those GIFs with `gifuct-js`; neither tool is shipped. The pack-building source
predates this opt-in: retain the manifest's rock, capability, version and fit fields
when regenerating art. This PR deliberately contains no engine or generator code.

These are local synthetic browser fixtures, not an installed plugin or physical
device test. Nothing was merged, installed or reloaded.
