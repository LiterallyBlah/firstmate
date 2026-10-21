# Home's header cluster

The captain found Home's top-left — a round tan pill, a round state chip and loose grey counts beside
the square-cornered List/Board/Home files/Deck switch, Open and More — "completely ugly and not within
the style of the plugin". The cluster now uses the right-hand controls' language:

- **Needs you** (`client/needs-you.tsx`) is drawn like `IconButton`: 28 points high (44 and full width
  below 638), 8-point corners, a 12-point label beside a 14-point icon — Check when clear, Bell when
  something waits, TriangleAlert when decisions cannot be read. The signal stays where it was: an
  amber outline while decisions wait, an amber fill while some are new, a dashed outline when stale, a
  danger outline when unreadable. The words keep the foreground colour, readable on both themes;
  the leading ✓ is now the icon.
- **The first mate's state** is "First mate *state*" beside its coloured dot, and **the counts** put
  their numbers in the foreground; both are plain text with no outline, so nothing that is only a fact
  looks like a button. Thin rules separate Needs you, the state and the counts. On a phone they share
  one row under the indicator and wrap rather than clip.

Information and behaviour are unchanged: the same label, accessibility label and tooltip, and
pressing Needs you still opens the next decision.

`render.mjs [label]` renders the real Home header with the Needs-you fixtures at 390, 900, 1440 and
2866 pixels, dark and light: new, waiting, stale, clear and unreadable decisions with the first mate
idle, and new decisions with it working. Images go to `.local/header-style/<label>/`, never into the
repository. It needs `docs/board-list`'s dependencies (`npm ci` there).
