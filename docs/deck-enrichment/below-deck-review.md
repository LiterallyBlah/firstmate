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

Validation and reviewed screenshot evidence will be recorded here before the PR is marked ready.
