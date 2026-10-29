# Optional routine checks and the update introduction

Slice 10 from the 29 October smooth-update report. Captain decisions D1–D8 are accepted. This change remains opt-in.

The following acceptance checks are recorded before implementation:

- Fresh/update, off/on, existing pilot, dismissed introduction and already configured projects produce the intended first screen with no automatic enablement, model wake or migration. Dismissal survives reconnect and is independent per home.
- Routine-check preview/cancel creates nothing. Confirming an owner uses the saved profile/limits and exact resume input. It does not create jobs or change timers. Healthy/unchanged incidents wake nobody; genuine choices enter the shared inbox once.
- Full integrated matrix: Home, Plans, contextual discussion, Needs-you and Board; light/dark; desktop/phone; fresh/upgraded; off/on plus UI-only; normal/delayed/offline/partial/corrupt reads; real owners, no owners and uncertain effects. Native keyboard/focus/screen-reader checks run in Paseo, beyond the web harness.
- Observe a real opt-in update with a non-technical tester: existing chat is immediately recognizable, setup's next action is named, all eligible projects can be reviewed together, cancellation is understandable, and no restart/terminal is used. Release remains opt-in until the captain changes rollout policy separately.

Boundaries: settings-only routine creation via the existing app admission; independent policy opt-in; advanced host/job/timer inventory retained. Observation and genuine authority/budget choices only. No Attach, cleanup, timer mutation, maintenance chat or corrective-plan dispatch. The dismissible, once-per-home/version introduction requires readiness and a usable shared project-setup path and never interrupts or replaces chat.

## Implementation and acceptance map

Routine checks opens from **Help with your work → Review routine checks**. An off home first reviews its independent opt-in; saving changes only `maintenance`. Creation then reviews the actual model, permission mode and cumulative turn limit through the existing `firstmate.maintenance.admit-ui` transport. Preview, inventory and cancellation call reads only. A saved request has a read-only **Check saved setup** action, alongside an explicit resume/retry preserving its request, scope, profile and spend. No maintenance server or effect guard is changed.

Advanced work details retains existing owners, incidents and resume controls. New creation lives only in settings. Routine-check Details reads jobs, host passes, resources, cleanup qualification and the full timer census, including disabled/unknown-owner rows.

The introduction component requires a real FirstMate conversation, ready fleet/project/policy reads, projects still needing setup and a usable setup callback. Its dismissal uses a separate immutable per-home/version preference, outside feature policy and the supervision journal. Reads create no files; corrupt preferences suppress the card and cannot be overwritten by dismissal. Cross-home calls refuse.

**Integration gate:** the introduction is deliberately not mounted in production yet. The first mate confirmed on 29 October that this PR should ship its component/readiness/dismissal dark, then wire the shared Home/settings project-setup destination after slice 6 merges. The screenshot labeled introduction is a component preview of that closed gate, not a claim that a project setup destination has shipped. No plugin update enables capabilities or changes chat.

| Acceptance | Evidence / remaining gate |
| --- | --- |
| Fresh/update; off/on/pilot; dismissal and already-configured state; no automatic enable/wake/migration | `client/project-introduction.test.ts`, `server/update-introduction.test.ts`, `client/help-settings.test.ts`. Read-only introduction eligibility includes every required source, conversation and setup-complete gate. `docs/smooth-pr10/render.mjs` checks all five destinations in both themes and widths, fresh/upgraded, off/on/UI-only. Production introduction remains closed pending slice 6. |
| Preview/cancel does nothing; exact saved profile/limits/resume; no jobs/timers; quiet unchanged incidents; choices counted once | `client/maintenance-ownership.test.ts` covers cancellation, independent opt-in, duplicate confirm, lost reply, read-only check, original-input retry, fresh-client resume and stale/held/offline/cross-home refusal. Existing `server/maintenance-runtime.test.ts` and `server/feature-policy-native.test.ts` cover the unchanged admission, incidents and pause/settlement boundaries in the full suite. No new job/timer/cleanup/answer transport exists. |
| Full integrated visual/failure/accessibility matrix | Harness records 64 pinned before/after screenshots and 120 ordinary destination combinations, plus phone 200% text checks. Focused tests cover pending/offline/held/wrong-home sources. Impeccable scan returned `[]`. Full cross-slice delayed/partial/corrupt/owner combinations and native Paseo keyboard/focus/screen-reader checks remain an explicit integration/release gate; browser fixtures do not establish native accessibility. |
| Real non-technical opt-in update | Pending human tester, accepted by the first mate as a later release check. Confirm recognizable existing chat, named setup action, aggregate project review, understandable cancellation and no terminal/restart. This PR does not claim that observation occurred. Defaults remain opt-in. |

## Reproduce

Use the installed Node/npm CLI workaround on Windows. Run `npm run typecheck`, focused Vitest files above, and the full suite with the hosted Windows settings: `npm test -- --maxWorkers=2 --testTimeout=20000`. Render with `node docs/smooth-pr10/render.mjs`, then `node docs/smooth-pr10/contact-sheets.mjs`. Artifacts stay under ignored `.local/smooth-pr10/`; selected screenshot evidence is copied into this folder for PR review.

The before bundle is pinned to `9c3485e8` and asserts that the new routine setup is absent. Host RPCs and model catalog results are synthetic. The introduction preview supplies an illustrative setup callback; no fixture creates real sessions or reads the live home.

The first default-concurrency local full suite completed 3,403 passing / 29 failing / 4 skipped, with broad 5-second Windows timeouts, temporary-directory cleanup fallout and the known `server/launch-tool.test.ts` EPERM rename flake. A run using hosted worker/time settings and the final hosted checks are recorded in the PR. No unrelated timeout or supervision test has been weakened.
