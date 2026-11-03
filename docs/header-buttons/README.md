# Home header controls share one size

Needs you and Supervisors were 44 points tall at every width, against 30 for Open, More and the
other `IconButton`s, and Supervisors also had 7-point corners, a 13-point label and no fill. The
segmented List/Board/Deck and Home files/Plans controls were 28. All desktop header controls are now the
30-point `CONTROL_HEIGHT` (`client/control-size.ts`) with 8-point corners and a 12-point label; phones keep
44-point targets. `IconButton` sets that height explicitly: its label's line height made it 30 points with Windows
fonts but 28 with Linux's. Needs you keeps its outline, fill and icon signal.

`node docs/header-buttons/render.mjs` (after `npm ci --prefix docs/board-list`) renders the real Home header on
the slice 3 synthetic host, with nine decisions waiting, at 1440, 900 and 390 pixels in both themes, for
`190b510` (before) and the working tree (after). It measures every header button and fails if any desktop
control differs from More by more than a point, or a phone control is under 44. Sheets: `evidence/`.
