# README screenshots and clips

These are synthetic UI fixtures, not screenshots of an installed plugin or a live fleet.
No daemon connection, plugin installation or reload was used to make them.

## Sources

| Image | Source | Size |
| --- | --- | --- |
| [Ship, day](ship-day.webp) | [Existing shark fixture](../deck-shark-suggestions/review/ship-after-day-900.png) | 900 × 900 |
| [Ship, night](ship-night.webp) | [Existing shark fixture](../deck-shark-suggestions/review/ship-after-night-900.png) | 900 × 900 |
| [Sakura, day](sakura-day.webp) | [Existing shark fixture](../deck-shark-suggestions/review/japanese-ship-after-day-900.png) | 900 × 900 |
| [Sakura, suggestions at night](sakura-suggestions.webp) | [Existing shark fixture](../deck-shark-suggestions/review/japanese-ship-after-night-900-bubbles.png) | 900 × 900 |
| [Home with Deck](home-deck.webp) | Fresh Home fixture | 1440 × 900 |
| [Home's List pane](home-list.webp) | Fresh Home fixture, cropped to the task pane | 638 × 815 |
| [Board](board.webp) | Fresh workspace fixture | 1440 × 540 |
| [Chat](chat.webp) | Fresh workspace fixture | 1000 × 980 |

The reused Deck captures come from the [shark interaction harness](../deck-shark-suggestions/README.md).
They show the current shipped scenes, including Sakura's submerged suggestion shark.

Fresh captures were made at source revision `3082862` using the existing
[Home Deck harness](../home-deck/render.mjs), its real workspace registration, React Native Web host
stubs, and the real scene-pack reader. A temporary adapter in ignored `.generated/` replaced the
entire `docs/board-list/fixtures.js` module; its older example content was not used. No application
code or existing harness source was edited.

The replacement fleet has six invented tasks under **Demo app**: colour palette, catalogue search,
keyboard navigation, quick-start guide, export button and card spacing. Tags are Design, Interface,
Accessibility and Docs. Its conversation is invented, and its preview is the same synthetic daytime
ship image above. Remote hosts are empty. All underlying identifiers are fixture-only and no agent
identifiers are displayed. The fresh harness reported zero browser page errors.

## Export and review

Headless Edge captured the fresh views with reduced motion. The images were decoded and re-encoded
through a browser canvas as WebP at quality 0.94, without source metadata. Deck images were resized to
900 pixels wide; text-heavy screenshots retain their capture scale. The List image is cropped to
the task pane to keep its rows readable. The eight files total less than 800 KiB; the largest is
about 164 KiB. All README image links are relative and all exports live here,
outside the npm package's `files` list.

Every final image was opened and visually inspected before commit, including the image embedded in
chat. The review checked for real project/task/backlog content, agent identifiers, host names,
addresses, personal filesystem paths, email addresses, unrelated pull-request URLs and private work.
None appears in the published images. Only the invented Demo app tasks, generic suggestion text,
standard interface labels and ship artwork are shown.

## Looping feature clips

The clips use the same invented Demo app fleet, captured at source revision `3efb59e` with
Playwright and headless Edge. Temporary adapters of the existing
[Deck settings harness](../deck-settings/render.mjs) and
[native chat harness](../native-chat-format/render.mjs) render the current compiled plugin.
The latter uses Paseo's actual native timeline components from the local source checkout;
it is a component fixture, not a recording of the installed desktop shell.

| Clip | Dimensions | Duration | Capture rate | File size |
| --- | --- | --- | --- | --- |
| [Sakura alive](sakura-alive.webp) | 800 × 453 | 5 s | 12 fps | 697,200 bytes |
| [Shark suggestions](shark-suggestions.webp) | 900 × 660 | 8 s | 6 fps | 444,034 bytes |
| [Scene picker](scene-picker.webp) | 900 × 660 | 8 s | 6 fps | 638,040 bytes |
| [Sailor focus](sailor-focus.webp) | 900 × 660 | 6 s | 6 fps | 511,126 bytes |
| [Native watch note](native-watch.webp) | 900 × 510 | 6 s | 4 fps | 15,374 bytes |
| [Chat image viewer](image-viewer.webp) | 900 × 700 | 6 s | 4 fps | 76,810 bytes |

The hero is cropped to the canvas. Its fixture changes one worker's state so the crew walks to
another station, and accelerates the local clock through the evening to show the real day/night
blend. The other clips use real pointer/keyboard interactions: open the shark's suggestions and send
one, switch scenes in both directions, focus a sailor and press Escape, reveal and fold a watch's
original text, and open and close an image preview. The shark send was checked against the fixture
RPC and appears as a user message; no assistant response was fabricated. All captures reported zero
browser page errors.

Sharp/libwebp encodes looping animated WebP, with quality 65 for the hero and 78 for the others.
Unchanged frames are coalesced while preserving their display time. The six clips total 2,382,584
bytes; with the eight stills, all README media totals 3,126,326 bytes. Source frames, temporary
adapters and review contact sheets stay in ignored `.generated/`; only final media is committed.
The obsolete upstream demo was removed.

Every one of the **171 encoded frames** was decoded from the final WebP files and visually inspected
in numbered contact sheets before commit. Captured visible text was also scanned for private data.
The review included the expanded watch envelope, suggestion prompts, task panels, image content and
chat after sending. The same privacy checks listed above passed for every frame: only synthetic
content and standard interface labels appear, with no displayed agent identifiers or private data.
