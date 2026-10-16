# Inline Deck in FirstMate Home

Home's right-pane switcher now offers List, Board, Home files and Deck. Compact Home offers the
same destinations beside First mate. Deck reuses `SelectedDeckView`, the same fleet cards,
suggestions, action guards and Converse drawer as the standalone Deck tab. No scene, pack, canvas,
server behavior or standalone availability policy changed.

The new host display field `homePane` defaults to `board` for existing documents. List/Board still
share `crewView`. The selection updates immediately, survives remounts through `cachedRightPane`,
and saves through the existing revision-aware display settings batching. Home files uses the same
persistence. Mobile keeps its separate First mate tab; the right-pane selection survives widening.

The renderer already measures its container and docks a focused worker's card below the scene in
narrow panes. That works in a phone browser with WebGL. Native iOS/Android still uses the existing
renderer-unavailable explanation; this change adds no native graphics dependency.

## Remote call-count investigation

The earlier `server/remotes.test.ts:204` failure was reproduced on clean main `e7abadd`, with all
parity changes stashed and no inline Deck code. The test imports no client surface. A temporary
1.1-second delay after the helper's successful `send` deterministically produced these four extra
calls, then was removed:

```text
project ls --json
workspace ls --json
provider ls --json
ls -g --label firstmate.role=crew --label firstmate.owner=local-test:firstmate --json
```

`RemoteService.request()` resets `pollAt` to zero in `finally`. Its next one-second timer tick starts
the collector, which issues those four listings. Their timing depended on child-process startup
and load. They are independent of UI query observers. Chat and the other fleet surfaces use
`useFleet` with `FLEET_QUERY_KEY`; remote snapshot observers also share a query key. Inline Deck
receives the parent's data and starts no fleet or remote query.

The helper test now stubs only `service.poll()` for that test. Its real queue pump and helper process
remain active, and its unchanged count assertion still proves refused commands send nothing.
The existing collector test exercises actual polling separately. No expectation was increased and
no production poll behavior changed. This small test-isolation commit is shared by the independent
Deck and parity PRs so both can be validated from main.

## Verification

`node docs/home-deck/render.mjs` mounts real components and the real ship renderer through React
Native Web, with host APIs stubbed and actual deck assets served from this checkout. It checks:

- 1440-, 960- and 390-pixel layouts, canvas and focus-panel bounds, keyboard focus and touch focus.
- Selection persistence across remount/reload, Files/List transitions, teardown and return.
- No navigation or extra fleet request when switching inline; the standalone Deck remains usable.

Screenshots in ignored `.generated/` were visually reviewed. The initial harness run exposed a
missing files-list fixture response; the fixture was corrected and the complete browser check passed.
This is not an installed-app or native mobile test. No plugin was installed.

The full suite passes: 90 files, 1,076 tests passed and three skipped. Typecheck, the 36 pack-lint
checks, changed-code Prettier, whitespace checks and the Paseo 0.11 bundle
check pass. The client has zero `class` tokens and parses with RN 0.81 Hermes default flags.

Reproduce with `npm ci`, `npm ci --prefix docs/board-list`, `npm test -- --maxWorkers=1`,
`npm run typecheck`, `npm run lint:deck-packs`, `node docs/shell-phase1/check-bundle.mjs`, and the
browser command above. Self-review covered every changed file, setting migration, navigation,
query reuse, scene lifetime and responsive focus layout. Scene and snapshot inputs are unchanged.
