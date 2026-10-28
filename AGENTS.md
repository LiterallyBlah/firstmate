# AGENTS.md

A Paseo plugin that adds a **FirstMate** screen: a conversation with one "first mate" agent
beside a board of the "crew" of agents it runs, each in its own git worktree. A Paseo-native port of
[kunchenguid/firstmate](https://github.com/kunchenguid/firstmate) — the agent distro — by way of
[ABorakati/paseo-firstmate](https://github.com/ABorakati/paseo-firstmate), which was a dashboard over
that distro's bash scripts and does not install on Paseo 0.9.

The repo root `AGENTS.md` covers what every plugin here shares: the per-folder npm layout, the
typecheck/reload loop, the client/server bundle split, and the constraints nothing catches at
compile time. This file covers only what is specific to `firstmate`.

## Orientation

Plans (workflows slice 1) are additive. `shared/workflow-plans.ts` owns strict one-step `task@1` and
`scout@1` contracts, dependency reasons, bounds and posture. `server/workflow-plans.ts` owns the
hash-linked, exclusive-link event log under `workflow-plans/`, revisions, start intents, projections
and read-only agenda. `server/workflow-service.ts` consumes the home tool's idempotent request files
under the role/lifecycle lock. `templates/tools/workflow.mjs` is transport only; `data/workflows.md`
documents commands. The first mate still makes every local worker call. No executor is installed.
`launch.mjs` records an implicit start before exposing a launch, and pins/claims explicit starts once.
An abandoned or archived attempt needs deliberate replanning; preparing the same task cannot reset
its one-run budget. The existing role check is a behavioral guard, not authenticated filesystem IPC.
Never treat arbitrary request-file identity as an independent security boundary.

Backlog `(plan:)`, `(needed-by:)` and comma-separated `(blocked-by:)` are optional. Keep the lenient
parser and strict Needs-you observation in step. The shipped `data/backlog-lint.js` calls the same
daemon observer through the workflow transport; it cannot silently diverge. Legacy blocker prose
remains opaque and valid. Only recognized ID lists populate `blockedByIds`.
The agenda's outcome observations remain the first mate's job until slice 4. A worker status line
cannot finish a run. Completion records must describe verified report/PR/head evidence.
Ship done is deliverable-ready; landing or an explicit evidence-only `close` receipt enters Done. Stores are namespaced by absolute home
identity, with separate expected-tip/publication records and per-plan quarantine. These are local
copies, not an independent trusted backup: coordinated loss of a log and all its metadata can hide
truncation. New publication markers detect losing an exposed event and its tip together. Only an
unpublished final anchor can be dropped automatically under the mutation lock, after validating the
prefix and checking launch records for unknown attempts; an append-only recovery receipt records it
in history. Old anchors without publication metadata still require deliberate reconciliation.
Publication records also retain checked task/host ownership capsules, attempts and budget. Quarantine
holds only conflicting scopes; non-plan names are reported warnings. `workflow.mjs retire` requires
the current mate and inspected-file fingerprint, appends evidence without changing damaged files,
and permanently retains the plan id, attempts, budget and scoped reservations. Legacy missing
ownership metadata cannot identify unknown lost tasks; restore a backup rather than guessing.
Reads cache event-file identity; finished implicit plans leave the agenda. Removal tombstones reconcile scoped backlog
rows. Explicit release, invalidate/validate and replace transitions preserve history and cumulative
budget; manual replacement/promotion keeps the workspace and task identity. Legacy unscoped logs
and missing anchors require deliberate reconciliation, never an automatic budget reset.

Slice 2 adds `shared/workflow-rpc.ts`, `server/workflow-board.ts` and `client/workflow-plans.tsx`.
The dialog's captain action carries the plan revision and subject hash (including prior captain
actions), and the store rechecks them under the same serialization/publication boundary. No view,
filter or dismissal writes approval. Edits affect unstarted nodes only; removing a prerequisite holds
its dependents. A saved note outbox wakes the mate between turns and survives reloads. Plan approval
is never merge/deploy authority. `withWorkflowNeeds` adds due plan actions and a separate Coming up
array; Coming up never enters any count. A disabled legacy detector reports plan actions as a lower
bound (`1+`, plans only), never a fresh complete count. `withWorkflowCards` draws pending runs while
the backlog catches up, with no invented agent identity. Deck continues to use real workers only.
The visual fixture `node docs/workflows/render.mjs` writes exclusively to `.local/workflows/`.
`shared/plan-decisions.ts` adapts due plan needs into the shared presentation queue without writing
backlog-ledger requests. The drawer, List and Board reuse `DecisionTask`; a plan answer uses only
`firstmate.workflow.act` with the displayed revision and subject hash, then rereads Needs you before
advancing or closing. Backlog answer responses are ledger-only: the drawer rereads the combined
snapshot before navigating and keeps a confirmed answer disabled if that read fails. Optional plan briefs use the same confined reader, ambiguity checks and shared
512 KiB snapshot budget. Plan approvals remain separate. All puts waiting cards before plan review
and the collapsed Coming up line; expanded future rows show only their own title and a plain waiting
reason, opening Plans for details. Warnings remain above the cards, both kinds use the same All-card
style, and plan refusal notices survive a changed-subject remount. Waiting time comes from committed
decision introduction and the first time each dependency condition was met, not the authored
request date. Landing preserves an earlier done time; renewed verification or changed decision
dependencies restart the clock. These optional projection fields are rebuilt on ledger replay.
All omits worker-absence claims when it has no fleet inventory. List/Board omit Coming up entirely. `node docs/plan-decisions/render.mjs`
compares all four views against its pinned baseline in both themes and desktop/phone browser widths;
renders and checks stay in ignored `.local/plan-decisions/`.
Plan actions retain author provenance: a captain press and a mate-recorded chat action are distinct.
Subject/revision checks run at append, never against a changing historical projection on replay.
Fleet/Needs-you/Bearings isolate plan failures and label incomplete counts. Decision projections,
card chips and filters require the explicit plan association plus host/project/task scope.
The posture reader consumes only `plan-posture` in a fenced `standing-orders` block at draft/revise;
request quotes override it, unreadable/absent blocks use D2, and invalid entries require review.

Home's Plans destination is `homePane: "plans"`, alongside List/Board, Home files and Deck on wide
and compact layouts. `client/workflow-plan-browser.tsx` consumes WorkflowSurface's existing
`readWorkflowPlans` snapshot and opens its existing dialog; searching, folding and paging never
act on a plan. `shared/workflow-plan-summary.ts` (re-exported by `client/workflow-plan-list.ts`) owns open/finished grouping, completion ordering,
displayed run states and cumulative budget usage (including removed runs, without recounting
prior attempts). Open plans precede finished history; automatic one-run plans have counted folds,
expanded for matching searches or awaiting approval, with ten rows per page. The same snapshot
now retains completed implicit history; agenda, due counts, Bearings and task-card rules stay unchanged.
Plans also has the fixed workspace destination `firstmate-plans` (`ListTodo`), sharing this browser,
snapshot and dialog. Each plan starts collapsed with progress, current/next work, unmet dependencies
and captain decisions. Attention names unresolved, invalidated, failed, held and awaiting-landing
steps; troubled reviews stay grouped under their build in both the browser and Bearings.
Expanded steps fold a named scout review into its single evidence-linked
build; ambiguous reviews and standalone probes remain independent. Dependency labels require the
recorded done/landed/answered outcome and refuse held, invalidated or missing evidence. Worker/host
details appear only while running. Automatic one-run copies are hidden before search by exact task,
project and normalized host identity, only while planned or when the owner records its own state
beyond planned. Live or completed automatic work with a merely planned/missing owner stays visible.
These display rules do not change durable plans or actions.
Expanded Plans now default to the read-only Graph, with the existing List behind a segmented toggle.
`client/workflow-plan-graph.ts` computes longest-path levels over every local node and its external
ancestors, preserving dependency reason/outcome and routing long edges outside the cards. The graph
separates source exit heights, long-edge arrival heights and target ports to avoid false shared buses.
Level labels sit in the right half of a card's header, away from the left-half incoming ports, and
count independent steps rather than claiming landed/external work can run now. Removed prerequisites
keep their retained title and a removed label; their historical edges are not current routes.
The graph shows reviews as independent nodes; only List folds them into build chips. `workflow-plan-graph-view.tsx`
uses native primitives and the host Modal for details, with the existing open-plan handler. Same-level
nodes have no dependency path and are labelled parallel, conditional on prerequisites/approval;
missing prerequisites suppress that claim. Cycles, more than 60 nodes (including external ancestors),
or more than 120 edges offer List instead. No graph interaction records an action.
`node docs/plans-graph/render.mjs` checks both themes and desktop/phone browser widths against the
previous list, using the existing plans-panel fixtures. Evidence stays in ignored `.local/plans-graph/`.
Bearings uses the same pure summary: one bounded line per open plan and per due/upcoming decision,
without step lists, review rows or finished history. `shared/bearings.ts` wraps it in an owned, strict
`firstmate-bearings` envelope. Home/Chat preserve the captain's request and reuse `MachineNoteDetails`,
the native watch-note disclosure, collapsed by default. Native chat uses the same parser and renderer.
Pasted, partial, nested or trailing-text envelopes stay visible. The mate receives the full compact overview.
The explicit workflow `close` transition requires the current verified done ship attempt, expected
plan hash and evidence that this trial has nothing to land. Its `closedWithoutLanding` receipt retains
the outcome, report, identities and spent budget. Pending landing dependents, including retained
declined plans, must be replanned first, matching global validation. Close refuses an incomplete
dependency inventory while any unretired plan is quarantined; repair or explicitly retire it first.
Future landing prerequisites cannot name a closed trial. It satisfies done, never landed. History,
backlog/card projections and the plan dialog label it closed without landing, without dispatch or cleanup.
`node docs/plans-panel/render.mjs` checks registered panels, both layouts and compact real-shaped
Starpath/reader-pass plans against the previous flat browser. Evidence lives only in ignored `.local/plans-panel/`.
`node docs/plans-view/render.mjs` adapts the existing workflow render harness for before/after
Home checks in both themes and widths, writing only to `.local/plans-view/`.
Approve, approve-with-edits and request-changes require `planAwaitingReview` in both the dialog and
the store's append handler. Active/held plans remain browsable with decision and lifecycle controls;
an open review form disappears if review ends. The status guard follows request-id replay and
revision/subject checks, and never runs during ledger replay, preserving previously accepted history.

S07 history import and single-writer cutover (`docs/scoped-supervision/S07.md`) is disabled and
unwired. `server/supervision-gate.ts` is the one cutover gate for every plugin-owned legacy delivery:
`queuePlanNotes`, `queueMateNote`, burst queue/extend, `flushMateNotes`, decision-answer send, watch
enqueue/flush and the watch-runtime note all check it before touching a queue, and every armed send
persists a claim before the network call and its result before removal. Unarmed it writes nothing.
`server/supervision-migrate.ts` freezes one plan under the gate and the legacy writer's lock, imports
its chain byte-for-byte with one disposition per affected delivery, commits transfer mappings before
compare-by-ID/payload removal, and activates the scoped backend only after barrier and committed
sidecars. Holds (decision answers, opaque watch rows, live worker callbacks, crashed claims) never
resend; they move only by explicit evidence, answer holds by the captain. Anything new for a frozen plan
is re-inventoried as a hold, never a terminal stray. A capacity preflight runs before the freeze, a
fresh Needs-you ledger is required, and `abort` releases a prepared cutover back to legacy, restoring
archived entries exactly. Commit imports attempt rows (`importedFrom`) so scoped worker guards see
migrated workers. Legacy `.scoped/<plan>/` sidecars refuse the old writer; a committed scoped backend
refuses it too. Keep every new legacy delivery path (including crew actions and item discussions)
behind this gate.
S08 (`docs/scoped-supervision/S08.md`) adds disabled source adapters in `server/supervision-sources.ts`:
versioned PR head/check/review observations with explicit `source-binding` owners and reread-before-admission
readiness, remote catalog fingerprints (inferred, never complete coverage) and persisted scoped `board-submission`
steers correlated by clientMessageId. Only refusal guards are wired: scoped workers' item discussions and remote
mutations are refused. pr-watch's typed spool is opt-in (`FIRSTMATE_PR_OBSERVATIONS=1`); default output is unchanged.
Dedupe is per source against its latest observation, and every content change in a stream is a new transition.
A full spool fails the run without moving the baseline. Board correlation pages the typed timeline and records gaps.
S08 writes stop at journal sequence 128, reserving the rest for effects and reconciliation.
S09 (`docs/scoped-supervision/S09.md`) adds disabled project context and cross-project coordination: admitted projects
with captain-set allocations, one sponsor per plan scope with all-or-none per-project budget claims (FIFO within
priority, never borrowed), one owner per captain intake, qualified resolutions attached to unchanged bare cross-plan
edges, CAS project memory and portfolio conflict records. Memory and these records are context only. `checkPolicy`
refuses citing them. A project stop writes S03-shaped operation holds on its plan scopes and cancels their reserved
effects, so the gateway and supervisor sessions refuse its pending starts. Cross-project choices are owned by General,
one-project choices by the project. `portfolioSummary` is a pure read. Nothing is wired, and Bearings is unchanged.
S09 writes stop at sequence 192; releases, stops and resolutions stay available for rollback.
S10 (`docs/scoped-supervision/S10.md`) adds disabled resources, maintenance jobs and D5 option 1 daily occurrences:
all-or-none advisory reservations over sorted keys (FIFO within priority, monotonic fences, expiry only suspect,
release only on matching terminal evidence), occurrences keyed by job/IANA zone/local date with one missed-day
observation, per-host passes with a write-ahead item ledger (interrupted items become uncertain and are never
reapplied), one incident per job/host/kind, and a read-only timer disposition inventory. No executor ships; healthy
results and unchanged failures wake nobody, and General reads `maintenanceSummary`. Cleanup is bounded by path
segment and retained-path containment. S10 admissions stop at 160, closures at 192; settlement always continues.
S11 (`docs/scoped-supervision/S11.md`) follows D6's conservative amendment: U1–U3 are not delivered or assumed.
`server/supervision-capabilities.ts` keeps the S00 strong rows and refuses every strong capability (`UNSUPPORTED`,
never a cooperative fallback) unless its flag, an S00-supported version column and a live `StrongQualification` all
hold; none ships, versions match S00's exact inspected releases, and failover, takeover and `fullAccessConfinement` are
always false. `server/supervision-receivers.ts` holds the U1–U3
adapter shapes, refusing any receiver for a capability not enabled. `server/supervision-cooperative.ts` is a pure
read: a scope is ready for cooperative rollout only when every named S01/S03/S04/S07/S08/S09/S10 dependency holds,
including exactly one active, verified supervisor binding (no binding is no owner), and no uncertainty, unaccounted
callback owner, unfinished cutover, suspect reservation, unsettled host pass, open incident or reached journal band.
`SupervisorSessions.attach` is the only way an S07-committed scope gets its first supervisor: explicit, captain only,
never over an existing binding. A binding counts only once its epoch's opening has succeeded.
It writes nothing and never claims fleet-wide relief. R10's E1–E3 and realpath (`resolveCleanupAliases`) are fixed in
`planCleanup`; `executorApproval` also needs a no-follow-deleting executor, a non-empty reader run artifact for the
installed version, listed by digest in `REVIEWED_READER_RUNS` (the S11 smoke run is only partial) and N7/receiver acknowledgements.

| File                          | What it owns                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| `index.server.ts`             | Wiring — the RPCs, the display settings document, the steer relay hook.                    |
| `index.client.tsx`            | Wiring — the screen, sidebar item, two panels, settings screen, ⌘K items, `/fm` `/bearings` `/ahoy`. |
| `shared/supervision-migration.ts`, `server/supervision-gate.ts`, `server/supervision-migrate.ts` | S07: migration/disposition records, the legacy delivery cutover gate, and the disabled per-scope importer. |
| `shared/supervision-projects.ts`, `server/supervision-project-state.ts`, `server/supervision-projects.ts`, `server/supervision-memory.ts` | S09: project/sponsor/intent/dependency/memory/conflict records, their journal row checks, the disabled coordination and memory commands, and the pure portfolio summary. |
| `shared/supervision-maintenance.ts`, `server/supervision-maintenance-state.ts`, `server/supervision-resources.ts`, `server/supervision-jobs.ts` | S10: reservation/job/occurrence/host-pass/incident records and their journal checks, the disabled arbitration and D5 scheduler, cleanup planning and the timer inventory. |
| `server/supervision-capabilities.ts`, `server/supervision-capability-evidence.ts`, `server/supervision-receivers.ts`, `server/supervision-cooperative.ts` | S11: the strong-capability gate over the S00 rows and executor-approval conditions, the frozen committed evidence it reads (no caller-supplied table or reader list), the U1–U3 receiver seams, and cooperative scope readiness. Unwired. |
| `shared/fleet.ts`             | Every RPC contract, the card/fleet shapes, the daemon config shape, and `CREW_LABELS`.     |
| `shared/settings.ts`          | The host settings document: List/Board, column order and folds, the chat's width, the poll interval, card spacing. |
| `templates/`                  | **Every file the plugin writes into the home**, as Markdown laid out as it lands there, and the parts that go inside them. The first mate's behaviour is `templates/data/charter.md`. |
| `server/templates.ts`         | Finds `templates/` — through `paseo plugin ls`, since the compiled plugin cannot say where it lives — and reads it. |
| `server/charter.ts`           | Renders `AGENTS.md`: the charter's placeholders filled, under its heading note.            |
| `server/charter-file.ts`      | `data/charter.md`, the captain's copy it is rendered from: follows the plugin until edited. |
| `server/home.ts`              | The home directory: writes the charter and records, reads the backlog and project registry. |
| `server/backlog.ts`           | `data/backlog.md` → `BacklogItem[]`. Lenient, because an agent writes the file.            |
| `server/suggestions.ts`       | `data/suggestions.md` → `Suggestion[]`, the board's next-step buttons, and taking one out. Lenient, likewise. |
| `server/crew-report.ts`       | A crewmate's closing status line (`done: PR …`) → state and text.                          |
| `server/fleet.ts`             | The board: first mate, crew by label, backlog, status lines → cards in columns.            |
| `server/remote-cards.ts`      | Remote work as cards: a backlog line's host resolved, joined to its worker, filed by the same rules. Pure. |
| `server/remote-crew.ts`, `shared/remote-crew.ts` | A remote card's Steer, Interrupt, End and its Converse log, through `RemoteService.request`. |
| `server/remotes.ts`, `shared/remotes.ts` | Saved remote hosts: the daemon-side connections, the minute poll, the helper's request queue. |
| `server/mate.ts`              | Launching, adopting and releasing the first mate; carrying the captain's words to it.      |
| `server/crew.ts`              | Steer, interrupt, end, relaunch one crewmate; the relay that tells the first mate about a steer. |
| `server/supervision-sources.ts`, `server/supervision-source-state.ts`, `shared/supervision-sources.ts` | S08 PR/remote/board observation adapters and their journal row checks. Unwired; see `docs/scoped-supervision/S08.md`. |
| `server/crew-seen.ts`         | Clears a crewmate's "finished" flag once a later first-mate turn has completed.            |
| `server/watches.ts`           | The watch runner: the minute timer, runs, the queue, `<firstmate-watch>` notes, `watches.json`. |
| `server/watch-service.ts`     | The runner wired to Paseo: the kept Paseo handle, delivery to the first mate, the on/off switch. |
| `server/watch-files.ts`       | `watches/`: which files are watches, their `schedule:` line, seeding the built-ins.        |
| `server/watch-schedule.ts`    | A crontab line → `Schedule`, and whether a local minute matches it. Pure.                  |
| `server/watch-run.ts`         | One script run: its own process group, a timeout, stdout capped, stderr's tail.           |
| `server/process-launch.ts`    | Windows desktop/npm CLI entry points and native Node watch launches, without a shell.   |
| `server/send.ts`              | Sending to an agent without interrupting its turn where the provider allows (`"steer"`), and each send's receipt. |
| `server/receipts.ts`          | The receipt journal behind `FIRSTMATE_RECEIPT_JOURNAL` (off by default): hash-linked entries, the generation and record ledgers. |
| `server/receipt-observers.ts`, `shared/receipts.ts` | What the journal observes — the first mate's tool calls, uncertain native finishes — and the read-only timeline-page RPC. |
| `server/attention.ts`, `attention-projection.ts`, `attention-report.ts`, `shared/attention.ts` | Opt-in 14-day attention timing: detached hook/catalog observations, existing fleet states, and the read-only JSONL report. See `docs/attention-observation.md`. |
| `shared/needs-you.ts`, `server/needs-you-*.ts`, `server/decision-answer.ts` | Captain-decision foundation: strict backlog observation, per-home ledger, disabled outbox, background service and revision-bound RPCs. Observation defaults on; `FIRSTMATE_NEEDS_YOU=0` disables it. Answers reserve durably before the existing mate send. See `docs/needs-you-foundation.md`. |
| `client/needs-you*.ts*`, `client/decision-*.tsx` | Shared server-count indicator and decision drawer, explicit acknowledgements/snoozes/answers, quiet batch toast state and `useOpenDecision` for view consumers. See `docs/needs-you/README.md`. |
| `shared/deck-setting.ts`      | A deck setting pack's format, `firstmate.deck-setting` 1: the manifest's schema, every reference it must resolve (`settingProblems`), the closed, versioned behaviour catalogue (`ENGINE_CAPABILITIES`) and what a pack uses. Server and tests only. |
| `shared/deck-rpc.ts`, `server/deck-settings.ts` | What the Deck needs from the daemon: `firstmate.deck.engine` serving `vendor/pixi.min.js`, `firstmate.deck.settings` listing the packs under `art/settings/` (and which this engine can draw), `firstmate.deck.setting` serving one whole — manifest and images — confined to its folder and capped. |
| `client/deck-setting.ts`, `deck-setting-query.ts`, `deck-setting-view.tsx` | Global selection: the fleet resolver, shared installed-pack metadata, fallback notice and one resolved id passed into the engine. Pack-owned presentation words travel with the drawing. |
| `test/deck-legacy.ts`, `test/deck-legacy-schema.ts` | Historical art manifest adapters and schemas, used only by regression tests; excluded from the shipped package. |
| `client/ship-deck.tsx`        | The Deck pane: the canvas's view, its status in words, the hovered sailor's label, the focused sailor's panel and keys, the legend of badges and counts. |
| `client/deck-camera.ts`       | The camera: the exact fit or a shot closed in on a focused sailor, the eased zoom between, where the focus panel goes; what a click or an arrow does to the focus. Pure. |
| `client/deck-badges.ts`       | Each state's pixel badge over a sailor's head and in the legend; its ink; an idle sailor's z; the reply marker's pixels and bob. Pure. |
| `client/deck-hover.ts`        | The sailor under the pointer, by the box it is drawn in; canvas ↔ deck coordinates; where its label goes; where each reply marker hangs (`askMarks`). Pure. |
| `client/deck-replies.ts`      | Which suggestions are a sailor's replies (`cardReplies`), the replies already picked (`answeredReplies`), where the speech bubble hangs. Pure but for that store. |
| `client/reply-bubble.tsx`     | Shared shark/Needs-you popover chrome, the first mate's count-only bubble and the worker focus panel's replies. |
| `client/deck-stage.ts`        | A setting's stage compiled from its pack: size and fit box, the floor, the zones each state sends a worker to, the entry, the exits' marks, the props, the pieces' rows, the veil and stale tint. Pure, per pack. |
| `client/deck-parts.ts`        | A setting's stage furniture compiled from its pack: the parts drawn (fallbacks and needs resolved, as the ambience's), the backdrop's cutout, the pieces and what stands in for one, the lights — and the bob, sway, duty cycle and flicker as functions of a clock. Pure, per pack. |
| `client/deck-cast.ts`         | A setting's cast compiled from its pack: each lane's poses and feet, the looks and who wears which (`lookFor`, by agent id), the roles — stand, walk cycles, each state's settled pose and mirroring — each state's fidget keyframes and the at-ease breath. Pure, per pack. |
| `client/deck-scene.ts`        | Cards → sailors, by column, greyed when their feed is lost, each with its hover caption; the depth order of everything on deck; whether the screen offers the Deck. Pure. |
| `client/deck-geometry.ts`     | Any setting's floor (`createFloor`): walkable areas and obstacles, A* paths, a spot beside a shared post, a place packed into a zone's overflow. Pure; its caches are per floor. |
| `client/deck-crew.ts`         | The crew in motion, on its setting's stage and in its cast: posts reserved, the state shown at once and walked to after, the hatch, the queue for the plank and each departure's clock, each frame's pose, fidget and breath. Pure. |
| `client/deck-choreography.ts` | A pack's finite departure timelines: segments, events, paths, cropped poses, named effect anchors and depth. Pure. |
| `client/deck-atmosphere.ts`   | Engine-owned intensity → the pack's compiled table of named channels and clocks (`compileAtmosphere`); calm values under reduced motion. Pure. |
| `client/deck-ambience.ts`     | A setting's ambience compiled from its pack: which elements are drawn — each left out on its own when its images did not arrive, with what is drawn in it or under it, a fallback only in its source's place (and named for it), a tile with neither filled flat, variants and drifters a sprite at a time — and how each moves on a lite or still deck (`elementMotion`). Pure, per pack. |
| `client/deck-variants.ts`     | The weather layers' arithmetic: curves over intensity, how an element shares its place with its variants, which frame of a looping set shows. Pure. |
| `client/deck-flash.ts`        | Moments of weather (`flash@1`, the ship's lightning): seeded flashes at a rate from data, capped; where one stands under a drifter. Pure. |
| `client/deck-precip.ts`, `client/deck-precip-view.ts` | `precip@1`: seeded individual rain drops across the pane, kind interpolation, gusts and optional splashes; three depth layers and a shared 1,500-particle cap. Lite freezes and caches the field; still hides it. |
| `client/deck-ambient.ts`      | The motion plan, and when and where a flyby flies (`flybysAt`), as a function of the clock. Pure. |
| `client/deck-sky.ts`          | The pack's day by the local time (`dayBlend`), a backdrop's place behind the stage (`backdropPlacement`), and a strip's scroll. Pure. |
| `client/deck-environment.ts`  | The scenery drawn with Pixi: every element of the setting's ambience — backdrop cycles, overlays, flashes, drifters, flybys, tiles, strips, cycles — in its slot in the pack's order, each under its variants; a tile with no art filled flat. |
| `client/deck-clouds.ts`       | Drifters (`drifters@1`, the ship's clouds): the seeded field in the pack's lanes above a backdrop's horizon, each one's whole-pixel drift and off-screen wrap, its colours from the day's blend, a sprite cut into slot masks. Pure. |
| `client/deck-loop.ts`         | When the deck draws: 30 fps at most, paused while hidden, still under reduced motion.     |
| `client/deck-mount.ts`        | The canvas put into a react-native-web view; WebGL probed; Pixi's served build evaluated; the pack decoded, its drifters cut into masks, its stage, cast and ambience compiled (`packArt`); every failure a status. |
| `client/deck-pixi.ts`         | The deck — the backdrop cut round its parts, the parts, pieces, props, lights and sailor sprites, and the sea's layer of sharks and splashes — drawn with Pixi, handed in through a narrow `PixiModule`. |
| `art/settings/<id>/`, `docs/ship-deck-art/`, `docs/settings/` | The setting packs as shipped — each a `setting.json` and only the PNGs it names; the ship is `art/settings/ship/` — and, unshipped, everything that made the ship's art (sources, prompts, provenance, reviews, `build-art.py`, the old manifests in `legacy/`) and its pack (`docs/settings/ship/from-legacy.mjs`). |
| `test/deck-settings.test.ts`, `test/ship-pack.ts`, `test/png.ts` | The pack linter, run over every pack under `art/settings/`; the ship's pack read for the tests; enough of PNG for both. |
| `shared/attachments.ts`       | What the captain can attach: the message's shape, image-or-file by Paseo's rules, the size cap. |
| `server/uploads.ts`           | An attached file written to `$PASEO_HOME/uploads/`, described as Paseo's `uploaded_file`.     |
| `server/cli.ts`               | `paseo stop` and `paseo project rename`, for what the SDK does not have.                   |
| `server/home-name.ts`         | Names the home's project and workspace "FirstMate" instead of the folder's "home".         |
| `server/daemon-session.ts`    | One raw session request over the plugin's channel: clearing an agent's attention.          |
| `server/config.ts`            | `$PASEO_HOME/plugin-data/firstmate/config.json`, read on every call; the default home.     |
| `server/data-dir.ts`          | `$PASEO_HOME/plugin-data/firstmate/`, and moving the plugin's files out of `plugins/`.     |
| `server/serialize.ts`         | Runs the config update and each home file's save one at a time, per file.                  |
| `server/host-types.ts`        | Paseo types projected out of `@getpaseo/plugin`; see the root AGENTS.md.                    |
| `client/fleet.tsx`            | The screen: header, banners, chat/board split, compact tabs, the shared fleet query.       |
| `client/workspace-panels.tsx`, `shell.ts`, `hub-launcher.tsx` | Home registration, the Deck/Board/Crew/Chat/Plans workspace destinations and Home's jump-shortcuts. |
| `client/fleet-query.ts`       | The shared fleet request and cache, used by Home, workspace panels and the sidebar.       |
| `shared/native-tools.ts`, `server/native-tools.ts`, `client/native-tools.tsx` | The shared terminal's identity and explicit creation/reuse, and the native browser URL dialog. |
| `client/screen.ts`            | The screen's id, and the count of working, ready and idle crewmates on its sidebar row. Pure. |
| `client/sidebar.tsx`          | The sidebar item: the FirstMate row and its badge.                                         |
| `client/chat.tsx`             | The first mate's conversation, folded to the words, and the composer.                      |
| `client/draft.ts`, `attachments.ts` | The unsent message and what is attached to it, kept on `globalThis` across reloads.  |
| `client/sent-images.ts`, `image-cache.ts` | Sent images by message id (the timeline has none), shared by both chats and cached in browser IndexedDB. |
| `client/chat-image.tsx`, `message-copy.tsx` | Conversation image viewer and host clipboard actions; Markdown opts into these only for chat. |
| `shared/chat-images.ts`, `server/chat-images.ts`, `client/chat-image-routing.ts`, `local-chat-image.tsx` | MateChat local image previews: home/registered-workspace identity plus relative path, server containment and image sniffing, 10 MiB cap, data URL into the existing viewer. |
| `client/timeline-history.ts` | Projected earlier pages merged with the live tail, with epoch/gap/overlap guards. |
| `shared/files.ts`, `server/files.ts` | The home as files: list, read, write — confined to the home, saved against the version opened. |
| `client/files.tsx`            | The Files view: the home's folders, a text editor, a Markdown preview.                     |
| `client/open-file.ts`         | The file open in the Files view, and what a save changes about it. Pure.                   |
| `client/permission-card.tsx`  | What an agent is waiting on — a question, a permission, a plan — answered in the chat or in Converse. |
| `client/questions.ts`         | The question form's rules, ported from Paseo's own card. Pure.                             |
| `client/keyboard.ts`          | How far the on-screen keyboard covers a view, measured in window coordinates.              |
| `client/keys.ts`              | Enter sends, Shift+Enter is a new line — web and wide layouts only, as in Paseo. Pure.     |
| `client/transcript-rows.ts`   | Timeline entries → chat rows. Pure.                                                        |
| `client/native-chat-transform.ts`, `native-chat.tsx` | Native Paseo timeline: strict FirstMate watch/board envelopes use the existing summary helpers, with a reveal-original row. |
| `client/task-board.tsx`, `board.tsx`, `card.tsx`| Summary Board, legacy detailed columns, and shared card details/actions. |
| `client/task-list.tsx`        | The default grouped List: one scroll container, Done collapsed to a count. |
| `client/suggestions.tsx`      | The slim suggestion strip, overflow menu and full-prompt dialogs; send, expand and delete. |
| `client/suggestion-removals.ts` | Which suggestions have a removal on its way, by label and prompt. Pure.                  |
| `client/suggestion-fold.ts`   | Whether a folded suggestion card cuts its text, measured against an invisible twin. Pure. |
| `client/watches.tsx`          | The Watches header button and dialog: schedule, last run and output, and on/off switches. |
| `client/mate-send.ts`         | Sending to the first mate — Send, Bearings, Ahoy, a suggestion — one message at a time.    |
| `client/converse.tsx`         | Converse: a worker's conversation in a drawer beside the crew — read it, steer it, answer what it waits on. Remote workers by their log. |
| `client/conversation-rows.ts` | Activity rows → the drawer's Conversation view (words first, tool runs folded), and the captain's sends until the transcript shows them. Pure. |
| `client/converse-layout.ts`   | Whether the drawer docks beside the crew or covers it, and which worker a `watchKey` names. Pure. |
| `client/host-tabs.ts`, `task-toolbar.tsx` | Host-filter rules and the compact Machines, Suggestions and Tags controls above List/Board. |
| `client/remotes.tsx`          | A selected host's compact, expandable health line and the shared remote snapshot query. |
| `client/activity-rows.ts`     | Timeline entries → the drawer's Activity rows, machinery kept: reasoning, tool detail, the latest plan, whose prompts are the captain's. Pure. |
| `client/mate-controls.tsx`    | The context meter, Compact and Restart (with its confirmation), at the end of the chat's buttons. |
| `client/context-meter.tsx`    | How full the first mate's context is: Paseo's ring, built from views; the numbers in a tooltip. |
| `client/follow-end.ts`        | A streaming transcript that follows its end, brings a new request into view, jumps back.   |
| `client/launch.tsx`           | What shows before there is a first mate: launch one, or adopt a running agent.             |
| `client/panels.tsx`           | The workspace and agent panels: the crewmate's card beside its own tab.                    |
| `client/settings-screen.tsx`  | Settings › Plugins › FirstMate.                                                            |
| `client/markdown.tsx`         | A trimmed copy of `github-board`'s renderer, for the first mate's replies.                 |
| `client/markdown-parse.ts`    | The renderer's blocks, and the inline text in them — what `file-links.ts` walks. Pure.     |
| `client/file-links.ts`        | A reply's inline tokens, and the home files it names that the daemon (`firstmate.files.find`) says exist. Pure. |
| `client/option-picker.tsx`    | A copy of `herald`'s searchable picker, for the model lists.                               |
| `client/web.ts`, `resize-handle.tsx` | The chat/board split's drag (a copy of `github-board`'s); the chat's file picker, paste and drop. |

Needs-you observation quarantines malformed/unresolvable rows individually. Healthy rows still
reconcile after stable reads; a quarantined gate retains its last good state and rejects mutations.
The ledger durably keeps unreadable holds, counted once per row unless an actionable gate already
represents them. Missing/repeated/unknown sections, duplicate identities, comments/NUL and unreadable
files remain whole-file failures; a missing gate never resolves. Problems include line numbers and
task ids, appear in the drawer and indicator description, and unreadable holds link to Board.
Every decision count, including the Deck legend, uses the server total and labels stale/unavailable
data. `local` resolves without a catalog; the saved local host label comes from registry sync and is
retained across restart. Ambiguous labels stay unresolved. See `docs/needs-you-foundation.md`.

The decision drawer marks a visible open question Seen through the revision-bound RPC; this never
reduces the action count. `Mark as new` is an explicit menu action. Its session order is append-only,
and answering advances to the next unanswered question in that order, or closes to the opening view
when none remain (including answers selected through All). Accepted answers stay out of navigation
while their source holds linger; All retains their record. A brief, quiet confirmation accompanies
the next question; failed or uncertain sends stay put. Snoozing still advances with a receipt.
Below 1,600 points it covers Home's task pane (`DecisionPane`) while preserving the chat/header; below 638 or host compact
it covers the surface and pins the answer bar with keyboard/safe-area support. Only the full cover
traps focus. Heading focus and opener return are deliberate. All groups use human state names.
Uncertain delivery is never retried on render: `It arrived` records the existing submission;
`Send again…` requires confirmation, records the prior attempt as failed, then uses a new submission
id and the existing send gate. The retained draft supplies the words; after a fresh session they must
be entered again. `I answered in chat` records accepted delivery without sending anything.
`decision-answer-summary.ts` folds only complete identified answer envelopes in both chats, preserving
the exact original for disclosure and the home/request/revision for reopening. New envelopes include
the authored title; old envelopes fall back to their task id. `decision-raised.ts` places each
non-baseline decision detected in the current first mate's tenure once in the plugin chat, at its `detectedAt`.
The tenure is config `mateSince`, stamped by `updateFirstmateConfig` whenever `mateAgentId` changes, so an
adopted mate's older history never shows another mate's decisions. An unrecorded tenure shows none.
`decision-raised-card.tsx` draws it from the live snapshot with the drawer's summary, bound answers and
send path. It shows the drawer's stale/quarantine warning beside retained content, and keeps a card answer's
words in the drawer's draft (`decisionDraftKey`) for Send again…. It shows as settled once answered or resolved. The drawer consumes optional server-bound
`answerOptions`, `specPath` and `notesPath` additively; their production belongs to the options slice.
Render evidence lives in ignored `.local/needs-you-drawer/`, never in tracked docs.
The standalone Deck omits the Needs-you header pill in every state; its scene legend and first mate
remain the decision entry points. Other headers keep both empty and non-empty indicators.
Deck's heading retains decision-surface visibility tracking so removing the pill does not change
toast suppression. `docs/needs-you/header-checks.mjs` checks both states in light/dark at phone/desktop widths.

## Home and the workspace tabs (shell phase 1)

Home's header keeps the title, mate status and task counts together, with the List/Board/Deck and Home files/Plans switches
and **More** beside them. The top-left cluster follows the right-hand controls: Needs you is drawn like
`IconButton` (28 points, 8-point corners, 12-point label, a Check/Bell/TriangleAlert icon; its outline and
fill carry the signal), while "First mate *state*" and the counts are plain text split by thin rules, so
facts never look like buttons. `docs/header-style/render.mjs` renders it at the usual widths in both themes.
`client/header-actions.tsx` puts provider migration, watches, pane visibility,
the full conversation, updates, refresh, settings and the full home path behind More's host modal.
Migration and Watches open sibling dialogs after More closes, with web focus returning to More.
Recovery/failing-watch attention colours the More trigger. All layouts keep workspace shortcuts behind
**Open**, beside More, in a host Modal, so the desktop header occupies one row. Below 1,000 points
the desktop view switcher uses its own menu and status/counts move into More. On compact layouts status and counts share one
quiet row under the title. The existing compact rule (host compact layout or less than 638 points)
also applies to a narrowed desktop pane. Shortcut capability explanations live in tooltips and the browser dialog.
The view choices use two existing segmented controls separated by an eight-point gap: List, Board,
Deck, then Home files, Plans. The narrow Home view menu wraps those groups; compact Home keeps
First mate as a separate segment and wraps the same task and record groups. Pane ids and saved choices stay the same.

The sidebar's `fleet` screen is **Home**: one first-mate chat, a List/Board task overview, Home files and a
launcher. Home uses the saved `crewView`, defaulting to List; the two views share the same cards,
host/tag filters, actions and open worker conversation. Switching views preserves a draft; pressing
the selected view again returns from the conversation to its tasks. Compact Home exposes First mate,
List, Board, Deck, Files and Plans in the existing tab row. The standalone Crew (List), Board, Deck and Plans destinations
keep their own layouts. `client/workspace-panels.tsx` registers `firstmate-deck`, `firstmate-board`,
`firstmate-crew`, `firstmate-chat` and `firstmate-plans` through `addWorkspacePanel`, workspace location only. The older
contextual workspace and agent panels are titled **FirstMate here**, with an **Open chat** shortcut.
`client/shell.ts` holds the fixed identities and home-workspace rule.
The callbacks are closed over the contributing installation, never a global navigation singleton.

Paseo owns tab creation/focus/deduplication, closing, splits, ordering and layout persistence. The
launcher calls `client.openPanel` with that fixed panel id and the configured first mate's home
workspace. An adopted mate outside the home never lends its workspace to this launcher. Paseo lists
plugin panels in all workspaces; Deck/Board/Crew/Plans opened elsewhere explain that and link to the correct home.
Chat works in any workspace and always reads the configured first mate from the shared fleet query,
including its launch/adopt state when none exists. A home file opened from Chat uses a dialog.
Until a mate has a verified home workspace, the shortcuts are disabled. No tabs, terminals, browsers
or agents are created on render, reload or restoration.

`FleetSurface` shares the existing Board, TaskList and SelectedDeckView rather than forking them.
`client/fleet-query.ts` owns the fleet query/cache. Drawers and Crew's completed-task choice are keyed
by host, workspace and view. Chat and Home mount the same `MateChat`: per-mate drafts, attachments,
sent images and send gate are shared. Sending rereads the stores to reject a stale copy's cleared draft;
each transcript keeps its own scroll position with the same follow/jump rules. A visible Home chat or
Chat tab clears first-mate attention. Deck/Board/Crew suggestions return to Home's chat and those views
retain the permission banner. Deck keeps the migrated scene
engine, installed-setting selection and unavailable state on compact/native clients; leaving it
unmounts its canvas, and its existing zero-size/document-hidden guard pauses a retained hidden pane.

**Native tools use workspace shortcuts in this no-fork phase.** The captain approved opening the
home workspace and selecting native tabs there. The public SDK has terminal create/list/keys/capture,
but no terminal focus-by-ID navigation. `navigation.openBrowser` is Electron-only, always creates a
new browser, returns `void` and has no existing-browser-ID input. Exact reuse/focus-by-ID of a shared
native terminal/browser tab, a returned browser ID, and live-pane embedding need an upstream Paseo
API change and are deferred to the separately fork-gated future phase. Do not use private host stores,
routes, renderer imports, raw frames, iframe terminals or a copied browser to bridge this gap.

`docs/shell-phase1/` has the fixture render checks, review evidence and bundle/Hermes check. Fixtures
exercise real views with synthetic host APIs; they are not claims of an installed desktop/device test.

**Native resource creation (slice 2).** Home's **Shared terminal** calls `firstmate.native.terminal`
with the displayed workspace id. Inside the same lifecycle lock used for role/home changes, the
server rereads the config, resolves the live mate, checks both its cwd and the workspace's canonical
directory against the home, refuses archiving workspaces, and lists terminals in that workspace.
Exactly one named `SHARED_TERMINAL_NAME` (`FirstMate shared`) is reused; none creates a default-shell
terminal with no command or keys; multiple matches are refused with instructions to select/rename.
An offline/failed listing never means "missing". Every explicit retry lists again, including after an
uncertain create response. Closing Home, reloading, restoring tabs and changing devices do not launch,
kill or replay anything. A terminal killed or renamed by the captain is only replaced on another
explicit Shared terminal press. The captain selects the terminal in Paseo after workspace navigation.

**New browser** is a separate explicit action, disabled without `navigation.openBrowser`. Its dialog
accepts absolute HTTP(S) URLs and explains that it creates a new tab; Cancel creates nothing.
Paseo owns the new local browser's view/profile and opens it in the home workspace. The plugin stores
no browser ID, URL registry or false cross-device handle. Existing tabs use **Terminal & browser**.
The client gates duplicate submissions and reports native API failures; a completed terminal request
does not navigate if Home (or that home workspace's controls) has unmounted.
`NativeToolButtons.renderButtons` lets the compact launcher contain only its buttons: New shared browser
is a sibling dialog, opened after the launcher closes, with focus returning to Open on dismissal.
Terminal state and its pending gate stay mounted when the launcher closes/reopens; successful navigation
closes the launcher. Rendering or opening either menu never creates a native resource.

The charter's shared-tools section teaches the mate to discover the same terminal by workspace/name
and the same browser via `browser_list_tabs`, then use the IDs returned by those tools. The terminal
name is rendered from the same shared constant. Browser sharing is conditional on browser tools and
a connected desktop automation host, not a capability the plugin enables. Localhost is the desktop,
and another device's browser is a different page. Edited charters retain their usual compare/update
path; a running mate must reread its charter to receive the new guidance.

## Needs you decision context

`server/decision-brief.ts` reads optional `data/<task-id>/decision.md`
through home containment, capped at 64 KiB per file and 512 KiB per snapshot. Ambiguous task ids do not
select a brief. `shared/decision-brief.ts` reads Markdown section labels and numbered bold options;
the drawer renders all prose, highlights recommendations and binds clear options to the whole brief's
content hash. Sending rereads the file through the existing answer path. All keeps full questions and
recommendations in counted section blocks; parked titles expand in place. The drawer captures its
opening view for the back label. Deck has no header pill: its first mate alone wears a count-only
speech bubble, with a dashed outline for stale data, and the legend retains the total and next link.
Clicking the officer or its bubble opens all current Needs-you items in the shark's shared popover
chrome. Opening sends and acknowledges nothing; picking a decision carries its exact id, home and
revision into the existing drawer. Due plan decisions use the shared presentation adapter; plan
reviews open their existing plan dialog. Counted items absent from the rows (including unreadable
held tasks) retain a counted footer opening All in Needs you, with repair controls visible even when
healthy decisions also wait. The client-only `all` destination never selects or acknowledges the next
decision; Back returns to the opening surface. Zero/unavailable counts show no bubble. Escape, outside
clicks, the close button and another officer click dismiss it. Shark and officer popovers are exclusive.

Missing tasks are retained as per-task quarantines, never inferred resolved and never freezing healthy
answers. A unique task id moving scope migrates its source while keeping request ids, revisions,
submissions and drafts; `identityKey` retains the original hash scope for persisted id validation.
Ambiguous moves stay quarantined. Whole-file structural/read failures still fail closed globally.

## The plugin never dispatches a crewmate

The narrow exception is an opt-in watch **inspector**, implemented in `server/watch-inspections.ts`:
read-only, parentless, with its own explicit workspace outside the home and `watch-inspector` labels.
It cannot inherit the supervisor charter or Paseo supervisory MCP tools. It receives a supplied board
snapshot, returns structured evidence, and is never crew. The current first mate alone acts on findings.
Typed routing contracts live in `shared/watch-routing.ts`; `watch-config.ts` and `watch-requests.ts`
persist definitions and the home tool transport. `docs/watch-routing/README.md` covers lifecycle and tests.

The first mate does, with **Paseo's own MCP tools** — `create_workspace` for the worktree,
`create_agent` for the crewmate, `send_agent_prompt` to steer, `archive_agent` to clean up. The plugin
gives it a home and a charter, starts it, carries the captain's words to it, and draws the result.
That was ABorakati's rule too ("the plugin deliberately does NOT dispatch crewmates itself"), and it
keeps authority in one place: the first mate owns intake, the brief and the backlog.

What that costs:

- **Paseo's agent tools must be on** — `daemon.mcp.injectIntoAgents`, **off by default** in Paseo. The
  board reads it through `paseo.config.get()` and offers a button that patches it on. A session gets
  its tool set when it starts or resumes, so a first mate launched before the switch needs a reload.
- **The charter is a contract with a model, not with code.** A weaker model can misuse the tools — a
  Haiku first mate on the test daemon tried to run `mcp__paseo__list_agents` as a shell command — which
  is why the charter names the tools and says outright that they are never shell commands.

## Supervision is Paseo's, not ours

**Archiving a parent can archive workers too.** Paseo 0.11 cascades to children in the parent's
workspace, recursively. A different `cwd` with `parent` alone still inherits that workspace. Create
an explicit separate workspace and pass its `workspaceId` (the SDK's workspace agent creation does
this) for a worker meant to continue independently. Cross-workspace children are detached on parent
archive and keep running. `server/migration.ts` refuses same-workspace children before preparation
and again before retirement; its unprompted replacement is created without a parent and checked
for independence and survival. Lifecycle fixtures must verify both refusal and preservation, using
only a throwaway daemon.

**A live agent listing is not an archive safety inventory.** Paseo 0.11 omits unloaded persisted
sessions on unregistered providers from `agents.list`, but archive still traverses those sessions
and can stop their running descendants. The shared migration/cancellation guard uses
`server/archive-inventory.ts`: paginated `fetch_agent_history_request` over the existing plugin
session channel, including unavailable persisted providers. It refuses archive on request/schema
failures or incomplete/non-progressing pagination, without falling back to the ordinary listing.

FirstMate's "zero-token supervision" was a bash watcher sleeping on status files. Paseo already has it:
when an agent creates or prompts another through the MCP tools with `notifyOnFinish` (on by default
for agent-scoped calls), the daemon sends the creator a `<paseo-system>` note when the child finishes,
errors, is closed or asks for a permission — with the child's last message, delivered with the same
`activeTurnBehavior: "steer"` described under *Sending without interrupting*. The charter tells the first
mate to keep it on and to read the crewmate's **status line**, the last line of that message.

Two gaps, and what fills them:

- **A turn the captain started from the board** was prompted by nobody Paseo knows to notify.
  `registerSteerRelay` remembers each steer (`CaptainSteers`, in memory, an hour at most) and sends
  the first mate a `<firstmate-board>` note with what was said and answered — on the first
  `agent.turn_ended` whose timeline **contains** the steer as a user message, and never on a cancelled
  one. The first turn to end is not always the answer: the one that was running may end first, and a
  provider that cannot steer cancels it. A steer whose send failed is taken back, so it is never
  relayed as said.

  **One note per burst, not per message.** A conversation in the Converse drawer would otherwise wake
  the first mate once a line. `queueBurstNote` (`server/mate.ts`) keys the note by worker and holds it
  in `mateNotes` with `burst.holdUntil`: each further exchange with that worker is merged into it
  (re-rendered from its `parts`, `templates/messages/steer-relay.md` around one
  `steer-relay-exchange.md` each), and each new steer (`extendBurstNote`) or exchange pushes the hold
  to `BURST_QUIET_MS` (two minutes) from now, never past `BURST_MAX_MS` (ten) from the first. Only a
  note that has stopped holding is sent, and only a holding one is merged into, so a part can never
  join a note a send already took. The 15-second note timer delivers it; other notes pass a holding
  one. Remote steers burst the same way (`remote:<serverId>:<agentId>`, `remote-steer-message.md`
  each). The config survives a reload, so a held note does too; a merge records `note-queued` again
  under the same id with the whole burst's relates.
- **Nothing wakes a first mate whose crew went quiet.** The charter has it keep one `create_heartbeat`
  while work is under way.

The notification watches once per prompt. A crewmate prompted by hand in its own tab is not watched
by anyone; the heartbeat is what catches it.

## Sending without interrupting

`PaseoAgentHandle.send` **interrupts a running turn by default.** For the first mate that is wrong — it
may be halfway through a dispatch — so `server/send.ts` sets `activeTurnBehavior: "steer"`, which the
SDK declares since 0.11 (`PaseoAgentSendOptions` is the daemon client's `SendMessageOptions`); 0.9's
handle passed it through undeclared. Everything the plugin sends goes through it.

"Steer" is only as gentle as the provider. The message joins the running turn where the provider
can take one mid-turn; where it cannot, the daemon's `steerOrReplaceActiveTurn` **cancels** the turn
and starts a new one from the message. That is the same path Paseo's own finish notifications take,
so it is no worse than what the first mate already lives with, but it is not a guarantee — and it is
why the steer relay above cannot assume the first `turn_ended` after a steer is the answer to it.

## The crew is found by label

The charter tells the first mate to create every crewmate with the labels in `CREW_LABELS`
(`firstmate.role=crew`, `firstmate.task`, `firstmate.kind`, `firstmate.project`), and the board lists
`agents.list({ filter: { labels: { "firstmate.role": "crew" } } })`. The charter imports the same
object, so the two cannot drift. A crewmate created without them is invisible to the board, which is
the first thing to check when the board is empty and the first mate says otherwise.

A card joins a crewmate to its backlog line by the task label, or by the `(agent: …)` the line records;
whatever is left on either side is a card of its own.

**The first mate itself is found only by `config.mateAgentId`.** It is labelled
`firstmate.role=first-mate` at launch, for `paseo ls --label`, but the label is not consulted: the SDK
cannot take a label off, so falling back to it would bring a released first mate straight back.

**Home identity is checked afresh.** `templates/AGENTS.md` puts `node tools/role.mjs` before the
charter, including a customized one. The generated helper uses the daemon's rendered paths, the
config's actual input schema and the same current/legacy precedence as `dataPath`. Missing,
unreadable or conflicting identity is a guest; environment/labels alone never grant the role.
Canonical paths include Windows case and junction aliases. This is behavioral guidance, not
revocation of a guest's native tools. Other home chats are allowed without a warning banner;
the contextual native agent panel still identifies a guest. Role detection and guest guidance are unchanged.

**Launch has a durable reservation.** `mateLaunch` saves ID, setup and opening before unprompted
creation. Only after checking the prepared session does config activate its identity and send the
opening. A lost create reply retries the same ID; an uncertain opening is never automatically
resent. Plugin sends/watches wait on the reservation. Release clears it without archiving the guest.
Keep this ordering when changing launch, restart or migration.

**Topic advisers remain unavailable.** The phase-0 evidence is `docs/topic-phase0/README.md`:
Claude plan failed native approval/mode/resume canaries. `server/adviser-profiles.ts` offers no profile.
`server/submissions.ts` is an unwired, content-bound journal library; it separates uncertain/recorded
delivery from intake and action receipts. No topic UI, transport or authenticated ack adapter is wired.

## The receipt journal is observe-only, and off by default

Attention timing is independently opt-in through `FIRSTMATE_ATTENTION_OBSERVE=1`, also off by
default. It reuses the receipt observer's turn-ended subscription and action catalogue, the remote
catalog poll and the existing fleet compiler; it does not change delivery or restart the decision
collector. Metadata appends to the home's `data/metrics/attention.jsonl` for 14 days from the first
start, with restart/gap boundaries. `npm run report:attention -- <absolute-log-path>` reports
permission waits, fleet-state residence, later lead-turn associations and bounded targeted actions,
with unpaired events kept explicit. No prompts, arguments, credentials or semantic decision labels
are retained. Details and measurement limitations are in `docs/attention-observation.md`.

`server/receipts.ts` keeps a forward-only, append-only, hash-linked record of what the plugin sends, which
first mate was at the helm, what it sees the first mate do, and what it writes into the home — so a first
mate's calls can be bound to what it was told and what it changed. It runs only with
`FIRSTMATE_RECEIPT_JOURNAL=1` in the daemon's environment. **Off, nothing changes**: no file, no
`messageId` added, every send and write the call it was before (`receipt-paths.test.ts` holds the off
calls to the old ones exactly, and `receipts.test.ts` a prepared home byte for byte).

- **Shape.** `$PASEO_HOME/plugin-data/firstmate/receipts/NNNNNN/NNNNNNNN.json`, one canonical-JSON entry
  per file published by `submissions.ts`'s exclusive hard link (its `canonical`, `digest` and `publish`),
  each with its sequence and the SHA-256 of the canonical entry before it. Every shard of 1,000 opens
  with a `checkpoint` of the generation ledger, so a start-up reads only the newest shard;
  `verifyReceiptJournal` reads all of it and fails closed with a coded `ReceiptJournalError`.
- **Never in the live path's way.** A receipt is queued beside the operation and written after it hands
  off; a send's attempt is recorded before its result, so an attempt with no result is an uncertain send.
  A receipt that cannot be written becomes an `uncertainty` entry at the next good append; one a broken
  chain refuses goes to `receipt-uncertainties.jsonl` beside it. `observedSend` falls back to the off
  path if the journal throws, and `observedWrite` passes the write's own result and errors on untouched.
- **Sends** go through `sendWithoutInterrupting`/`observedSend` with a `receipt` (channel, actor). Ids the
  plugin already gave (opening, handover, notes, watches, inspections) are kept; a steer, an ask and
  `/compact` get `firstmate-<channel>-<uuid>`, never starting `firstmate-watch-`. **A board steer is the
  one send that differs with the journal off**: it always carries `firstmate-crew-steer-<uuid>`
  (`CAPTAIN_STEER_MESSAGE_ID_PREFIX`), so the Converse drawer can label the captain's words "You"
  (`receipt-paths.test.ts` holds that on purpose). A remote steer's id does
  not travel to the host (`carried: false`). A board steer's id rides in `CaptainSteers` to the relay,
  which records `steer-read` and a `note-queued` naming it.
- **Generations** are recorded where the plugin changes the first mate (launch, restart, adopt, release,
  handover) and, where the config changed without it (the role helper can), as `observed` at the next
  receipt. A receipt to a first mate is its generation's; any other the one at the helm when it happened.
- **Records**: `observedWrite` hashes before and after each plugin write into the home — the Files view,
  suggestions, item tags, `prepareHome`, the charter's copies, built-in watches, handoffs — under an
  `actionId` (`newAction`). An unchanged write records nothing. The first mate's own writes are not seen.
- **Observed, not sent**: the first mate's Paseo tool calls in a turn it ends (`mate-actions`, hashed
  detail), and a crewmate of it ending a turn (`native-finish`, always `certainty: "uncertain"` — the
  `<paseo-system>` note is in no timeline a plugin reads). `firstmate.receipts.timeline` pages the first
  mate's, a former first mate's or a crewmate's timeline through the SDK cursor and returns `gap`,
  `staleCursor`, `hasOlder` as Paseo gives them; it is refused while the journal is off and writes nothing.

## The ship deck is a WebGL canvas

Sakura's storm spirit uses two registered strips from the same unchanged atlas:
`umibozu` above the sea and `umibozu-submerged` beneath its opaque backdrop.
They split at world row 160 (source row 60), keeping source top 100, voyage drift,
swell frames and visibility identical. The scene sea covers the baked-in foam;
never add a separate water patch or move the spirit with the viewport. The coast
authoring helper is `docs/settings/japanese-ship/coast/surface.mjs`.
Sakura's water uses eight `-ib` atlases: 24 row-major poses in a 4-by-6 grid,
80 ms per pose on the unchanged water clock (1920 ms per loop). Original poses
remain at indices 0, 4, 8, 12, 16 and 20; geometry, scroll and palettes stay fixed.
`docs/settings/japanese-ship/water/inbetweens.mjs` registers those atlases and removes the superseded sheets.
Sakura's cast is kasa, cook, elder, rigger, fisher, padded, moss and ochre. The six
new sheets share the indigo lane's 15 poses and feet; keep that lane even though
the indigo image is retired. `docs/settings/japanese-ship/crew-variety/register.mjs`
registers the sheets and removes retired images only when no pack content uses them.

A standard part of the screen (`docs/ship-deck-canvas/README.md`, `docs/ship-deck-motion/README.md`,
`docs/ship-deck-environment/README.md`, `docs/ship-deck-tweaks/README.md` and
`docs/ship-deck-default/README.md` have the evidence). The wide layout's Crew/Files switch has **Deck** in a
web renderer (`deckOffered`); a phone or a narrow window is not offered it, and a display without WebGL
gets a sentence instead of the canvas. It was built behind a `FIRSTMATE_SHIP_DECK` switch, now removed: the
fleet load carries nothing for the deck, and its RPCs always answer. What building it found applies to any
client code:

- **The client bundle must parse under React Native 0.81's Hermes, so it has no `class` syntax.** A phone
  parses the whole bundle before any of it runs, and the host's `hermesc` refuses `class` with its
  default flags (it needs `-Xes6-class`). Whether the app turns that flag on at run time has not been
  checked on a device, so treat it as a constraint. esbuild lowers `async` for the client (the compiler's
  `supported`), but it cannot lower classes. Main's bundle has none. Pixi has them, so even lazily
  bundled it would risk the plugin on every phone. `docs/ship-deck-canvas/compile.mjs`
  runs Paseo's compiler and `hermesc` over both bundles. Check any new client dependency the same way.
- **A browser-only library is served, not bundled.** `vendor/pixi.min.js` is Pixi's own prebuilt build,
  shipped in `files` and held byte-identical to the pinned devDependency by `ship-deck.test.ts`; an npm
  dependency would add about 76 MB to every install. `firstmate.deck.engine` sends it as text. `evaluatePixi` runs it with `new Function`, which needs the same permission
  as the app's own `(0, globalThis.eval)` of every plugin bundle. It runs once per session, only after a
  host and WebGL have been found.
- **The escape hatch is a childless `View`.** On the web, react-native-web hands a `View`'s ref the DOM
  element, so `mountDeck` appends Pixi's `<canvas>` to it by hand — no DOM JSX, no forbidden host module.
  React owns the element and nothing inside it. On native the ref has no `appendChild`, so the deck says
  where it draws instead.
- **Pixi's types cannot be imported into the project**: `@xmldom/xmldom`, one of its dependencies,
  references `lib="dom"`, which would quietly let all of `client/` use DOM types. `deck-pixi.ts` declares
  the narrow shape it draws with. The test holds that shape to the real build's prototypes, and the
  harness draws with it in Edge.

- **The art is served the same way**, as a setting pack (see *The Deck is a scene engine drawing setting packs*
  below): `firstmate.deck.setting` sends a pack's `setting.json` and every image it names, fetched
  and decoded once a session alongside Pixi, never bundled. `docs/ship-deck-art/build-art.py` rebuilds the atlas
  from the generated sources; `docs/ship-deck-art/README.md` says where those came from and what still needs a
  pixel artist.
- **`art/` ships only what the deck draws.** `package.json`'s `files` names all of `art/`, so a generation
  source or a review render left there goes to every install: before they moved, about 11 MB of them did,
  against about 300 KB served. Sources, prompts, provenance, verification records and review renders go
  in `docs/ship-deck-art/`, under the same relative path; the pack linter (`test/deck-settings.test.ts`) fails
  on any file in a pack that its manifest does not name, on a name with no file, and on anything in `art/` but
  packs.
- **Depth is the deck row.** Scene coordinates are the hull's own pixels, and a sailor's `x, y` is its
  feet. The hull is the backdrop (in slices, so the masthead can sway). Its mast, bollards and near rail
  are cut out again as pieces, each with the row it stands on, and `depthOf` orders props, sailors and
  pieces by row. A new place on deck must keep its feet on the hull's deck and off the near rail:
  `deck-motion.test.ts` reads the atlas to check every anchor, however crowded. `docs/deck-settings/gate.mjs`
  renders main's compiled bundle and the branch's, still and moving, and compares them pixel for pixel.

Leaving the Deck destroys the application and its canvas. A mount torn down mid-start destroys whatever
starts.

## The Deck is a scene engine drawing setting packs

`first-mate@1` reserves an A1 officer at each pack's `firstMate` post; its atlas is
never assigned to ordinary crew. `first-mate-asking@1` adds `firstMate.asking: { at, clearance }`:
the officer walks along the existing floor to this bow post while workerless decisions wait,
then returns to the wheel. Still mode snaps to the post. Both posts reserve overflow clearance;
the pack linter checks both against the unchanged A1 atlas, routes and crowded pointer targets.
The legend leads with the ledger total and one Answer the next action. `client/deck-decisions.ts` projects the daemon's
needs-you gates to sailors and the officer's workerless tag, without detecting
holds or reconstructing total counts. Placement and weather inputs are separate.
Every decision marker uses `ShipDeckView.onOpenDecision`; see
`docs/attention-deck/README.md` for the shared `useOpenDecision` integration, geometry
checks and the CI before/after screenshot artifact.

The Deck is a **scene engine** that knows workers, states, places, portals, layers, behaviours, the day and
intensity, drawing a **setting pack** that knows what those look like and where they are. The nine-step migration
is recorded in `docs/deck-settings/README.md`. The released pack is `art/settings/ship/`.
Office was withdrawn after visual review; its files are retained at
`docs/settings/office/withdrawn-pack/`, outside the picker, RPC discovery and npm package.

- **A pack is pure data**: `setting.json`, format `firstmate.deck-setting` 1 (`shared/deck-setting.ts`), and the
  PNGs it names, nothing else. **No pack code, ever**, and **no expressions**: numbers, ids, sprites, fixed path
  shapes, named events and piecewise-linear curves over intensity. Anything derived (the tall mast's depth rows,
  the walk out along the plank) is computed offline when the pack is built and checked by the linter.
- **The behaviour catalogue is closed and versioned** (`ENGINE_CAPABILITIES`: `drifters@1`, `choreography@1` …). A
  pack lists what it uses in `requires`, which must equal what it uses (`capabilitiesUsed`). A new behaviour is an
  engine change, setting-agnostic, added only when a shipped setting uses it — never `if (setting.id === …)`.
  `choreography@1` is the one most likely to grow: hold it to segments, events and effect keys.
  Every manifest object has a strict shape: undeclared fields, including script/expression hooks, fail validation.
  Step 9a adds `stable-posts@1` (`assign: "stable"`: agent identity's preferred post, nearest free on collision)
  and `pose-fidgets@1` (a key's optional pose, retaining the settled mirror rule; skipped in still/stale).
  Step 9b adds `walk-in@1`: an authored straight corridor from an off-floor mark to a navigable endpoint,
  with optional finite effects using only `from`/`at` marks and `start`/`entered` events. `shared/deck-portals.ts`
  lowers it to the existing choreography machinery; the crew reverses entry progress continuously and snaps
  to posts in still mode. `portalEffects` supplies both entry and exit tracks. No persistent door-state hooks.
  Step 9c adds `phase-tint@1`: `stage.tintByPhase` multiplies stage art/body colours using the existing day blend
  (`client/deck-phase-tint.ts`). Badges and interaction graphics stay untinted; focused bodies keep their tint.
  Step 9d adds `phase-frames@1`: an ambience sprite selected by local hour/minute, modulo its frame count
  (`client/deck-phase-frames.ts`). It shares the renderer's wall clock, honors lite/still policies and adds no timer.
  The existing wall-clock refresh also applies in still mode, without restoring weather variants or animation.
  `zone-appearance@1` adds a settled zone's fixed sprite, feet anchor and foreground piece. The engine keeps
  identity, state and badges; sprite bounds/depth drive hit testing and focus. Cast motion resumes while walking.
  `cast-scale@1` adds optional `cast.scale` (1–3, default 1): nearest-neighbour enlargement around the feet.
  Atlas rectangles, crop rows and choreography reveals remain in source pixels; body drawing, breathing,
  badges and hit bounds apply the scale together. Zone appearances remain registered to their hull openings.
  Keep `stage.actorHeight` equal to the enlarged body plus its badge for focus, and review posts/overflow,
  routes, eaters and 24-worker clicks when changing scale. The frozen Ship fixture and Sakura remain unscaled.
  Only explicit packing areas with visible handles can use non-spill floor; ordinary overflow stays out.
  `post-transit@1` gives a post an authored reversible access path from navigable floor to a raised station,
  with speed, moving/settled poses and piece-relative depth (`client/deck-post-transit.ts`). Only its primary
  holder takes the route. It descends before changing posts, reverses continuously on reassignment, and snaps
  in reduced motion. Missing declared art dependencies leave the station on the floor. No pack callbacks.
  The office's commissioning contract, historical draft, provenance and runtime review live in
  `docs/settings/office/`. Its installed manifest has real image digests and copies of the verified PNGs.
  `test/office-draft.test.ts` preserves the original geometry/registration checks; generic pack lint checks
  the installed files. Author new settings via `docs/deck-settings/authoring.md`; new art is commissioned separately.
- **Atmosphere is compiled per pack** (`compileAtmosphere`, `client/deck-atmosphere.ts`): `atmosphere.table`
  interpolates any named channels, `clocks` binds animation names to pace channels, and `delivered` supplies every
  channel's calm value. Tables have strictly increasing intensities and the same channels in every row. Clocks advance
  by step times pace; they never jump when pace changes. Reduced motion holds live clocks and supplies null intensity,
  disabling variants, curve-driven layers and flashes. Packs without atmosphere have no named channels or clocks.
- **Flash caps are engine rules**, including for future packs: at most two frames and 3500 ms total, opacity ≤ 0.6,
  at least four seconds dark between flashes, none in lite or still. Format 1 permits one flash element per pack;
  supporting multiple emitters needs a shared scheduler capability first so they cannot evade the global interval.
- **The engine keeps what must read the same everywhere**: cards → workers and their four states, badges, marks,
  legend, hover label, focus panel, reply bubble, the motion plan (full, lite, still; paused when hidden), reduced
  motion staying calm, flash caps, and intensity — how busy the fleet is (`ACTIVITY_WEIGHTS`, `BUSY_CREW`). A pack
  says how intensity looks, never what it means.
- **Served by id**: `firstmate.deck.settings` lists the packs, `firstmate.deck.setting` sends one whole. The server
  checks every manifest whole (`SettingManifestSchema`: shape and references) before it serves it, confines its
  paths to its folder, caps its raw image bytes at 2,000,000, and lists a pack this engine cannot draw — a newer format, a capability it
  lacks — as incompatible, with why, without parsing the rest. The client's contracts (`shared/deck-rpc.ts`) carry
  none of the format's rules, so the schema costs the phone's bundle nothing.
- **The pack linter** (`test/deck-settings.test.ts`) runs over every pack: the schema and its references, images
  at their declared sizes and hashes with nothing else in the folder, sprites inside their images, animations one
  size, variants lined up with their elements, drifting sprites in their palette's colours, the whole under the cap —
  and its floor against its own backdrop: every walkable point on it, posts and marks on open floor and in sight,
  everything reachable from everything else, the fit taking in every part, flyby and effect, and two dozen workers
  packed into each packing zone, each in sight and in the pointer's reach.
  Above 80% of that budget (1,600,000 bytes), the linter prints an advisory warning; exceeding the cap still fails.
  Transport limits and the reproducible first-draw benchmark are in `docs/deck-pack-budget/README.md`.
  Run it with `npm run lint:deck-packs`. `node docs/deck-settings/render.mjs '?setting=ship&overlay=1'` draws
  the selected pack's floor, posts, zones, marks and fit box over its own deck. See `docs/deck-settings/authoring.md`.
- **Whole-stage rocking**: `stage-rock@1` optionally gives the whole stage a rigid pivoted rotation and sideways drift
  (`client/deck-stage-motion.ts`). Hull/furniture/crew/interaction graphics and the spotlight/veil share
  the transform; pointer inversion and focus/label anchors use the same arithmetic. Ambience, the independent
  attention carrier and the off-stage effects slot stay level. Full/lite use existing atmosphere clocks;
  still is level. Rocked packs always use the authored fit; unopted packs keep the old fit and pixels.
  The pack linter bounds the full angular sweep plus bob/drift for art, lights, routes and crowded targets.
  See `docs/deck-settings/authoring.md` for the strict fields, limits and layer rationale.

- **No module-level "the setting"**: the stage is compiled per pack (`compileStage`, `client/deck-stage.ts`) and
  handed to the crew, the geometry and the renderer; caches are keyed by id (`packOnce` in `client/deck-mount.ts`)
  or held on the compiled floor; and the view takes the id as a prop (`setting`, the default
  `DEFAULT_DECK_SETTING`), so choosing one globally now and per project later changes neither the engine nor the format.
- **Ghost ship has no underwater cutaway.** Its fit ends at stage row 520. The surface's back/front
  bands share origin 265 and the same atlas frame and clock, with the foreground starting at row 448.
  Its optional `depth-wash@1` tile colour blend follows day phases and eases down world rows 448–1250;
  it does not repeat per tile. `client/deck-depth-wash.ts` owns that arithmetic. A delivered `sea-light`
  channel preserves daylight under reduced motion and attenuates the colour blend in storms.
  Commissioned water atlases are registered without repainting by `docs/settings/ghost-ship/water-art.mjs`.
  `fix-motion.mjs` transfers the basket pixels out of the fluttering flag into the fixed mast and registers
  a four-frame downward rain loop. Run it after art registration; `build-art.mjs` does this automatically.
  Review captures belong under ignored `.local/`, never in the shipped pack or committed docs.
- **Global selection** lives in `displaySettings.deckSetting`, default `ship`, chosen through **Scene** in the
  Deck workspace toolbar (`client/deck-scene-switcher.tsx`) or Settings > Plugins > FirstMate > Deck setting.
  The toolbar saves the host document at its current revision and reports a failed save without changing the scene.
  An external file restore emits no host notification: the mounted scene selector rereads at the fleet poll interval.
  A refused save reloads once, then retries only from a changed, readable revision on the next committed render,
  merging only the scene into fresh preferences. A second refusal reports an error; unmount cancels a pending retry.
  The picker lists installed pack previews, disabling incompatible choices with their
  reason. `resolveDeckSetting(display, scope, installed)` handles the fleet scope now; a future project resolver
  changes selection alone. Missing, incompatible or failed choices fall back to ship with a notice, leaving the
  saved choice intact. A changed resolved id remounts the view, clearing focus, hover and pending loads. The canvas
  records that actual id in `data-firstmate-deck-setting`; pane/actor/zone words come from the pack's `copy`.
- **Every drawn part now comes from the pack.** Steps 3?7 moved the stage, floor, zones, cast, ambience,
  furniture, atmosphere and portals into data. `client/deck-choreography.ts` compiles finite actor segments
  and effect tracks; `portals.byDeparture` routes departures, queues release on named events, and rise/sink/fade
  durations belong to the pack. No runtime reads the old art manifests. Historical adapters and frozen timeline
  expectations live under `test/` and are excluded from the package. Every step is held to the 81-shot
  pixel-identical gate in `docs/deck-settings/gate.mjs`. Step 8 adds global selection; step 9 installs the office
  as data and commissioned art, after its generic capabilities landed in separate reviews. Per-project selection
  and external pack installation remain deferred. The code-drawn plank/wake remain retired.

Sky pirates' peak-storm `sky-serpent` uses the eight `dragon-0..7.png` flight frames,
a transparent base, 180 ms on the swell clock and rightward 24 px/s on wind. Its 2,048-pixel
strip stays above the entire airship at top -80 and hides in lite/still modes. `strip@1` draws at
native art size; it has no per-effect scale. Flight evidence is kept outside the repository.

### The deck moves (`docs/ship-deck-motion/README.md` has the evidence)

- All four shipped scenes use `precip@1` rain, with 36 authored streaks per atlas, registered by their
  falling tips, visible lengths and baked angles. Kinds blend density, speed, length, opacity and depth
  ranges over the existing weather intensity. A scene/session seed supplies independent drops, with
  three depth strata (far/mid/near in a 3:2:1 mix), small angle jitter and gentle gusts. Drops move down
  along their displayed streak. The field fills the pane, including negative sky rows, on resize and focus.
  One emitter per pack and one slot per 1,000 pane CSS pixels, capped at 1,500 including optional splashes,
  bound the work. All three depths draw last in the front slot, over hulls, sails and foreground water.
  Rain and peak are calibrated against the old tiles; drizzle keeps a sparse population. Lite holds
  a seeded field cached as a texture; still/reduced motion draws no rain.
  Legacy tile/strip weather stays supported, and the frozen 81-shot fixture is unchanged. See
  `docs/deck-rain-particles/README.md`; `test/deck-rain.test.ts` checks the shipped art and thresholds.

- **State and movement are separate.** The scene says what each sailor is doing (`DeckSailor` has no
  position). `applyCrew` sets the new state at once, so the mark under the feet and the legend change on
  the poll; the sprite then walks to the state's anchor at 32 px a second, re-planning from wherever it
  is. A test holds the state ahead of the position.
- **Anchors are named and reserved** (`ANCHORS` in `client/deck-geometry.ts`): stations round the mast
  and the stores, rest spots, helm spots on the quarterdeck, bow spots. A sailor takes the nearest free
  one; when a place is full it stands beside a taken one (`sharedSpot`), never on it and never on the
  stairs. A new anchor must stand on open deck: `deck-motion.test.ts` reads the atlas for every anchor,
  every walkable cell and every path between any two anchors.
- **Idle crew rest below deck** (`docs/deck-enrichment/below-deck-review.md`). The ship pack's rest zone
  uses non-spill floor below the hull, reached through its narrow access corridor. Once settled, a generated
  porthole represents each worker in front of the hull (`zone-appearance@1`), preserving its badge, identity,
  hover and focus. Posts fill in order; packing fits two dozen at regular spacing, with closer overflow and
  a gap round the plank. Active overflow stays upstairs. The linter checks every handle is visible, clear of
  active workers and reachable by the pointer. Its label hangs below the hull when there is room.
- **The suggestion shark** (`docs/deck-shark-suggestions/README.md`) uses generic `attention-carrier@1`.
  Its body and the legend's keyboard button open all first-mate suggestions in file order, through the
  board's existing `suggest` handler. It never selects a worker. Sailors keep their focus actions and
  linked replies in the focus panel, without sprite bubbles or reply markers. Sent suggestions remain
  visible but disabled until the file changes; send failures
  restore them through `answeredReplies`. Escape, outside clicks and another shark click dismiss the list.
  The carrier stays with no suggestions or crew; `bubbleHeight` names the sprite's top marker-only rows,
  hidden when the list is empty. Its body remains clickable for the empty-state bubble. Lite/reduced motion
  hold frame zero; hidden scenes pause on the existing clock. Missing art retains the keyboard action.
  Optional `carrier-surface@1` splits the sprite at a pack-defined waterline, tints its submerged rows,
  and draws a pixel ripple attached to it. The ripple, swim and loiter share the pack's water clock;
  marker rows stay clear. Packs without this capability keep their original carrier rendering.
- **Walking is A* over a 2 px grid** of the pack's polygons (main deck, stairs, quarterdeck and the
  below-deck room with its single access corridor) minus obstacle footprints, pulled tight. The only way to the helm is the stairs, which belong to the `near`
  piece, so a climbing sailor passes behind their balustrade.
- **Depth is set every frame.** The deck's layer sorts by `zIndex` from `depthOf(row, rank)`, so a
  walking sailor goes behind the mast while its feet are on or behind the mast's row and in front after.
- **The hatch.** Crew already aboard when the Deck opens are simply there. A crewmate that joins later
  climbs out of the hatch (its sprite cropped to the rows above the grate) and walks to its anchor.
- **The ship's departure choreography** (`client/deck-choreography.ts`, `docs/ship-deck-plank/README.md`). One whose card leaves the deck
  walks to the plank over the gunwale amidships, queues there in the order they left, and goes over the side
  one at a time: out along it, a jump, a splash, a shark. The scene says why each card is off the deck
  (`departureOf`: done, failed, closed; removed when gone from the board), and `portals.byDeparture` selects
  the exit. The ship sends all four reasons to its plank. From the plank's foot a sailor is a
  `Departure`, off the crew and on its own clock under a new key, so a card that comes back meanwhile is a
  new sailor from the hatch. A departing sailor has no badge or mark and is never under the pointer. The
  plank is a piece of the pack, drawn just in front of the near rail it stands `over`; off its end the sailor, the shark and the splash are in
  the `overboard` layer over the near sea, outside the bob. Under reduced motion a departure fades where it
  stood, redrawn by a timer only while something fades.
- **Disconnected workers are hidden by default.** `display.hideDisconnectedWorkers` is a host display
  setting, default true, beside Deck setting in Settings. `deckScene` uses only the existing
  `remote.online === false` out-of-reach decision, never worker status or a failing fleet load.
  Hidden workers leave the visible scene/counts immediately, with no departure animation; a short
  worker/host count offers Show. `client/deck-offline.ts` keeps that reveal per daemon on `globalThis`
  for this app session, shared by Home/Deck and scene remounts, without saving settings. Reconnection
  restores workers automatically. Hidden workers' decisions stay accessible with the reserved first
  mate and the unchanged ledger total. Crew is the backlog List, so Crew/List/Board stay unchanged.
- **Stale never reads idle.** A failing fleet load (`fleet.error`) greys the visible crew. With hiding
  off or Show selected, an offline host greys its workers: the last state stays, the sprite greys,
  the mark goes hollow, idle motion stops, and the pane says the feed is lost.
- **When it draws** (`deckAnimator`): `requestAnimationFrame`, capped at 30 fps; nothing at all while
  `document.hidden` or the pane has no size; no loop under `prefers-reduced-motion: reduce`, where the
  deck is drawn once per change with everyone at their anchor; 12 fps with no sea drift or gulls on a
  software renderer (SwiftShader, llvmpipe, read from the WebGL context). The canvas carries
  `data-firstmate-deck-motion`: `full`, `lite` or `still`.
- **The fit is exact, not by whole device pixels** (`fitDeck`). Rounding the scale down to whole device
  pixels an art pixel made the ship a staircase: at 2× it lost a third of its size a pixel past each step as
  the pane was dragged narrower. Now it is 0.96 of the pane at every size; only the offset is snapped.
  `client/deck-polish.test.ts` sweeps widths 200–2400 at five resolutions; `docs/ship-deck-polish/` has the
  drag measured in Edge, main against the fix.
- **Who each sailor is, on hover** (`docs/ship-deck-polish/README.md`). `startDeck` reads pointer events off
  the canvas, finds the sailor under it in the last frame drawn (`sailorAt`, the frontmost by depth, badge
  included) and reports `DeckHover` — key and place on the canvas — only when the sailor changes or moves
  more than two pixels. The label is React, the canvas host's sibling (the host stays childless), with
  `pointerEvents: "none"`: the card's title, the state in the board's words, project and host, the
  card's line at rest, and why it is greyed. Its words are `sailorCaption`, built in the scene from the card.
- **Clicking a sailor focuses it** (`client/deck-camera.ts`, `docs/ship-deck-focus/README.md`). The pane owns
  the focus (`nextFocus`: a click on the whole deck focuses, then any click but on that sailor lets go); the
  canvas only reports which sailor a click hit (`onSelect`) and takes `focus(key)`. The camera is a shot —
  how far in, and the deck point — turned into the world's fit each frame by `cameraFit` from the canvas's
  size *now*, so a resize mid-zoom or while focused re-fits; it follows a walking sailor, eases over
  `FOCUS_MS` on the deck's clock, and snaps under reduced motion. Behind the sailor a `veil` dims the world,
  and the sailor's sprites move into a `spot` container over it (riding the bob) until the camera is back
  out. The panel is not the deck's: `ShipDeckView` takes `renderFocus`, and the screen hands in the board's
  own `CrewCard` with `presentation: "focus"` — always open, a ✕ for the chevron, no tags, facts or report
  path — so its actions, guards and End confirmation are the board's. `focusLayout` places the panel (beside
  the sailor from `FOCUS_SIDE_MIN`, docked under it below) and the camera's anchor from one rectangle.
- **Every state wears a badge** (`client/deck-badges.ts`): ▶ working, hourglass waiting, ! blocked, Z idle,
  in the state's colour, drawn in the sailor's own layer so the pieces in front cover it, and the same
  badge keys the legend. An idle sailor breathes out a z under motion. The badge stands in for state poses
  the art lacks; a pixel artist's moving poses would carry state better (`docs/ship-deck-art/README.md`). The
  canvas harness's 2D reference draws the badges too, so the still comparison stays exact.
- **Replies stay in the crewmate's focus panel** (`client/deck-replies.ts`).
  A first mate's suggestion whose label or prompt names a card's task id, pull request or agent id is that
  sailor's reply. Its panel retains `ReplyOptions` and the existing `suggest` handler, send gate,
  `answeredReplies` suppression and failure recovery. `ShipDeckView` never marks worker sprites as
  asking and never mounts hover reply bubbles. Only the engine's reserved first-mate anchor reaches the
  count bubble, whose live component also rejects worker keys. `DeckAskMarker` is only the reply icon
  inside focus panels. Historical marker geometry stays covered by its pure regression tests.
  `node docs/fm-ui-polish/render.mjs` adapts the existing attention-deck and Plans render harnesses for
  before/after toolbar and Deck checks in both themes, exact-item routing, dismissal, scrolling, zero
  and all shipped scenes. Evidence stays in ignored `.local/fm-ui-polish/`; no daemon is touched.
- **Ambient life has no shaders**: whole-pixel bob and sway, a sea tile that scrolls, three lanterns, a
  gull now and then, so a software renderer pays only for sprites. The masthead sways because the hull is
  drawn in slices round the cutout of the parts drawn in its place (`client/deck-parts.ts`): the tall mast's, or the
  hull's own masthead's in the topmast's place where the tall mast did not load.
- **The weather follows the work** (`client/deck-atmosphere.ts`, `docs/ship-deck-atmosphere/README.md`). Working
  crew (waiting a quarter, blocked, idle and greyed not at all; local and remote) make an intensity, eased over a
  few seconds; the pack's `atmosphere.table` maps it to multiples of the art's own timing — glassy at idle, the art as delivered
  with two working, spirited at six. **A speed that changes needs its own clock**: each animation is handed a
  clock advanced by step × pace, never the scene's clock times a pace, which would jump the sea and the clouds
  whenever the crew changed. Reduced motion draws exactly as before (`deliveredWeather`).
- **Weather layers are data, not code** (`client/deck-variants.ts`, `client/deck-flash.ts`, `client/deck-ambience.ts`,
  `docs/ship-deck-weather/README.md`). The pack gives its tile, strip, cycle and drifting elements `variants` (a
  second frame set over each), `cycle` elements, `overlay`s on the sky and `flash`es, each with an
  `opacity` curve of `[intensity, value]` points (flashes also `perMinute`). The heavy weather is the first set; a new
  setting adds entries, not code. A variant rides its element's own clock and frame index, so it must have as many
  frames of the same size — one that does not line up, or did not decode, is dropped alone and the element stands.
  `over` (opaque art) hides the element once whole; `crossfade` fades it out. Flashes are capped at
  `FLASH_CAP_PER_MINUTE` whatever the data says. No layer draws on a still deck (`Weather.intensity` null); on a
  software renderer variants show on frame 0 and flashes never fire.

### The sea, the sky and the gull are generated art (`docs/ship-deck-environment/README.md` has the evidence)

- **In the pack, and not needed to draw.** The sky, the sea, foam and wake and the gull come with the rest of the
  ship's pack and are decoded one by one. Each ambience element stands alone (`compileAmbience`): without a phase of
  it there is no sky, nor the overcast, stars, clouds and lightning drawn in it, while the gull still flies; without a
  frame of the animated sea or foam, its still tile or strip (`sea-still`, `foam-still`, the elements' `fallback`)
  is drawn in its place and under its name; with neither sea the deck draws its ship and crew on a flat sea of the
  pack's `fallbackFill`. Each is a warning in the console (`packArt`).
- **Depth, back to front** (`createScenery`'s `back` and `front`, either side of `ship` in the world, each
  element in its slot by its `order`): the sky, its stars, the clouds, the gull, the sea's back band from the horizon
  (`sea:back`); the ship and everything on deck; the sea's front band from the waterline (`sea:front`), cut from the
  same tiles so they line up, the wake, the foam over the waterline and the spray at the bow.
  `client/deck-environment.test.ts` drives `startDeck` with a stand-in Pixi and reads the scene graph.
- **The sky follows the machine's local clock**, read through `DeckMotionEnvironment.clock`. Each of the
  six skies is alone from its manifest anchor (dawn 05:30, morning 08:00, midday 12:00, afternoon 16:00,
  dusk 18:30, night 21:00) until the 90 minutes before the next, when the next is drawn over it, eased
  (`dayBlend`, from the pack's `dayCycle`); the stars fade with the night's share. Not the manifest's whole-gap fade,
  which put half a dawn in the sky at a quarter past one. An invalid clock shows midday. No location or season is read:
  the anchors are wall-clock hours. A running deck reads the clock every frame; a still one (reduced
  motion) is redrawn once a minute by `every(SKY_REFRESH_MS)`, never while hidden. The canvas carries
  `data-firstmate-deck-sky`: the phase that shows most, or `none`.
- **The sky is placed, not tiled**: at the hull's pixel scale, centred on the ship, its row 213 (two
  thirds down, where the asset preview puts the sea) on the horizon, scaled up only as far as a wide or
  tall pane needs (`backdropPlacement`, from the sky's `placement`). The water tile scrolls 10 px a second and the foam 6.25, in whole
  pixels, both still under reduced motion and on a software renderer. The foam is cut from its repeat into
  at most three crops a frame across the hull's waterline (the strip's `span`), so it never runs into open sea.
  The gull flies behind the ship, beak-registered and mirrored to fly left, flapping `up mid down mid` at
  125 ms, and not at all while the stars are more than half out — its slots, speed, rows and flap are the pack's
  `flyby` (`flybysAt`).
- **Clouds drift in the sky's own pixels** (`client/deck-clouds.ts`, art in the ship pack's `clouds/`, its
  `drifters` element). Seven, one a lane, each a cloud's bottom a seeded 30–188 sky pixels above the horizon
  row, drawn with the sky's placement and scale, so a resize or the camera's zoom moves them with the sky and
  never against it (`layout` re-places them too, since a still deck's camera can lay out without a draw). Not
  the art manifest's rows 20–110: a pane that fits the deck's height shows only the sky's lowest ~96 rows,
  so the lowest lanes are what keeps a cloud in view there. Each drifts right ~0.2–0.8 sky px a second in
  whole pixels and wraps only wholly outside the sky, which `backdropPlacement` always makes at least as wide as
  what shows; held on a software renderer and under reduced motion, as the element says (`elementMotion`). Its lanes,
  margin and top are the pack's `drifters`. The field is seeded from the clock's second at
  start. **The tint is per colour slot, not a multiply**: each sprite holds exactly three colours, so
  `cutCloudMasks` (`client/deck-mount.ts`) reads it back off a scratch canvas into three white masks
  (`ImageBitmap`s), each a sprite tinted to its slot of the phase palette, crossfaded by `dayBlend`'s `t`. A
  multiply cannot brighten, and the afternoon palette is lighter than the source. A cloud that will not cut is
  left out with a warning, like any extra.
- **What still wants an artist** is in `docs/ship-deck-art/ENVIRONMENT.md`: the foam's scallops are regular and
  not fitted to hull C's curve, and the gull's wing sweep is approximate. The hull and sea are not tinted
  for night.

### The sail, the wake, the crew's looks and the sailor at ease (`docs/ship-deck-tweaks/README.md` has the evidence)

- **In the pack, and kept image by image.** The sail's two-state strip, the tall mast, six crew looks, and the
  plank's four shark keys and two splashes come with the ship's pack. `packArt` keeps whatever decodes: no sail
  without both its strip and the tall mast (the sail `needs` it), and a look that failed is not handed out, with a
  warning.
- **The sail hangs behind the crew** (`ship`'s children: the hull's slices, then the pack's parts in order —
  `tall-mast`, `topmast`, `sail` — then the deck). It rides the bob but
  not the masthead's sway, and alternates rest and billow every 850 ms, resting under reduced motion.
  While it shows, the mast's depth piece is the occluder — the mast with the rows behind the cloth
  cleared — so a sailor behind the mast is still covered from the cloth down, and the mast never paints
  over the sail. A sailor behind the mast stands with its head in front of the sail.
- **A look per crewmate, stable by agent id** (`DeckSailor.identity`: the agent's id, a remote worker's
  host and id): `lookFor` (`client/deck-cast.ts`) hashes it over the looks that loaded, whoever else is aboard, so two crewmates can
  share a look and a relaunched one (a new agent) changes its own. The extra looks use the atlas's
  base-lane rectangles and feet exactly, so `Figure.outfit` (the lane) still drives hit boxes and badges,
  and `Figure.look` the texture.
- **Idle is at ease**: the side view standing at rest (`STATE_POSES.idle`), looking fore or aft by seed,
  feet still; on the out-breath the top `BREATH_ROWS` rows are drawn a pixel lower over the body, each part
  placed by its top in whole pixels. Read the deck's canvas at art-pixel centres to compare frames: drawn
  in two parts, the body's rows can round to device pixels a little differently from the whole sprite.
- **The wake is the pack's**, a `cycle` at the stern whose opacity is the weather's `wake` channel. Where it did not
  load there is no wake: the wake drawn in code is retired, as is the plank's board drawn in code (captain's call: not
  baked to PNGs either).

## Remote work is on the board

Work on a saved remote host (see README's *Remote hosts*) is filed in the same columns as the local
crew. A backlog line names its host with `(host: …)` — the charter's spelling — or `(on-host: …)`, which
first mates have written too; both parse into `BacklogItem.host`. The value is whatever the first mate
wrote: a serverId, a label, or "Label serverId". `resolveHost` (`server/remote-cards.ts`) tries an exact
serverId, an exact label, a serverId among its words, then a label among its words, each only when one
host matches, so an ambiguous value is never guessed; this machine's own serverId is local work. A line
whose host is not a saved one still gets a card, with `serverId: null`, in its section's column (`backlogPlacement`).

`buildCards` never joins a remote line to a local crewmate, since task ids repeat across hosts.
`buildRemoteCards` joins it to a worker in the remote snapshot (`RemoteService.read()`, in memory, polled
about once a minute) by the agent id the line records (a prefix of seven or more counts, as `paseo`
accepts) or the worker's `firstmate.task`. The column is `crewPlacement`'s, fed the worker's status and
pending permissions and the status line `remoteReport` finds in the log tail the poll keeps — only after
the last `[User]` or `[Thought]` paragraph, so a prompt saying "done:" is not a report. Cards are keyed
`remote:<serverId>:…`, and a remote card has `remote` and never `agent`, so no local action can be
pointed at another daemon's id.

The snapshot's optional fields are used where the poll has them: `lastMessage` — the worker's last
message alone — is read for the status line before the log tail (`workerReport`), and
`pendingPermissions` (id, tool, description) counts toward Blocked and is spelled out on the card. A
`followed` entry is one of the captain's own sessions the first mate follows (`data/remote-follow.json`),
not crew: its card says so, it joins a backlog line only by agent id, the sidebar does not count it, and
End is off on the card and refused by the server. While a permission is pending, the worker's
`recentTools` — its latest tool calls, which show a waiting Bash command — are listed on the open card.
A host's `clockSkew` (host time minus this machine's, measured on each remote `run`) moves
the card's "updated" time onto this machine's clock, and a skew of three minutes or more, the helper's
own warning threshold, gets a line in the host's health.

**The task label takes a lookup.** `paseo ls` and `inspect` print no labels, so the poll asks the
other way round: for each unfinished line on a host whose worker is not known by agent id or an already
learned task (`remoteTaskQueries`, given to `RemoteService` by `index.server.ts`), one
`ls --label firstmate.task=<id>`, ten a poll at most, and the task stays on the worker after. A line that
records its agent id costs nothing.

**Actions** go through `RemoteService.request` with the worker's serverId — its allowed commands, its
target and credential handling, one attempt — and only to a worker the last poll found this first mate
owning on that host (`server/remote-crew.ts`). Steer is `send <id> -- <words>`: after `--`, as the helper sends a prompt,
the request path keeps the words out of its option checks and puts its own flags before them, and the CLI
reads them as text even when they start with a dash. Interrupt `stop`, End `archive`, Converse `logs --filter text`, re-read every
ten seconds while open. The plugin cannot see a remote turn end, so a steer is relayed to the first mate
without the answer (`templates/messages/remote-steer.md`), in one note per burst of steers to that worker. Relaunch is drawn disabled
with its reason: a new worker there needs a brief only the first mate can write. Steer, Interrupt and
End are off while the host is unreachable, and End always on a followed session. Errors are the request path's own — the remote CLI's
message, redacted — and anything still shaped like a password or pairing link becomes "Remote command failed".

**Machine filter.** `TaskToolbar` puts Machines, Suggestions and Tags in one compact row above List/Board.
The machine button shows the selected scope and warns when that host is unreachable. Its host Modal offers
All machines, This machine and each saved host, with reachability and working/attention counts, followed by
expandable connection health (projects, workspaces, providers, errors and clock warnings). Filtering still
uses `client/host-tabs.ts` and the saved `hostTab`; a host that is gone falls back to All. No saved hosts,
no machine button. Tags opens the shared `ItemTagFilter` in another host Modal, with the active count always
visible on its trigger and full selected names in its tooltip. The existing match-all filter, clear action,
overflow and saved selections are shared between List and Board.
The sidebar badge (`activeCrewCount`) counts remote workers like local ones.

## Status lines are read on the daemon, cached by `updatedAt`

`ReportCache` fetches a crewmate's timeline tail only when its `updatedAt` has moved and it is not
mid-turn, so a poll every few seconds costs one agent listing and nothing else while the crew is
quiet. `closingText` joins the assistant messages at the very end — a streamed reply arrives in pieces
that split anywhere, even mid-word — and `parseCrewReport` looks for the status line only in the last
few lines, so "the build is done: …" earlier in a message is not a report.

Columns (`crewPlacement`): a pending permission, an error or a running turn win (blocked, failed,
working); once the turn has ended the status line decides:

- `done:` or `resolved:` is **Ready** — finished, waiting on the first mate. **Done** is for work the
  backlog records as Done, and a crewmate that has reported done is still alive and In flight until the
  first mate lands it and moves the item. Its card keeps the status line and the item's hold, so
  "Done: PR …" still reads on it from Ready.
- `working:` or `paused:` that names a wait on something outside the worker — a gate, a run, a watcher,
  a background job, another worker, "until …" (`waitTarget` in `server/crew-report.ts`) — is
  **Working**, chip "waiting": workers often end their turn while a job they started runs on, and these
  read as Idle before. A wait on the captain is Blocked, on the first mate Ready.
- `working:` with nothing to wait on is a stall: **Idle**, chip "stalled". An ended turn with no status
  line is Idle too, and any other `paused:` is **Parked**.

An in-flight backlog item the board cannot match to a worker (`backlogPlacement`) — a session it does
not list, a host it cannot read — is Working with the chip "no worker seen", since nothing says it has
stopped; with a `(hold: …)` it is Blocked. The chip's word is the card's `note`, set only where the
live status alone would not explain the column. Ready came after the other seven, so a saved
`columnOrder` without it gets it at its end (`orderedColumns`). Remote workers, followed sessions
included, are placed by the same function; a followed session is marked as followed on its card.

**List is the default** (`crewView` in display settings). Crew and the summary Board use
`client/task-presentation.ts`: Needs you, In hand, Later and Done. This projection never changes
`CrewState`, `ColumnId`, report parsing, supervision or Deck placement. Only the server ledger's New
and Seen requests populate the decision queue. It is unfiltered, with **Filters don't hide decisions**
shown only while a host/tag filter is active, and
ordered New first, then longest waiting with a stable id tie-break. Its count is the server's
`actionCount`; worker cards never recompute it. Duplicate worker representations share one request,
and a request needs no worker card. Every request opens the shared drawer at its home/id/revision.

`client/task-list.tsx` owns one `ScrollView`. Needs you comes first, then In hand grouped **With the
first mate**, **At work** and **Parked**; Later and Done start folded to a count. Ordinary tasks obey
host/tag filters even when the decision queue is visible. Done means a completed backlog item,
with its outcome; worker finishes remain with the first mate for review. All completed outcomes are
shown newest first when unfolded. Existing card memory and drafts survive view/group changes.

`client/task-board.tsx` is the default four-column Board. Needs you is pinned first and can fold,
retaining its amber count. In hand groups by whose move; Later and Done start folded. The last three
columns can move. Desktop columns scroll vertically inside a horizontal board; phones stack all four
inside one vertical scroll container. New fold/reorder controls have 44-point targets and spoken
names, expanded states and disabled states. The List/Board switch still saves `crewView`.

The separate host settings document `task-layout`, version 1 (`shared/task-layout.ts`), owns summary
versus **Detailed columns**, summary order/folds and Crew's Later fold. It never migrates or writes
`display` version 1's `columnOrder`/`collapsedColumns`; particularly, `blocked` never means Needs you.
Existing installations start with summary defaults without a settings write. Detailed columns stays
available for one release, through Board's ellipsis menu and Settings. Folded summary strips retain
the full label and count, such as **Later · 23 ›**. `client/board.tsx` keeps its original
eight-column layout, order, folds, empty-column behaviour and Done cap. Switching back restores it.
Invalid/newer settings display a notice and remain read-only rather than being reset.

**A card at rest says whose move it is**, plus the worker's status line, next step or outcome.
Reason icons distinguish failures, permissions, review, work and the next step. Failure detail uses danger
ink; the redundant "In hand:" prefix is omitted. The first-mate group restores **waiting over 30m**,
using the last worker update with known remote clock skew corrected and offline feeds excluded.
Lifecycle chips, provider/model and original actions stay behind the details chevron. Project, host,
relative time and item tags remain visible. A card's accessible label includes its full summary even
when clipped. Compact decision rows show NEW, a one-line title, Your call, time waiting and Answer;
six desktop rows plus their header occupy about 340 pixels. Phones retain 44-point answer targets.
Full titles and worker details remain expandable. Contextual panels use their installation-owned drawer opener; view cards use the shared
surface action. Drawer dismissal returns web focus to the initiating control. Deck focus cards and
animation keep their existing presentation in this slice.

**Card spacing** (`density` in display settings) still changes ordinary-card padding and title size;
it never hides content or changes decision controls. `docs/needs-you/view-checks.mjs` exercises real
Crew and Board at desktop, 390 and 320 pixels, both themes, enlarged text, compact density, filters,
legacy settings restoration, focus, retained drafts and list scroll position. These are synthetic-host
fixture checks, not installed desktop or native-device claims.

`shared/needs-you.ts` carries optional spec/notes paths and ephemeral `answerOptions` from
`server/decision-options.ts`. Exact `For <task-id>:` suggestions bind only one unambiguous live hold;
the answer path rechecks label, prompt, home, request and revision before its existing durable send.
Explicit bindings remain supported. No suggestion/source file is rewritten. `client/decision-context.tsx`
supplies the merged drawer's ask and reading-material slots, using verified home links and a
four-line/700-character named-draft preview. See `docs/decision-ux-lists/README.md` for the slot contract,
render checks and evidence location.

## The first mate is told it lives in Paseo

Charter §0 says what the first mate cannot work out for itself: that it runs inside Paseo, and that
Paseo — not its memory or its records — is where the captain's projects, workspaces, agents,
providers and schedules are. It names both ways in: the MCP tools for acting on the crew, and the
`paseo` CLI for looking things up, with the exact commands. Without it a first mate asked "which
projects do you know?" answered from `data/projects.md` alone. So the registry now holds only each
project's delivery mode; which projects exist is `paseo project ls`.

The crew is listed with `paseo ls -g --label firstmate.role=crew`, not the MCP `list_agents`:
that tool defaults to the last 48 hours and 50 agents, and a crewmate older than that would silently
drop out of the first mate's view. Agents get `PASEO_CLI`, `PASEO_HOME` and their own
`PASEO_AGENT_ID` in their environment (seen on 0.9.1), which is what the charter points at.

## The templates

`templates/tools/recall.mjs` and the plugin-owned `data/recall.md` guide supply optional record
recall (approved D5 slice 1). `prepareHome` supplies code only: no catalog build, snapshot, watch,
config or operational charter change. Explicit `search|show|rebuild` uses the source allowlist,
exact file/unit digests and historical warnings documented in `docs/recall-slice1.md`. Rebuild reads
the existing baseline watch's snapshots and creates none. Private probes, corpora and trial evidence
stay outside Git and the indexed corpus. The later 160-run adoption trial has not run.

`templates/tools/launch.mjs` is the optional new-task helper, rendered by
`server/launch-tool.ts` during `prepareHome`. The first mate still creates local
workspaces/agents through its own MCP calls; the helper launches remote work only
when explicitly invoked by the current role, through the existing `remote.mjs`.
It never retries, archives or relabels. Attempt records are under
`data/<id>/launches/`; `status` is read-only and watches abandoned labels for late
workers. Backlog writes are best-effort and retain the exact recovery line: a
concurrent write between compare and rename can still be overwritten undetected.
`parts/brief-*.md` supply both the charter's brief and assembled briefs; message
templates under `data/templates/` are seeded once and remain editable. Local
branch/ancestry checks use read-only Git on Paseo's reported workspace; unsupported
remote checks stay unknown. See `docs/launch-tool.md` and `server/launch-tool.test.ts`.

**No text the plugin writes into the home, or says to the first mate, lives in code.** `templates/`
holds, in three places:

- **The home's files**, laid out as they land there — `AGENTS.md`, `icon.svg`, `data/captain.md` and the
  other records, `data/charter.md` with its note, `data/charter.new.md`, and `watches/` with the built-in
  watches and the folder's README.
- **`parts/`** — the sentences that fill `{{crewProviderRule}}` and `{{crewModeRule}}` in the charter, one
  for a setting left open and one for a setting chosen.
- **`messages/`** — everything the plugin sends the first mate: the note a restart adds after the opening,
  the Relaunch request, the note relaying a Steer (with the words for an answer that was too long or
  never came), the note for a Steer to a remote worker, and Bearings and Ahoy, each with a second form for words typed after `/bearings` or
  `/ahoy`. A template cannot branch, so a message that reads differently when something is missing is
  two files. Bearings and Ahoy are worded on the daemon — the app cannot read the plugin's files — so
  the buttons, ⌘K and the slash commands send `firstmate.mate.command` with the command's name and what
  followed it, and `commandText` picks the template. A watch message has no wrapper: it is `watch-output.md`
  and `watch-failed.md` blocks one after another, led by `watch-dropped.md`'s self-closing
  `<firstmate-watch-dropped count="N"/>` when a full queue dropped some.

`TEMPLATES` in `server/templates.ts` names every one, and `templates.test.ts` fails if the folder and that
list disagree, or if `package.json` stops shipping the folder (`files` names it; a top-level directory it
does not name is silently left out of the npm package).

HTML comments in a template are notes for whoever edits it. Where a template becomes a message or a part
of another file, `withoutNotes` leaves them out, so each part and message starts with a note saying where
it goes and what its placeholders are;
where a template is copied into the home as a file, its notes go with it and speak to the captain.
Placeholders are `{{name}}` throughout, filled by `fill` in a single pass, which leaves any name it was
not given alone and never reads a filled-in value for placeholders — a crewmate's answer relayed through
a Steer can say `{{title}}` and arrives as written.

**Finding the folder is the one hard part.** Paseo compiles the server half into one CommonJS script and
evaluates it from memory: `import.meta` is an empty object in it (esbuild's CommonJS output), the process
runs in the daemon's directory, and nothing in the plugin API names the plugin's. The daemon knows, and
`paseo plugin ls --json` says — the folder of a directory install, and for an npm install the package
itself, inside the daemon's `node_modules` — so `templatesDirectory` asks it, once per process, through the
same CLI lookup as `paseo stop`. In the tests, where the code runs from its own files, `import.meta.url` is
real and the folder beside it is used. A failed lookup is not kept; the next call tries again.

Templates are read once per process, so a changed template reaches a home in use on the next reload, and
only as far as the home takes it: the charter is re-rendered, an untouched `data/charter.md` follows, and a
record the home already has is never rewritten.

Checked on a throwaway 0.9.1 daemon from the packed tarball, unpacked and installed as a directory: a home
got every file, `AGENTS.md` with no placeholder left; and on the real daemon a reload rendered the same
`AGENTS.md`, byte for byte, as the charter held in code before the move. An npm install of 0.1.0 lists its
`path` as the package folder in the daemon's `node_modules`, where `templates/` ships from 0.1.1.

## The home

`server/home.ts` writes `AGENTS.md` (the charter, **rendered from `data/charter.md` on every launch,
every settings save, every plugin start and every save of that file in the panel** — it names the crew's
model, and a charter change should reach a home in use without a relaunch; a running first mate still
has to be asked to re-read it) and creates `data/captain.md`, `projects.md`, `backlog.md`,
`suggestions.md`, `learnings.md` and `opening.md` only when missing, so a relaunch never loses a record. `data/captain.md` is the
captain's to edit and outranks the charter below its hard rules; that is where customisation that
should survive an upgrade goes.

**The default home is `$PASEO_HOME/plugin-data/firstmate/home`**, and it used to be
`$PASEO_HOME/plugins/firstmate/home` — Paseo's install root, deleted by `paseo plugin remove` (see the root
AGENTS.md). `migrateLegacyFiles` (`server/config.ts`) moves the config on start, and the old default home
only when nothing knows it by path: not while a first mate is aboard in it, since the agent keeps working
in the directory it was launched in, and not while `projects/` holds clones, which are Paseo projects and
registry entries by absolute path (and the roots of their crewmates' worktrees). Nor when the settings
name that very directory as the home. A home that has to stay is used where it is — `defaultHome()`
prefers it while `plugin-data/` has none — and the reason is logged on every start. A home the config
names elsewhere is never touched. The config and the home are each used from wherever `dataPath` finds
them, so one that failed to move keeps working where it is and moves on a later start. Once the old home has moved, the Paseo project
still registered at its old path is left for the captain to remove.

There is **no `CLAUDE.md`**. Claude Code and Codex both read `AGENTS.md`, and a `CLAUDE.md` importing
it risks the charter twice in every turn. The opening asks the agent to read the file if it is not
already in its instructions, for a harness that reads neither.

**The opening is the captain's.** A new first mate's first message — what it is told at launch and at
restart, before the captain has said anything — is `data/opening.md`, written once with the plugin's own
wording (`templates/data/opening.md`) and read at every launch by `readOpening`. It is a file
in the home rather than a setting because it sits with the captain's other records, is edited in the Files
view, and survives an upgrade. HTML comments are notes to the captain and are left out, which is where the
file explains itself; a file with nothing else in it — emptied, or deleted and not yet rewritten — gives
the template's wording, so a first mate is never started with nothing to act on. A restart appends its
note (`templates/messages/restart-note.md`) after it: the heartbeat that note asks for is not optional, so it does not depend on
what the captain wrote. The charter's records table marks the file as the captain's, so the first mate
leaves it alone. An existing home gets the file on the next plugin start, like any missing record.

**The charter is the captain's to edit, too.** `AGENTS.md` is rendered, so an edit there is lost at the
next reload; it is rendered from `data/charter.md`, which starts as `templates/data/charter.md` — the
plugin's charter under a note — and is the file to edit. The note lists the placeholders and records a fingerprint of the
plugin charter the copy was taken from, and that fingerprint is how `syncCharter` (`server/charter-file.ts`)
tells the two cases apart when a new plugin version changes the charter:

- **Untouched** — the copy still matches its fingerprint, so the captain never edited it. It is replaced
  with the new charter: a home nobody customised keeps getting the plugin's improvements.
- **Edited** — the captain's text is kept and rendered. If the plugin's charter has changed since the
  version the edit started from, the new one is written beside it as `data/charter.new.md` and the board
  shows a notice with **Compare**, which opens that file in the Files view (`firstmate.charter.compare`
  writes it first, so it is there even for a copy the sync has not seen yet), and **Done**, which moves the
  fingerprint on and removes the file (`firstmate.charter.acknowledge`). Done restores the note if the
  captain deleted it; a copy without one counts as edited from nothing, so every plugin charter is news
  to it.

An emptied or deleted copy goes back to the plugin's charter. HTML comments are notes, left out of both
`AGENTS.md` and the comparison, so the fingerprint is of the words alone and a note of the captain's own
does not count as an edit. The board reads the state on every poll (`readCharterState`, one small file);
only a sync or the two calls write. The charter's records table tells the first mate that both files are
the captain's.

The backlog format is the contract between an agent and `server/backlog.ts`. Changing one means
changing both, and the parser stays lenient: unknown groups are ignored, a line it cannot read is
skipped, and `(since …)` is accepted without the colon because that is how the charter spells it.

**A title never changes** (charter §2). In the demo dry run a first mate waiting for the word to land
two local branches wrote "…, ready in branch fm/…, awaiting captain's approval to land" into both titles,
and the cards grew with them. The charter now says where status lives — the section, the crewmate's
status line, and `(hold: …)` for anything waiting on the captain, which the card already shows as
"Captain's call".

## Watches run on the plugin's own clock

`templates/watches/launch-metrics.mjs` is an opt-in template, registered in `TEMPLATES` but deliberately
absent from `BUILT_IN_WATCHES`: installation into a home is a separate approved step. It runs silently
every 15 minutes, baselines each host on its first successful listing, appends versioned launch
observations to `data/metrics/launches.jsonl`, and snapshots changed backlog bytes under
`recall/backlog/`. An unmeasurable host warns once per run on stderr and leaves unseen launches
eligible for retry without failing the run or blocking other hosts; internal storage errors remain
fatal. Its `--report` mode is read-only and groups explicit periods by locality. The lead
lookup mirrors `dataPath`/`role.mjs` current-before-legacy config precedence and verifies the home;
unreadable identity stays unknown. CLI-unexposed branches and remote receipt causes/retry counts also
stay unknown. Do not infer them from a requested branch or count workspace dispatches as worker
retries. `server/launch-metrics.test.ts` exercises public CLI projections, baseline/deduplication,
config precedence, snapshots, local/remote observations and reports. See the watch README for the
schema, installation and recovery limits. No existing watch or daemon lifecycle changes for this.

A watch is an executable script in the home's `watches/` folder that declares a crontab schedule in a
comment near its top (`server/watch-files.ts` says exactly which files count, and `templates/watches/README.md`
is the captain's documentation, env vars included). `WatchRunner` (`server/watches.ts`) ticks on every
minute's boundary and runs whatever is due, enabled and valid. Paseo's own schedules are no use here: each
fire prompts an agent, and a watch's usual run should cost nothing. The schedule is read in the daemon's
local time, and a minute the daemon missed is not made up.

**Output goes to the first mate only between turns.** Non-empty stdout is queued; a flush sends the whole
queue as one message, from `templates/messages/watch-*.md`, through `sendWithoutInterrupting`. It waits
while the first mate is `running` or `initializing`, or absent, and asks Paseo afresh before every send —
never assumes, since a note sent into a newer turn can replace that turn where the provider cannot steer.
The first mate's own `agent.turn_ended` tries the queue 1, 5 and 15 seconds later (`flushAfterTurn`: its
snapshot can still say running for a moment, and a crewmate's finish note may start a turn at once), and
every tick tries again. The queue holds `MAX_QUEUED` and counts what it drops, and one message holds at
most `MAX_MESSAGE_CHARS` (32,000), tags included: `fitWatchNote` keeps the newest blocks that fit and drops
the oldest whole, counting them in the same `<firstmate-watch-dropped>` tag and marking their watches
`dropped` on the card. The newest block always goes — two blocks at the 16,000 cap come to a little over
32,000 with their tags and marker, so only one is certain. **A run is one block**,
everything it printed, never a turn per line, and **a message carries nothing of the plugin's** — just
`<firstmate-watch name=… ran=…>` blocks one after another, oldest first, with the plugin's own facts
(a `failed=` block, a leading `<firstmate-watch-dropped count="N"/>`). How output is to be
read is the script's to say: charter §7 has the first mate take a script's own instructions as the
captain's, since the captain approved the script, and what it marks as quoted from others as information
only, so a script that relays outside text has to mark it (`pr-watch` prints its own line saying the
text it takes from GitHub — titles, check names, reviews, comments — is other people's, and prints every
piece of it JSON-quoted, so a hostile title cannot pass for a line of the script's own).

Two defences keep a watch message honest, and both are needed:

- **What a script prints cannot write a tag.** `quoted` (`server/watches.ts`) turns the `<` of anything
  tag-shaped into `&lt;`, stdout and stderr alike — not only the watch's own tags but `<firstmate-board>`,
  `<paseo-system>` and whatever envelope comes next, since the charter tells the first mate to trust
  those.
- **The chat folds only what the plugin sent.** A watch message goes out with a `messageId` starting
  `firstmate-watch-` (`WATCH_MESSAGE_ID_PREFIX`), which the daemon records as the timeline item's
  `clientMessageId` (`agent-prompt.ts` in Paseo). `watchSummary` (`client/transcript-rows.ts`) folds a
  message into one line naming the watches only when it carries that id and is watch-shaped; the captain's
  words, even a pasted watch block, stay as they are. A timeline rebuilt without the id shows a watch
  message in full rather than hiding anything. `<paseo-system>` and `<firstmate-board>` notes are still
  recognised by their text alone.

**The timer has no Paseo handle of its own.** The plugin API passes `paseo` only to RPC handlers and hooks —
but it is one object per plugin process (`plugin-process.ts` in Paseo creates it once), so
`server/watch-service.ts` keeps the first it sees from `firstmate.fleet.load`, the toggle RPC, or any
agent's `turn_started`/`turn_ended`. Until then, after a plugin start, watches run and their output waits.

What the card shows and the queue itself are in `$PASEO_HOME/plugin-data/firstmate/watches.json`, so a
reload neither loses an output the script has already moved past (the PR watch's baseline has advanced)
nor reports a failure twice. A failure — non-zero exit, timeout, a script that will not start — is queued
once, with stderr's tail, and marks the watch `failing` until a run succeeds; its stdout is not sent. A
run on Unix is its own process group (`detached`), so a timeout's SIGTERM, and SIGKILL two seconds later, reach its
`gh` — the SIGKILL fires even when the script itself has exited, since a child that ignores SIGTERM and has
closed its pipes outlives it. On Windows, Node shebang watches run through the plugin's own runtime
without executable permission bits; unsupported interpreters are marked invalid. They are **not**
`detached` there: a detached Windows process has no console, so every console program it starts — `gh`,
`git` — opens one of its own, about three seconds each, which ran `pr-watch` past its budget and its tests
past their timeouts (`watches.test.ts` times four child launches to keep it out). `pr-watch` also passes
`windowsHide` to `gh`, for a runner that has no console to share. A watch gets the daemon's whole
environment; a test that narrows it must keep `SystemRoot` on Windows, or Node's crypto can fail at
startup (`ncrypto::CSPRNG`). A timeout or abort
uses `taskkill /PID <watch-pid> /T /F` while the root process still exists, to stop its descendants too.
The desktop Paseo `.cmd` launcher is resolved to Paseo.exe and its runner; npm shims use their JavaScript
entry point. Keep all arguments as an array and do not introduce shell interpolation.
A plugin stop aborts running scripts the same way, and starts nothing after,
even from a tick already under way (`runWatchScript` checks an already-aborted signal before spawning). A watch still running when it is due again is
skipped, not queued.

**On and off is the daemon's config** (`disabledWatches`), not a settings document: the runner acts on it,
and a toggle from the card is `firstmate.watch.toggle`, read and written under `serialized` so two quick
presses cannot undo each other. The script is never touched.

**Built-in watches follow the plugin until edited**, like `data/charter.md`: each carries a
`firstmate-watch <fingerprint>` comment, and `seedWatches` (on `prepareHome` and every tick) rewrites an
untouched copy of an older version and keeps an edited one — the card says when the plugin's has moved on,
and deleting the file takes it. A deleted built-in is written again, which is why the card's switch is the
way to silence one. `pr-watch` is Node, with only dynamic `import()`s, so it runs whether Node treats the
extensionless file as CommonJS or ESM; its test (`server/pr-watch.test.ts`) seeds it into a temporary home
and runs it against a stand-in `gh` on a `PATH` of its own. It skips the backlog's `## Done` section,
subsections included, and comments by the account `gh` is logged in as — the crew's and the captain's own.
It has to finish inside the runner's two minutes, so it looks up four pull requests at a time, starts none
after a 70-second budget, and takes the least recently checked first, saving what it checked: a long or
slow backlog is covered over a few runs instead of timing out on every one.

`remote-watch`, the other built-in, reads only `data/remote-hosts.json`, the public catalog
`server/remotes.ts` writes about once a minute. That catalog lists the first mate's remote crew (by
`firstmate.role=crew` and its `firstmate.owner` label) and any agents `data/remote-follow.json` names
(`"followed": true`). It reaches those agents only through read-only `inspect`, `logs` and `permit ls`,
never labelling or sending to them, since they are the captain's own sessions. For each worker it adds
`lastMessage`, from `logs --tail 1 --filter assistant_message` (Paseo's `logs` matches an unknown filter
against the timeline item's type), and `pendingPermissions`, each request's tool and the description
`permit ls` gives. A waiting worker also gets `recentTools`, from the same `logs --filter tools --tail 3`
the helper's `permit ls` adds, because a pending Bash command is in the tool call and not the request. The watch reports a finished turn once, keyed by a hash of status and final
message, so a new `updatedAt` with the same words is not news. Running workers report only new
permission request ids. Reports share a 12,000-character budget, and a worker that does not fit
keeps its old state, so the next run reports it. A previous version's state (one signature string per
worker) is read as already reported, so an upgrade repeats nothing. Its test
(`server/remote-watch.test.ts`) runs the seeded copy against catalogs written by hand, and checks that
an untouched copy of the 0.4.0 version is replaced.

Watches open from `WatchButton` in the panel header, on every layout. `watchAttention` adds a count
and colour only for failing, invalid or off watches; quiet watches have only the muted icon. The host
Modal contains the existing `WatchList`, including schedules, switches and output. A watch's
name opens its script (`watchPath`, the same `watches/` the server reads) through the surface's `openFile`,
the charter Compare's way into the Files view: the Files tab on a phone, the right-hand pane otherwise.

## Suggestions are the first mate's, and a press sends one

`data/suggestions.md` is what the captain might do next — `- <label> :: <prompt>`, one per line — and
the first mate rewrites it whenever that changes (charter §2 and §9). The board reads it with the fleet
on every poll (`parseSuggestions`): notes are left out, a line without a label and a prompt either side
of the first `::` is skipped, and at most `MAX_SUGGESTIONS` are kept. Nothing in code writes a
suggestion; an empty or missing file hides the slim suggestion strip.

The one thing code does to the file is take a suggestion out, for a card's trash button
(`firstmate.suggestion.remove`, `removeSuggestion` in `server/home.ts`). It is found by the label and
prompt the board showed, not by position, because the first mate may have rewritten the list since the
board loaded it. Parsing and removal share one scanner (`scan` in `server/suggestions.ts`) that takes
notes out of the whole text, as the board always has, while remembering each visible character's
offset in the file: a note that splits a suggestion across lines is read the way the board reads it,
and removal deletes only that suggestion's own characters and its line break, never a note's bytes —
deleting the whole physical line could take a `<!--` with it and bring what the note hid onto the board.
A suggestion the file no longer has writes nothing. The write is `replaceTextIfUnchanged` in
`server/files.ts`: confined to the home, staged and renamed, and refused with `FileChangedError` unless
the file still reads exactly as it did — by content, since two writes in one millisecond share an
mtime — checked before staging and again just before the rename. A refusal is the first mate writing
at the same moment, and the removal starts over from its version, `REMOVE_ATTEMPTS` times at most. A
write landing between that last check and the rename is still lost: a rename cannot compare and swap.
The Files view's own saves get the same second check, by modification time as before. The RPC answers
with the list left, which the board puts in the fleet query at once.

On the card, the trash is a sibling of the send `Pressable` rather than inside it, so pressing it can
never press the card. A removal on its way shuts that card by label and prompt, not position
(`client/suggestion-removals.ts`), since a poll can move it; identical twins wait together, and the gate
is checked synchronously, so two presses before a redraw start one removal. The gate is in module scope,
like the send gate, because the list unmounts on a phone's tab switch and on the wide layout's board/Files
switch while a request can still be out.

A button sends its prompt to the first mate at once, and brings the chat into view to show it go out:
the First mate tab on a phone, the chat unfolded on a wide layout. The draft is not touched. The send is
the chat's own: `useMateSender` (`client/mate-send.ts`) is what Send, Bearings and Ahoy go through too,
so a suggestion is the same `firstmate.mate.ask` with the same failure toast, the transcript echoes it
like a typed message, and a first mate mid-turn gets it the way `server/send.ts` delivers any message.
The sender's gate — one message on its way at a time — is per first mate in module scope, not in the
chat's state, because the surface's buttons and the chat both read it, and a phone switching tabs
unmounts the chat mid-send; the buttons are disabled while it is shut, and a double press that gets in
before the re-render is refused by it. Phones keep First mate, List, Board and Files tabs; suggestions open
from the task toolbar, with the same send path back to First mate.

`TaskToolbar` keeps a Suggestions button and count visible, including when there are none, so removing
the last suggestion leaves a stable return-focus target. The button opens a host Modal without sending.
`SuggestionList` cards show the start of each prompt and compare their folded and full heights
(`client/suggestion-fold.ts`) to decide whether to offer expansion. Only the main button sends;
expand and delete are always siblings, so neither sends accidentally.
The filter-row Plans control uses the same `ToolbarButton` as Machines, Suggestions and Tags, with
`ListTodo`, a tooltip and selected/open state. Its existing filter/details modal is unchanged; Home's
Plans destination remains a separate header tab.

## The home is called FirstMate in the sidebar, with a ship for its icon

Paseo names a project and its workspace after their directory, and the default home is
`…/plugin-data/firstmate/home`, so the sidebar said "home" twice under a generic folder icon. `nameHome`
(`server/home-name.ts`) calls both "FirstMate" — the workspace through the SDK's `setTitle`, the project
through `paseo project rename`, since the SDK has no call for it. It runs on every launch and restart,
and — for a first mate launched before this existed — once per plugin process from the board's first
`firstmate.fleet.load`, only when the first mate works in its home (an adopted agent's workspace
elsewhere is not the plugin's to name).
A title or project name the captain set is kept, and the project is renamed only when its root is the
home itself: a home chosen inside another project keeps that project's name. A failure is logged and
never fails the launch or the board.

**The icon is a file, not a call.** Paseo looks for an icon in every project's own folder — `favicon.svg`,
`favicon.png`, `icon.svg`, `icon.png` and more, in `public/`, `assets/` and the like first and then the
root, square and 32 KB at most, an SVG taken as square (`project-icon.ts` in Paseo) — and shows it unless
an icon was uploaded in the project's settings. So `prepareHome` writes `icon.svg` into the home when it is
missing: the plugin's own sidebar ship, white on blue, 640 bytes (`templates/icon.svg`). The captain can
replace it, in the Files view or on disk, or upload one in Paseo, which wins. An earlier build set the icon
with the daemon's internal `project.icon.set.request` instead; a project it reached keeps that upload until
it is reset to automatic in the project's settings.

Checked on a throwaway 0.9.1 daemon: a launch made both "FirstMate", Paseo served the home's `icon.svg` as
the project's icon with no custom icon set, and with the project reset to its directory name, a plugin
reload and one board load named it again.

## Interrupting needs the CLI

The handle has no cancel. `server/cli.ts` runs `paseo stop <id> --home $PASEO_HOME`, preferring
`PASEO_CLI` — the daemon hands its plugins the path of the CLI it shipped with (seen on 0.9.1) — and
falling back to `PATH` and the usual install directories.

## Questions and permissions are answered in the chat

When the first mate asks the captain something (Claude's `AskUserQuestion`) or needs a permission, it
stops on a pending permission request. The chat draws each one at the end of the conversation and
answers it with `respondToPermission` from the client — the same call and payload the agent's own tab
sends, so nothing server-side is involved:

- **A question** (`kind: "question"`) is a form: one tab per question, options as radio buttons or
  checkboxes, a free-text box where the daemon added `allowOther`, and Dismiss / Next / Submit.
  `client/questions.ts` is a port of Paseo's `question-form-card-core.ts`, and the payload must stay
  identical to it: `allow` with `{ ...request.input, answers }` keyed by each question's **header**
  (the daemon re-keys them by question text for Claude), or `deny` with "Dismissed by user".
- **Anything else** is a card with the request's own `actions` as buttons, or Allow and Deny.

The request reaches the chat through the timeline: every timeline page carries the agent's snapshot,
pending requests included, and the request is itself a stream event, so it shows up with the next
re-read. The board's poll of the first mate (`updatedAt` and the pending count) is a second trigger for
a re-read, for a request the stream did not announce. The "waiting for your answer" banner now shows
only when the chat is out of sight — folded, or behind the Crew tab — with a button that brings it back.

Checked on a throwaway 0.9.1 daemon: a Claude agent's AskUserQuestion arrived in the timeline page's
snapshot with `allowOther` set, and answering it with `buildAnswers` got "I picked Blue." back.

## The screen and its sidebar row

Paseo 0.11 replaced the static sidebar row and the bare surface with `addScreen` and
`addSidebarHeaderItem`, and both keep the old id, `fleet` (`FLEET_SCREEN_ID`): the sidebar item's id is
the key Settings › Sidebar keeps its order and hidden state under, and a saved
`/plugin/firstmate/sidebar/fleet` link resolves to a screen of that id. The screen is titled
"FirstMate" — the old surface's header read "fleet" — and every way in — the sidebar, "Open FirstMate",
"FirstMate: bearings", `/bearings`, `/ahoy` — is `openScreen`. Two things Paseo draws differently for a
non-legacy item, and nothing here can change: the screen header has no ship, and Settings › Sidebar
shows a generic plugin icon.

The item (`client/sidebar.tsx`) is the one FirstMate row, with a badge in `trailing`: how many crewmates
Paseo still runs have their card in the Working, Ready or Idle column (`activeCrewCount`), and no badge at
zero. It reads **the board's own fleet query** (`useFleet`) rather than an agent observation of its own:
the screen, the panels and the item share one cache and one poll, and the count agrees with the
board's columns. The cost is that the poll now runs whenever the app shows this host — before, only
while the screen or a panel was open.

A row per crewmate was tried and dropped after the captain used it: a backlog title is a sentence with
notes, and Paseo's row draws its label with no line limit, so the rows were paragraphs; one count says
what the sidebar needs to.

## Conversing with a crewmate

Every card and list row has a **💬** at rest (`MessagesSquare`), a sibling of the card's
toggle — pressing it never folds the card, and pressing the card still only expands it. It opens the
**Converse drawer** (`client/converse.tsx`) in the right-hand pane: **docked** beside the list, board or deck
when the pane fits both (`drawerDocks`: 380 pt of drawer and 300 of surface), with ✕; **over** them
when it does not, with a back button named after the view ("‹ List"); filling the Crew tab on a phone
("‹ Crew"). The surface underneath stays mounted (`display: none` when covered), so Esc, ✕ or back
return to it scrolled where it was, and focus goes back to the 💬 (`converseButtonId`,
`focusWebElement`). The open worker is `watching` in module scope; its 💬 is lit. Pressing *Crew* again
also closes it. Deck's Converse and Steer open the same drawer. A narrow Deck uses an absolute overlay:
its canvas keeps its dimensions, scene and focused sailor underneath, with the covered view inert.
The deck yields its document keyboard handler while Converse is open, and ignores an already-handled
Escape when the drawer closes. Interrupt, Relaunch and End retain the card's guards and inline results.

**Items without a worker open a light discussion with the existing first mate.** Opening is read-only;
Send calls `firstmate.item.discuss`, using `askMate` and its lifecycle guards. The discussion template
explicitly forbids dispatch or implementation. **Start work… → Request dispatch** is a separate,
explicit request for the first mate to turn the discussion into a brief and dispatch using its own tools.
The UI says **Work requested**, never claims a worker was created from successful message delivery.
After graduation, follow-up questions keep the original work request's authority and scope.

`shared/item-threads.ts` reuses `itemTagKey`: host, project and task, independent of title, column and
worker. `converseKey` keeps the existing worker id when one exists, otherwise an encoded `thread:` key.
An open thread stays selected when a worker appears; **Worker | Item discussion** switches between the
two without changing recipients or drafts. Reopening a live worker defaults to phase-1 read/steer.

`server/item-threads.ts` stores `data/item-threads/<sha256-key>/thread.json` and asks the first mate to
write each reply to `<message-id>.reply.md` beside it. These reply files are the thread transcript,
read every five seconds while open; unrelated first-mate timeline text is never attributed to an item.
The plugin owns the JSON, the first mate owns the replies. Both remain readable in Files and survive
reloads and first-mate replacement. This is a model/file contract, like the backlog, not a second agent
or a new topic transport: if the first mate omits the reply file, the drawer keeps awaiting the saved
reply. Permissions on the first mate are still answered in the bridge.

Writes use the existing confined, atomic, content-checked home-file path. A send reserves its message
id and receiving first mate immediately before delivery. A lost response or restart never automatically
resends it; uncertain delivery is shown explicitly. Graduation is reserved once per discussion, even
when uncertain; further clarification goes through discussion. Current fleet identity and absence of a
worker are checked before graduation, and its template checks for an existing worker before dispatch.
No steer, receipt id, or burst relay code changes for live workers.

The drawer is a non-modal `complementary` region named "Conversation with ‹title›". Top to bottom:
the title, state chip and tags; the glance — status line, captain's call, error, link, one line each;
**↗ Open in its own tab**, local workers only, opens the native Paseo agent tab on demand; **⋯** for the card's
details and actions (`presentation: "drawer"`: always open, no title, no Steer); **Conversation |
Activity**; the transcript; and the composer. Its Esc is bound in the capture phase, since a text box
keeps its key presses.

The **composer** is the steer: the same `firstmate.crew.steer` and `firstmate.remote-crew.steer` the card
used, so the relay and its bursts are unchanged. Enter sends and Shift+Enter is a new line on the web in
a wide layout (`isSendKey`), and the composer takes focus there as the drawer opens; on a phone nothing
does. The draft is kept per worker in the chat's `drafts` store (`converse:<watchKey>`). A send shows at
the foot as *sending*, then *sent* until the transcript has a prompt with its words (`unseenSends`
counts, so a repeat is not taken as delivered by the first), or *Not sent* with Retry, the words going
back to the box. While the worker runs, ■ Interrupt sits by Send and the hint says a message joins the
turn or restarts it, as the provider allows; while it waits on a request, the hint points at it.

**Conversation** (`conversationRows`) folds the Activity rows: prompts and replies in full, labelled
**YOU** for a prompt carrying the captain's steer id, **PROMPT** for any other (the first mate's, or typed
in Paseo — nothing in the timeline says which), **WORKER** for replies; reasoning left out; a run of tool
calls one line that opens to the calls; the plan one line. **Activity** is what Watch was. The choice is
kept in module scope.

A remote worker's drawer reads `paseo logs --filter text` through the remote request path every ten
seconds, as Watch did: no tool calls, its permissions answered on the host, no ↗ (whether the app knows
that host is not something the plugin can see). Its composer is off, with the reason, while the host is
unreachable or not saved.

The transcript is `useAgentTimeline` on the crewmate, the tail of 200 projected entries, turned into
rows by `activityRows`. Where the chat folds the first mate's machinery away, this keeps it: reasoning,
every tool call with an expandable detail (a shell command's output from its end, an edit's diff, a
file's content from its start, all clipped to 40 lines), and only the **latest** plan, because each
update restates the whole list. Claude's task tools reach the timeline as that plan
(`claude/task-state.ts` in Paseo); Codex, OpenCode and ACP providers send it directly. `hasOlder` on
the page offers Load earlier messages through the shared history hook, preserving the reading offset.
Worker replies reuse chat Markdown, code/message copy and the local image reader. Unqualified worker
images resolve from its cwd inside its registered workspace, never the first mate's home; missing or
remote identities fail closed. Both chats share `GrowingChatInput`, with the first mate's existing
one-line measurement and 160-point cap. `docs/deck-side-converse/` records the fixture checks and shots.

Rows — here and in the chat — are keyed by their entry's `seqStart` (`rowKey`). The entry's end grows
while a tool call runs or a reply streams, and its position in the page shifts by one with every new
entry once the tail is full; a key built from either remounts the row, which closes an open tool
detail just as its output arrives.

**Text rows preserve the projected timeline's message boundaries.** `continuesText` in
`client/transcript-rows.ts`, shared with Converse, joins only adjacent text entries with consecutive
sequence ranges and matching provider, turn id and (for assistant text) message id. It checks the
previous timeline entry, not the previous visible row, so hidden reasoning and removed plans do not
join unrelated replies. The daemon already merges continuous streaming chunks; no separator is added
inside those chunks. Separate messages are separate Markdown renders, using the existing row spacing.
Paseo omits `<paseo-system>` prompts, so a final reply and the next worker-triggered commentary can be
adjacent without a user row; their turn/message ids still distinguish them. Rebuilt provider history
can omit turn ids, making message ids necessary too. The isolated regression harness and exact
reported boundary are documented in `docs/chat-message-boundaries/README.md`.

A crewmate's pending questions and permissions are answered here exactly as the first mate's are in
the chat — `usePendingRequests` and `PermissionCard`, shared — and the transcript follows its end the
same way (`useFollowEnd`, also shared).

"At the end" (`isAtEnd`) is judged against the **shorter** of the live content height and the one
`onContentSizeChange` last reported. On the web that report waits for a ResizeObserver and a
`setTimeout`, while react-native-web's scroll-end event, 100 ms after a scroll settles, reads the live
height — so an event landing in between saw a reply that had grown but not yet been followed, decided
the captain had scrolled up, and the chat stopped following until they scrolled down by hand. Jumps
are instant for the same reason: mid-animation, every scroll event reads as away from the end. A round
button over the transcript's foot, as in Paseo's own agent view, goes back to the end while the reader
is away from it.

Checked on a throwaway 0.9.1 daemon: a Sonnet agent's projected timeline came through as prompt, shell
calls with their output, and replies, and the compiled client bundle carried the view.

## The home's files, in the panel

A Files view — beside the crew board on a wide layout, a third tab on a phone — lists the home folder by
folder and opens any text file in an editor, with a Markdown preview for `.md`. Three calls in
`shared/files.ts`, handled in `server/files.ts`, and a fourth for the chat:

- **Confined to the home, twice over.** A path is normalized and refused if it is absolute or climbs
  above the home; then it is resolved through symlinks and refused if it lands outside the home's real
  path — for a file about to be created, through its nearest existing ancestor. A clone under
  `projects/` can contain links to anywhere, and the panel must not follow them out.
- **Saved against the version opened.** The first mate writes these same files, so a save carries the
  modification time the editor opened the file at and is refused if the file has changed since; the
  editor then offers *Overwrite*, which sends `force`. A file that changes on disk while open and
  unedited is reloaded quietly, off the list's ten-second poll. A save is a temporary file renamed over
  the old one, so the first mate never reads half of it.
- **Text only, up to a megabyte.** A NUL byte in the first 8 KB marks a file binary; either kind is
  listed but not opened.
- **The chat links only what the daemon vouches for.** `client/file-links.ts` picks anything
  path-shaped out of the first mate's replies — plain text, inline code, a Markdown link's target,
  never a fenced code block; a `/` or an extension, a trailing `:line` dropped, at most 1024
  characters — and `firstmate.files.find` answers which are files, through the same confinement,
  absolute paths included when they sit under the home. One query for the whole conversation, the
  500 most recently mentioned paths, re-asked every 30 s so a file named before it was written
  becomes a link. Opening one unhides a hidden right pane. Captain's messages are plain `Text`, not the Markdown renderer, so they are not linked.

`AGENTS.md` opens with a note that the plugin rewrites it on every start, pointing at
`data/captain.md` for anything that should last. The open folder, the open file and its unsaved text
are kept in module scope, like the chat's draft, so a remount does not lose an edit in progress.

Errors from any RPC reach the app wrapped as `Request failed: … requestType=… code=…`;
`errorText` (`client/format.ts`) strips that, so the panel shows the handler's own sentence.

## Context, Compact and Restart

The chat's button row ends with how full the first mate's context window is, the way Paseo's composer
shows it: `lastUsage.contextWindowUsedTokens` over `contextWindowMaxTokens`, read from the agent snapshot
every timeline page carries (so it moves with the stream, and the board's poll re-reads it too), coloured
at Paseo's thresholds — a warning from 70%, danger past 90%. Paseo draws its ring in SVG, and
`react-native-svg` is not a module a plugin may import, so `ProgressRing` builds the same ring from views:
each half of the circle is an `overflow: hidden` clip holding a ring whose border is coloured on two
adjacent sides only — a rounded border splits its sides at the diagonals, so that is exactly half a ring —
rotated so the coloured half slides into view clockwise from the top. At 0% the fill is not drawn at all,
since its edge showed as a hairline on the seam. Rendered through react-native-web in Chromium at 0–100%
and at 14 points to check the angles; iOS and Android draw per-side border colours on a rounded view the
same way, but have not been looked at. No usage yet — before the first turn ends — draws nothing, as
Paseo's does.

The ring is all the row shows, as in Paseo; the numbers — the share, the tokens — are in a tooltip above
it. It opens on hover (`Pressable`'s `onHoverIn`/`onHoverOut`, the web renderer's) and toggles on a tap
where there is no pointer, a phone; a tap under a hovering pointer is ignored, or clicking the ring would
hide the tooltip being pointed at. The box has a fixed width because an absolutely positioned view is
measured against its parent, the 28-point ring, and would wrap to it. Checked in Chromium through
react-native-web, hover, click and leave.

- **Compact** (`firstmate.mate.compact`) sends `/compact`, the command Paseo's own composer sends; Claude
  Code (a root-only command there, and the first mate is a root agent), Codex and OpenCode each compact on
  it. It is a plain send and refused while a turn runs — the button is disabled then, and the daemon
  refuses too: a slash command must be a turn of its own, where a send would interrupt the running turn
  and a steer would bury the command inside it. The compaction's
  two timeline entries — started, finished — fold into one line (`pushCompaction`).
- **Restart** (`firstmate.mate.restart`) archives the first mate and launches a new one in the home with
  the live agent's model, mode and thinking — not the config's, since they can be changed in its tab and
  an adopted first mate has none there — and the opening followed by the restart note, which tells it it is
  taking over. Archived
  *first*, under the same lock as a launch, so two first mates never hold the helm at once; a launch that
  then fails leaves none, and says so. Archiving retires its heartbeat, because Paseo completes a schedule
  whose agent is archived; the conversation stays readable in Paseo's history. Refused mid-turn, like
  Compact, button and daemon both: a turn cut off halfway through a dispatch can leave a crewmate the
  records never heard of.

What a restart costs: **crewmates the old first mate started no longer wake anyone.** Paseo's finish
notification goes to the agent that created or prompted the crewmate and is dropped when that agent is
archived (`setupFinishNotification` in Paseo returns early for an archived caller), and archiving a first
mate also takes the parent label off its cross-workspace children — which is why Herald 0.5 announces
them from then on. The restart note and charter §7 tell the new first mate to keep a heartbeat while any
are in flight, which is how it finds out.

Checked on a throwaway 0.9.1 daemon with a Haiku first mate: 33,969 of 200,000 tokens after launch,
4,949 after Compact, and Restart archived it and brought up the same model and mode, with the config
pointing at the new one.

## Showing Home's chat marks the first mate seen

While Home's chat is visible (not folded or behind another compact choice), a first mate flagged "finished" or "error" is cleared the way opening
it in Paseo clears it, so its workspace reads as done in the sidebar (`deriveAgentStateBucket`: an
idle agent without `requiresAttention` is `done`). The effect is keyed by the agent's `updatedAt`, so
a turn that ends while the panel is open is cleared too, and a failed clear is not retried until
something changes. A first mate waiting on a permission keeps its flag — Paseo's own "mark as read"
(`workspace.clear_attention`) skips those too, because the flag is the prompt to answer it.

The SDK has no call for it, so `server/daemon-session.ts` writes a `clear_agent_attention` session
message on the plugin's own IPC channel — the frame envelope the plugin's `DaemonClient` already
uses — and waits for the response carrying its own `requestId`. That is the protocol, not an
interface: a daemon that changes the message answers with a timeout, which is logged and costs
nothing. Only complete, valid session messages go this way; a malformed frame is a protocol
violation, and the daemon closes the socket every other call from the plugin rides on.

## A crewmate the first mate has read about leaves "Ready to review"

Paseo's sidebar puts a workspace in "Ready to review" while one of its agents has `requiresAttention`
set, which the daemon does on every running → idle transition (`attentionReason: "finished"`), and
leaves it there until someone looks at the agent. Nobody looks at a crewmate in Paseo — the first mate
reads about it in the `<paseo-system>` finish note — so without help every crewmate the first mate
ever ran piled up there.

**The note is not in any timeline a plugin can read.** The daemon drops every user message that is a
whole `<paseo-system>` envelope (`isSystemInjectedEnvelope` in Paseo's agent manager) before recording
it, so neither `turn_ended`'s `timeline` nor `paseo logs` ever shows one, even though the provider's
own session holds every note. The first version parsed the notes out of the hook's timeline and so
never cleared anything. Checked on the live 0.9.1 daemon: the first mate's Claude session held 23 notes,
its Paseo timeline none.

So `server/crew-seen.ts` goes by time. It hooks **the first mate's** `agent.turn_started` and
`agent.turn_ended`: when a first-mate turn *completes*, every crewmate the first mate created
(`firstmate.role=crew` and Paseo's own `paseo.parent-agent-id` set to the first mate — the note goes to
the creator) whose `attentionTimestamp` is no later than that turn's start is cleared, the same way
`markMateSeen` clears the first mate. The daemon sets the flag before it sends the note, and the note
either starts a turn or is steered into a running one, so a finish from before a turn started has
reached the first mate by the time that turn completes. A finish during a turn waits for the next one.
The first-mate hooks rather than the crewmate's own `turn_ended`, because that fires from the
crewmate's stream and can run before the daemon sets the flag. A cancelled or failed turn leaves the
work for the next completed one, and a turn whose start the plugin did not see — one running across a
reload — is skipped. Each clear logs `cleared N crewmates` to `paseo plugin logs firstmate`.

Only a crewmate of this first mate whose flag is still `"finished"`, with no pending permission, not
running and not in error, is cleared. A permission or an error still reaches the captain, and Paseo
ranks both above the flag regardless. The first mate itself does nothing, so the charter is unchanged.

**This relies on Paseo's internal message format, like `markMateSeen`**: `clear_agent_attention` over
`server/daemon-session.ts`, because neither `PaseoApi`, the MCP tools nor the CLI can clear attention
in 0.9. A daemon that changes the message answers with a timeout, which is logged, and crewmates go
back to waiting in "Ready to review". The follow-up is an upstream API — an `agents.clearAttention`
(or `workspaces.clearAttention`) on `PaseoApi` — and moving both callers onto it.

## Phones: the home indicator and the keyboard

The host pads a surface's top, under its header, and nothing else: not the home indicator, and not
the keyboard — Paseo moves its own composer with `react-native-keyboard-controller` and
`react-native-safe-area-context`, and neither is a module a plugin may import. So the chat does both
itself, with what `react-native` offers:

- **The home indicator.** The composer is wrapped in `SafeAreaView` (deprecated in React Native
  0.81, still present). It replaces the padding in its own style, which is why the composer's padding
  is on the view inside it. It does nothing on Android.
- **The keyboard.** `useKeyboardOverlap` (`client/keyboard.ts`) measures the chat pane with
  `measureInWindow` — the space the keyboard's frame is reported in — and the pane pads its bottom
  by the overlap. `KeyboardAvoidingView` is not used because it measures against its parent, which
  inside the host's screen needs an offset nobody here knows. Lifted above the keyboard, the composer
  no longer overlaps the home indicator, so its safe-area padding drops to zero instead of stacking.
- **The lists with text boxes in them** — the compact board, the panels, the launch screen,
  settings — use `automaticallyAdjustKeyboardInsets`, iOS-only, which insets a `ScrollView` and
  scrolls the focused box into view.

All of it was written against a screenshot and has to be checked on a device.

## Attachments go the way Paseo's composer sends them

Paseo 0.9 gives a plugin no composer to embed: composer pills and attachment sources contribute *to*
Paseo's own composer, and `@getpaseo/plugin/client/*` exports no input, picker or chip. So the chat
has its own, and sends what Paseo's composer sends (read in the 0.9.0 app and daemon):

- **An image** goes in the send's `images`, base64 with its type — raster types only, by Paseo's list;
  an SVG is a file.
- **Any other file** is written to `$PASEO_HOME/uploads/upload_<uuid>/<safe name>` and goes in
  `attachments` as `{ type: "uploaded_file", id, fileName, mimeType, size, path }`; the provider tells
  the agent the path. Paseo's app uploads over a binary channel a plugin cannot reach, so the bytes
  ride the `firstmate.mate.ask` RPC as base64 and `server/uploads.ts` writes them in Paseo's layout —
  only once the first mate is known to exist. Paseo caps one file at 50 MB and nothing else, since each
  upload is its own stream; here one RPC carries the whole message in one WebSocket frame, and the
  daemon's socket takes `ws`'s default 100 MiB. So the contract holds images and files alike to 50 MB
  each, 20 per message and 64 MB together (about 85 MiB as base64), and the client checks the same
  before it reads a byte.

Picking, pasting and dropping are all `client/web.ts`, and **all of it is web-only**. Paseo's native
app picks with Expo's image and document pickers and pastes through a third-party text input; none
of those is a host module, so on iOS and Android the attach button is not drawn and the chat takes
words only. A phone *browser* gets the button, and its picker offers the photo library and camera.
Paste takes images only, as Paseo's does, so pasting text or a copied file still pastes text.

The pending attachments live beside the draft on `globalThis` (`client/attachments.ts`), bytes and
all, so a lost connection keeps them; a failed send puts them back unless something new was attached.

**A sent image comes back from nowhere but the chat's own copy.** The daemon's timeline records a sent
message's words alone (`submittedPromptText` in Paseo's agent manager keeps text blocks only), so the
transcript cannot show an image from it; Paseo's app shows one from its local copy of the message. The
chat does the same (`client/sent-images.ts`): a message with images is sent with a `firstmate-captain-`
`messageId`, its images kept under that id on `globalThis`, and the captain's row whose `clientMessageId`
matches draws them. Browser clients also cache the association and bytes in a plugin-specific IndexedDB
database (`image-cache.ts`, the browser adapter in `web.ts`), bounded to 50 messages and 128 MiB of base64.
Failed sends delete their cache entry; cache failures never prevent sending. The cache is local to the
browser profile, so another device or a message sent outside the plugin still has only words or
`(attachments)`. Native clients have no host storage/picker API. `docs/image-preview/` records the first
memory-only fix; `docs/chat-parity/README.md` records the current capabilities and boundaries.

Both chats use the same image viewer, copy controls and **Full conversation** shortcut. The chat's
Markdown opts into image lines and code copy with `chatTools`; other Markdown consumers keep their
existing rendering. Earlier history is loaded by public `before` cursors in `useAgentTimeline`,
retained through live-tail reads, and discarded on an epoch change or gap. `follow-end` preserves
the reading offset when older content is prepended; its ordinary follow/jump/permission rules remain.

## The remote helper

`tools/remote.mjs` (from `templates/tools/remote.mjs`) is how the first mate drives saved remote hosts:
it queues a request, and `RemoteService` (`server/remotes.ts`) runs it as one remote `paseo` CLI call.
The first mate's guide is `templates/data/remote-access.md`; keep it in step with the helper.

- **Errors are the CLI's own.** `remoteError` takes the JSON error's message and details, else the
  text, from stderr and then stdout, capped, through `redact`: the host's password and relay details,
  pairing links, relay URLs and bearer credentials never come back. Text that mentions a password or
  authentication still becomes "Remote authentication failed", and the queue's own guard still drops a
  message with a pairing link or `relay://` in it.
- **A prompt from a file goes after `--`.** The helper's `--prompt-file` reads a file inside the home
  and passes its text as the last argument after `--`, so a brief starting with a dash stays text;
  `commandArguments` checks options only before `--` and puts its own flags there. The CLI's own
  `--prompt-file` is refused, because it would read any file the daemon can. 28,000 characters at most,
  for a Windows command line.
- **Nothing here reads remote files.** The remote daemon has a read-only, cwd-confined file read
  (`file_explorer_request`, `workspace.read`), but the 0.11 CLI does not expose it, and the plugin
  cannot import Paseo's client or its transports (relay, SSH). A `paseo` command for it, or a plugin API
  that reaches a saved host, is what it would take; until then the guide has workers put reports in their
  final reply or push them.
- **Permission requests lose their input in the CLI.** `permit ls` and `inspect` keep only the tool name
  and description: a Claude question's text and a Bash command stay on the daemon. The helper adds each
  agent's last three tool calls (`logs --filter tools`), whose summary carries a Bash command.
  `permit allow --input '{"answers":{…}}'` answers a Claude question: the daemon merges the original
  questions back in and matches answers by question text or header. For any other tool, `--input`
  replaces the tool's input, so the guide offers it for questions only.
- **Remote times are the host's clock, and it can be wrong.** A first mate saw a host run about an hour
  behind. Times are passed on as reported, never converted. After a successful `run`, `measureClock`
  inspects the new agent (read-only). Its `CreatedAt` should fall between sending the run and the answer
  on our clock, and whatever lies outside that window is the host's skew. It is stored as the host's
  optional `clockSkew` (`shared/remotes.ts`), kept across polls, and published in `remote-hosts.json`.
  While it is 180 seconds or more, every queue answer for that host carries a `warning`, which the helper
  prints on stderr; so does `hosts`. `paseo status` reports no server time for a remote endpoint, and
  `run --json` returns no creation time, which is why it takes the extra `inspect`.

## What was left out

From FirstMate the distro: the session backends (tmux, Herdr, cmux, Zellij, Orca), treehouse, the
watcher and its wake queue, secondmates, Relay, `/afk`, calm mode and self-update — each is either
plumbing Paseo replaces or a feature for another day. `no-mistakes` is an external tool; its place is
taken by a `reviewed-PR` mode the crewmate carries out itself.

From ABorakati's plugin: changing the first mate's model, thinking or mode from the board (0.9's SDK
cannot; ABorakati's plugin sent raw daemon frames over the plugin's IPC channel, which is not an
interface — Paseo's own agent view does it), and dragging columns (arrows instead). Attachments came
later, web-only — see *Attachments go the way Paseo's composer sends them*.

## Checking it

Vitest loads `test/setup.ts` before every test file: it forces `FIRSTMATE_RECEIPT_JOURNAL=0`
and `FIRSTMATE_ATTENTION_OBSERVE=0`, `FIRSTMATE_NEEDS_YOU=0`
and gives the file a fresh temporary `PASEO_HOME`, removed after the file finishes. This applies to
`npm test` and direct Vitest runs, regardless of the shell's environment. Receipt tests may opt in
only against temporary homes and must drain pending receipts before cleanup. Never restore a live
home in a test. `test/journal-isolation.test.ts` launches a child test run with journaling enabled and
an existing stand-in journal, checks it stays untouched, and exercises explicit opt-in in the isolated
home. CI also starts the suite with the flag enabled to keep this boundary covered.

`npm test` covers the parsers, the column rules, the card join, the charter's placeholders, the home's
write-once records, the relay text, the transcript rows, the column order, and the watches — schedules,
the runner's queue and guardrails, seeding, and `pr-watch` against a stand-in `gh`. What it cannot cover,
check against a **throwaway daemon** (see the root AGENTS.md — never the real one, whose agents are
the user's):

1. `paseo plugin install "$PWD" --home /tmp/paseo-check`, then `paseo plugin ls --home /tmp/paseo-check`:
   `running`. The daemon sets `PASEO_HOME` for its plugins, so the plugin's files land under the
   throwaway home even when the shell's `PASEO_HOME` names the real one.
2. A throwaway `*.tmp.test.ts` can drive every RPC the way the app does:
   `new DaemonClient({ url: "ws://127.0.0.1:6799/ws", clientType: "cli", … })` from
   `@getpaseo/client/internal/daemon-client`, then `client.invokePluginRpc("firstmate", "<wire name>",
   input)`. Delete it afterwards.
3. The loop worth watching once per charter change: launch a first mate with a capable model, register
   a scratch `local-only` repository in `data/projects.md`, ask for a one-line change, and watch a
   crewmate appear on the board in its own worktree, report `done: ready in branch fm/<id>`, and the
   first mate relay it.
4. Then look at the screen and the sidebar row's badge, wide and compact, in two themes. The local
   render harness in `docs/board-list/` mounts the real `FleetSurface`, chat, cards and task layouts
   through react-native-web with only host APIs stubbed. It captures the before revision and both new
   views at 2866×1694 (45% chat) and 390×844, using 45 tasks, and checks scrolling, keyboard expansion,
   local/remote steer routing, Done, suggestion dialogs, Watches and host filtering. See its README.
   Native phone behavior still needs a device check; the harness covers the phone browser layout.
