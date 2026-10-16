# Whole-stage rocking: engine review

This adds generic `stage-rock@1` without opting any installed pack in. The authored
pivot, angle and optional sideways drift transform everything aboard together.
The [authoring contract](../deck-settings/authoring.md#whole-stage-rocking) explains
field bounds, clocks, reduced motion, fit requirements and the world/stage boundary.

## Verification

- Typecheck passes; full suite: **1,166 passed, three skipped**, across 98 files,
  using `npm.cmd test -- --maxWorkers=2`. The initial unconstrained run under
  concurrent rendering hit timing failures in two unrelated server tests; the
  complete bounded-worker rerun passed without changing those tests.
- Pack lint: **69/69**. No installed manifest or PNG is changed in the engine PR.
- Generic tests cover schema/reference errors, finite amplitude bounds, curve and
  channel values, clock selection, full/lite/still behavior, pivot invariance,
  inverse screen mapping and angular extrema between sweep endpoints.
- The established renderer fixture checks moving hover/clicks, focus, resize,
  stage/spotlight/veil agreement, level off-stage layers, hidden pause and the
  transition to reduced motion. It adds no Pixi observer or runtime timer.
- [Compiler/Hermes](compile-results.json): both complete plugin bundles parse;
  client growth is 1,991 bytes. Pixi remains served separately.
- [Ship gate](ship-gate.json): 81/81 pixel-identical against pinned main
  `b0152f3`, with no expected-change exceptions.
- [Unchanged pack captures](unchanged-packs.json): Sakura coast and Sky pirates
  have exactly matching before/after SHA-256 canvas captures at fixed noon in
  reduced motion, through the established compiled-client renderer.

The final engine source was compiled at `5eaf3f2`; later commits only record
review evidence. The gate was repeated after the final source changes. An
in-memory airship opt-in preflight caught propeller-vapour clipping at the right
edge; increasing its logical width by eight pixels and reserving vertical fit
clearance passed the full pack linter. That opt-in belongs to the subsequent PR.

`docs/settings/sky-airship/check-scene.mjs` is extended in this engine PR so the
subsequent data-only PR can use the existing review harness for calm/storm GIFs
and 24 moving targets. It reads visible hover/focus labels and screenshots,
never Pixi internals. The existing still 24-worker click check remains intact.

These are local synthetic browser/renderer fixtures, not an installed plugin or
physical-device test. No plugin was installed or reloaded.
