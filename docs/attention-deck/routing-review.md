# Ghost ship routing investigation

The shifted posts made routing modestly more expensive and pushed an already marginal Windows
all-pairs test over its five-second limit. This is not classified as an unrelated Ghost ship flake.
The fix reduces actual polygon-check cost and makes the exhaustive linter enforce deterministic
work limits. Neither routes, floor geometry, post positions nor art change in this fix.

## Evidence before the fix

Compared `origin/main` at `2519564` with the original PR at `9698749` on 2026-10-19.
The first mate is a reserved destination, **not a floor obstacle**. Areas, obstacles, grid and
the routing algorithm were identical. Both versions have 36 places and 1,260 ordered routes:
one crew wheel post was replaced by the officer post. The bow moved farther forward.

| Ghost ship all-pairs work | Main | Original PR | Change |
| --- | ---: | ---: | ---: |
| A* expanded cells | 1,433,796 | 1,497,929 | +4.5% |
| Half-pixel visibility samples | 11,451,837 | 12,743,946 | +11.3% |
| Total path length, logical pixels | 289,620.1 | 298,190.4 | +3.0% |
| Longest path, logical pixels | 630.4 | 659.8 | +4.7% |
| Unreachable/fallback routes | 0 | 0 | none |

Every route ends at its destination, remains on floor at half-pixel spacing, and has no removable
corner. There is no new blocked corridor or exhausted search. The maximum search on the PR is
5,506 cells; the maximum visibility work for one route is 63,367 samples.

CI logs (whole test, including validation and concurrent-suite contention):

| Run | Event / revision | Ubuntu | Windows |
| --- | --- | ---: | ---: |
| [39266316603](https://github.com/LiterallyBlah/firstmate/actions/runs/39266316603) | main push / `2519564` | 1,859 ms | 4,889 ms, pass |
| [39269836918](https://github.com/LiterallyBlah/firstmate/actions/runs/39269836918) | PR / `9698749` | 3,882 ms | 4,999 ms, pass |
| [39269822828](https://github.com/LiterallyBlah/firstmate/actions/runs/39269822828) | branch push / `9698749` | pass | 5,210 ms, timeout |

Inspected the latest 100 main workflow runs and the failed logs for all six failed main runs
(`38951570774`, `38933552430`, `38904398792`, `38877674856`, `38814709016`, `38765336654`).
None failed this Ghost route test; the failures were other tests. All 100 were first attempts.
The current main result is nevertheless only 111 ms below the timeout. The earlier ship linter
timeout documented in `docs/deck-enrichment/below-deck-review.md` is not evidence of a Ghost flake.

## Fix and repeatable measurement

`createFloor` precomputes each area's bounds. `walkable` and `areaAt` reject points outside those
bounds before doing polygon ray casting. Bounds are inclusive so the original polygon test still
decides every boundary. A*, string pulling, half-pixel spacing and every returned coordinate are
unchanged. Separate fixtures check concave/sloped boundaries, area precedence and blocked feet.

`RouteWork` optionally counts expanded cells, visibility samples and failed searches. The linter
keeps all ordered pairs and every former geometric assertion, partitioned into one test per origin.
Every route must stay below 7,000 expansions and 80,000 visibility samples (about 25% above the
measured worst case), and must never use the unreachable fallback. The ordinary five-second
timeout stays unchanged. Counters have a fixture that distinguishes a direct route from an
exhaustive search ending in the fallback; a slower CI machine cannot change these work counts.

Run `node docs/attention-deck/route-audit.mjs` with the repository and the existing `docs/board-list`
harness dependencies available. It builds the three revisions from git without checking out another
tree. Seven alternating timing rounds use fresh floor caches; discard the first as warm-up.
Instrumentation runs separately, checks all route geometry, and hashes every returned path for all
four packs. Results and temporary bundles go under ignored `.local/attention-deck/routes/`.

Local Windows / Node v24.19.0 / AMD Ryzen AI 9 465, six measured rounds, routing only:

| Revision | Minimum | Median | Maximum |
| --- | ---: | ---: | ---: |
| Main | 1,189 ms | 1,205 ms | 1,445 ms |
| Original PR | 1,285 ms | 1,332 ms | 1,595 ms |
| Fixed | 994 ms | 1,005 ms | 1,164 ms |

The fix is 25% faster than the original PR and 17% faster than main by median. Ghost polygon edge
tests drop from 194,061,876 to 52,748,894 (73%). Search/visibility counts and route lengths remain
exactly the original PR's. All 5,330 ordered routes across the four settings have identical path
hashes before and after the optimization. Timing is diagnostic evidence, not a pass/fail assertion.

CI validation for the final revision is recorded on PR #119, including both push and PR workflows
on Windows and Ubuntu for two consecutive complete attempts.
