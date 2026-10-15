# Shark reply signal

Ship pack **1.3.0** replaces per-sailor reply markers with one generated shark carrying a three-dot speech
bubble beside the bow. Clicking its body or bubble opens the selected worker's existing **Converse** drawer.
The footer names that worker, offers the same keyboard action and previous/next controls for multiple
requests. Selection stays with its identity across polls and reordered cards; a removed or stale selection
falls back to the first eligible key. Opening Converse does not send a message or mark a request answered.

Eligibility is engine-owned: live crew in Blocked, with pending permissions, or named by unanswered
first-mate suggestions. Ready and a failed job alone do not qualify. Stale fleet feeds, unreachable remote
workers, followed sessions, closed workers and absent cards are excluded. The fleet converts the selected
card key through the existing local/remote Converse identity function. Ordinary sailor/porthole hover,
focus, state badges and card actions remain available. The office retains its existing suggestion markers.

Intentional visual differences: the generated shark and speech bubble, removal of the ship's old per-worker
reply markers/bubbles, and replacement of the footer hint with the attention count, selected worker and
Converse controls while a response is needed. The controls occupy the existing footer space. No stage fit,
floor, camera, hull, cast, porthole, weather, lighting or other art changes. The signal hides during ordinary
worker focus; the footer action remains available. Lite and reduced motion show frame zero without loiter.

`attention-carrier@1` is generic pure data: frame sprites/size/time, position and bounded sine amplitude/period.
The schema validates references, frame crops and sizes, fit bounds and exact capabilities. It has no pack
callbacks, scripting, setting-id branches or new timers. It shares the existing simulation and pause path,
draws outside stage bob/tint, and uses the same rendered coordinates for its hit target and hover label.
Missing frames use the first available frame; missing all art leaves the engine's bubble and keyboard action.
Sources, prompt, normalization and provenance remain in [the art directory](../ship-deck-art/reply-shark/README.md).

The [compiled-browser check](check-attention.mjs) uses real client code, RPCs and packaged art, with fixture
fleet/host APIs. It verifies body-to-local Converse, bubble-to-remote Converse and host permission guidance,
keyboard-to-suggestion worker, multiple requests, insertion stability, offline/removal cleanup, no accidental
sends, and office isolation. Reproduce after compiling with `CHECK_ATTENTION=1 node docs/deck-settings/render.mjs`.
Its [results](reply-shark-interactions.json) and [screenshot](reply-shark-still.png) are saved alongside this review.

Unit/renderer tests additionally cover arbitrary pack ids, invalid data, alpha/palette/borders/registration,
full animation, calm motion, camera/resize hit geometry, missing images, focus hiding and texture/listener
cleanup. The missing-art bubble fits arbitrary carrier dimensions, including a target smaller than its glyph.

Local validation: **89 files, 1,082 tests passed, three skipped**; typecheck and all **51 pack-lint checks**
pass. Paseo's compiler builds both bundles; Hermes parses the client, with no `class`, bundled Pixi or
embedded PNGs. Client growth is **8,380 bytes**. `npm pack --dry-run` contains **566,196 art bytes**, with only
the four 64×48 shark PNGs added, and excludes tests, documentation and source art. No checks, timeouts or
test coverage were relaxed. [Windows and Ubuntu CI for the final runtime](https://github.com/LiterallyBlah/firstmate/actions/runs/38824306663) passes.

The first full capture compares `e1cb4a1` against merged main **`b830b37`**. All **81 shots** have matching
canvas metadata, no flakes and no browser errors. Fifteen are pixel-identical: the lost-feed frame and
all fourteen crew-departure/after frames once nobody needs a response. The other 66 were inspected in
full frames and difference sheets before recording exact main/branch hash pairs in
[`expected-changes.json`](../deck-settings/expected-changes.json).

| Frames | Reviewed difference |
| --- | --- |
| 7 still views | Shark/bubble beside the bow and the footer's selected worker/Converse action. |
| 8 moving noon, 2 night | The carrier's four generated tail frames and bounded loiter; same footer. |
| 29 storm views | Same additions; existing creatures, lightning, weather timing and sea remain identical. |
| 13 crew transition views | Same additions; selected identity stays stable until its response request disappears. |
| 3 focused views | Footer only; every canvas pixel is identical and the carrier is hidden. |
| 1 focus return, 3 lite views | Carrier reappears on return; lite holds its first frame at the fixed position. |

An additional [pixel check](check-attention-pixels.mjs) compares the actual PNG pairs named by the gate's
hashes and finds **zero changed pixels outside the carrier and existing footer regions**. Its
[per-shot evidence](reply-shark-pixels.json) is separate from acceptance: the gate still compares every
pixel with no masks, tolerance or skipped scenarios. The later runtime commit `ccfe291` only makes the
missing-art fallback fit arbitrary pack sizes; the normal scene/art inputs remain the same.

A second independent full capture of **`ccfe291`** passes all **81 shots**, reproducing every main/branch
PNG hash pair from the first capture: **66 exact reviewed additions, 15 identical**, matching canvas
metadata, zero flakes and zero browser errors. The pixel-region check passes again. The compiled-browser
interaction check was rerun against this final runtime and passes as well. Final
[gate results](../deck-settings/gate-results.json) and [compiler results](../deck-settings/compile-results.json)
are committed. Run `SAVE=1 RERENDER=0 node docs/deck-settings/gate.mjs` after compiling to reproduce it.

Self-review of the complete code, pack, generated art and screenshot differences is complete. The evidence
commit changes documentation, captures and test assertions only; runtime and pack inputs stay at `ccfe291`.
This slice is published as its own READY PR after the final pushed commit's Windows and Ubuntu checks pass.
