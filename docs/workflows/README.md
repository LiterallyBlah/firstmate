# Workflow slices 1 and 2

`shared/workflow-plans.ts` defines strict, bounded one-step task/scout plans. The daemon folds
exclusive-link, hash-linked events under `plugin-data/firstmate/workflow-plans/`. Start intent and
brief digest are committed before local launch instructions are exposed. The first mate still
makes every local Paseo call and verifies all delivery evidence; automated workflow checks arrive
in slice 4. A broken journal is refused. Views and Bearings are read-only projections.

The slice 2 dialog uses revision and subject-bound captain actions. Model choices are validated
against the live catalog at submission; hosts must still be saved. Started runs remain immutable.
Removing a prerequisite holds dependents rather than releasing them. No action resolves a merge,
deploy, discard or publish gate. No worker dispatch or multi-step recipe is installed in these slices.
Plan posture alone reads `plan-posture: review|sail|default` in one fenced `standing-orders` block
in `data/captain.md`. Explicit request words override it; missing/unreadable orders use D2 and
invalid entries require review. Merge, routing and the rest of D3 remain in slice 6.

Run `npm run typecheck` and `npm test`. On a busy Windows host the full local suite was also run
with `--maxWorkers=4 --testTimeout=30000 --hookTimeout=30000` to let subprocess tests finish and drain
before cleanup. CI uses its existing Ubuntu/Windows Checks workflow without these overrides.

For browser fixtures, first `npm ci --prefix docs/board-list`, then `node docs/workflows/render.mjs`.
The real plan dialog, chip, filter, Needs-you badge and Coming up components run through
react-native-web. Only host APIs and data are synthetic. Checks cover no action on render/open/close,
filter selection, requested changes, desktop/phone widths and light/dark themes. Captures and
`checks.json` land only in ignored `.local/workflows/`. This is a phone-browser fixture, not an
installed native-device test. It never contacts a daemon or creates a native resource.

`node docs/board-list/workflows.mjs` also mounts the full FleetSurface, TaskList and decision drawer.
Its disposable server store computes cards, Now, Coming up and counts; the browser checks badge = Now,
same-slug filter isolation, opening/closing the dialog and both themes/widths. Evidence stays under
`.local/workflows/integrated/`. No live home or installed plugin is accessed.

Review evidence is copied to
`C:\Users\micha\.paseo\plugin-data\firstmate\home\data\fm-workflows-s1\evidence\`.
No screenshots or generated bundles are committed.
