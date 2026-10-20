# Disconnected Deck workers

`node docs/hide-offline-hosts/render.mjs` mounts the real Deck view, Pixi and shipped packs with
synthetic host RPCs and 3 reachable workers plus 12 workers on one disconnected host. Install the
root dependencies and `npm ci --prefix docs/board-list` first. The harness uses headless Edge.

Checks cover light/dark at 1440, 390 and 320 pixels: visible counts, hidden count/reveal line,
44-point Show target, accessible description, keyboard/touch reveal, no setting save, session
remount/scene switching, a fresh app session, reconnection, setting off and all hosts online.
The reserved first mate stays drawn. These are browser fixture checks, not a native device test.

Renders and results go to ignored `.local/hide-offline-hosts/`. Review copies live at
`C:\Users\micha\.paseo\plugin-data\firstmate\home\data\fm-hide-offline-hosts\evidence\`.
No review images are committed.
