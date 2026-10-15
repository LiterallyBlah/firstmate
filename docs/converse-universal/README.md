# Universal Converse

Every List/Board item opens Converse. Live workers retain their read/steer path. Worker-less items
open a persistent discussion with the existing first mate, with explicit **Start work… → Request
dispatch** graduation. No new agent or worktree is created by the discussion RPC.

The small server addition stores a confined home record and uses the existing `askMate` lifecycle and
delivery path. The first mate writes per-message Markdown reply files, so unrelated bridge turns are
never guessed to be replies to an item. This relies on the first mate following the message template,
like the existing backlog/status-line contract. A missing reply file stays visibly pending; first-mate
permissions remain in the bridge. The browser fixture simulates this contract; it does not exercise a
real provider. No real daemon or installed plugin was changed.

Self-review covered stable identity across worker attachment, mixed-recipient drafts, uncertain
delivery and duplicate graduation, lifecycle/home changes, file confinement, malformed records and
size limits. It caught and fixed draft omission during graduation, focus return after a worker appears,
and follow-up scope answers after the initial work request. Worker steer/receipt/burst code is unchanged.

Verification:

- `npm run typecheck`
- `npm test -- --maxWorkers=4` — all 82 files, 1046 tests passed, 3 skipped after rebasing onto the
  workspace-shell and collector changes (`origin/main` at `0d2f672`).
  The default high-concurrency run hit four unrelated timing-sensitive tests; the complete lower-
  concurrency run passed without changes to those tests.
- `npm run lint:deck-packs` — 51 tests passed (the repository's lint command).
- `git diff --check`
- Production client bundle built with esbuild and host modules external: no `class` syntax (310,061 bytes).
- `node docs/converse-universal/render.mjs` — List and Board at 1440, 900 and 390 pixels in light and
  dark themes. Results in `verification.json`; representative screenshots alongside this report.

The browser fixture renders the actual surface, cards, drawer and composer. It checks universal
icons, no send on open, scoped replies, drafts, cancel versus explicit graduation, one dispatch request,
phase-1 local and remote steering, worker attachment without replacing the discussion, separate
discussion/worker drafts, reload persistence and no horizontal overflow. The screenshots reflect the
new workspace views. Install its existing dependencies
with `npm ci --prefix docs/board-list` if needed; it uses headless Edge.
