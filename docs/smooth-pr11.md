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

Implementation and verification are pending.
