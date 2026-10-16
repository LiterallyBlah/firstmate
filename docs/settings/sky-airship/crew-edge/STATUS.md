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
