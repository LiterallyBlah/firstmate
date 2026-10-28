# Deck scene changes after a settings restore

Restoring `display.json` while a client is open bypasses the host's settings-change notification.
The visible scene and the revision passed to `display.save` stay old. Each choice is then rejected
by the host's compare-and-swap check. This also occurs in `9ed5dd84`; it is not introduced by PR #152.
The old switcher already toasts the refusal, but neither reloads the document nor recovers the selection.

The switcher now reloads after a refused save. Since the SDK returns only a boolean from `save`
and no snapshot from `reload`, it waits for the next committed hook snapshot. A different, readable
revision permits one retry, merging only the requested scene into the fresh values. The retry is
pinned to the first changed revision observed during that selection; another revision cannot become
its new base. An unchanged revision, unreadable settings or another refusal reports an error and releases the selection gate.
If the refreshed document already names the requested scene, no further write is needed.
Leaving Deck before the refresh completes cancels the selection, even if Deck returns before the
read completes. Home's pane/tab switch cancels synchronously; disabling or unmounting the controller
also cancels. An abandoned completion cannot retry, show a stale error or unlock a newer choice. The selection controller
belongs to `FleetSurface`, above the scene-keyed canvas; Home's inline caption picker may remount
when the restored scene appears without discarding the pending selection.

While Deck's selector is mounted it also rereads settings at the configured fleet polling interval.
This lets an external file restore update the scene without a selection or page reload. Passive reads
skip an active save and do not overlap one another. They stop while Deck is deselected or unmounted.

Run from the repository root after `npm ci` and `npm ci --prefix docs/board-list`:

```powershell
node docs/deck-scene-swap/render.mjs
$env:DECK_SCENE_REVISION = '9ed5dd84'
node docs/deck-scene-swap/render.mjs --expect-stale
Remove-Item Env:DECK_SCENE_REVISION
```

The browser harness mounts the real registered Home and Deck views, picker, Pixi and shipped packs.
Only host APIs are fixtures. Settings use a real **test-only** JSON file and content-hash revisions
under ignored `.local/deck-scene-swap/`; nothing reads or writes installed settings or a live daemon.
The fixture retains the SDK's shared query snapshot, explicit reread and revision-bound whole-document
save semantics. Replacing the fixture file emits no push event.

Eight light/dark cases cover Home, compact Home, the Deck panel and a narrow panel: a stale selection,
one fresh retry, preservation of unrelated restored preferences, the actual canvas, persistence across
reload, switching back and the adjacent shark-suggestions control. Two navigation cases hold the
conflict read, leave Deck for Board, return, restore Ghost ship, then release the read: the abandoned
Sakura choice must not write over Ghost, and a new deliberate choice must still work. A final case changes the file
without choosing anything and checks the open canvas and picker follow it without a write.
`--expect-stale` checks the original failure instead: one refused choice, unchanged file and old canvas.
`DECK_SCENE_REVISION` loads that revision's client/shared sources through the same host fixture.
Screenshots, request logs, results and bundles stay in `.local/deck-scene-swap/<revision-or-worktree>/`.

The unit suite additionally covers a second conflict, failed refresh, same-revision refusal, thrown
save, concurrent presses, StrictMode replay, an already-applied selection, timer cleanup, unmount
during refresh, leave/return cancellation, synchronous cancellation before another render, and refusal
to rebase a retry past its first fresh revision. The browser regression runs in the `deck-review` CI job. These are fixture checks,
not an installed-desktop or native-device claim.
