# Decision lists, context and Deck

The List uses compact decision rows; the fixture measures six rows plus the header at 341 pixels
on desktop. NEW has a filled Answer control; Seen retains Answer and the ledger count. At rest,
ordinary tasks show the worker's status after whose move, with reason icons and visible time.
The 30-minute hint measures the last worker update, not an inferred supervision SLA. Offline feeds
do not add to it. Board retains folded labels and moves Detailed columns into its ellipsis menu.

## Shared contract and drawer integration

`shared/needs-you.ts` adds optional `source.specPath` and `source.notesPath`, and optional
`snapshot.answerOptions: DecisionAnswerOption[]`. Each option is `{ label, prompt, decision:
{ homeId, requestId, recordRevision, actionId } }`. The server reads suggestions without modifying
them. An exact `For <task-id>:` prefix binds only an unambiguous live decision; explicit bindings
remain supported. The captain's press goes through the existing durable answer reservation and
send path. Changed hold revisions, missing/changed/duplicate suggestions, quarantined sources,
ambiguous task ids and stale data refuse delivery. Reads never authorize or send anything.

`client/decision-context.tsx` exports `DecisionAsk` and `DecisionMaterials`. Both take
`{ theme, source, homeId, onOpenFile(path) }`. `DecisionAsk` renders the ask inline with verified
home paths and HTTP(S) links. The drawer owns its callout. `DecisionMaterials` renders reading
chips and the first named draft's first four lines, capped at 700 characters. Missing or unreadable
files cannot become invented links or previews. Existing confined `findHomeFiles` and `readHomeFile`
RPCs are reused; no new file endpoint or home edits are needed.

The drawer from merged PR #123 uses these exports in its ask and reading-material slots with
`{ theme, source: request.source, homeId: snapshot.homeId!, onOpenFile: setFile }`.
Materials also accepts `compact` for 44-point phone controls. Its bound option renderer consumes
`snapshot.answerOptions ?? suggestions`; an absent server field retains legacy explicit bindings.
The final shared `client/decision-copy.ts` helpers and automatic Seen behavior from #123 are preserved.

## Verification

Run `npm run typecheck`, `npm test -- --maxWorkers=2`, `npm run lint:deck-packs`,
`node docs/attention-deck/compile.mjs`, and these fixture scripts after installing the existing
`docs/board-list` development dependencies:

- `node docs/needs-you/render.mjs`: existing interaction checks, including filters, folds, focus,
  drafts, enlarged text and independent legacy settings.
- `node docs/decision-ux-lists/render.mjs`: real List/Board at 1440, 390 and 320 pixels in both
  themes, six decisions, target sizes, standalone context link/preview clicks, and four integrated
  drawer fixtures opening full files and sending the exact server-bound option once.
- `node docs/attention-deck/render.mjs`: all four shipped packs, ledger routing, six workerless
  gates at the bow, clear state at the wheel, stale/unavailable legends and reduced-motion stability.

All images remain under ignored `.local/`. Review copies go to
`C:\Users\micha\.paseo\plugin-data\firstmate\home\data\fm-decision-ux-lists\evidence\`.
CI's `deck-before-after` artifact includes Deck and list/context captures. These use synthetic host
APIs and fixture data; they are not claims of an installed plugin or native device test. No plugin
installation, reload, charter change or live home data write is part of this work.
