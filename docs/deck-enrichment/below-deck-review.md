# Idle crew below deck

Ship pack 1.2.0 sends idle crew through a narrow access corridor to a room beneath the working deck.
Once settled, each worker appears in a small generated porthole on the hull. Clicking or hovering it
still names that worker; focus, keyboard navigation, badges, reply markers and stale-feed handling keep
their existing meaning. A worker going back to work resumes its cast and walks upstairs. Reduced motion
snaps between posts and fades removed handles without leaving clickable ghosts.

The intentional visual differences are the removal of idle bodies from the working deck, their new
portholes/badges below it, changed rest travel and departure routes, and the legend's “resting below deck”.
Working-deck floor, active posts, hull, cast art, weather, sea, camera fit and the office pack are unchanged.
Packing keeps a gap round the plank. Twenty-four resting workers fit at regular spacing and larger crowds
use the pack's closer spacing; the generic linter checks reachability and clear click targets for 24 with
every active post occupied. Existing tests also check 32 distinct resting positions.
Departing workers now release their reservations before newcomers are assigned in the same poll, so
replacing a whole room does not waste posts on absent workers or leave overlapping targets. This also
applies to ordinary zones; departure choreography and existing workers' reservations stay unchanged.

`zone-appearance@1` is the new generic catalogue entry. A zone can declare one sprite, its feet anchor and
the piece it draws in front of. It applies only after settling. The engine retains identity/state and uses
the actual sprite's bounds and depth for badges, labels, hit testing and focus. It suppresses cast fidgets
and breathing for a handle. Ordinary overflow remains restricted to spillable floor; a zone with a visible
handle may use explicitly authored packing areas on non-spill floor. Missing handle art leaves the engine's
badge and mark visible and clickable. No setting-id branch, script, expression, callback or new timer is added.

The strict schema checks the capability, image and piece references and feet anchor. Pack lint checks its
crop, footprint, visibility, fit and crowded hit targets. Generic tests apply the feature to a waiting zone
in a differently named pack; renderer tests cover depth, hover/click/focus, image failure, stale feeds,
state changes, texture cleanup and removal. Source art, prompt and normalization records are in
[the art directory](../ship-deck-art/below-deck/README.md), outside shipped `art/`.

The compiled browser check clicks all 24 portholes, verifies their distinct worker focus panels, sends one
worker back to work and rest, removes a focused worker, and replaces the entire room in one poll. All
targets remain reachable with the right identity and no clickable ghosts. The check uses real compiled
client code, deck RPCs and packaged PNGs; only the host fleet is a fixture. Reproduce with
`CHECK_IDLE=1 node docs/deck-settings/render.mjs '?setting=ship'` after compiling. Its results and crowded
room image are [recorded here](below-deck-interactions.json) and [here](below-deck-crowd.png).

Local validation: **88 files, 1,075 tests passed, three skipped**; typecheck and all **51 pack-lint checks**
pass. Paseo's compiler builds both bundles; Hermes parses the client, with no `class`, bundled Pixi or
embedded PNGs. Client growth is **2,020 bytes**. `npm pack --dry-run` contains **559,579 art bytes** and
excludes tests, documentation and source art. No tests or timeouts were disabled.

The first complete capture compares implementation `70f3cd7` with merged main `3cc12d1`: **81 shots**,
matching canvas metadata throughout and no browser errors. Each difference was inspected in the full
frames and difference sheets before recording exact main/branch hash pairs in
[`expected-changes.json`](../deck-settings/expected-changes.json). All 81 contain intentional changes,
including the below-deck legend; the gate uses no masks, tolerance or omitted scenarios.

| Frames | Reviewed intentional differences |
| --- | --- |
| 8 still views | Idle bodies leave the deck; hull portholes, their badges and the legend replace them, including busy/all-idle and stale-feed views. |
| 8 moving noon, 2 night, 3 lite | The same replacement, with cast fidgets and breathing absent from stationary handles. |
| 29 storm frames | Four idle bodies become hull handles. Sea creatures, lightning timing, sky and sea pixels remain unchanged. |
| 27 crew transitions | Rest travel follows the new room; handles appear when settled. The existing hatch, active workers and departure effects remain unchanged. |
| 4 focus frames | Idle background figures and handles move under the existing veil. Focused worker, camera and panel remain unchanged. |

A second independent full render **passes all 81 shots**, reproducing every reviewed hash pair, with no
flakes or browser errors and matching canvas metadata throughout. Results are in
[`gate-results.json`](../deck-settings/gate-results.json); the matching compiler evidence is in
[`compile-results.json`](../deck-settings/compile-results.json). Run with `SAVE=1 RERENDER=0` after
compiling to reproduce the unmasked comparison. The following evidence commit changes no runtime inputs.

Self-review of the complete code, pack, art and screenshot diff is complete. The implementation's
[Windows and Ubuntu CI](https://github.com/LiterallyBlah/firstmate/actions/runs/38819645779) passes.
The PR is published READY only after those checks also pass on its final pushed evidence commit.

The subsequent PR-triggered run exposed a five-second limit in the ship linter's all-pairs route test.
Its half-pixel samples and every route/corner check are retained; a single assertion now reports the first
off-floor sample per route, instead of constructing a matcher for every passing sample. This reduced the
local ship route check to **1.47 seconds**, with all 51 pack checks passing and no timeout increase. This
test-only optimization leaves the compiled runtime, art and reviewed 81-shot evidence unchanged.
