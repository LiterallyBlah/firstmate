# Toolbar and crew help evidence

The real `FleetSurface`, List, Board and shared crew actions run through React
Native Web in headless Edge. Only host APIs and session data are mocked. All
screenshots are labelled synthetic fixtures; no live plugin install, reload or
session action was used.

## Control meanings checked against code

| Control | Purpose and source |
| --- | --- |
| Opposing arrows | Transfer the first-mate role to a new provider/model; saved transfers expose recovery. `client/migration-control.tsx`, `server/migration.ts`. |
| List / Board | Grouped task list / columns by status. `client/fleet.tsx`, `task-list.tsx`, `board.tsx`. |
| Radar icon | Scheduled watches, results, reports and on/off controls. `client/watches.tsx`. |
| Crew / Files | Crew and backlog tasks, or the FirstMate home's files. Crew returns from Watch. `client/fleet.tsx`. |
| Pane toggles | Show/hide chat or the current Crew/Files pane. `client/fleet.tsx`. |
| Open | Open the first mate's full Paseo conversation. `client/fleet.tsx`. |
| Refresh | Refresh the fleet query: task board and first-mate status. `client/fleet.tsx`. |
| Settings | FirstMate home, model and display settings. `client/settings-screen.tsx`. |
| Watch | Local live activity or remote recent log within FirstMate. `client/crewmate.tsx`, `remote-worker.tsx`. |
| Steer | Direct instructions to the worker, relayed to the first mate. No promise of an uninterrupted turn. `server/crew.ts`, `remote-crew.ts`. |
| Interrupt | Stop the current turn; disabled when no turn is running. `client/card.tsx`, `server/crew.ts`, `remote-crew.ts`. |
| Relaunch | Ask the first mate for a replacement in the same local copy. Remote Relaunch explains that the first mate must write a new brief and launch there. `templates/messages/relaunch.md`, `client/card.tsx`. |
| End | Confirm archiving the worker while keeping its workspace. Followed sessions cannot be ended here. `client/card.tsx`, `server/crew.ts`, `remote-crew.ts`. |

Busy, unreachable-host, refreshing, migration-loading and missing-first-mate
states explain the reason for unavailability. Original labels, actions and
confirmation flows are retained. Disabled buttons remain disabled; a focusable
wrapper supplies their description. No native `title` accompanies the custom
popup.

## Escape diagnosis and regression

Both original failed receipts are preserved in [failed-receipts.txt](failed-receipts.txt).
[escape-trace.json](escape-trace.json) records tooltip identity/text, event order,
listener lifetime and component lifetime for List and Board before/after the
correction, with normal polling and a frozen-polling counterfactual.

On Board, End received Escape and hid correctly. The stationary pointer then
exposed Interrupt below it. React Native Web emitted an enter event for that
different tooltip, with the just-hidden End popup as its source. There was no
pointer movement, remount or lost Escape listener. List stayed dismissed;
freezing polling produced the same Board failure.

The correction recognizes that hidden-popup source at the web boundary and
keeps the newly exposed control dismissed. Intentional leave/re-entry or fresh
keyboard focus can open help again. The normal matrix reproduces the actual
textarea-focus → Board End → popup → Escape path and checks both ways to reopen.
It keeps polling enabled and asserts that **no tooltip** remains visible.

The disabled-key test also waits for the browser's default Space-key scroll to
finish before moving the pointer. This avoids testing hover while the trigger
is moving; it does not suppress scrolling or relax Escape assertions.
The busy-action test catches another React Native Web transition: the browser
emits focus-out when a button becomes disabled, but the component's blur handler
does not run. Stale focus is cleared only when the wrapper has no actual focus;
fresh focus on disabled help is kept.

## Verification

The final [verification receipt](verification.json) records all six passing
theme/width cases and state checks. Typecheck passed; the full test suite passed
36 files and 452 tests, with three conditional tests skipped. Self-review checked
the handler-derived wording, original names/actions, geometry, web boundary and
all ten screenshots. The original failed-receipt file is unchanged byte for byte.

From the repository root, using the existing `docs/board-list` dependencies:

```powershell
node docs/toolbar-help/render.mjs
npm.cmd run typecheck
npm.cmd test
```

The render checks light/dark at 1280, 800 and 638 px; hover and keyboard focus;
Escape with textarea focus; popup hover persistence; intentional reopening;
disabled Enter/Space without action RPCs; actual Tab access to remote Relaunch;
viewport/clipping/stacking; and original control geometry within one pixel.
All five local actions and the four disabled-state categories are exercised in
both List and Board. A partly visible Board column also constrains popup width;
its wrapped height is remeasured before choosing above/below placement.
It also checks PR10's Bearings/Ahoy/Compact/Restart, pane state changes, Watch
return, pending actions, refresh, saved transfer recovery and mocked navigation.
End's confirmation is cancelled; no archive RPC runs.

The diagnosis can be regenerated independently:

```powershell
$env:FM_HELP_TRACE = '1'
node docs/toolbar-help/render.mjs
# Counterfactual fixture build removes only the hidden-popup guard:
$env:FM_HELP_TRACE_OLD = '1'
node docs/toolbar-help/render.mjs
```

Raw traces and build output stay in ignored `.generated/`. The evidence is a
desktop browser fixture; native device behavior and a running Paseo installation
were not exercised. Optional daemon integration tests remain conditional.

## Inspected screenshots (800 px)

| Example | Dark | Light |
| --- | --- | --- |
| Header transfer help | [Dark](header-transfer-dark.png) | [Light](header-transfer-light.png) |
| Header Watches help | [Dark](header-watches-dark.png) | [Light](header-watches-light.png) |
| Crew Steer help | [Dark](crew-steer-dark.png) | [Light](crew-steer-light.png) |
| Disabled remote Relaunch, keyboard focus | [Dark](remote-relaunch-disabled-dark.png) | [Light](remote-relaunch-disabled-light.png) |
| Board End help | [Dark](board-end-dark.png) | [Light](board-end-light.png) |
