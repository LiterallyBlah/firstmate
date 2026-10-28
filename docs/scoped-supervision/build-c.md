# Build C — everyday scoped conversation and inbox

## Check first

Acceptance is against the feature audit dated 28 October 2026, Build C, inventory
15–21, 24–28, 30 and 70. Automatic checks must pass before this build is done:

| Audit ID | Required proof |
| --- | --- |
| A07 | Checked scoped answer transaction/outbox; accepted retry, changed subject, owner transfer and failed reread retain the original submission and never fall back to backlog delivery. |
| A09 | One shared inbox with global totals, scope/ancestry filtering, holds/quarantines and no Coming up count; stored status/Bearings and repeated reads create no resources or approvals. |
| A11 | Admitted project names/aliases are context only; source prose cannot select or authorize an effect; exact scope/home identity checks remain in force. |
| A16 | Captured send recipient survives scope switches; drafts and uncertainty survive remount/offline; only explicit Send creates discussion; exact native-session links, no new tab manager. |
| A21 | Unknown/ambiguous routing refuses, evidence is confined/capped and untrusted text remains context. |

Commands: `npm run typecheck`, `npm test`, focused Build C integration/client tests,
the Build C render harness (light/dark, desktop/phone), and the current client-bundle/
Hermes compile check. The PR records actual commands, counts and any limitations.

UI and execution use independent explicit startup switches, both default off.
No rollout, provisioning, migration, Attach, timer changes or live model calls are
authorized by this build. Existing S00–S12 and #161/#163 paths are reused.
Build B owns worker execution/rule enforcement; Build D owns maintenance delivery.
