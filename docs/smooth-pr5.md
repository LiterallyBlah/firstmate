# In-app help settings (smooth rollout, slice 5)

## Acceptance checks recorded before implementation

- [x] A non-technical tester reaches the setup entry without a terminal and sees
  applied state immediately. No restart instruction is needed. A first update
  keeps everything off unless previously opted in.
- [x] Opening/canceling/settings navigation has zero model/session effects.
  Feature-save failure leaves the previous effective state and draft review visible.
- [x] A partially enabled pilot sees its actual setup; unavailable policy
  dependencies have a named in-app next step. Turning off cannot look like
  deletion or completed rollback.
- [x] Two-client stale settings, host/home switch and permission/provider
  unavailability refuse safely with readable recovery.

## Scope

Use the existing policy RPCs and runtime enforcement from slices 3–4. Add
Project mates, Plan help and Routine checks to the existing settings screen,
with read-only setup review, explicit enable-only saving, reviewed dependency
changes, retained independent pilot values, turn-off impact and separately
reviewed capacity/headroom changes. Do not add project admission/provisioning,
batch setup, migration/Attach, routine-check creation or the upgrade introduction;
those belong to later slices. Only the captain attaches a supervisor.

The captain accepted D1–D8 on 2026-10-29. D2 requires explicit opt-in for fresh
and upgraded homes and exact legacy environment compatibility until an explicit
save. Saved settings then override environment values, including saved off.

## The settings and environment bridge

Open FirstMate settings and choose **Help with your work**. The three entries
open read-only reviews. **Save help settings** opts in immediately using the
existing server policy; it creates no session and sends no model message.
Each helper still requires its existing model, actual permission, cumulative
limit, source and opening review. Advanced work details retains those existing
controls; the new guided project admission flow belongs to slice 6.

| Reviewed choice | Enables | Leaves independent |
| --- | --- | --- |
| Project mates | Project controls, contextual conversation controls and contextual messages/answers | Plan execution, plan handover and routine checks |
| Plan help | Plan execution, handover controls and contextual conversation controls/messages | Projects and routine checks; each plan still requires checked handover and captain-only attachment |
| Routine checks | Routine-check controls | All other capabilities; no checks conversation adapter or cleanup |

Every change starts with the existing six requested values. Off changes only the
selected owner controls; shared conversation choices remain intact for other
help. The review lists the exact changes. **Keep existing setup** stores all six
existing independent choices without normalizing a partial pilot.

For the captain's current machine, all six user-level environment switches remain
in effect until a save here. Merely updating, opening settings, inspecting a
review or canceling writes no policy. **Using your existing setup** identifies
that bridge. The first explicit save persists either those exact values or the
reviewed change. A saved off overrides environment on on subsequent reads and
starts. The screen does not edit environment variables or require a restart.
The bridge remains bound to the original configured home; it is never copied to
another home. Capacity is retained exactly during a feature save. A separate
capacity review names current/proposed slots, FirstMate's headroom, spending
impact and the limits it cannot change. Known invalid legacy capacity can be
corrected explicitly without normalizing its capability values; damaged policy
with an unknown revision stays held.

## Acceptance mapping

| Report acceptance | Evidence |
| --- | --- |
| Find setup in the app; immediate state; first update off | The production SettingsScreen browser walkthrough opens the project review, cancels with focus returned, then explicitly saves and observes the reread effective state. `client/help-settings.test.ts` verifies off defaults and exact project dependencies. Only `firstmate.features.set` is called on confirm; no lifecycle/send RPC is imported. |
| Reads/cancel have no effects; failure retains old state and draft | Browser call logs assert zero mutation RPCs on navigation/cancel. Component tests cover permission refusal, retained review, duplicate confirm, lost reply checked through a read, and exact request-ID/body retry. A pending pre-save read is canceled so an old response cannot overwrite applied state. |
| Partial pilot, dependency next step, truthful off | All 64 independent flag combinations exercise dependency selection. The partial pilot browser saves only its originally requested contextual execution value. All-on pilot saves remain all-on. Reviews list exact on/off changes and keep full independent pilot choices visible. Off review names active/pending/uncertain lower bounds, incomplete coverage and overlap, in-flight settlement, retained identity/history/spend and no automatic resend/refund. |
| Stale clients, host/home and unavailable authority/provider | Stale revision disables confirm and preserves the review. The existing server CAS still checks at append. A refused save can read the current setup for a new review. Config and feature queries are host/home keyed, changed home remounts the review, and delayed old-home results are ignored. Held/permission/connection failures disable new saves with read-only recovery. No provider/model/mode is selected by enablement; unavailable providers cannot cause fallback, session creation or extra permission. Existing runtime/source/profile/cap and strong-qualification tests remain unchanged. |

The walkthrough is automated against actual components with an isolated synthetic
host. It is evidence for the app path and safeguards, not an observation of a
human tester or native screen reader. The real non-technical opt-in update test
and native keyboard/screen-reader matrix remain slice 10 release validation.

## Verification

- Typecheck passes.
- Full local suite: 244 files, 3,410 tests passed; four skipped. The known
  intermittent Windows `server/launch-tool.test.ts` flake did not occur.
- Focused policy/UI run: 56 tests passed, one skipped; includes 15 new settings
  behavior tests. Server policy/storage/effect guards are unchanged.
- `node docs/smooth-pr5/render.mjs`: 64 captures/assertion cases, light/dark,
  1440×1000 and 390×844; no page exceptions or document overflow. Review controls
  also pass 44×44 target and clipping checks at 200% text. Escape returns focus.
- The Impeccable mechanical scan found no issues in changed settings components.
- A throwaway daemon was started inside this worktree and stopped cleanly.
  Installation correctly refused because the machine's CLI starts Paseo 0.9.2
  while this plugin requires >=0.11.0. No manifest weakening, repeated install,
  live plugin reload, live home change, model wake or session was attempted.
  Native installed-app verification is therefore not claimed.

## Visual evidence and copy contract

| Theme/width | Before → after | Setup, pilot, pause, error, capacity, stale and 200% reviews |
| --- | --- | --- |
| Light desktop | [Comparison](smooth-pr5/evidence/light-desktop-comparison.png) | [Reviews](smooth-pr5/evidence/light-desktop-reviews.png) |
| Dark desktop | [Comparison](smooth-pr5/evidence/dark-desktop-comparison.png) | [Reviews](smooth-pr5/evidence/dark-desktop-reviews.png) |
| Light phone | [Comparison](smooth-pr5/evidence/light-phone-comparison.png) | [Reviews](smooth-pr5/evidence/light-phone-reviews.png) |
| Dark phone | [Comparison](smooth-pr5/evidence/dark-phone-comparison.png) | [Reviews](smooth-pr5/evidence/dark-phone-reviews.png) |

The before build reads `8e88715` with `git show`; it never changes the checkout.
All eight original first-frame screenshots are beside the comparison sheets.
The ordinary screen uses Project mates, Plan help and Routine checks, honest
off/partial/effective states and plain review actions. Internal capability
details/source/revision and full diagnostics are disclosed under Help details.
Actual stopped/uncertain ownership stays in Advanced work details. Routine checks
explicitly says automatic cleanup is unavailable. No setup opportunity enters
Needs-you. No Home/chat/plan/board behavior changes in this slice.

Generated call logs/bundles/screenshots stay under ignored
`.local/smooth-pr5/ui/`; CI uploads them with its render artifact. To reproduce,
install root and `docs/board-list` dependencies, then run:

```powershell
& 'C:/Program Files/nodejs/node.exe' docs/smooth-pr5/render.mjs
& 'C:/Program Files/nodejs/node.exe' docs/smooth-pr5/contact-sheets.mjs
```

The render fixture supplies only host chrome, read responses and a CAS/idempotent
synthetic policy server. Its writes never reach a live daemon or home. Production
mutation safety is covered separately by the existing server runtime tests.
