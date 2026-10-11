# Plain item tags: isolated verification

The real `FleetSurface`, `TaskList`, `Board`, `CrewCard`, tag editor and filter render through
React Native Web. Existing `docs/board-list` host stubs are reused; synthetic tag RPCs and settings
live only in this harness's browser storage. No daemon, model, installation or real home is used.
Filesystem persistence is verified separately by `server/item-tags.test.ts` with temporary fixture
homes and the production save path.

Run from the repository with Node 24 and Microsoft Edge installed:

```sh
npm ci
npm ci --prefix docs/board-list
node docs/item-tags/render.mjs
```

Use `npm.cmd` in PowerShell when script policy blocks `npm.ps1`.

Every capture labels its view, theme and width. All eight scenarios passed keyboard add/remove,
AND tag filtering, intersection with host tabs, saved tag/filter reload, failed-save recovery and
document overflow checks. Screenshots were opened and inspected. The final limit capture exercises
12 tags and a 40-character tag on a narrow Board; the filter row stays scrollable within 108 points,
the remove button truncates within the card (its accessible name and hover title retain the full tag),
and removing a tag re-enables the input.

| Layout | Light | Dark |
| --- | --- | --- |
| List, 1440×960 | [Rest](list-desktop-light.png) · [Edit](list-desktop-light-edit.png) | [Rest](list-desktop-dark.png) · [Edit](list-desktop-dark-edit.png) |
| Board, 1440×960 | [Rest](board-desktop-light.png) · [Edit](board-desktop-light-edit.png) | [Rest](board-desktop-dark.png) · [Edit](board-desktop-dark-edit.png) |
| List, 390×960 | [Rest](list-narrow-light.png) · [Edit](list-narrow-light-edit.png) | [Rest](list-narrow-dark.png) · [Edit](list-narrow-dark-edit.png) |
| Board, 390×960 | [Rest](board-narrow-light.png) · [Edit](board-narrow-light-edit.png) | [Rest](board-narrow-dark.png) · [Edit](board-narrow-dark-edit.png) |

Each scenario also preserves `*-filtered.png` (empty host/tag intersection) and `*-save-error.png`
(a deliberately failed fixture save). [Maximum-size controls](board-narrow-light-limit.png) and
[machine-readable receipts](verification.json) accompany the matrix.

The initial [failed capture](failed-list-desktop-light.png) and [receipt](failed-receipts.txt) are
preserved. The visual checkboxes were selected after reload, but React Native Web had not exposed
their native accessibility state as `aria-checked`. Explicit web ARIA state fixed that; the final
matrix verifies selected checkboxes through the accessibility tree.

The limit fixture also preserved a receipt from an incorrect disabled-input assertion:
React Native Web uses `readonly` for `editable={false}`. The final check tests editability instead.
Visual inspection then caught [unbroken long text overflowing](failed-limit-text-overflow.png),
despite a correctly sized button. Text now truncates within its flex width, and a scroll-width
assertion verifies that limit case. The full-suite receipt in `failed-receipts.txt` also records the
deliberate charter fingerprint update required by the added tag documentation.

Regression coverage checks lenient repeated metadata, unchanged title/status/unknown metadata,
task identity across section moves and worker replacements, real remote card joins, ambiguous and
stale edit targets, concurrent additions/removals, content-conflict retry, corruption refusal,
limits and home confinement on Windows/Unix. A staging hook rewrites an agent's backlog while a
tag save is in progress and asserts the agent's exact bytes survive. Captain deltas also preserve
new tag metadata added later by an agent.

Self-review confirmed that only the shared card and crew content receive UI changes; the header
is unchanged. Tags use task/project/host identity, with host/agent identity for taskless workers.
Changing a task's id, project or host deliberately denotes another item. UI edits never save
`data/backlog.md`; only the captain-owned JSON sidecar is serialized and content-checked. The
existing atomic rename path has the same narrow external-write race as the Files editor, confined
to that sidecar rather than the agent's backlog.

Native iOS/Android and live daemon integration are not exercised. The browser's synthetic tag RPC
does not substitute for the fixture-home filesystem regression tests.
