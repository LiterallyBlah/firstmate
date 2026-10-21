# Shared Needs-you indicator and decision drawer

Home, Chat, Crew and Board headers use the server ledger's counts.
Deck has no header pill in either state; its scene legend and first mate keep their existing
decision signals and drawer actions. Its heading preserves visible-surface toast suppression.
The sidebar badge uses the same source; active crew appears as `N in hand` in
Home. Waiting decisions keep an amber outline; New decisions fill it. Clear reads
**Nothing needs you**, unavailable reads **Can't read decisions**, and stale counts
carry a dashed outline with their last confirmed time. Stale or
unavailable data is labelled and cannot enable an answer or acknowledgement.
Missing tasks are quarantined individually; other readable tasks remain answerable. Unique
task ids can move host/project without losing their durable request identity or drafts.
Worker cards, filters and lifecycle events do not determine these counts.

Unreadable backlog lines appear as problems with line numbers and task ids in the
drawer and indicator tooltip/accessibility label. Healthy tasks remain fresh;
quarantined gates retain their last good state with actions disabled. Suspected
holds without readable gates still count and offer a **Couldn't read this task**
entry with **Open Board** when the home workspace is available. Structural failures
retain the last count marked stale, or show unavailable before initialization.
The Deck legend uses this same server total, including workerless/unreadable holds.
`resilience-checks.mjs` exercises the real drawer at 390 and 1440 pixels with
synthetic quarantined and unavailable snapshots; images go under `.local/`.

Opening a visible decision marks it Seen through the current home/request/revision,
without reducing the waiting count. Polling and opening All do not acknowledge unseen
questions. Mark as new lives in the actions menu. The drawer's session order stays
stable across state changes and appends new arrivals; Previous/Next wrap among unanswered questions.
An accepted answer or recorded answer advances in that order, or closes the drawer back to its
opening view when none remain, including questions selected through All. A quiet confirmation on
the next question clears after three seconds. Accepted answers remain handled while the source
hold lingers and are still available in All and the chat's existing answer card. Failed or uncertain
sends stay on the question with their draft/recovery controls. Snoozing advances with a receipt.
Drafts stay keyed by home, request and revision.

The question comes first, then reading links and supplied answer choices, then an accent
Send answer and Snooze / Discuss first / I answered in chat. Snooze offers an hour,
evening, tomorrow at 09:00, or a calendar with hour/minute choices in local time. The
phone keeps its answer bar at the bottom, above the keyboard and safe area. Enter stays
a newline. Actions require fresh, unquarantined data and use the existing send gate.

All groups Waiting for you, Answered, Snoozed, Parked and Settled today into bordered blocks with
strong headings and counts. It shows complete questions and recommendations. Row titles are clamped;
selecting a decision shows the full title, and parked titles expand in place with one press. An uncertain
send offers Open the first mate's chat, It arrived (record the existing submission as
accepted), and Send again with confirmation. A confirmed resend first records the prior
attempt as failed, then sends with a new id. The retained draft supplies the words; after
a fresh client session they must be entered again. Cancel does nothing. I answered in
chat records an accepted submission without sending. None of these actions lifts a hold;
the first mate still reconciles the backlog. Nothing retries automatically.

Both chats fold complete identified answer envelopes into Your answer to «title», with
the answer, recorded question, Open the decision, and Show what was sent. Malformed,
partial, quoted or unidentified envelopes remain ordinary text. Existing envelopes without
a title use the task id. The original message is retained exactly.

## Decisions raised in the chat

The plugin's chat shows each decision the first mate raises once, as a card (`client/decision-raised.ts`,
`client/decision-raised-card.tsx`). The chat keeps no copy: the card is the Needs-you snapshot's
request, read afresh on every poll. It lists the title, question and the brief's recommendation (the drawer's
`DecisionSummary`). It also shows the bound `answerOptions` the drawer offers for that revision, and
Open the decision. A button goes through the drawer's answer path: the same RPC, send gate and
content-bound action id. Answered (sent or uncertain) and resolved decisions show as settled, without
buttons or recommendation.

A card is placed at the request's `detectedAt`, before the first transcript row recorded after it, or
at the end. The daemon observes the backlog every few seconds, so this is just after the first mate
writes the hold. Only non-baseline requests detected in this first mate's tenure appear. The tenure is
the config's `mateSince`, stamped whenever `mateAgentId` changes (launch, restart, adoption, handover).
An adopted agent's earlier history, and anything the ledger saw before it, is another first mate's, and
never gets a card. A first mate saved before tenures existed gets one from its first fleet load
(`readConfigWithTenure`); until then no cards show. Within the tenure, a decision before the first
loaded entry waits for that history to load. A reworded question keeps its card; a re-raised one (a
new generation) gets its own.

Stale, disabled, unknown or offline decision data, or this task's own unreadable line (quarantined),
keeps the last known question and recommendation, with the drawer's warning beside them
(`raisedWarning`); its answers are disabled. A card answer saves its exact words under the drawer's
revision-bound draft key (`decisionDraftKey`) before sending, and clears them once accepted. After an
uncertain delivery, the drawer's Send again… resends those words.
Paseo's native timeline has no item to transform for a raised decision, so only the plugin's chat
shows the card.

`raised-checks.mjs` renders it at 390 and 1440 in both themes. It checks that a previous first mate's
decision stays out and shows the quarantine warning, then answers through the card and settles it.
`RAISED_ONLY=1 node docs/needs-you/render.mjs` runs just those checks.

## Bound one-press answers

Optional `data/<task-id>/decision.md` briefs are read through home containment (64 KiB per file,
512 KiB per snapshot). Ambiguous task ids do not select a brief. The drawer renders all authored
content, including Background, Options and a highlighted Recommendation, accepting Markdown headings
or bold section labels. Numbered options with bold labels receive content-bound answers: the server
rereads the whole brief before sending. Unstructured or unavailable briefs fall back to the recorded
question and ordinary reading links. Briefs and derived choices are optional snapshot context, never
persisted as ledger state.

The drawer consumes optional snapshot.answerOptions supplied by the options/context slice,
falling back to explicitly bound suggestions on older snapshots. specPath and notesPath
are optional reading links for the same integration. Existing suggestions remain unchanged. An optional suffix on the label binds an
answer to the exact home, request and revision returned by `firstmate.needs-you.read`:

```markdown
- Cautious option [decision: {"homeId":"home-id","requestId":"request-id","recordRevision":1,"actionId":"cautious"}] :: Choose the cautious option.
```

Only unique bindings for the displayed revision appear in the drawer. The server
rereads the file and checks the binding, label and complete prompt before sending.
Malformed bindings are rejected; they never fall back to unbound actions. Unbound
suggestions remain in the existing suggestion strip and Deck reply buttons.
Bound suggestions use only the drawer's validated send path. The shipped charter teaches the brief
format; edited live charters retain the usual compare/update path. No authored home records are
rewritten by observation or an answer.

## Shared opening action and notifications

Descendants of `FleetSurface` call `useOpenDecision()` from `decision-action.tsx`:
`open({homeId, requestId, recordRevision}, optionalReturnFocusId)`. Omit the target
to open the next decision. Other installation-owned contributions can call
`FleetShell.openDecision(target)`, which opens Home with the same declarative
destination. The opening action itself does not submit; the visible drawer acknowledges its question.

The sidebar owns one quiet toast for each newly observed batch. Initial baselines
and polling/reload duplicates are silent. A visible FirstMate indicator suppresses
the toast and consumes that batch, so it is not replayed after leaving. Web checks
retained panes' visibility; native uses mounted visibility.
The outbox remains off and no phone transport is included.

## Compact layout and verification

Below 638 points (or host compact), the indicator fills the header width, the drawer
covers its surface, and controls keep 44-point targets. At desktop widths below 1,600,
DecisionPane covers only Home's task pane, keeping its chat and header unchanged. Larger
surfaces dock a 440-point drawer. Full covers hide/inert the background and trap Tab;
pane covers keep the adjacent chat reachable. Escape closes and returns to the opener.
The heading takes focus on open. Desktop controls use Paseo's compact scale.
Back captures the opening view (Deck, List, Board, Chat or Home), including inline Home views.
Home's desktop launcher is behind Open so the header occupies one row. Deck keeps the bow tag
and one short legend link without a header pill; the drawer retains the detailed freshness status.

Run npm ci --prefix docs/board-list, then node docs/needs-you/render.mjs.
`polish-checks.mjs` covers the seven polish fixes using real components and synthetic host APIs,
including the shipped Deck engine. `POLISH_ONLY=1` runs that subset. Captures stay in
`.local/needs-you-drawer/`; no screenshots are committed. These are fixture checks, not an installed
desktop or native-device test.
The harness mounts real components with synthetic host APIs at 320, 390, 637, 638, 900,
1440 and 1680 pixels in both themes. It verifies heading focus, Seen/count semantics,
append-only navigation, retained drafts, pinned phone input, pane cover, answer/snooze
receipts, All, quarantined data, recovery cancellation/confirmation and readable chat.
Screenshots and results go to ignored .local/needs-you-drawer/ and CI artifacts.
`answer-checks.mjs` covers next/last answers, selection through All, failed sends, and lingering holds
at 390 and 1440 pixels in both themes. `client/decision-drawer.test.ts` covers those transitions in
the suite, including definite failures and uncertain delivery.
This is fixture evidence, not an installed desktop or native-device test.
`header-checks.mjs` adds 40 captures across Deck, Home/List, Board, Crew and Chat at 390 and
1440 pixels in both themes. It checks empty and non-empty states, count restoration, unchanged
Deck header geometry, sidebar counts and both Deck legend drawer actions. Phone Deck retains
its existing wide-window notice.

## Crew, Board and status vocabulary

Crew and the default Board lead with the server ledger's unfiltered decision queue,
labelled **Across all machines**. New items come first, then Seen, oldest first with
a stable id tie-break. Multiple worker cards for the same gate produce one decision
row; workerless decisions stay visible. Both the heading count and header indicator
use the server snapshot. Host and tag filters apply to the other tasks.

`client/task-presentation.ts` maps ordinary cards to **In hand**, **Later** or **Done**.
In hand groups work with the first mate, active workers, and parked runs. Worker
failures, permissions, finishes and stalls stay with the first mate. Done requires
a completed backlog item, whose outcome wins over a stale worker. Structural
dependencies, unasked captain choices and snoozed requests go to Later; pending or
uncertain answers stay with the first mate. The drawer still exposes the complete
ledger, including requests without a matching task card.

Cards at rest show ownership plus one useful line. Lifecycle, provider/model,
timestamps, raw reports, full errors and permissions remain in **Details**, along
with the existing actions. No report parser, supervision rule, internal state or
Deck animation changes. Opening a row only opens the shared decision drawer; the visible drawer
marks it Seen, but never snoozes or answers without a press.

Crew has one scroll container, with Later and Done folded to counts. Board has
four columns: Needs you pinned first, In hand, Later and Done. Later and Done start
folded. Needs you can fold but keeps its amber count. The last three columns can
move. On compact layouts all four stack in one vertical scroll container.

The new `task-layout` host settings document has its own version 1, independent
of `display` version 1. It stores the summary/detailed choice, summary order/folds
and Crew's Later fold. Existing display settings are neither migrated nor rewritten;
saved `blocked` folds keep their original meaning. **Detailed columns** restores
the old eight-column layout for one release. Invalid or newer documents are not
reset; controls remain disabled with an explanatory notice. Initial rendering and
view restoration never write settings.

`client/task-presentation.test.ts` covers the column/report matrix with local,
remote, followed and absent workers, lifecycle notes, structural deferral, ledger
states, duplicate representations, outcome ordering and settings isolation.
`view-checks.mjs`, called by `render.mjs`, checks Crew and Board at 1440, 390 and
320 pixels, light/dark themes, enlarged text and compact density. It verifies global
decisions under filters, named keyboard actions, 44-point decision targets,
permission/error details, drawer focus return, drafts during worker moves, a
35-question queue, preserved scroll, summary fold/order persistence and legacy
layout restoration. Screenshots and `view-results.json` are CI artifacts on both
Windows and Ubuntu; they use synthetic host APIs, without installing or reloading
the plugin.
