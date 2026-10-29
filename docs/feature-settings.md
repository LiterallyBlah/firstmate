# Durable feature policy (smooth rollout, slice 3)

This preparatory slice adds a server-owned per-home policy contract and storage.
Runtime enforcement and public enablement belong to slice 4; in-app controls belong
to slice 5. Display preferences do not authorize server work.

## Acceptance checks recorded before implementation

- [x] Missing settings, fresh/upgrade, home aliases and home changes cannot enable
  another home's capabilities. Reads create no file/journal/coordinator. Concurrent
  saves refuse the stale revision.
- [x] Existing env-only partial combinations round-trip without broadening;
  explicit persisted off beats a legacy on. A lost settings response resumes the
  same request. Damaged records do not silently re-enable features or erase history.
- [x] Display preferences never authorize server work. Settings do not change
  current scope/session identity, cumulative budget, project authority or strong
  qualification.
- [x] This preparatory PR exposes no new public enablement until the runtime
  enforcement in PR 4 exists.

The captain accepted D1-D8 as recommended on 2026-10-29. For this slice that means
explicit opt-in for fresh and upgraded homes, preservation of partial pilot state,
separate capability choices, reviewed capacity, and no claim that switching off
undoes prior effects. Only the captain may attach a supervisor; policy grants no
new Attach, session, source authority, budget or strong capability.

## Contract and storage

`shared/feature-settings.ts` owns six strict independent booleans, reviewed plugin
slots/General headroom, versioned policy, app provenance and read/write contracts.
No actor, role, permission, plan cap or display setting is accepted as authority.
Capacity uses the existing supported 4/1 suggestion; saving requires the full
explicit reviewed value. No new preset or automatic increase is introduced.

`server/feature-settings.ts` keys `feature-settings/<sha256>/` below plugin data by
the existing `workflowHomeIdentity` (absolute normalized path, case folded on
Windows). It deliberately does not introduce a different realpath/alias identity.
Capture `legacyFeatureSettings` once against the initial configured home; passing
that captured bridge to another home cannot carry its opt-in across. All 64 flag
combinations remain independent; saved false overrides legacy true.

Each immutable revision contains the entire normalized request, hash-linked prior
revision and exact saved response. A synced temporary file is exclusively linked
into place, so independent processes cannot overwrite a winning revision. A
separate immutable publication receipt detects losing a final revision. Reads
validate the full history and never initialize, repair or reset it. An exact
explicit retry can finish a missing receipt for its final validated revision;
it cannot rewrite a damaged record. Receipt replay precedes the revision check,
so retrying an old saved request returns its original response after later edits.
These are local copies, not a trusted backup: coordinated deletion of a revision
and its publication receipt can conceal loss of that suffix.

## Runtime boundary and retained inventory

The app transport is prepared in `server/feature-settings-rpc.ts` but is **not
registered by `index.server.ts`**. Even explicit registration keeps app saves
held. There is no environment bypass or caller-supplied actor to unlock them.
PR 4 must install fresh policy checks at runtime effect boundaries before making
writes available; PR 5 supplies the in-app settings controls. The store's internal
save seam is tested directly and grants no running service authority.

Read results distinguish resolved requested/effective **policy** from runtime
enforcement (`runtimeEnforced: false`, `writesAvailable: false`). Dependency
refusals explicitly name the missing runtime prerequisite. A saved policy is not
a claim that current constructor-captured services have applied it. Corruption
returns held/unknown revision and all policy capabilities off without falling
back to the environment or deleting damaged files.

Inventory reads cover scoped bindings/effects only, with **complete: false** and
a named missing-coverage reason for legacy deliveries/native reconciliation.
Counts are lower bounds, never a complete fleet census. Active counts require one
verified owner and a succeeded opening for its exact epoch. Pending and uncertain
effect counts overlap; accepted sends remain uncertain. Failed/held source reads
return unknown counts, not zero. Reads invoke no writable runtime or host effect.

## Acceptance evidence

| Report acceptance | Focused evidence |
| --- | --- |
| No writes on reads; home isolation; stale CAS | `server/feature-settings.test.ts`, `server/feature-settings-rpc.test.ts`; independent Node processes in `server/feature-settings-process.test.ts` |
| Exact partial pilot bridge, off override, replay and corruption holds | Every one of 64 env combinations, restart/later-revision replay, changed-body refusal, corrupted JSON/home/hash/receipt, missing identity/final revision and interrupted publication |
| No display/session/budget/authority side effects | Strict schema rejects actor/display/strong fields; real seeded supervision journal projection and bytes remain identical after reads and policy saves |
| No early public enablement | Neither entrypoint imports the new policy; prepared app save always returns HELD, including when its handler is explicitly registered in a fixture |

No user-facing components, copy, navigation or runtime behavior change in this
slice, so before/after UI screenshots are not applicable. The report's copy
contract and all four theme/width proposal contact sheets were reviewed.
