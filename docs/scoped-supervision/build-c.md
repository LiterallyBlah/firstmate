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

## Composition and rollout boundary

`FIRSTMATE_SCOPE_UI=1` exposes the existing scope composer, context/status and inbox
filters. `FIRSTMATE_SCOPE_EXECUTION=1` separately enables explicit discussion and
scoped-answer presses. Values other than exactly `1` are off. Neither switch performs
an operation by itself. No settings document, background loop or helper flips them.

`ScopeRuntime` injects S05 `ScopeDiscussions` and S03 `SupervisionCommands` into the
existing RPCs, using Build A's `SupervisionRuntime`. The owned writer opens only on
an explicit mutation. The service uses the existing cooperative SDK receiver and
S04 claim/verify/send sequence. Capacity checks and reservations share the existing
scoped admission queue; native effects do not hold that queue or General's conversation
lock. General uses `askMate` with its lifecycle/home/recipient checks. Scope and project
admission/source/profile/budget guards run again at reservation and dispatch.
General's shared messages use a read-only scoped projection and never acquire that writer;
an unrelated coordinator recovery cannot gate ordinary General conversation.

Only a dormant, unbound scope can gain a discussion-only session through Send.
The existing S07-committed plan Attach convention remains the only way to attach
its first work supervisor; this build never invokes it. Discussion cannot dispatch
workers or promote itself to work. Maintenance and remote discussion remain read-only.
Uncertain effects, drafts, submitted answers and original message identities are retained.
No automatic send retry, takeover, worker execution or release authority is added.

Project turns retain `project.owner.limits`. Plan sessions retain the existing **1 session /
1 opening turn** cap. `ScopeRuntimeOptions.planLimits(status, scopeId)` is the single
server-owned seam for B's later durable continuing-turn cap; it is not wired to environment
values or composer input. A spent plan cap refuses another model turn. This is an explicit
integration boundary, not a budget reset or a claim of everyday plan runtime completion.

The plugin transport does not authenticate the captain. The dedicated answer press uses
`answerFromUnverifiedUi`, records `plugin-ui-unverified` provenance and atomically writes
the existing decision answer/logical-owner outbox. It cannot mint plan approval or another
operation. The normal command entry points still reject unverified actors. Native permissions
retain the original native request flow. Failed combined rereads keep confirmed answers disabled.

## Shared inbox and context

All filters operate on the existing combined Needs-you snapshot. General includes legacy work
it owns; Project includes its scoped descendants and exact local host/name aliases; Plan and
Maintenance select their recorded scopes. Specific project filters never join a remote task by
name alone. Global totals stay unchanged; Coming up contributes no count. Unknown quarantines
remain visible in every filter and every counted scoped hold retains its scope.

`shared/scoped-captain-decision.ts` exports `ScopedCaptainDecisionSchema` and its type for B/D.
The strict versioned shape carries home, scope kind/id, decision identity/revision/subject,
origin kind/id, question, consecutive numbered option IDs, recommendation, evidence refs/digests,
project ancestry and permitted answer action. It is presentation only; the emitting service must
retain its checked answer context and logical-owner outbox. Existing plan decisions use it now.
Project/maintenance origins are **fixtures only**, per the first mate's scope clarification.
Owner-only incidents/conflicts do not acquire captain ownership or inflate counts.

Admitted project names/aliases resolve `#project` context and `@project` recipients. Untagged
shared messages and `@mate` address General. Context uses A's confined, digest-checked conventions/
memory reader, capped at 512 KiB across one message, with authority `none`. Body mentions never
select recipients. Native tabs retain their own recipient; there is no universal composer hook.

Projects, Plans and Needs you link into the existing scope chat with exact home/scope identities.
Exact native-session links keep the selected host. Status and compact scoped/portfolio/maintenance
Bearings come directly from the stored projection; reading, filtering, selecting, restoring and
opening a native link create no resource or approval. B's actual stored rule holds appear through
existing operation-hold/goal-next/effect-evidence fields; C does not invent rule verdicts.

## Verification artifacts

All local render/compile/test output stays in ignored `.local/`. The committed Build C harness
mounts the actual drawer, filters and shared decision component in both themes at 1440×1000 and
390×844. It checks every scope category, project ancestry, retained global counts/quarantines,
zero mutation calls, origin fixtures and horizontal containment. Existing S05 checks cover the
captured pending send, native link, remount/offline drafts, refusal and answer uncertainty cases.
The Build C harness is also part of both CI check jobs, with screenshots uploaded as artifacts.

Current verification is recorded in [build-c-verification.json](build-c-verification.json).
Typecheck, focused checks, both browser harnesses and installed compiler/Hermes passed.
The final local full suite has a **known pre-existing Windows flake**: 3,192 passed, one failed, three skipped. Two CI-shaped
full runs each failed one assertion in the unchanged launch-helper suite; its isolated control
passed all 90 tests. The first mate confirmed Build A's reviewer encountered the same flake
and designated hosted checks as the completion gate. No unrelated fixture, assertion or timeout
was changed, and the failed local result is retained rather than relabeled green.
