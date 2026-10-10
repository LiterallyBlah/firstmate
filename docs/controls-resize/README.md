# FirstMate control help and chat resize verification

The four controls now explain their purpose on pointer hover and keyboard focus. Bearings asks for a
fresh overview from records/live crew; Ahoy recaps the conversation and its open decisions (first
contact falls back to Bearings); Compact condenses context in the current session; Restart starts a
fresh mate from saved records and preserves the previous conversation in Paseo history. Wording was
checked against charter §10 and the compact/restart implementations. Actions and confirmation remain
the same. Tooltips have an accessible description, are hoverable, stay open on focus, and dismiss with
Escape, including when the composer owns keyboard focus. Native uses the accessibility hint.

## Diagnosis: trigger, symptom and counterfactual

Read-only `paseo plugin ls --json` reported the installed plugin at **cb08298**, PR #7. Its
`client/fleet.tsx`, `client/resize-handle.tsx` and `client/web.ts` match the initial **830cd6a** source
used by this harness. There is one splitter shared by List and Board. It is deliberately absent in
compact tabs or when either pane is collapsed; those paths do not show two panes to resize.

At normal scale, the old pointer path already moves 100 pixels for a 100-pixel drag and saves
`chatWidthFraction` through the host settings hook. The apparent missing boundary has a concrete
trigger: the painted child has width but no height, so its measured height is **0**. The live hit
target is only 9 points wide and has no resting resize cursor. A small counterfactual adds only
`flex: 1` to that child's style: the line gains height, while the same drag still moves 100 pixels.
That isolates visibility from the working movement/save path.

Two additional defects were reproduced:

- With an 800-point pane, the old 80% maximum leaves **151 points** for crew. Fraction limits alone
  do not keep both panes useful. The updated limits leave **320 points** for chat, **300** for crew
  and **18** for the separator, within the existing 20–80% setting. Below 638 points the existing
  compact tab layout is used. The host's compact flag is always respected. Merely narrowing a window
  constrains the drawn width without overwriting the saved preference.
- Under the existing desktop fixture's **2× CSS UI scale**, `onLayout` reports layout points and
  pointer movement reports rendered pixels. Dividing the latter by the former makes a 100-pixel drag
  move the split **200 pixels**. The updated document tracker divides by the split's rendered width,
  so it follows the pointer by **100 pixels** at either scale. Native keeps its point-based responder.

The existing handle now paints a full-height line and grip, offers an 18-point hit area, a resize
cursor and hover/focus feedback, and exposes a vertical separator controlling the chat pane. Left/
Right adjust by 16 points, Shift by 48, Home/End select the useful limits. Screen readers receive the
current percentage and limits; native exposes increment/decrement actions. Pointer movement remains
local, with one settings commit per completed drag. Leaving the screen before the 400ms batch expires
now flushes that committed width through the existing settings adapter.

## Reproduction and checks

The real `FleetSurface`, `MateChat`, controls, task list and board run through React Native Web in
headless Edge. Only host APIs are stubbed. The synthetic fixture and dependency package are shared
with `docs/board-list`; the settings stub persists to fixture-local browser storage so fresh mounts
and page reloads exercise the real surface's save/readback path. No live plugin install/reload,
daemon mutation or real session operation occurs.

```powershell
npm.cmd ci
npm.cmd ci --prefix docs/board-list
npm.cmd run typecheck
npm.cmd test
node docs/controls-resize/render.mjs
```

The interaction matrix covers both List/Board and light/dark at **1280**, **800**, **638** points,
plus **1600 rendered pixels at 2× scale** (800 layout points). Assertions cover pointer movement
across task content, one commit after release, remount/reload persistence, keyboard limits and ARIA
values, window narrowing/widening, pane collapse, immediate-unmount persistence, every control's
hover/focus/description/Escape behavior and unchanged command/confirmation paths. Phone captures
use **390×960**, host compact mode, chat and Board in both themes. Geometry/results and bundles are
generated under ignored `.generated/`.

Final validation uses the code reconciled with PR #9's merge **d198658a2ad8989a267c360272a6d5a08fc5c7a6**.
Typecheck and the full test suite pass: **31 files, 375 tests passed, 3 skipped**. The skipped cases
are two optional installed-daemon probes and the POSIX-only process-group test on Windows. Browser fixtures verify settings calls and
readback; they do not claim live daemon storage or native iOS/Android/device verification.

## Labelled screenshots

Each capture contains a synthetic-fixture label, theme, viewport and UI scale.

| View | Capture |
| --- | --- |
| Before: 800 px, invisible splitter, crew compressed | [Dark](before-narrow-dark.png) |
| List after widening chat, 1280 px | [Dark](after-list-1280-dark.png) |
| Board after widening chat, 1280 px | [Light](after-board-1280-light.png) |
| List after widening chat, 800 px | [Light](after-list-800-light.png) |
| Board after widening chat, 800 px | [Dark](after-board-800-dark.png) |
| Board, 1600 px at 2× scale | [Dark](after-board-1600-dark.png) |
| Bearings on keyboard focus | [Dark](tooltip-bearings-dark.png) |
| Ahoy on keyboard focus | [Dark](tooltip-ahoy-dark.png) |
| Compact on keyboard focus | [Dark](tooltip-compact-dark.png) |
| Restart on keyboard focus | [Dark](tooltip-restart-dark.png) |
| Phone chat with Restart help | [Light](phone-chat-light.png), [Dark](phone-chat-dark.png) |
| Phone Board | [Light](phone-board-light.png), [Dark](phone-board-dark.png) |
