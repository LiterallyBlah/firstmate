# Ledger decisions on the Deck

The bow is for an actionable New/Seen ledger gate; ordinary worker failures,
permissions, ready work and idle/stalled work wait with the first mate. Running
work uses the rigging and parked/snoozed work stays below deck. Answer-sent and
delivery-uncertain gates wait with the first mate. No hold or question is detected
in the client. The server's `actionCount` and `newCount` are displayed unchanged.
An unavailable count remains unavailable; stale decisions retain their last good
count. Older daemons without `needsYou` retain the legacy vocabulary.

`deck-decisions.ts` matches a gate by task and resolved host identity. An absent,
closed or ambiguous worker leaves its decision with the officer. Its tag is the
server total minus gates successfully assigned to sailors, so an unmatched gate
cannot disappear from the Deck. Seen keeps its count; only New moves the existing
exclamation badge, using the existing one-pixel reply lift. Still mode holds it.
The original activity state/feed remains the weather input, independently of
decision placement, so a new/stale/snoozed/answered decision changes no weather.

## Reserved officer and geometry

`first-mate@1` declares `firstMate: { at, clearance, image, lane, pose, facing }`.
The atlas is mandatory and separate from ordinary crew looks. It has no arrival,
departure or ambient fidget. The renderer uses the normal body scale, frame,
mirroring, depth and pointer machinery. Its tag follows the same stage transform
and camera as its figure. Packs without the capability retain the legend action.

`register.mjs` copies Astra's A1 PNG bytes unchanged from commit `02d0cb6` and
registers their existing lanes and anchors; it never processes images. All four
wheel/stern groups move inward, with fewer primary posts where the stern is
narrow. Bow and working posts are separated accordingly. Sky pirates uses an
aligned 12-pixel overflow lane to keep 24 crew reachable after reserving its stern.
Below-deck posts remain aligned to the existing cabin/window art and separated
from the officer. No floor, hull, window, sprite or weather art is edited.

The reserved clearance also applies to overflow targets. The pack linter checks
the supplied bytes, every atlas frame, on-floor position, foreground visibility,
fit, all floor routes, clearance from crew posts, and pointer access with 24 crew
in each state plus the other states' primary posts. The existing scaled-cast tests
retain their 24 distinct and reachable workers in every state.

## Shared drawer integration

`ShipDeckView.onOpenDecision(decision: string | "next")` is the single action for
the held worker's figure/badge, focus-panel Answer, officer figure/tag, total and
legend links. It passes a stable ledger ID and lets the shared drawer reread its
current revision. The Deck neither marks Seen nor sends answers on its own.

**Pending parallel integration:** `FleetSurface` currently passes
`onOpenDecision={shell?.openDecision}`. The clearly marked adapter in
`workspace-panels.tsx` uses the agreed public Home route
`openScreen({ screenId: "fleet", params: { decision } })`. The drawer itself is
being delivered separately. Once its in-place action lands, replace this one prop
with `onOpenDecision={openDecision}`. No other Deck indicator needs rewiring.
The native/compact availability policy is unchanged.

## Verification and screenshots

Run `npm run typecheck`, `npm test -- --maxWorkers=2`, and
`npm run lint:deck-packs`. `node docs/attention-deck/compile.mjs` uses the existing
Paseo compiler and Hermes without installing or reloading a plugin.

With `docs/board-list` harness dependencies installed and Edge available, run
`node docs/attention-deck/render.mjs`. It bundles the real before/after Deck views,
serves the real manifests and Pixi, and substitutes only the host RPCs and ledger.
The fixed baseline is `2519564` (#118); the same fixture drives both views.
The workerless Seen gate and working worker's New gate exercise both markers.

It captures `before-` and `after-` PNGs for `ship`, `japanese-ship`, `ghost-ship`
and `sky-airship` at 1440×900, verifies tag/legend keyboard and actual canvas-badge
click routing, and compares repeated reduced-motion canvas screenshots byte for
byte. These are browser fixture checks, not an installed Paseo or native test.
All captures remain under ignored `.local/attention-deck/`. The Windows
`deck-review` CI job attaches all eight PNGs plus `results.json` as the
`deck-before-after` artifact, retained for 30 days and linked from the PR.
