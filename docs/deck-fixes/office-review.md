# Withdraw Office

The captain rejected Office's art on 2026-10-16. Its pack is retained unchanged at
`docs/settings/office/withdrawn-pack/` for reference, outside shipped `art/`.
Both scene pickers use the installed-pack RPC, so Office is absent from both.
Direct loading is refused and an existing saved Office choice falls back to Ship
through the existing resolver, with its usual notice. No client engine, Ship art,
FirstMate tab chrome or display-setting value changes.

Self-review: moving the complete pack preserves the closed catalogue and avoids a
scene-specific runtime exception. The RPC withdrawal and saved-selection fallback
are covered explicitly. Historical Office screenshots are retained as history.

Validation: typecheck, 36 pack-lint checks, and the full suite (90 files; 1,075
passed, three existing skips) pass. The first default-concurrency suite run hit
unrelated `update-source` timeout and `watch-service-routing` outbox timing
failures; the unchanged full suite passes with `--maxWorkers=4`. No test was
disabled or timeout changed. `npm pack --dry-run --json` contains zero Office
files. Paseo compilation keeps the client byte-identical to main, with no `class`,
bundled Pixi or embedded art; Hermes parses it.

The compiled-browser check (`CHECK_OFFICE_WITHDRAWAL=1 node
docs/deck-settings/render.mjs`) verifies the actual picker and saved-choice
fallback with no browser errors. See `office-withdrawn-picker.png`,
`office-withdrawn-fallback.png` and `office-interactions.json` beside this note.

The complete unmasked ship gate against `6b11d4d` passes **81/81 pixel-identical**,
with matching canvas metadata, zero flakes and zero browser errors. No expected
shot was changed. See `../deck-settings/gate-results.json`. The compiled bundles
were captured before the data-only commit; both are byte-identical because no
runtime code changes in this PR. Windows and Ubuntu CI passed for `ba1a158`.
