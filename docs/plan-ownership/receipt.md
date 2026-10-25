# Plan ownership implementation receipt

Base: `origin/main` at `b02540b9041fc68672f75120c2f5eed685732b3a`. Branch: `fm/fm-plan-ownership`. This is a source receipt; no live FirstMate home plan, schedule, plugin installation, or running agent was changed.

## Behavior and source pins

- `shared/workflow-plans.ts` defines the persisted initial owner, decision authority and current-owner projection. Missing ownership means Captain. An explicit FirstMate draft needs recorded delegation; implicit plans cannot claim it. A pending routine decision follows the current plan owner, while `authority: captain` remains a Captain gate.
- `server/workflow-plans.ts` appends explicit Captain transfer/revocation events and FirstMate progression events to the existing hash-linked plan log. Revision and subject hash bind submissions to the current owner and decision state. Idempotent request replay precedes current-state admission. Started attempts, answered choices and prior Captain actions survive transfer and revision.
- `server/workflow-plans.ts` keeps delegated revisions within the request and project/host/branch/delivery scope, pins Captain-only decisions and authority gates, and counts removed and prior attempts. A count-only worker/turn expansion can stay active under delegation; the new cap and spent attempts remain visible and enforced. Captain holds and explicit authority prerequisites still block starts.
- `server/workflow-board.ts` routes due actions to the actual owner and removes only plan-tagged, scope-matching duplicate legacy decision rows from Needs you. `client/workflow-plans.tsx` and `client/workflow-plan-browser.tsx` show the owner, transfer evidence, Captain exceptions and cumulative cap. The transfer control records a reason; no view or dismissal acts on a plan.
- `templates/tools/workflow.mjs`, `templates/data/workflows.md` and `templates/data/charter.md` document the supported commands and initiative rule. The existing heartbeat is the only scheduled wake; this change adds no timer or executor.

## Reproduction and checks

`server/workflow-plan-owner.test.ts` reproduces the old Captain-owned 1.5× relaunch review stop, then verifies that a FirstMate-owned relaunch remains active with a larger explicit cumulative cap and unchanged approval history. It exercises transfer, revocation, stale actions, request-id replay, role replacement, default Captain ownership, delegated stage/answer/start, preservation of active attempt identity, Captain-only decision and access gates, holds, invalid posture, duplicate Needs you suppression and scope refusal.

`server/workflow-tool.test.ts` exercises draft, answer, start and revocation through the shipped `workflow.mjs` request transport. `client/workflow-plans.test.ts` checks the displayed owner, transfer submission, exception copy and disabled Captain controls for delegated choices. The checks use temporary test homes; they do not act on live plans.

Local verification on Node 24 (the CI major): TypeScript `tsc --noEmit -p tsconfig.json`; focused workflow tests; full Vitest suite; `node docs/plans-graph/render.mjs` (eight theme/viewport cases); `git diff --check`. Full-suite totals and CI results are recorded in the PR and the FirstMate home report. Visual captures remain in ignored `.local/plans-graph/`.

Limit: `data/workflow-requests` is the existing cooperative first-mate-role transport, not authenticated filesystem IPC. Recorded chat delegation follows that established trust model. Worker/turn counts are internal limits; this change grants no money, access, merge, deployment, discard or external-effect authority.
