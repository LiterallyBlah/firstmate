# Ledger decisions on the Deck

The bow is for an actionable New/Seen ledger gate; ordinary worker failures,
permissions, ready work and idle/stalled work wait with the first mate. Running
work uses the rigging and parked/snoozed work stays below deck. Answer-sent and
delivery-uncertain gates wait with the first mate. No hold or question is detected
in the client. The legend leads with the server's `actionCount`; it omits the duplicate signal pill
and empty new-count copy. The amber officer tag reports workerless decisions, including Seen.
An unavailable count remains unavailable; stale decisions retain their last good
count. Older daemons without `needsYou` retain the legacy vocabulary.

`deck-decisions.ts` matches a gate by task, project and resolved host identity. An absent,
closed or ambiguous worker leaves its decision with the officer. Its tag is the
server total minus gates successfully assigned to sailors, so an unmatched gate
cannot disappear from the Deck. Seen keeps its count; only New moves the existing
exclamation badge, using the existing one-pixel reply lift. Still mode holds it.
The original activity state/feed remains the weather input, independently of
decision placement, so a new/stale/snoozed/answered decision changes no weather.

## Reserved officer and geometry

`first-mate@1` declares `firstMate: { at, clearance, image, lane, pose, facing }`.
`first-mate-asking@1` additionally declares `firstMate.asking: { at, clearance }`.
The officer walks to this bow post while workerless decisions wait, and returns to the wheel when
none do. Reversal replans from its current feet; reduced motion and stale state use the final post.
The atlas is mandatory and separate from ordinary crew looks. It has no arrival,
departure or ambient fidget. The renderer uses existing walk poses and the normal body scale, frame,
mirroring, depth and pointer machinery. Its tag follows the same stage transform
and camera as its figure. Packs without the capability retain the legend action.

`register.mjs` copies Astra's A1 PNG bytes unchanged from commit `02d0cb6` and
registers their existing lanes and anchors; it never processes images. All four
wheel/stern groups move inward, with fewer primary posts where the stern is
narrow. Bow and working posts are separated accordingly. Sky pirates uses an
aligned 12-pixel overflow lane to keep 24 crew reachable after reserving its stern.
Below-deck posts remain aligned to the existing cabin/window art and separated
from the officer. No floor, hull, window, sprite or weather art is edited.

Both posts' reserved clearances also apply to overflow targets. Ship and sky overflow spacing
retains 24 distinct reachable crew with both reservations. The pack linter checks
the supplied bytes, every atlas frame, on-floor position, foreground visibility,
fit, all floor routes, clearance from crew posts, and pointer access with 24 crew
in each state plus the other states' primary posts. The existing scaled-cast tests
retain their 24 distinct and reachable workers in every state.

## Shared drawer integration

`ShipDeckView.onOpenDecision` uses the shared `OpenDecision` contract for
the held worker's figure/badge, focus-panel Answer, officer figure/tag, total and
legend links. It passes the ledger request ID, home and displayed revision; a
queue opener passes `requestId: "next"` and the home. The shared drawer rereads the
current revision. The Deck neither marks Seen nor sends answers on its own.

`FleetSurface` passes `onOpenDecision={openDecision}` from `useOpenDecision` under
the shared `DecisionSurface` added in #120. Markers open that drawer in place and
read the same needs-you query as the drawer. The temporary Home-navigation adapter
is removed. The native/compact availability policy is unchanged.

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
It also captures six workerless decisions at the bow and the clear state at the wheel in each pack,
checking the figure's actual rendered coordinates against the manifest.
All captures remain under ignored `.local/attention-deck/`. The Windows
`deck-review` CI job attaches all eight PNGs plus `results.json` as the
`deck-before-after` artifact, retained for 30 days and linked from the PR.
The same harness renders the real `FleetSurface` and checks that the bow badge,
first-mate tag and legend open the shared drawer on the expected title and question,
without navigation or answer/snooze mutations. Revision-bound Seen acknowledgements from the companion
drawer are allowed. It attaches `drawer-bow.png`,
`drawer-first-mate.png` and `drawer-legend.png` as additional review evidence.

The Ghost ship timeout investigation, main/PR measurements and deterministic route-work limits
are in [routing-review.md](routing-review.md). `node docs/attention-deck/route-audit.mjs` reproduces
the paired timing and exact-path comparison without changing a checkout or running a plugin.
