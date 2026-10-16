# Validation status

Implementation: `007c9f0` (crew/rain/whale) and `7eee74c` (travelling storm serpent); later commits record evidence.

- 24 distinct positions and exact centre winners in all four states.
- 192 browser centre clicks pass across wide and tall panes, plus the two
  three-person bow checks. No browser errors.
- All painted crew pixels and their foot-relative positions are preserved.
- Rain's four frame transitions, including wrap, advance exactly eight rows down.
- Four carrier frames are exact horizontal reflections with unchanged alpha rows.
- Low (0.67) and high (1.0) rain clips pass in wide and tall panes.
- Pack lint: 69/69 with a 20-second timeout. The default five-second run timed
  out only in the unchanged Ship pathfinding test.
- Typecheck passes. Both plugin bundles parse with Hermes; runtime engine sources are unchanged.
- Requested local `npm.cmd test -- --maxWorkers=1`: 1,180 passed, three skipped.
- Ubuntu and Windows CI both pass on the implementation commit:
  https://github.com/LiterallyBlah/firstmate/actions/runs/38967660354

The full scene regression passes, including lookout arrival, whale departure, calm/storm rocking and moving 24-crew clicks. The frozen-Ship gate passes all 81 shots pixel-identically. The serpent policy audit confirms storm gating, rightward travel and hidden lite/still behavior; wide/tall crossing clips are in `../art-motion/serpent/`.

The earlier disjoint-box investigation is retained in `overlaps-before.json`
and `spacing-trials.json` for provenance. It is superseded by the clarified
acceptance criterion: partial overlaps are allowed, but each existing centre
must select its own sailor. Current evidence is `after/results.json` and
`verified-geometry-art.json`. No runtime engine, Ship or Sakura files change.
No plugin was installed or reloaded. The worktree is retained for the follow-up.
