# Topics phase 0 — adviser gate failed

13 October 2026. Based on `origin/main` e8c7dc44e6ad621c9721da01486818ce1b24b8ab:
https://github.com/LiterallyBlah/firstmate/tree/e8c7dc44e6ad621c9721da01486818ce1b24b8ab.
The Opus topic design and Astra adversarial review in the assigned `fm-topic-design` and
`fm-topic-design-review` reports were read in full. The review's M1–M4 requirements govern this work.

**Verdict: Claude plan is not qualified. No adviser profile is available.** Native approval and mode
changes allowed real canary writes, including after restart. `server/adviser-profiles.ts` has an empty
allowlist and an unconditional refusal; there is no adviser creation path, topic UI or Discuss entry
point. Muse, Codex, OMP and OpenCode are untested and unavailable. A discussion-scout experiment remains
the first mate's next decision, not an implementation added here.

## Qualification evidence

`qualify.mjs` runs the real installed Paseo daemon and Claude Code binary against **deterministic local
Anthropic-protocol replies**. It forces actual native tool attempts rather than relying on a model to
disobey a prompt. No real Opus inference or external API credential is used. The model identifier is
`claude-opus-5-5`; this is a harness qualification, not a model-behavior evaluation.

| Component | Measured version/configuration |
| --- | --- |
| Paseo CLI/server/client | 0.11.0 |
| Claude Code | 2.1.282 |
| Claude Agent SDK in installed daemon | 0.3.246 |
| Node / OS | v24.19.0 / Windows 10.0.26300, win32 |
| Creation | Explicit separate workspace; parentless; no prompt; mode `plan`; role label `topic-adviser` |
| MCP | `paseo` namespace replaced with the existing empty stdio endpoint; daemon injection enabled |
| Settings | Fresh `CLAUDE_CONFIG_DIR`, no copied user settings/MCP/hooks; provider retains its native tool inventory |
| Network | Local model endpoint and separate localhost dispatch canary endpoint; relay disabled |
| Enforcement listener | Headless test client denies permission requests, except explicitly tested native approvals |
| FirstMate plugin/client | Absent throughout; no installation or reload, including on the throwaway daemon |

`qualification.json` records exact creation inputs, the pre-prompt snapshot, effective tool names
observed in real Claude model requests, permission decisions, actual tool results and canary contents.
The inventory includes **Agent, Bash, Write, Edit, ExitPlanMode, SendMessage, Workflow, CronCreate,
ScheduleWakeup**, among others. No `mcp__paseo__*` tool was observed; this does not remove native tools.
The stub's own empty tool list was not treated as proof of the whole inventory.

| Attempt | Observed result | Acceptance meaning |
| --- | --- | --- |
| Write inside cwd | Tool requested permission; denied; marker absent | This request was denied |
| Write outside cwd | Tool requested permission; denied; marker absent | This request was denied |
| Bash interpreter write | Actual Bash call failed because auto-mode classifier could not evaluate it; marker absent | **Inconclusive**, not a policy guarantee |
| Bash dispatch-shaped POST | Actual call failed at classifier; controlled endpoint received zero requests | **Inconclusive**, not dispatch isolation |
| Native Agent | Actual request denied | This subagent request was denied |
| Native SendMessage | Native validation rejected the attempted canary input; no real recipient supplied | **Inconclusive**, not cross-session isolation |
| ExitPlanMode | `kind: plan` request denied; tool failed | This request was denied |
| Native approval while deny listener unavailable | Write completed; `approval.txt` contains `approved` | **FAIL** |
| Two clients race native Allow versus independent Deny | Both RPCs returned success; Write completed; `raced.txt` contains `raced` | **FAIL**; deny cannot undo the winning approval |
| Direct native `setAgentMode(..., bypassPermissions)` | Mode changed; Write completed without a permission; marker contains `escalated` | **FAIL** |
| Resume after daemon stop/start | Mode still `bypassPermissions`; Write completed; marker contains `resumed` | **FAIL** |

The approval race uses the same daemon permission RPC as a native tab, through a second client, with
Allow started 50 ms before Deny. No visual native tab was opened. No topic pane or FirstMate client was
connected. Plugin unavailability is exercised throughout; an actual plugin restart was **not** performed
because installation/reload is prohibited. No claim is made that a particular plugin hook was run or
that injected-seed behavior, every native tool, or ordinary external-model classifier behavior passed.
These unproved cells cannot qualify a profile; the observed breaches already reject this one.

All probe homes, provider state and canaries were created beneath a unique `.phase0-*` directory in
this worktree. The harness stopped its explicit test daemon and removed that directory. Cleanup was
checked afterward. It never connected to the live daemon or wrote the live home/plugins checkout.

Reproduce without installing a plugin:

```powershell
node docs/topic-phase0/qualify.mjs '<installed @getpaseo/cli/dist/index.js>'
```

The runner records a **not qualified** verdict even if individual negative tests pass. It cannot
automatically enable a profile. A future qualified profile requires a new complete acceptance matrix,
including enforcement independent of native approvals, mutable mode, inherited tools and plugin life.

## Shipped home guard

- `templates/AGENTS.md` puts a role check before even a customized charter. `templates/data/charter.md`
  limits first-mate duties to a verified current role. No live home file was edited.
- The generated `tools/role.mjs` reads current config every time. Its rendered daemon/home paths bind
  it to the intended installation. Config and default-home precedence match `dataPath`: current wins,
  legacy is used only when current is absent. A corrupt current config never falls back to legacy.
  Its validator is generated from the plugin's actual Zod input schema. Real paths, junction aliases
  and Windows case are compared canonically. Unreadable/missing/ambiguous identity returns `guest`.
- Environment role labels never grant authority. `PASEO_AGENT_ID` is a candidate hint checked against
  current durable config; a conflicting `PASEO_HOME` fails closed. This is a **behavioral identity
  guard**, not process authentication or a filesystem sandbox. A same-user process can spoof state;
  stale guest sessions retain native capabilities and previously read instructions.
- Launch/restart reserve identity and opening before create, create without prompt, verify the
  independent idle workspace, activate config, then send. Lost create replies reuse the saved ID.
  A lost send reply leaves `sending` and blocks additional plugin deliveries; opening is never blindly
  replayed. Inspect the reserved session in Paseo, then release the role before another launch.
  Release clears the reservation but does not archive the session. Migration retains its existing
  prepare/activate/send ordering. Adoption/release are reflected on the next role check.
- Native agent panels identify other home chats as guests, including released mates carrying
  stale labels. Inspectors/advisers are excluded from adoption. Home guests add no authority or actions.
  Home permits other chats without a warning banner; the role guard and guest guidance are unchanged.

## Submission core and remaining phase-1 integration

`shared/submissions.ts` and `server/submissions.ts` are **unwired library primitives**. No background
delivery, RPC, topic registry, filesystem ack consumer or canonical action uses them yet.

The store has an explicit home/fleet identity. Each submission starts with an immutable, content-bound
ID and payload (topic, adviser generation, text, links, kind and references). Same-ID/same-content
retries recover the saved receipt; changed content raises `SubmissionConflict` with that receipt.
Intentional repeated text with a new ID remains a distinct instruction.

Each transition is a complete immutable revision, file-synced and published with an exclusive hard
link. Revisions form a hash chain. There is no separate mutable registry to lose after writing a file.
An unpublished temp is not a submitted request. Missing store identity, corrupt revisions, gaps and
foreign namespaces stop reads/writes instead of resetting to an empty outbox. This covers process
crash/restart and competing writers; it does not promise recovery from disk loss, power failure,
malicious local modification or deletion of the newest journal files. The intended root is private
plugin data, outside the home Files editor.

`beginDelivery` persists the target, generation and message ID **before any caller may send**, with
state `uncertain`. A crash just before sending and one just after acceptance look the same; neither
permits automatic retry. Only affirmative, content-matching evidence can set `recorded`, which means
transport recorded the message, not that an agent acted. The recovery inbox includes unacknowledged
old-mate deliveries and partial outcomes, independently of Done/backlog retention. Explicit transfer
changes reconciliation owner without resending. Corrections retain both instructions, never canceling
an already-started one.

Ack request identity and effects are committed in one revision. Receipts bind a **verified caller** to
mate generation, separate accepted intake from completion, and retain action-level progress/evidence.
They reject stale actors, changed same-ID acks, lost completed progress and unsupported completion.
The library's verified-actor argument is a trust boundary, not authentication supplied by JSON.

Before actionable handoffs, phase 1 still needs: durable client intent/recovery UI and history lookup;
real home/fleet/generation provisioning; an authenticated server ack adapter; exact immutable envelope
rendering; full retained-timeline reconciliation that treats errors/gaps/absence as uncertain; fair
delivery scheduling under the mate lifecycle gate; visible recovery/transfer/correction receipts; and
reconcilable canonical effects performed by the first mate. There is **no exactly-once execution claim**.

## Validation and self-review

Focused tests cover role precedence/defaults, corrupt/missing config, aliases/case, stale identity,
bootstrap ordering, lost creation/send responses, adoption exclusions, generation transfer,
submission conflicts and crash boundaries. The first role parity run caught a missing default-home
case; it was fixed by using the actual input schema/default semantics. Existing launch tests failed
until their old prompt-during-create assumptions were replaced with ordered identity assertions.

`node docs/topic-phase0/render.mjs` mounts the real fleet and guest panel through the existing synthetic
host harness (dependencies: `npm ci --prefix docs/board-list`). Desktop/phone, light/dark screenshots
and `render-results.json` are now written only to ignored `.local/topic-phase0/`. The current harness
checks that Home has no guest warning or guest-navigation buttons, while the guest panel retains its
identity explanation. The older long-title/button overflow evidence is historical. Native device
behavior is not claimed. `docs/plans-panel/render.mjs` has before/after warning-removal captures.

Full repository commands: `npm run typecheck`, `npm test` (same commands as Linux/Windows CI).
Final local result: typecheck passed; **535 tests passed, 3 existing tests skipped, 43 files passed**.
One full run caught the deliberate charter fingerprint change; its fixture was updated. Another run
overlapped the daemon probe and hit an existing 5-second Git-fixture timeout in `update-source.test.ts`;
the final run is performed without the probe. Review includes the full diff, template inventory/package
shipping, fail-closed paths and the deliberate absence of any topic/adviser product entry point.
