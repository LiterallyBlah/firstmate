# Mention mates and switch conversations

Slice 11 builds on the smooth-update report's slices 1, 6 and 8. The captain
accepted D1–D8; D5 keeps FirstMate's original transcript as Home's permanent
source, with explicit named conversations and a return. Refreshes stay silent;
age appears only for stale data or a failed refresh.

## Acceptance checks recorded before implementation

1. Typing `@` in Home's FirstMate composer opens a short, searchable list of
   existing project mates and plan helpers, naming the project/plan each belongs
   to. Reading, choosing and switching creates no session or message.
2. Choosing a mate offers an explicit choice: carry the text into that mate's
   named conversation for its checked Send/review, or open that conversation.
   The recipient is visible before sending. Back to FirstMate restores its
   transcript, draft, attachments, tool disclosures and reading position.
3. A compact conversation switcher lists FirstMate and each real mate/helper,
   with unread counts from observed conversation messages. Merely opening the
   menu does not mark other conversations read or wake a model.
4. When a complete read finds no mates, `@` shows “No project mates yet. Set one
   up”, opening the same ProjectSetup flow as slice 6. Pending/failed reads never
   claim that no mates exist.
5. General keeps its existing checked sender. Scoped messages use the existing
   captured routes, per-recipient drafts, first-send review and checked outbox.
   Disabled, stale, changed-owner, missing, cross-home and unsupported targets
   refuse with the intended recipient/draft intact; no fallback to General.
6. Features remain opt-in. No Attach, new provisioning route, weaker guard,
   environment edit or restart is added. Setup/navigation are read-only until
   the existing explicit creation confirmation.
7. Light/dark desktop (1440×1000) and phone (390×844) captures show before and
   after, mention/menu/selected/empty states. Check 44px controls, keyboard
   selection/dismissal, focus return, readable copy and no horizontal overflow.
   No Updating/as-of labels are introduced. Browser evidence is distinguished
   from native device verification.

These checks extend PR 1's chat continuity and PR 8's captured-target/draft
acceptance, plus PR 6's existing-mate conversation/setup path. The original
report has no numbered slice 11.

## Validation and evidence

| Check | Evidence |
| --- | --- |
| 1: real project mates and plan helpers, short searchable mention list | `conversation-list.test.ts` checks filtering and names; real Home browser captures show both existing owners and omit uncreated New trial. Caret mentions exclude emails and code. |
| 2: Message/Open choice, named send, FirstMate continuity | Message carries the words to the named composer for its existing Send/review; Open leaves that draft alone. Browser interactions send through `firstmate.scope.discuss` to the selected project agent, then restore General's words, attachments, earlier pages, reading offset and composer focus. Component coverage retains the existing transcript across enablement and failed/cross-home targets. |
| 3: switcher and unread | Browser checks one actual plan reply becoming read only after visiting its conversation. The local read store survives plugin reevaluation and isolates host/home/owner. Failed unread reads show unavailable, never zero. The existing To control and switcher share selection. |
| 4: empty versus pending/failure and shared setup | Component tests distinguish pending/failed/complete-empty reads; the exact plain empty action opens the exported slice 6 ProjectSetup. Browser captures retain a real read failure without claiming there are no mates. |
| 5–6: checked routing and opt-in safety | General still uses `useMateSender`; leading unresolved addresses are held. Scoped sends retain `discussionSender` and its exact outbox. Navigation pins home/scope/agent/epoch, while each send captures the fresh scope version. Changed owners refuse with retained drafts. The existing server services, Attach, flags, source/profile/capacity checks and first-send review are unchanged. |
| 7: copy, themes, widths and input | 64 captures compare actual Home at `0e720c2` with this branch; two browser interaction flows cover wide/phone input. All new mention controls meet 44px; no page exceptions or document-width overflow. Manual both-theme inspection corrected dark action contrast; the mechanical design scan has no findings. Refresh stays silent; retained age is muted and appears only after a failed read. |

Unread tracks replies visible through the existing scoped-conversation reader and
FirstMate's native transcript. It is local to this app session, like the existing
drafts; it does not claim a device-shared read receipt or include unseen native-only
messages outside that reader. Navigation and discovery create no model turn.

Run `node docs/smooth-pr11/render.mjs` after installing `docs/board-list` dependencies.
It writes captures, comparison sheets and JSON only to `.local/smooth-pr11/ui/`.
`--interactions-only` verifies routing/return behavior without recapturing the visual
matrix. CI runs the complete harness and retains the raw captures as artifacts.
The checked-in comparison sheets are the small review set linked in the PR, following
the preceding smooth-update slices. The fixture has synthetic host data and sends;
it does not create live owners, sessions or projects. Physical phone keyboard and
native screen-reader behavior have not been independently verified in this worktree.

Validation: typecheck; 38 focused tests; 64 browser captures and two input/route
flows; `git diff --check`; mechanical design scan (no findings). Full-suite and
hosted results are recorded in the PR after completion.
