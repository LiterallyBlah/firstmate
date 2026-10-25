# PO2-R1 gate-conversion receipt

This correction extends the [original ownership receipt](receipt.md) and the [PO1–PO4 correction receipt](corrections.md). Its parent is `82af44cd79a3804db45caffee99d0afdbdbc3277`. The independent re-review report in FirstMate home, `data/fm-plan-ownership-rereview/report.md`, remains unchanged (SHA-256 `1EA9D8CC0A58BAF0481B042ECED7CB286641EA7EBE19B837BD707CF473979880`).

An unstarted routine decision named `choice` could be revised into a ship run under the same ID. The existing scope check recognized the run as introduced, but Captain-gate inheritance applied only when the ID was entirely new. With a protected ship already in the same scope, the converted run could be started before the Captain decision. Both the legacy workflow handler and the disabled S03 command seam call this shared admission check.

`assertDelegatedRevision` now applies gate inheritance whenever the prior node is **not a run**, including a decision-to-run conversion. The separate checks for previously started nodes, answered decisions, changed scout/ship scope, and explicit Captain authority remain intact. This check runs at append admission; it does not reinterpret committed history on replay.

Each handler-level regression drafts an explicitly delegated plan with an unanswered Captain database decision, a gated scout, a gated ship and the routine `choice` decision. It proves that an ungated new-ID ship and an ungated conversion of `choice` both refuse with unchanged workflow/store bytes. It then admits the same conversion with the Captain edge retained, refuses its start before the Captain answer, and starts it after the Captain answer with one spent attempt. The previously closed PO1, PO3 and PO4 tests remain in the focused and full suites.

Evidence retained in ignored `.local/plan-ownership/`:

| Run | Result | SHA-256 |
| --- | --- | --- |
| `gate-conversion-red.log` | Both new handler tests fail at the prior admission condition because the ungated conversion resolves successfully. | `A90B2D3B506AC5E3311167BD7B7F55B10B807CCF84CBE113FB26267D36D93DFC` |
| `gate-conversion-focused.log` | Both affected files pass, 54/54 tests. | `AE92D0511B4EC6C78328B3EA333CF629A02946E62165F90E97C977A10EAB19C1` |
| `gate-conversion-full.log` | Default-timeout full suite: 2,504 pass, 3 skipped, two unchanged tests reach Vitest's five-second limit under load. No assertion failure is reported. | `9EA61025E91A2B95B1A873C367E78E9D9EBE64BFEBD5939C170DAD869AF300A7` |
| `gate-conversion-timeouts-isolated.log` | Both timed-out cases pass alone at the default limit in under half a second each. | `7E21DBA072F7885314962CEAC616C0FF43A1442BC272129741211B5E2A63F7D1` |
| `gate-conversion-full-15s.log` | Full suite with `--testTimeout=15000`: 168 files, 2,506 pass, 3 skipped. Assertions unchanged. | `305BA6ED11B97CB70023CDFD4183128FC730C5AFE64634150D0211A43F9761D8` |

Node 24 TypeScript typecheck and `git diff --check` passed. `node docs/needs-you/render.mjs` reported `{"raised":4,"headers":40,"layouts":14,"taskViews":6,"failures":0}`. CI and the exact correction head are recorded in the separate FirstMate home report after the PR checks finish. No live plan, ownership, plugin, schedule, agent or provider action was taken.
