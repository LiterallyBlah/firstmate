# Replies on the Deck

Worker sprites retain state badges and hover labels. Suggestions naming a worker remain available
as reply buttons in its focused details panel, through the board's existing send handler, gate and
answered-reply store. No worker sprite wears a reply marker or opens a hover speech bubble.
Only the reserved first mate wears the numeric Needs-you bubble; the shark keeps Suggestions.

Run `node docs/ship-deck-replies/render.mjs` after installing the repository and
`docs/board-list` dependencies. This entry point delegates to the maintained UI-polish render
harness instead of the removed legacy art/RPC adapters. It mounts real views with synthetic host
APIs and writes all captures and results to ignored `.local/fm-ui-polish/`.

The browser assertions cover no worker sprite bubbles/markers, the officer's count and popover,
exact-item routing, unreadable held-task repair access, both themes and all four shipped scenes.
`client/ship-deck.test.ts` separately checks that linked replies remain in worker focus panels,
clear when picked and return after a failed send. `client/deck-replies.test.ts` retains matching,
answered-store and historical marker-geometry regression coverage; those geometry tests do not
claim that current worker sprites display markers. The former worker-bubble screenshots and
compiled-bundle size figures describe the historical design, not the current UI.
