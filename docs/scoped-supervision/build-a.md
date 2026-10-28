# Build A acceptance contract

Project mates and durable project ownership are default-off. This build does not activate, provision or attach live scopes; rollout belongs to the captain after review. Plan execution, everyday scoped chat and maintenance are separate builds.

The following automatic checks define acceptance before implementation:

| Audit acceptance IDs | Required automatic evidence |
| --- | --- |
| A01, A13, A18 | One shared owned coordinator; concurrent/stale requests refuse; shutdown/restart retains identity and uncertainty. No second Attach path. |
| A12, A22 | History and accepted request replay survive journal paging beyond sequences 128/160/192/256, pressure and restart. Corruption/truncation holds remain; no history reset or budget refund. |
| A09, A15 | Every active registry entry is admitted or explicitly held, canonical project identities/aliases are stable, and project-plan membership distinguishes legacy pending migration from scoped sponsorship. Reads create no resources. |
| A01, A15, A20 | Duplicate project provisioning/intake produces one identity; independent workspace/session, durable profile/context/caps and cumulative spend survive restart. Plugin-owned admission reserves configured General headroom. |
| A05, A15 | A project stop holds only affected starts; an unrelated project continues. Cross-project plans retain one sponsor and one execution owner. |
| A11 | Memory proposal/CAS transport and confined capped digest-verified accepted text reader; memory/context never authorizes effects. |

Validation commands: `npm run typecheck`, `npm test`, focused Build A service/storage fixtures, `node docs/ship-deck-canvas/compile.mjs`, and affected UI render checks in both themes at desktop/phone browser widths. Fixtures use temporary homes/synthetic providers only. The completed PR will record exact commands/results and map new fixtures to this table.
