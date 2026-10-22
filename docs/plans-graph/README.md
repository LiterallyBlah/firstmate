# Plans dependency graph

Expanded plans default to a top-to-bottom DAG. The pure layout uses longest prerequisite paths;
steps at the same depth have no dependency path and can run in parallel when their prerequisites
and approval permit. Reviews and decisions remain separate nodes. External ancestors are included
and labelled Other plan, so a path through another plan cannot create false parallelism.
Unavailable prerequisites are explicit, and parallel claims are suppressed for incomplete topology.
Removed prerequisites use their retained title and a removed label, without treating their historical
dependencies as current routes. Level counts say "independent" even for completed or external work.

Native View borders draw directed connectors without extra runtime dependencies. Reason colours
and line patterns share a legend. Each source has its own horizontal routing height, long-edge arrivals
have separate heights, and incoming ports spread across the left half of their target; unrelated routes
cannot merge into shared segments or align entry/exit stubs. Level labels occupy the right half of a
card header, clear of those incoming ports. Selecting a node highlights its incident edges and opens a host
dialog containing its full state, summary, dependency reasons and required outcomes, recommendation
or answer, and running worker/host details. Open plan details uses the existing plan dialog.
Browsing reads the existing WorkflowSurface snapshot and records no action.

The Graph / List toggle retains the original compact list and review chips. It is local browsing
state, shared across the browser's expanded plans. Graphs exceeding 60 nodes (including ancestors)
or 120 edges, or containing a cycle, offer List as a fallback. This bounds graph size and clutter;
the plan contract still supports its original limits. Broad graphs scroll horizontally and start
centred so their first level is visible at phone width. Long edges use a gutter outside all cards.

Run `npm ci --prefix docs/board-list`, then `node docs/plans-graph/render.mjs`.
This adapts `docs/plans-panel/render.mjs`, reuses its real-shaped Starpath/reader-pass fixtures and
synthetic host shell, and mounts the actual registered Plans browser and dialogs via react-native-web.
The baseline is `3afaacd33185c3eb9916d1077d497dec529c59df`, before the graph.
Checks cover all plan nodes, external prerequisites, parallel groups, reason labels, keyboard access
to step details, the existing plan dialog, Graph/List switching, no page overflow, and no plan actions
from browsing. Captures include before-list, after-list, graph, full-width graph, and step details in
both themes at desktop and phone-browser widths. This does not claim a native device or installed
desktop test. The live plugin is never reloaded.

All generated bundles, PNGs and checks stay in ignored `.local/plans-graph/`. Reviewer evidence is
copied to `C:\Users\micha\.paseo\plugin-data\firstmate\home\data\fm-plans-graph\evidence\`.
No generated evidence is committed.
