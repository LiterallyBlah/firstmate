# Compact tag filters: isolated verification

The existing item-tag fixture renders the real `FleetSurface`, List, Board, cards and filters through
React Native Web. The optional `tags=19` fixture has 17 active-work tags and two Done-only tags
(`Archived release` and `Legacy migration`), with Dashboard shared by active and completed work.
The ordinary fixture has two tags. Every item stays within the existing 12-tag limit.
Only host RPCs and host settings are synthetic; no daemon, live plugin or home records are used.

At baseline `611e9cd0d5f4fb751dc36b5b8451c78b9ed1bd27`, the 19 choices occupy
[three rows](before-list-desktop-dark.png) at 1440×960. The existing tray's `maxHeight: 108` permits
three 32-point chips with two 6-point gaps, and Clear is inside its scroll content. Choice collection
also includes Done even when List hides completed tasks. The smallest height counterfactual is 70
points (two rows and one gap), but clipping alone leaves hidden keyboard targets and selected filters
without a visible removal control. The shared filter therefore adds a disclosure, an always-visible
selected count and Clear, and excludes clipped chips from keyboard and accessibility navigation.
Expansion remains bounded and scrollable so the last tag is reachable on a phone.

Completion scope follows the existing controls: List's Show/Hide completed tasks and Board's
Fold/Unfold Done. An unfolded Board already displays completed cards, so its choices include their
tags; folding Done removes those choices and their counts. List starts with completed tasks hidden.
Ready is still active work. Saved selections survive a scope change as zero-count choices until
removed or cleared. The scope is applied after the host tab and before tag matching; AND matching,
item tags, tag storage, the Board's latest-Done limit and saved host/filter settings are unchanged.

Run with Node 24 and Microsoft Edge, reusing the existing browser dependencies:

```sh
npm ci
npm ci --prefix docs/board-list
node docs/tag-filter-limit/render.mjs
node docs/item-tags/render.mjs
npm run typecheck
npm test
```

Use `npm.cmd` in PowerShell if script policy blocks `npm.ps1`.

All eight combinations below passed. Each collapsed tray measured 70 points and two rows; desktop
shows 16 of 17 active choices in List and 14 of 19 choices in an unfolded Board, while narrow shows
six choices. The few-tag path has one row and no disclosure. Screenshots were opened and inspected.

| Layout | Light | Dark |
| --- | --- | --- |
| List, 1440×960 | [Collapsed](list-desktop-light.png) · [Expanded, selected](list-desktop-light-expanded-selected.png) · [Few](list-desktop-light-few.png) | [Collapsed](list-desktop-dark.png) · [Expanded, selected](list-desktop-dark-expanded-selected.png) · [Few](list-desktop-dark-few.png) |
| Board, 1440×960 | [Collapsed](board-desktop-light.png) · [Expanded, selected](board-desktop-light-expanded-selected.png) · [Few](board-desktop-light-few.png) | [Collapsed](board-desktop-dark.png) · [Expanded, selected](board-desktop-dark-expanded-selected.png) · [Few](board-desktop-dark-few.png) |
| List, 390×960 | [Collapsed](list-narrow-light.png) · [Expanded, selected](list-narrow-light-expanded-selected.png) · [Few](list-narrow-light-few.png) | [Collapsed](list-narrow-dark.png) · [Expanded, selected](list-narrow-dark-expanded-selected.png) · [Few](list-narrow-dark-few.png) |
| Board, 390×960 | [Collapsed](board-narrow-light.png) · [Expanded, selected](board-narrow-light-expanded-selected.png) · [Few](board-narrow-light-few.png) | [Collapsed](board-narrow-dark.png) · [Expanded, selected](board-narrow-dark-expanded-selected.png) · [Few](board-narrow-dark-few.png) |

Keyboard checks cover Enter/Space on the disclosure, Space on a checkbox (including held-key repeat),
Tab past the final visible chip, individual removal of a selected overflow chip and focus retention
on collapse. Resize sequences at 3600 → 1100 → 800 → 390 → 1440 verify that a newly clipped focused
chip transfers focus to Show more and active filtering remains visible and clearable. Capture labels
in these resize sequences retain the initial 3600-point width; file dimensions show the final width.

| Resize | Light | Dark |
| --- | --- | --- |
| List | [1100](list-resized-light.png) · [800](list-resized-light-800.png) · [390](list-resized-light-390.png) | [1100](list-resized-dark.png) · [800](list-resized-dark-800.png) · [390](list-resized-dark-390.png) |
| Board | [1100](board-resized-light.png) · [800](board-resized-light-800.png) · [390](board-resized-light-390.png) | [1100](board-resized-dark.png) · [800](board-resized-dark-800.png) · [390](board-resized-dark-390.png) |

The matrix also verifies filter persistence after reload and List/Board switching, match-all results,
host intersections, completion visibility and counts, zero-count selections, unchanged stored Done
tags and clear recovery. A narrow case checks the 12-selection limit and re-enabling choices after
removal. [Machine-readable measurements](verification.json) accompany the captures. The existing
item-tag browser suite also passed its editor, save/retry, saved tag reload and maximum-name checks.
The full unit suite passed 478 tests with three existing skips; typecheck passed.

Self-review found two browser details requiring explicit handling: React Native Web's `onLayout`
observes chip size, so wrapping without a size change needs remeasurement from the container; its
checkbox Pressables activate with Enter but need Space handling. Container measurements use the
portable View API, and browser keyboard/focus handling stays at the existing web boundary.
Native iOS/Android accessibility and device layouts have not been exercised.
