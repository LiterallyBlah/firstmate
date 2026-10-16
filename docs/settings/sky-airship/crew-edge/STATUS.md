# Blocked verification

Implementation commit: f70c51e. Only Sky pirates pack data changes at runtime.

The inset bow and crowded bow screenshots show the intended margin. Pack lint
passes 69/69, typecheck passes, and both bundles parse with Hermes (zero growth).

The new browser crowd check repeatedly fails for the wide 24-blocked fixture:
hovering Crew 14 and clicking the same point opens **Crew 15: details and actions**.
The final reproduction explicitly moves off the canvas, waits 100 ms, requires
the old hover label to disappear, moves to the candidate, waits another 100 ms,
checks its label, then clicks and checks the exact focus identity. It still fails.
See `crowd-log.txt`, `check.mjs`, and `after/wide-blocked-24.png`.

Stopped under the task's repeated-obstacle rule. No ready-for-review PR was opened.

Verification is incomplete:
- `before/` has all ten wide/tall state captures from the initial harness.
- `after/` has only the three-worker and 24-worker blocked wide captures/overlays.
- Full suite: 1179 passed, 3 skipped, one unrelated wall-clock PR-watch budget
  assertion failed under heavy machine load (`full-suite.txt`).
- The 81-shot frozen-Ship gate was stopped for memory pressure after its first
  11 shots passed (`gate-log.txt`); it did not complete.
- The existing motion review was stopped for memory pressure; its initial
  24-sleeper click pass completed, but lookout/departure/rocking remain unverified.
- No plugin was installed or reloaded. No Ship or Sakura pack was edited.

## Resumed spacing audit

`node docs/settings/sky-airship/crew-edge/audit-spacing.mjs` records all 24
resolved positions and hit rectangles in every state (`overlaps-before.json`).
Blocked has 55 overlapping pairs. The original reported pair is:

- Crew 14: feet (160,234), hit rectangle (146,195)–(174,234).
- Crew 15: feet (174,234), hit rectangle (160,195)–(188,234).

Two pure-engine pack-data trials are recorded in `spacing-trials.json`; neither
is applied to the runtime manifest because neither passes:

1. Bow posts at (112,226), (144,232), (176,224), overflow spacing 28×39.
2. Posts spread across the full interior at (112,226), (304,234), (416,205),
   overflow spacing 28×39. Ordinary overflow can use all spill-enabled floor.

Each trial yields only 11 distinct positions and 35 overlapping pairs. In both,
Crew 0 and Crew 2 resolve to (112,226), with identical hit rectangles
**(98,187)–(126,226)**. The allocator returns an occupied anchor when it cannot
find another open position. Stopped after the two further spacing failures, as
instructed; no further browser/gate/suite run or PR was attempted.

This is a capacity constraint. Standing hit boxes are 28×39, including the badge.
All permitted standing floor lies between y=203 and y=235: even the stern and
main-deck rows overlap vertically. Their centres span x=100..428, only 328 pixels.
24 non-overlapping boxes need at least 23×28=644 pixels between first and last
centres. Even ignoring obstacles and allowing polygon endpoints gives an upper
bound of 12, while the actual allocator finds 11. The original wider floor also
cannot fit 24 such boxes without overlap. Sleepers fit because their dedicated
window appearance has 14×25 hit rectangles, not the standing crew's 28×39.

A successful continuation needs a scope choice: smaller crew/hit areas, a larger
visible deck surface, or retaining overlapping rectangles while proving every
worker has a reliable distinct click target. The last option relaxes the latest
explicit requirement that no two hit rectangles overlap. No sprites, engine,
Ship or Sakura data were changed in this audit.
