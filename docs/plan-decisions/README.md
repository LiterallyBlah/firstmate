# Plan decisions in Needs you

Due workflow decisions join the same presentation queue as backlog decisions. The drawer shows the
decision's own title, question, recommendation and current options, plus its optional `data/<task>/decision.md`.
Only `firstmate.workflow.act` records a plan answer; its revision, subject hash, idempotency handling
and saved first-mate note remain the existing plan path. The drawer refreshes and advances to the
next unanswered item, or closes when none remain. Backlog answers return a ledger-only snapshot;
the drawer rereads the combined snapshot before advancing so a remaining plan decision cannot be
lost. No plan decision enters the backlog decision ledger. Refusals survive a refreshed plan card,
and the waiting clock starts at committed readiness rather than the plan request's creation date.
Each dependency condition keeps its first-ready timestamp: a later landing preserves an earlier
done-based wait. Renewed verification and changed decision dependencies restart the waiting clock.
All hides worker-absence text when no worker inventory was supplied.

Stale/offline warnings stay above the cards. Otherwise All begins with Waiting for you, using the
same card style for plan and backlog decisions, then plan review and a collapsed Coming up line. Expanded future
items show their own short title and a plain waiting reason; opening the plan reveals full detail.
List and Board reuse `DecisionTask` for plan decisions and omit Coming up, leaving future decisions
to the drawer and Plans. The server's due-only count is unchanged.

Run the browser fixture after installing the repository and `docs/board-list` dependencies:

```sh
node docs/plan-decisions/render.mjs
```

It adapts the existing Plans-view and Needs-you harnesses. Real drawer/List/Board components run
against invented host data, with the baseline loaded from `cf3c914d4854f6e20b74b721f031f0a3956430ea`.
Needs you opens with one due plan decision: before the change, the drawer has only a plan link for
it; after, it has an answerable card. All, List and Board contain a legacy decision as well.

The fixture checks 32 before/after cases: Needs you, All, List and Board in day/night at 1440 and
390 pixels. It also captures expanded Coming up, exercises List/Board → Answer, records a plan
action, advances to a backlog decision and answers that through its original transport. All also
answers the backlog decision first using a ledger-only answer response, then advances to the plan
card. The fixture checks visible text order and prefixed `Review plan: …` links, as well as the
absence of repeated plan titles after expansion. Browser errors, horizontal overflow, duplicate
review links, cards below Coming up, and incorrect counts fail the fixture.
Evidence is written only under ignored `.local/plan-decisions/`; no images are committed. These are
browser fixtures, not an installed-plugin or native-device test.
