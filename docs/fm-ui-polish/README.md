# Toolbar and Deck UI polish

Run `npm ci` in the repository and `docs/board-list`, then `node docs/fm-ui-polish/render.mjs`.
This adapts the existing attention-deck and Plans harnesses, mounts real FleetSurface/Deck/drawer
components through react-native-web and shipped Pixi, and supplies synthetic host data. It never
connects to a daemon, installs or reloads a plugin, or sends real messages.

The pinned before revision is `3afaacd33185c3eb9916d1077d497dec529c59df`; `FM_UI_BASELINE` may override it.
Ignored `.local/fm-ui-polish/` contains before/after toolbar and Deck captures in light/day and
dark/night, the first mate's open Needs-you popover, a selected exact item, many items and zero.
Additional narrow captures exercise Sakura coast, Ghost ship and Sky voyage. `results.json` records
the checked themes and scenes. These are fixture checks, not installed desktop or native-device tests.

Assertions cover the shared Plans icon/style, selected/open state and unchanged filter modal;
count-only first-mate bubble; no worker sprite bubbles/markers; opening without acknowledging or
swapping the page; exact-item drawer selection; direct All/repair access with unreadable holds alone
or alongside healthy decisions; keyboard,
toggle and outside dismissal; scrolling;
and removing the bubble/popover when the last item clears. Generated evidence stays in the ignored
output folder; copy review captures to the task's separately designated evidence location.
