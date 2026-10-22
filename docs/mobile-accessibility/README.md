# Compact controls and accessibility

This batch starts at the reviewed batch-1 commit
`da554c911a527caaf7fb2766847f6d3f8dd3c075` and targets `fm/fm-tabs-ux-review`.
It keeps the existing components, theme colors, 380-point Converse and Deck engine.

Changes:

- Opt-in compact targets: 44-point buttons and tab segments, plus 44-point composer
  fields and attachment removal. Desktop sizing stays the default. Home, Chat,
  Converse and Plans pass their existing compact layout through to these controls.
- A Home page heading; List/Board sections at level 2 and ownership subgroups at
  level 3. Fold buttons sit inside their section headings. Plans sections follow
  their visible heading; Converse and decision headings are below the page heading.
- An accessible name for the mate composer. Both Converse tab sets sit in the
  conversation's labelled complementary region.
- Converse covers the task pane below 900 points, leaving at least 520 beside it
  when it docks. The previous rule could leave only 300.
- The compact decision header shortens Home files to Files, puts the counter on
  its own line and wraps its navigation buttons as a group. Only the noninteractive,
  programmatically focused drawer headings suppress their outline. Buttons and
  inputs keep the renderer's focus indicators and keyboard behavior.
- The standalone Deck uses the same web capability on compact and wide layouts.
  Native fallback text names Home's List, Board and web Deck correctly. No new native
  API or scene/pack change is involved.

## Reproduction and code checks

The source audit is `data/fm-tabs-ux-review/report.md` in the FirstMate home. Its
manifest records S11 (compact controls), S13–S15 (heading focus), S16 (Converse),
S22 (squeezed List), S47/S48 (Home Deck versus standalone Deck), and S51 (Files
return label and split counter). These are historical synthetic-fixture observations.

Before implementation, the added assertions failed against the pinned base:
`drawerDocks(864)` returned true; `deckOffered("web", true)` returned false. Wide
web Deck and native refusal are the comparison paths. The regression assertions
retain those paths and check the new 899/900-point docking boundary. No copy or
CSS snapshot tests were added.

Final-head validation commands:

```powershell
npm.cmd test -- client/converse.test.ts client/ship-deck.test.ts client/decision-drawer.test.ts client/task-presentation.test.ts client/decision-copy.test.ts client/workflow-plan-browser.test.ts
npm.cmd run typecheck
node docs/shell-phase1/check-bundle.mjs
git diff --check
```

The bundle check uses Paseo's compiler and Hermes parsing, without installing or
reloading a plugin. Browser render scripts are deliberately not invoked locally.
Repository CI remains required.

The earlier broad Windows run is retained as incomplete in
`.local/mobile-accessibility/final-tests.log`. It exposed a missing `Platform` in
the Plans test mock (fixed), plus timeouts in unchanged PR-watch, precipitation,
home-role and workflow tests. The original run was stopped after retaining its
failures; no broad rerun or timeout/check-limit change followed. The specific
PR-watch comparison on the pinned base passed all five tests in isolation, so
these observations do not establish a baseline code defect or a timeout cause.
The six affected files pass 195 tests after the mock fix. CI must qualify the full
suite on the submitted head; fresh visual and integration checks remain separate.

The first CI run reproduced an obsolete header-fixture expectation of the compact
Deck refusal text. That check now requires the real canvas at both widths, with
the same legend states and open/close drawer checks also exercised on compact web.
The older shell fixture likewise requires one canvas. No check or timeout was
removed; these render scripts run in repository CI, not through a local browser.

## Prepared fixture and outstanding landing gate

Fresh browser captures and desktop keyboard traversal are **pending**, explicitly
deferred by the captain. No browser connection, capture attempt or direct Playwright
fallback is part of this batch. A successful bundle is not visual verification.

The ignored `.local/tabs-review/` here is a separate copy of the audit's synthetic
app, fixture and stubs, bundled against this worktree's actual components. The audit
worktree and its original screenshots remain untouched. It includes registered
Home/workspace views, backlog and plan decisions, plan review, worker permissions,
remote logs, Home files and the shipped Deck engine. RPC effects remain in page
memory. `.local/mobile-accessibility/` retains the reproduction and validation logs.

To prepare without opening a browser:

```powershell
node .local/tabs-review/serve.mjs --build-only
```

When capture is authorized, serve on loopback with
`node .local/tabs-review/serve.mjs 48735` and use Paseo browser tools. Use fresh page
loads for each width; the fixture computes compact layout from its initial viewport.
The parameters `theme=dark` (Paseo default), `theme=paseo-light` (Paseo light), and
`theme=light` (the older fixture palette) are available. Add `reset` for clean
synthetic settings. Save new evidence under `.local/mobile-accessibility/`.

| Surface | Required checks, still pending |
| --- | --- |
| Home and Chat | 390×844 and 1440×900 in both Paseo palettes; tabs, Open/More, named composer, Send/Attach/Bearings/Ahoy/session controls, attached-file removal |
| List and Board | Page/section/subsection DOM levels, heading fold buttons, 44-point phone tabs, no clipping or horizontal page overflow |
| Converse | Both tab sets inside the labelled region; compact back/send/interrupt; cover at a 1440-point Home split; dock only with at least 520 left for List |
| Needs you and All | Open from Files, long return labels and larger counters at 390 and 320 points; counter stays intact; grouped navigation wraps; programmatic heading focus has no input-like ring |
| Keyboard | Tab and Shift+Tab through Home, drawer and Converse; visible button/input focus, Escape and return focus, heading focus retained without adding heading tab stops |
| Deck | Compare Home Deck and standalone Deck at 390×844; same real engine, no compact refusal; repeat wide and both themes; retain native unsupported fallback |
| Plans | Compact Graph/List targets, hierarchy in inline and standalone Plans, existing modal/graph behavior |

Integration with the later Discuss-first, plan/work navigation and decision-queue
batches is also **pending**. This branch deliberately starts at batch 1. The old
fixture and these code checks do not prove those future surfaces. After combining
the reviewed commits, rebuild the fixture against that exact integration head and
repeat the matrix, including new return-to-decision chips, plan task links and plan
review queue navigation. This remains a landing gate alongside fresh capture.

Browser emulation cannot verify native iOS/Android touch, keyboards or safe areas,
screen-reader output, real Paseo tab focus, or installed-daemon behavior. None is
claimed here. No canonical home file, real decision, agent setting, watch, charter,
installation or running daemon is changed by the fixture or validation commands.
