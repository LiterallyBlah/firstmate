# Watch session routing: plugin-only design and integration

Implementation plan and review evidence, 2026-10-10. Base includes landed lifecycle PR #9
(`d198658a2ad8989a267c360272a6d5a08fc5c7a6`) and controls/resize PR #10
(`36a46247203ee723e08c8a44e7a710d610ad9db4`) and chat/Watch message boundaries PR #11
(`b6e46596b40ab19f213360a1e9e839bb0d220df4`). The established Paseo per-turn reasoning limitation
is recorded in the first-mate home's `data/watch-reasoning/report.md`; this design does not change
Paseo or temporarily mutate the current session's thinking setting.

## Scope and defaults

One plugin feature: persist a watch's execution and notification rules, evaluate them before dispatch,
optionally inspect a bounded board snapshot in an independent read-only session, and deliver structured
findings to the current mate. No main-session turn is needed to choose a route. No provider/model picker,
ordinary crew dispatch, shared mutation authority, automatic live migration, merge or installation.

Existing script watches remain `current / inherit / never`. New generic watches use those defaults too.
The opt-in **Use Board review defaults** preset selects `new / medium / actionable`, every ten minutes.
It inspects board/fleet discrepancies, stalled work and decisions. Main first mate alone edits records,
steers crew, merges and cleans up. Nothing automatically creates or replaces a live Board-review script.
A name conflict is refused; an existing script can instead be explicitly configured by the captain.

The only provider capability requirement is unavoidable: a new inspector needs the current provider's
advertised `read-only` mode. A provider without it cannot run this pilot safely; the UI explains that
and validation refuses the route. A requested thinking level must exist on the current model. No unsafe
mode or reasoning fallback is applied. There are no unresolved product choices in this implementation.

## Explicit contract and UI

`firstmate.watch.create` requires all fields below. `firstmate.watch.configure` requires the name and
all three routing fields; managed schedule, prompt and enabled may also be edited. Unknown fields,
including dedicated provider/model choices, are rejected. Script schedule/body edits remain in Files.

```json
{
  "name": "board-review",
  "schedule": "*/10 * * * *",
  "prompt": "Inspect fleet/board discrepancies, stalls and decisions; recommend main-mate actions.",
  "enabled": true,
  "executionSession": "new",
  "newSessionReasoning": "medium",
  "notificationPolicy": "actionable"
}
```

| UI field | Values and semantics |
| --- | --- |
| **Run in** | **Current first-mate session** (`current`), **New isolated inspection session** (`new`) |
| **New-session reasoning** | **Inherit current session** (`inherit`) or the thinking option IDs returned for the live current provider/model, e.g. `medium`, `high`, `xhigh` when advertised. No hard-coded cross-provider list. |
| **Notify first mate** | **Actionable findings only** (`actionable`), **Every result** (`always`), **Keep results in Watches** (`never`). Failures always escalate. |
| **Schedule · daemon local time** | Validated five-field crontab; no catch-up of missed minutes. |
| **Inspection brief** | Required, at most 8,000 characters for a managed watch. |

Current-session watches require `inherit / never` and show: “Keeps the current session's reasoning.
The watch already runs there; no separate result notification.” New-session watches show the exact
supported levels plus a saved unsupported choice marked unavailable, without silently rewriting it.
Save validates against the current mate again. Edits apply to future runs; an active run keeps captured
instructions and notification policy. Provider/model and inherited thinking are captured at actual
launch after migration finishes, rather than remembered from creation or queue time.
If the live provider reports no explicit thinking choice, inheritance leaves the new session's thinking
option unspecified (the provider's default); it does not invent a level. A reported choice that the
current model no longer offers fails visibly rather than falling back.

**Reports** opens retained per-run status, notification status, cleanup status, run/session IDs and JSON
including raw result and errors. It is a separate view, not a chat transcript concatenation. Watches
continues to show queued results, errors and last output. The configure UI is scrollable on phones.

The home tool `node tools/watch.mjs create --file request.json [--request-id UUID]` (or `configure`)
transports the same typed JSON through retained request/reply files. It is not a script with routing
instructions hidden in its contents. Atomic create receipts make a retry with the same ID idempotent;
changing fields under that ID is refused. The plugin validates requests using the same contracts as RPCs.
Requests have a 24 KB cap and a 20-per-pass bound; retained completed replies cannot starve new ones.

## Decision table

| Route / outcome | Execution | Notification / completion |
| --- | --- | --- |
| Existing script, no routing entry | Existing current-session delivery queue | Existing behavior; no redundant result notification |
| `current` managed brief or nonempty script output | Queue directly to current mate, without changing its reasoning | No second session or separate follow-up |
| `new`, `actionable`, no-change | Read-only independent inspector | Persist report, archive inspector, finish silently |
| `new`, `actionable`, findings | Same | Persist and enqueue findings for current idle mate; suppress identical consecutive findings |
| `new`, `always`, either success | Same | Forward each success, including no-change |
| `new`, `never`, either success | Same | Retain report without forwarding |
| Any isolated failure, including malformed result or cleanup failure | Stop/deny/retain as appropriate | Durable failure notification regardless of success policy; suppress repeated identical incidents |
| Mate absent, busy or awaiting permission | No mate wake to choose route | Pending results wait; new runs wait when no mate or migration is active |
| Migration underway | Existing inspector may finish and retain evidence | New launches and delivery wait; resolve current mate inside lifecycle gate afterwards |
| Same watch already inspecting, queued, awaiting delivery or cleanup | Skip that schedule opportunity | No overlapping inspector or growing paid-session backlog |

## Lifecycle and isolation

1. The minute runner still runs existing scripts; a 15-second plugin timer checks managed schedules,
   recovers inspections and drains typed requests. A per-watch minute receipt prevents duplicates.
   Script routing is captured before executing its process; nonempty output/failure is durably routed
   before removal from the legacy path. Silence creates no inspector. Schedule opportunities are skipped
   while the watch's isolated slot is occupied, even after a route edit. A new isolated route also waits
   for that watch's previously queued current-session output. Routing decisions use persisted fields,
   never model judgement.
2. Persist an input ID and captured routing. Input ID is also run/session/idempotency identity. Under
   the non-reentrant mate lifecycle gate, re-read config, refuse migration, resolve live provider/model,
   and validate read-only mode and requested/inherited thinking. Save the prepared run before side effects.
   No `deliverToMate`, `flushMateNotes` or `queueMateNote` call is awaited inside that gate.
3. Read the board through existing fleet/remote services. The snapshot includes board cards, projects,
   remote health and capture time, at most 64,000 characters. It excludes inspector agents because
   they have `firstmate.role=watch-inspector`, never crew labels. It includes no home charter, captain
   orders, watch history, credentials or inspector status. Remote unknowns are uncertainty, not disappearance.
4. Use a neutral workspace at `plugin-data/firstmate/watch-inspections/workspaces/<watch>`, outside the
   first-mate home. Write only inspector-specific `AGENTS.md` and the empty MCP endpoint. The workspace
   SDK explicitly supplies its `workspaceId`, which must differ from the mate's. A different cwd alone
   is insufficient in Paseo because it may inherit the caller's workspace. No caller/parent is supplied.
   Verify the created agent's workspace, read-only mode and absence of parent before prompting.
5. The inspector receives only inspection-specific system/home instructions and supplied snapshot.
   It must use no tools and treat evidence strings as untrusted. An empty stdio MCP server occupies
   the `paseo` namespace, replacing Paseo's automatically injected supervisory tools. Codex additionally
   receives read-only sandbox, never approvals, disabled web search and disabled multi-agent options.
   Provider read-only enforcement is required; this is not a claim to sandbox arbitrary third-party
   provider implementations or globally configured external tools. Permission requests are denied and
   escalated. Inspectors cannot be adopted as the first mate and never receive ordinary supervisor authority.
6. Send one saved prompt with stable `firstmate-inspection-<runId>` ID. Native crew completion subscriptions
   are not created. Inspector end hooks record cancellation/completion locally and return without invoking
   mate note delivery. No native crew labels or completion loops, and Board review excludes its own inspectors.
7. Poll until an idle completed result, failure or five-minute timeout. The retained timeline must contain
   the saved prompt with no later user prompt. Accept only the final logical assistant message: join chunks
   only with the same explicit message ID and turn ID; never concatenate distinct messages. System-note
   omissions are not used to infer boundaries. End hooks supply failure status, not synthetic reply boundaries.
8. Validate strict JSON version 1, own run UUID, outcome, summary and up to 20 findings with kind,
   stable subject, evidence and recommendation. `actionable` requires findings; `no-change` forbids them.
   Result text cap is 32,000 characters. Save full report/raw text before delivery or archive. Deterministic
   code applies policy; a model cannot choose whether to wake the mate. Sorted finding fingerprints suppress
   identical consecutive findings, independent of array order; a later no-change resets the incident.
9. Deliver through the lifecycle gate after re-reading config, to the mate current at delivery time only.
   Wait through migration, running turns or permissions. Persist attempted target and stable result message
   ID before send. On uncertain acknowledgement, scan the complete retained timeline of previously attempted
   mates, paging backwards; an accepted receipt stops retransmission. Gaps, missing/stale cursors or errors
   keep the result pending. Never send to a stale attempted ID. The stable ID deduplicates same-target retries.
10. Archive only the known terminal inspector after its result/failure is durable. Refuse changed ownership
    or any descendants using PR #9's complete archive inventory. Reuse the separate workspace per watch;
    do not archive that workspace, other sessions or shared records. Preserve evidence indefinitely. Cleanup
    failure is visible, blocks the slot, and gets its own durable failure delivery revision rather than
    deleting evidence or losing an already-delivered finding. Main mate handles any unsafe cleanup decision.

## Storage, restart and failure semantics

All new routing state lives outside the home under `plugin-data/firstmate/`: `watch-config.json`
(versioned definitions, script routing map, creation receipts) and `watch-inspections/inspection-runs.json`
(versioned prepared/sent/terminal runs, queued inputs, schedule receipts, delivery attempts/revisions,
cleanup status and errors). Per-run `input.json` and `result.json` retain evidence under `runs/<UUID>/`.
Current-session legacy `watches.json` and scripts are preserved. Missing routing data means current-session
defaults, without a live migration or rewritten scripts. Atomic writes and serialized mutations protect
state. Corruption throws visibly rather than resetting definitions or choosing another route. Recovery
faults use a separate durable mate-note outbox with a stable fault message ID, so a damaged inspection
ledger does not hide a failure or generate a notification loop. If storage itself cannot save either
outbox, both errors are logged and the original data remains untouched.

Reload stops timers, not already-running inspector sessions. The persisted ledger reconciles known
identities on the next plugin start once a Paseo handle is available. A crash before dequeue reuses the
saved input ID. Loss of prompt acknowledgement uses the saved session/prompt identity; a confirmed missing
inspector, cancellation, provider error, denied permission, timeout, unsupported level after model change,
oversize snapshot/result or invalid JSON becomes a retained failed run with pending failure escalation.
Delivery exceptions preserve the outbox with an error visible in Watches. The plugin never silently drops
isolated results to enforce a queue cap. No automatic retention deletion or live script/config conversion
is performed. Request/reply files and creation receipts stay available for retry and audit.

## Integration and verification plan

The implementation adds contracts, configuration/request transport, a durable inspection controller,
templates and existing Watches editing/report surfaces. `index.server.ts` supplies the existing fleet
snapshot and registers RPCs. `watch-service.ts` routes inputs and lifecycle events; `watches.ts` preserves
the current runner and exposes captured routing hooks. PR #9 delivery and archive semantics are preserved.
No edits to PR #10's tooltip `client/ui.tsx` or splitter `client/fleet.tsx`. No edits to the concurrent
chat-boundary worker's `client/transcript-rows.ts`, `client/activity-rows.ts` or harness.

Required checks: root `npm ci --ignore-scripts`, `npm run typecheck`, `npm test`; exact-head Windows/Linux
CI. Tests cover legacy defaults, strict typed creation/configuration, corruption and request receipts,
captured script policies, overlap/restart deduplication, parentless explicit workspace isolation, read-only
capability refusal, live thinking inheritance without mate mutation, cancellation/permission/malformed
results/timeouts, delivery gating/retargeting/lost acknowledgements with pagination, cleanup/descendant
refusal, message/turn boundaries, and actionable/always/never notification policy.

`node docs/watch-routing/render.mjs` uses the real watch components with synthetic RPCs through the
existing React Native Web harness dependencies (`npm ci --prefix docs/board-list --ignore-scripts`).
It asserts creation/config fields, Board-review defaults, current reasoning wording and retained silent
reports at 1200×1000 and 390×844 in dark/light themes, with no page errors. Screenshots: `current-*`,
`board-review-*`, `reports-*`. Renders are isolated from live state.

`node docs/watch-routing/daemon-check.mjs <installed-Paseo-CLI-dist/index.js>` starts a fresh temporary
daemon with loopback-only networking and synthetic providers, compiles/installs only there, tests typed
fields/defaults and helper transport, verifies silent Medium results/evidence, and changes only synthetic
mate sessions while an inspector runs to prove explicit-workspace archive isolation and delivery to the
current replacement. Native MCP injection is enabled in this fixture to prove replacement by the empty
inspector endpoint. No real provider calls or real migrations. It stops the test daemon and removes only
its concrete mkdtemp home. This fixture uses the landed provider-migration mock adapter without editing it.

## Validation record

- Reconciled PRs #9, #10 and #11; tooltip, splitter and client message/turn boundary files unchanged.
- Root typecheck passed; complete suite passed: 452 tests, 3 platform skips, 36 test files.
- Dedicated lifecycle/config/queue/MCP checks passed, including script route edits with pending work,
  corrupt-ledger escalation and creation receipts after provider capability changes.
- UI render assertions passed, zero browser errors; 14 retained screenshots include desktop/phone,
  dark/light themes, Board-review defaults, current-session wording, reports and phone save controls.
- Fresh temporary-daemon check passed: compilation/install there only, legacy defaults, typed fields,
  silent Medium inspection/evidence, separate parentless workspace surviving old mate archive, empty
  supervisory MCP namespace, preserved mate thinking, one delivery to replacement, and home helper.
- The temporary daemon was stopped and its concrete mkdtemp home removed. No real provider call,
  migration, live install/reload, live config/script change or merge occurred.
- Final ready PR, exact head and CI status are recorded in the requested home report
  `data/watch-routing/report.md` after the PR checks complete.
