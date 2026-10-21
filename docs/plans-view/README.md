# Plans browser

Home's Plans destination uses the existing `readWorkflowPlans` snapshot and review dialog.
Open plans appear first, approval reviews first within each group. Finished/declined history follows,
ordered by recorded completion/action time. Ship runs marked done remain open until landed;
invalidated evidence and uncertain outcomes remain open. Posture and status are distinct.

Authored plans show their runs, dependency reasons, decisions/options/recommendations and cumulative
used/approved budget. Automatic one-run plans have separate counted folds in both sections, expanded
when awaiting approval or matching a search. Each group initially shows ten rows, with Show more.
Search matches plan titles/ids, run titles, worker names/ids and pinned hosts. Browsing never writes
an approval. The shared snapshot now retains finished automatic plans as history, while the agenda,
Needs you, Bearings and board-card behavior keep their existing exclusions.

Run `npm ci --prefix docs/board-list`, then `node docs/plans-view/render.mjs`. This adapts
`docs/workflows/render.mjs` and the board-list baseline loader, mounting the real FleetSurface,
Plans browser and plan dialog through react-native-web with synthetic data and host APIs.
The baseline is commit `1685ff6`, before the Plans view. Wide/narrow desktop and phone-browser captures
cover both themes, grouping, paging, search, opening/closing without actions, requesting changes,
approving through the existing dialog and saving the Home pane.
Empty, offline/retry and partially quarantined states have separate captures. The fixture never
contacts a daemon or creates a native resource. It is not an installed desktop/native-device test.

All bundles, captures and checks are written only to ignored `.local/plans-view/`. Review evidence
is copied to `C:\Users\micha\.paseo\plugin-data\firstmate\home\data\fm-plans-view\evidence\`.
No generated evidence is committed.
