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
cleanup. Full suite, package lint, Hermes and the exact 81-shot review are recorded below when complete.
