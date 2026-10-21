# Plans workspace panel and compact browser

`firstmate-plans` contributes Plans / ListTodo to Paseo's workspace tab menu and Home's Open
shortcuts. It shares FleetSurface, WorkflowPlansView, the existing workflow snapshot and review
dialog with Home. It follows the other fleet panels' home-workspace guard and attention rules.

Plans start collapsed. A summary shows progress over primary steps (ordinary ship work must land), running
work, the next work and unmet prerequisites, outstanding captain decisions, and attention for
unresolved, invalidated, failed, held or awaiting-landing work. Expanded builds
carry compact review chips. A scout is folded only when its name identifies a review and it has
exactly one same-project build linked by a needs-evidence dependency. Ambiguous reviews and
independent investigations remain separate. A check mark means a recorded done/landed outcome,
not a new approval. Worker/host details show only for running steps. Held, invalidated, missing or
unsatisfied prerequisites cannot produce a ready label. Automatic one-run copies are suppressed
before searching, using task/project/host identity, only while planned or when the owner has recorded
work beyond planned; unaccounted automatic work and unrelated host/project tasks stay visible.
No source plans, budget, agenda, counts or approval behavior are changed by these display rules.

Run `npm ci --prefix docs/board-list`, then `node docs/plans-panel/render.mjs`.
The harness adapts `docs/plans-view/render.mjs` and `docs/shell-phase1/panel.jsx`. The baseline is
`200e73e05da3293718d41db95298b07634403d28`, which has the original flat Plans browser.
The Starpath fixture preserves seven builds, fourteen reviews and a later decision. Reader-pass
preserves four build/review groups, two independent probe runs, two decisions and cross-plan
prerequisites. Topology and representative names follow the saved plans; progress, worker IDs,
hosts and evidence are synthetic. An automatic duplicate exercises suppression. Live files are
never loaded or changed by the harness.

Captures cover both themes at 1440, 900 and 390 pixels: before/after menu descriptors, collapsed
summaries, each plan before/after and expanded, plus empty/offline/retry/partial states. Checks
also capture Home's grouped List/Board/Deck and Home files/Plans header, including the narrow
Home view menu and compact wrapping, against the former single row in both themes. They
exercise the real registration, dedicated and inline browser, Open shortcut, review dialog,
duplicate removal, home-workspace/adopted-mate guards, no actions on browse, no attention clear
from Plans and no horizontal overflow. The fixture menu visualizes actual registered descriptors;
it is not an installed Paseo menu or a native-device test.

Bundles, PNGs and `checks.json` are written only to ignored `.local/plans-panel/`.
Reviewer captures and check output are copied to
`C:\Users\micha\.paseo\plugin-data\firstmate\home\data\fm-plans-panel\evidence\`.
Generated evidence is never committed.

Bearings now uses `shared/workflow-plan-summary.ts`, also used by the browser. It sends bounded
open-plan lines and due/upcoming decisions, without finished history or separate review rows.
Its strict owned envelope keeps the visible captain request short; Home/Chat and native chat reuse
the existing watch-note disclosure, collapsed until explicitly expanded. The message still carries
the complete compact overview to the mate. Pasted or malformed envelopes are never hidden.

Evidence-only ship trials use an explicit `workflow.mjs close` receipt after verified `done`, with
current attempt/hash and explanatory evidence. This preserves outcome, identities and cumulative
budget, without satisfying landing dependencies. Pending landing dependents, including retained
declined plans, require replanning. Close refuses incomplete dependency inventories, including
unretired quarantined plans, so repaired records cannot invalidate the home's later commands.
The fixture includes six such trials: they appear open in the baseline and as retained finished
history with closure evidence afterward. Store tests cover append-only/restart/idempotency,
refusal paths, unchanged reports/budget and done-versus-landed dependency behavior.

Additional day/night desktop/phone captures show Bearings before/collapsed/expanded, retained trial
history and its closure evidence, and Home with guest chats before/after removal of its warning.
The role helper and guest guidance are unchanged. The raw compact Bearings text is also saved.

`node docs/plans-panel/render.mjs --review` runs only the attention regression captures against
PR head `7568147`, writing to ignored `.local/plans-panel-review/`. Both themes at desktop/phone
widths show unresolved, invalidated, failed and awaiting-landing steps in the collapsed summary
and compact Bearings, with the existing disclosure still collapsed initially.
