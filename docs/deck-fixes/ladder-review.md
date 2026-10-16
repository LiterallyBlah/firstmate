# Ladder against the mast, behind the sail

Ship pack 1.4.1 moves the existing 14×144 ladder from `[215,-38]` to `[204,-38]`:
its centre is now the mast's vertical axis, x=211. It has no rotation, skew, sway
or scale. The existing part list draws it after the mast and before the sail,
so both sail frames occlude it. No new asset, renderer code or capability is needed.

The floor post remains `[222,98]`, on open deck beside the mast's obstacle. Its
access path now approaches `[211,98]`, climbs vertically to `[211,-35]`, then
steps into the unchanged lookout position `[218,-35]`. The existing climb layer,
poses and speed stay unchanged. The additional approach changes the climber's
position and timing during ascent/descent; these are part of the intentional
ladder alignment. Other floor posts, routes and behaviours are unchanged.

All 84 PNGs, the sleeping zone, hull targets, floor, weather, sea, sail animation,
camera, shark and interface are unchanged. FirstMate tab chrome is outside this PR.
The browser still focuses all 24 sleeping workers correctly, vacates their targets
on state change/removal, and preserves identity when they return. The lookout is
clickable by day/night, descends to its porthole and climbs back to the nest.

Self-review checks the actual renderer's sibling order, the common mast/ladder/path
axis, missing-art fallback, unchanged nest endpoint and the pixel comparisons.
Typecheck, the full suite and pack lint pass; Paseo compilation gives byte-identical
client and server bundles against main, and Hermes parses the client with no `class`,
bundled Pixi or embedded PNGs. Browser evidence lives in `ladder-*.png`,
`ladder-interactions.json` and `ladder-sleeping-interactions.json` here. Reproduce it
with `CHECK_IDLE=1 CHECK_POLISH=1 node docs/deck-settings/render.mjs`, which writes
the historical harness's output names under `docs/deck-enrichment/`.

The first capture was reviewed in full: 81 main/branch/difference comparisons,
across 21 contact sheets. Every change is the old ladder disappearing and the
new mast-centred ladder appearing, including the four camera-focus frames.
[Still comparisons](ladder-gate-still-comparison.png) and
[zoom/return comparisons](ladder-gate-focus-comparison.png) show main, branch,
and red differences from left to right.
`ladder-pixels.json` records a separate decoded-pixel audit: zero changes outside
the canvas; all 77 non-focus frames change only within the old/new ladder columns;
and the settled sleeping-room frame has no changed pixels below the deck. All
84 registered images match main's SHA-256 hashes. The audit also checks that the
manifest changes only in the three places described above.

`../deck-settings/expected-changes.json` records both exact screenshot hashes
and the reason for each intentional difference against main `b3d70ec`. The
gate remains unmasked, with no changed thresholds or acceptance code. A second
independent run passed all 81 exact reviewed frames with the default re-render
checks enabled: zero unexpected differences, zero browser errors and zero flakes.
`../deck-settings/gate-results.json` records that final run.

Validation: 90 test files, 1,076 tests passed (three existing skips); 36 pack-lint
tests; typecheck; the exact-hash acceptance regression; and the browser interaction
checks above. The data change is `88c5d6f`; the compiler evidence in
`ladder-compile.json` pins that revision and its baseline. Reproduce the pixel
audit after the full gate with `node docs/deck-fixes/check-ladder-pixels.mjs`;
contact sheets are written under ignored `.generated/ladder-gate-review/`.
