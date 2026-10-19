# Shared Needs-you indicator and decision drawer

Home, Chat, Crew, Board and the Deck header use the server ledger's counts.
The sidebar badge uses the same source; active crew appears as `N in hand` in
Home. New decisions colour the signal amber, Seen decisions neutral. Stale or
unavailable data is labelled and cannot enable an answer or acknowledgement.
Worker cards, filters and lifecycle events do not determine these counts.

Opening a decision, following a link, restoring a view or polling never sends,
marks seen or snoozes. Previous/Next starts with New, then Seen, ordered by waiting
time and stable id. Pending and snoozed decisions follow; All decisions also
includes resolved and parked records. New arrivals do not replace a selected
question. Drafts are keyed by home, request and revision in the shared client
session; a changed question retains its old draft separately.

Explicit actions are Mark seen; Snooze for one hour, tomorrow at 09:00 in the
device's time zone, or an entered local date/time; Unsnooze; and Answer the first
mate. Enter in the answer field is a newline. The send button uses the existing
per-mate send gate and server lifecycle lock. The server validates the current
home, fresh source and record revision, writes a durable uncertain reservation,
then calls the existing mate-send path. Accepted delivery waits for the mate's
recorded outcome; uncertain delivery never automatically retries. Reusing a
submission id with the same payload returns its journaled result, including
after restart. Reusing it for a different payload is refused.

## Bound one-press answers

Existing suggestions remain unchanged. An optional suffix on the label binds an
answer to the exact home, request and revision returned by `firstmate.needs-you.read`:

```markdown
- Cautious option [decision: {"homeId":"home-id","requestId":"request-id","recordRevision":1,"actionId":"cautious"}] :: Choose the cautious option.
```

Only unique bindings for the displayed revision appear in the drawer. The server
rereads the file and checks the binding, label and complete prompt before sending.
Malformed bindings are rejected; they never fall back to unbound actions. Unbound
suggestions remain in the existing suggestion strip and Deck reply buttons.
Bound suggestions use only the drawer's validated send path. No charter or home
records are changed by this slice.

## Shared opening action and notifications

Descendants of `FleetSurface` call `useOpenDecision()` from `decision-action.tsx`:
`open({homeId, requestId, recordRevision}, optionalReturnFocusId)`. Omit the target
to open the next decision. Other installation-owned contributions can call
`FleetShell.openDecision(target)`, which opens Home with the same declarative
destination. Neither action acknowledges or submits anything.

The sidebar owns one quiet toast for each newly observed batch. Initial baselines
and polling/reload duplicates are silent. A visible FirstMate indicator suppresses
the toast and consumes that batch, so it is not replayed after leaving. Web checks
retained panes' visibility; native uses mounted visibility.
The outbox remains off and no phone transport is included.

## Compact layout and verification

Below 638 points (or with host compact layout), the indicator fills the header's
content width under the title. The drawer fills its surface unless there is room
for both its 440-point width and a 638-point fleet pane. Its controls have at least
44-point targets. Covering drawers hide/inert the background for accessibility,
trap Tab/Shift+Tab, close with Escape and return focus to the opener. Wide drawers
leave the adjacent fleet accessible.

`render.mjs` runs the real React Native Web views with synthetic host RPCs. It
checks 320, 390, 637, 638, 900, 1440 and 1680 pixels, host compact layout, light and
dark themes, accessible control names, target sizes, focus trapping/return,
preserved selection/drafts, revision links and an explicit bound typed send.
The CI matrix runs it on Windows and Ubuntu and uploads its screenshots/results.
This is fixture evidence, not an installed desktop or native-device test.

```powershell
npm.cmd ci --prefix docs/board-list
node docs/needs-you/render.mjs --diagnose 2>&1 | Out-File -Encoding utf8 .local/indicator-diagnose.log
node docs/needs-you/render.mjs 2>&1 | Out-File -Encoding utf8 .local/indicator-render.log
```

The targeted compact investigation found a real layout bug: the loading root had
no initial `onLayout`, and React Native Web did not start observing the reused
element when its handler appeared later. Both 320 and 390 pixels stayed in wide
mode (visible 207.89 × 50 signal beside the title, in wrapping row parents of
288 and 358 pixels). All root states now register layout from mount. The fixed
indicator is 296 × 50 at x=12 in a 320-pixel pane, and 366 × 50 at x=12 in a
390-pixel pane, below the title row. `--diagnose` writes screenshots and computed
indicator/parent/title-row/ancestor boxes, including flex, grid, min-width,
overflow and visibility. The render assertion checks exact content width and
placement after font/layout readiness; it does not relax the requirement.

Unit/integration coverage lives in `client/needs-you-state.test.ts`,
`server/decision-answer.test.ts` and the foundation's detector/ledger/service
tests. Deck markers, Crew/Board regrouping and status vocabulary remain separate.
