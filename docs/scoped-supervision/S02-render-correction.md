# S02 Windows render qualification correction

This follow-up preserves the independently accepted S02/S03 integration at
`508eff9df937dce3adf95d9e03fd8ddc6d263b2b`. It changes only the synthetic-host
Needs-you render harness. The Deck return check now waits for committed graphics
drawing status before pressing its legend. No product layout, drawer behavior,
timeout, crash assertion, supervision contract or activation wiring changes.

## Evidence and diagnosis

The retained [Windows PR failure log](s02-render-evidence/original-ci-failure.log)
and [screenshot](s02-render-evidence/original-ci-failure.png) come from
[PR run 40144985559](https://github.com/LiterallyBlah/firstmate/actions/runs/40144985559),
job `121024291195`. The action preceding `polish-checks.mjs:107` completed, but
`Back to Deck` inside `FirstMate decisions` remained absent for the unchanged
10,000 ms limit. The screenshot shows the drawn Deck without a drawer. The same
source passed [Windows push run 40144980959](https://github.com/LiterallyBlah/firstmate/actions/runs/40144980959).
All client sources and the original render harness were identical to the landed
S03 base, which disconfirms a deterministic S02 client change as the explanation.

The fixture's `pageAt("view=deck")` waits for the heading while the real graphics
engine, setting images and scene continue loading. The working header check
waits for the rendered canvas before using the same decision entry. Instrumented
[ordinary cold and settled observations](s02-render-evidence/cold-and-settled-observations.json)
passed eight cases, but showed the legend moving from y=836 to y=801 when startup
adds the scene footer. Ordinary successes alone did not establish a cause.

The next bounded experiment gates only the synthetic `firstmate.deck.engine`
response and records actual pointer targets and legend geometry. Its
[observations](s02-render-evidence/controlled-observations.json) distinguish:

| Engine response relative to press | Observed result |
| --- | --- |
| Held until after pointer-up | Drawer opens |
| Released after pointer-down, drawing completes before pointer-up | No drawer; down hits the legend at y=850, up hits outside it after its 35px move |
| Drawing completes before the press | Drawer opens at y=815 |
| Same release during an actual locator click with a held mouse press | Locator click completes, then the original 10s missing-drawer failure occurs |

The [missing-drawer image](s02-render-evidence/controlled-missing-drawer.png) and
[settled control](s02-render-evidence/controlled-settled-drawer.png) were visually
inspected. No handler, query result, decision count or drawer state is stubbed to
make the controls pass. This establishes a startup-layout mechanism for the
observed symptom. The historical CI run retained no pointer trace, so its exact
interleaving is not retrospectively proven or labelled harmless/flaky.

Run the preserved diagnostic with existing locked render dependencies:

```
node docs/scoped-supervision/s02-render-evidence/reproduce.mjs
```

It deliberately records both failing and successful controls under
`.local/s02-render/reproduction/`; it is a diagnostic, not a green acceptance
command. Its two injected press intervals reproduce the input boundary rather
than increase any action timeout. The portable copy changes only checkout-relative
import/output paths from the executed script; original traces remain in the
builder's `.local/s02-render/probe-{1,2}/` directories.

## Correction and regression

`panel-return-check.mjs` retains the exact Deck/Board/List entry, exact scoped
return button and closed-drawer assertion formerly inside `checkPolish`. Its only
behavioral addition waits for the Deck's committed `Drawn with …` status before
the existing click. Board and List retain their original entry paths. Waiting for
this rendered state also avoids the canvas-append/status-commit interval.

`deck-startup-checks.mjs` exercises that same check against the real component,
real locked Pixi engine and pack, through synthetic local RPCs. The delayed case
injects 1.2s engine response latency and releases earlier on a legend pointer-down;
a 1.5s held mouse press exposes the old startup transition. The settled case is
the positive control. Both require exactly one legend press after drawing, the
exact `Back to Deck` action and a closed drawer. Normal polish checks keep their
ordinary click. All actions retain the existing 10s default.

Before the readiness correction, the [same regression failed](s02-render-evidence/regression-red.log)
at the exact missing return button. The [pre-fix helper](s02-render-evidence/panel-return-before-fix.mjs)
and [regression source](s02-render-evidence/startup-regression-before-fix.mjs) are
retained. After correction, both delayed and settled cases
[pass](s02-render-evidence/regression-green.log), with their sole press at y=815
after drawing. The full render command includes these regressions before its
existing checks.

## Verification and limits

The companion [validation receipt](s02-render-validation.json) binds exact source,
preserved evidence and fresh command results. The independent integration review
remains applicable to unchanged product sources; this harness correction requires
its own independent review. Exact delivery head and CI are reported separately
after normal non-force delivery of PR 146. No default-branch merge, plugin install,
reload, live activation, routing/watch change, model call or history rewrite is
part of this correction.
