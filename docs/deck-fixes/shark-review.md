# Shark focus stays on deck

Clicking the shark's body or speech bubble now focuses its selected worker through
the existing crew camera and focus panel. The footer offers **Focus**, and the hover
label says **Click to focus on deck**. The deck stays mounted, including its selected
attention worker. Escape, the panel's Close button, and ordinary crew focus keep
their existing behaviour. Choosing Converse explicitly inside the focus card still
opens that conversation.

The deck no longer receives a navigation callback. The four removed lines in
`client/fleet.tsx` are only that deck-specific callback; tab chrome is unchanged.
The renderer identifies the carrier hit as `attention`, and the view rechecks the
current worker's eligibility before focusing it. Delayed pointer and keyboard
callbacks cannot focus a removed, stale, or no-longer-asking worker. The legend
retains selection across polls and falls back when the selected worker disappears.
Packs without a carrier retain their existing suggestion markers and replies.

No manifest, image, position, palette, animation, floor, camera geometry or pack
capability changes. The ladder fix and below-deck sleepers are retained. The only
intentional difference in the standard gate is the footer's action text and the
following arrow moving to fit its shorter label. Hover copy and the shark's focus
behaviour are covered by the interaction check.

The compiled-browser check at `../deck-enrichment/check-attention.mjs` verifies:

- Local body click, remote bubble click and keyboard selection open the correct
  worker's existing focus card, in place, with the same canvas node and URL.
- Camera pixels beside the card match ordinary crew focus exactly. Escape restores
  that region's pixels in the whole-deck view, and Close also restores the deck. This comparison uses
  the scene interior, excluding the container's corners and keyboard focus outline;
  the separate 81-shot gate remains entirely unmasked.
- The moving shark focuses correctly. Insertion preserves selection; offline,
  stale, closed and removed workers lose their signal; closed workers lose focus.
- No message is sent, no Converse drawer appears, and no remote conversation log
  is fetched. No browser errors.

Run `CHECK_ATTENTION=1 node docs/deck-settings/render.mjs` after compilation. Its
[results](shark-interactions.json), [whole deck](shark-still.png),
[local focus](shark-local-focus.png), [remote focus](shark-remote-focus.png),
[keyboard focus](shark-keyboard-focus.png), and [moving focus](shark-moving-focus.png)
are stored here. The historical reply-shark review describes the original behaviour;
this review supersedes that navigation behaviour.

Self-review covers callback removal, focus routing, current-state guards, preserved
selection, native/no-card behaviour, the closed pack contract, and the unchanged
rendering paths. Typecheck, all 1,076 tests in 90 files (three existing skips), and
all 36 pack-lint checks pass. Runtime revision `138dd86` compiles against main
`6704512`: the client is 302 bytes smaller, the server is unchanged, and Hermes
parses the client with no `class`, bundled Pixi or embedded PNGs. See
[compiler evidence](shark-compile.json).

The first 81-shot capture has 15 identical frames and 66 footer-only differences.
All five comparison sheets were reviewed: [still/daylight](shark-gate-footer-01.png),
[storm I](shark-gate-footer-02.png), [storm II/night](shark-gate-footer-03.png),
[crew/focus](shark-gate-footer-04.png), and [lite](shark-gate-footer-05.png).
Main is on the left, the branch on the right. Both exact PNG hashes for each
difference are recorded in `../deck-settings/expected-changes.json`.

The separate [decoded-pixel audit](check-shark-pixels.mjs) checks the actual gate
PNG hashes and every pixel. It finds zero changes outside the existing footer,
so **all 81 ship canvases are pixel-identical**, including the ladder, sleepers,
weather, movement and ordinary focus. It also checks the entire manifest against
main and all 84 image hashes. [Per-shot evidence](shark-pixels.json) is separate
from gate acceptance; no mask, tolerance, threshold or gate code was changed.
Reproduce with `node docs/deck-fixes/check-shark-pixels.mjs` after the full gate.

The independent full gate rerun passed all 81 frames with default re-render checks:
15 identical, 66 exact reviewed footer changes, matching canvas metadata, zero
flakes and zero browser errors. `../deck-settings/gate-results.json` records the
final run. The decoded-pixel audit passes against that run too. Runtime and pack
inputs remain at `138dd86`; the evidence commit changes documentation and the
browser harness only. The PR is handed back after final Windows and Ubuntu CI pass.
