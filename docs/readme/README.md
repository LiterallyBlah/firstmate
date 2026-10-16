# README screenshots

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
