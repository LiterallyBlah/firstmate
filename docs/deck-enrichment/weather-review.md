# Weather atmosphere — review

Ship pack 1.1.0 adds a serpent at the bow and tentacles at the stern. Each begins as a dark silhouette
and gains colour with rising intensity. A newly generated distant lightning fork is more legible at
0.54 peak opacity. Its existing schedule, cloud placement, 80/120 ms timing and engine caps are retained.
Reduced motion remains fully calm. Lite freezes the creatures and never flashes.

[Storm view](weather-storm.png) · [Changed pixels in red](weather-storm-diff.png)

These are the only intentional scene changes. Stage geometry, navigation, crew, camera, sky, existing
water/foam/wake and office assets are unchanged. Runtime TypeScript and the closed versioned catalogue
are unchanged: the pack uses `cycle@1`, `variants@1`, and `flash@1`. Sources, exact prompts, mechanical
registration and palette records are in [the art folder](../ship-deck-art/enrichment/README.md).

Validation on the weather implementation:

- Full suite after rebasing onto the merged scene switcher and Converse: 87 files, 1,066 tests passed,
  three skipped (`npm test -- --maxWorkers=2`). The two-worker
  setting avoids Windows process/timer contention; no timeouts or product tests were relaxed.
- Typecheck and all 51 pack-lint checks pass. Additional art tests check the approved palette, binary
  alpha, clear borders, registered silhouette/colour pairs and unchanged fit bounds.
- Renderer tests cover separate intensity ramps, clearing as work quiets, lite freezing, reduced-motion
  hiding even with a busy input, and missing-frame isolation.
- Package dry-run: all 18 registered PNG frames included, no `docs/` sources included.
- Paseo compilation against main `0ff23d7`: client 649,762 bytes (byte-identical), server 343,520 bytes
  (unchanged size and source). Hermes parses the client, with no class syntax. The pack contributes no
  bundled art or JavaScript.
- First complete visual capture: 81 shots, no page errors, all canvas metadata unchanged. Ten shots are
  pixel-identical, including all eight reduced-motion views and the two focused close-ups. The other 71
  contain creatures at the sea edges; four storm shots also contain the replacement lightning fork.
  A second independent full render passed all 81 shots, reproducing every reviewed hash with no flakes.

The visual gate accepts intended additions only by an exact pair of main/branch screenshot hashes with
a written reason in `docs/deck-settings/expected-changes.json`. It uses no masked areas, tolerance,
scenario exclusions or automatic baseline acceptance. Canvas metadata must also match. The first run
records differences for visual review; the second independently renders and checks the reviewed hashes.
The compiler pins main's commit before building; the gate uses that same commit for its server and art,
even if another worktree fetches while it runs. This evidence uses the complete, unmasked toolbar after
the scene-switcher merge. Run with `SAVE=1 RERENDER=0` after compilation to reproduce the accepted pairs.

The harness pins React DOM to the app's React version (19.1.0), preventing a fresh dependency install
from selecting incompatible 19.3.1. Page errors now fail promptly. These changes are unshipped tooling.

Review of the complete source/data diff found no setting-specific runtime code, added catalogue hooks,
changed intensity semantics, external assets, package source-image leakage or increased flash frequency.
Four-frame creature silhouettes have the pose variation of the generated source; no continuous deformation
is claimed. The [registered sprite sheet](../ship-deck-art/enrichment/contact.png) shows every generated pose.
Self-review is complete. [PR #64](https://github.com/LiterallyBlah/firstmate/pull/64) carries the final
Windows and Ubuntu CI checks; it is marked ready only after they pass on the final pushed commit.
