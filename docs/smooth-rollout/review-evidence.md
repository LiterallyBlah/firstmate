# Independent review follow-up

The two P2 findings were reproduced with failing browser assertions before the
fixes. The same production-component runner now passes all four theme/width
variants (52 records, 36 captures). Before is reviewed head `b2fad4e`; after is
the follow-up on main including slice 3 (`cb464d1`). Host responses are synthetic;
no live home, agent, message or execution setting was changed.

| Acceptance | Evidence |
| --- | --- |
| An explicit route beats old preferences; Open original message deliberately changes recipient, reads its conversation and exposes reconciliation while preserving the uncertain request | `scope-discussion.test.ts`; `review-regressions.mjs` asserts the Reader pass header, original plan read, reconciliation control and no mutation RPCs after starting in Reader project. |
| The outstanding decision wait survives fleet success and late/reopened drawers; neutral after 8s, read-only retry/details after 30s, no timer-created failure | `needs-you-query.test.ts` checks source lifetime across observer/remount, cache isolation, settlement and one in-flight read; `read-progress.test.ts` checks absolute deadlines and genuine failure. Browser holds both reads at 1/9/31s, completes only fleet, opens/reopens the drawer and proves decision retry remains one read. |
| Recovery Back returns focus to General while fleet is pending | Browser asserts composer focus in every theme/width; the nested recovery chat receives its actual visibility. Draft, attachment and history checks remain. |

Each sheet has before/after columns and three rows: decisions still pending after
fleet success at 31 seconds; drawer opened late; original-message recovery.

| Theme/width | Comparison | Full-size before/after captures |
| --- | --- | --- |
| Light desktop (1440×1000) | [Sheet](review-evidence/light-1440-comparison.png) | [Files](review-evidence/) prefixed `before-light-1440` / `after-light-1440` |
| Dark desktop (1440×1000) | [Sheet](review-evidence/dark-1440-comparison.png) | [Files](review-evidence/) prefixed `before-dark-1440` / `after-dark-1440` |
| Light phone (390×844) | [Sheet](review-evidence/light-390-comparison.png) | [Files](review-evidence/) prefixed `before-light-390` / `after-light-390` |
| Dark phone (390×844) | [Sheet](review-evidence/dark-390-comparison.png) | [Files](review-evidence/) prefixed `before-dark-390` / `after-dark-390` |

Inspected both themes and widths against the copy contract: existing neutral delay
copy and 44px recovery actions are reused, pending never creates an error or zero,
and an uncertain send is never retried. Existing administration/discussion jargon
belongs to later slices. These browser checks do not establish physical-device
keyboard or spoken screen-reader behavior.
