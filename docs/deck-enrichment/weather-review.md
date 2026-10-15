# Weather atmosphere — review

Ship pack 1.1.0 adds a serpent at the bow and tentacles at the stern. Each begins as a dark silhouette
and gains colour with rising intensity. A newly generated distant lightning fork is more legible at
0.54 peak opacity. Its existing schedule, cloud placement, 80/120 ms timing and engine caps are retained.
Reduced motion remains fully calm. Lite freezes the creatures and never flashes.

These are the only intentional scene changes. Stage geometry, navigation, crew, camera, sky, existing
water/foam/wake and office assets are unchanged. Runtime TypeScript and the closed versioned catalogue
are unchanged: the pack uses `cycle@1`, `variants@1`, and `flash@1`. Sources, exact prompts, mechanical
registration and palette records are in [the art folder](../ship-deck-art/enrichment/README.md).

Validation on the weather implementation:

- Full suite: 81 files, 1,040 tests passed, three skipped (`npm test -- --maxWorkers=2`). The two-worker
  setting avoids Windows process/timer contention; no timeouts or product tests were relaxed.
- Typecheck and all 51 pack-lint checks pass. Additional art tests check the approved palette, binary
  alpha, clear borders, registered silhouette/colour pairs and unchanged fit bounds.
- Renderer tests cover separate intensity ramps, clearing as work quiets, lite freezing, reduced-motion
  hiding even with a busy input, and missing-frame isolation.
- Paseo compilation: client and server bundles byte-identical to main `9693516`; Hermes parses the client,
  with no class syntax. The pack contributes no bundled art or JavaScript.
- End-to-end visual gate: in progress. All eight reduced-motion shots are pixel-identical so far.

The visual gate accepts intended additions only by an exact pair of main/branch screenshot hashes with
a written reason in `docs/deck-settings/expected-changes.json`. It uses no masked areas, tolerance,
scenario exclusions or automatic baseline acceptance. Canvas metadata must also match. The first run
records differences for visual review; the second independently renders and checks the reviewed hashes.

The harness pins React DOM to the app's React version (19.1.0), preventing a fresh dependency install
from selecting incompatible 19.3.1. Page errors now fail promptly. These changes are unshipped tooling.

Review of the complete source/data diff found no setting-specific runtime code, added catalogue hooks,
changed intensity semantics, external assets, package source-image leakage or increased flash frequency.
Four-frame creature silhouettes have the pose variation of the generated source; no continuous deformation
is claimed. Final screenshot evidence and CI status will be recorded before the PR is marked ready.
