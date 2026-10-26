# FirstMate machine notes in native chat

The native Paseo conversation now folds complete FirstMate watch batches and board
notes into the same summaries as FirstMate's Chat tab. Each row has a keyboard and
touch accessible **Show original / Hide original** button. The expanded text is
selectable and preserves the original, including line endings, tags and failure
details. The canonical transcript is unchanged.

The transformer selects only `user_message`. It requires a complete envelope at
character zero, rejects trailing ordinary prose and incomplete or nested
envelopes, and reuses `watchSummary` / `injectedSummary` from
`client/transcript-rows.ts`. Watches retain failed-run and dropped-run indicators.
Plan action notes (`templates/messages/workflow-note.md`) fold only with their own
`firstmate-plan-<event id>` client message id, as "Plan owner transferred ·
<plan id>" and the like, through `planNoteSummary`.
There is no fleet lookup, clock, selected-agent state or side effect in the
transform; renderer disclosure state is local to the mounted row. Source identity
and projection caching remain Paseo's responsibility.

Ordinary messages, assistant text, tool calls, reasoning, errors and permission
requests remain native. The existing FirstMate Chat tab is unchanged. Recognition
is by format across the host: any agent's user message consisting of an exact
FirstMate envelope receives the same presentation. This is not provenance or
authorization validation.

## Paseo-owned system notes

`<paseo-system>` remains native, including in the first mate's conversation.
Safely folding it only for the configured first mate would require a supported
agent/host identity or agent-scoped registration in the **transformer** API,
plus cache identity/invalidation that accounts for that scope and role changes
(adoption, migration, release). The renderer already receives an agent ID, but
that is too late to restore an untouched native row after replacement. Reading a
mutable fleet/selection global from a cached transform would be incorrect.

## Evidence and its limits

These are **native timeline fixtures, not screenshots of an installed plugin in
the running first mate session**. The task forbids installing or reloading the
plugin. No plugin was installed, reloaded or deployed; Paseo source was read only.

`render.mjs` evaluates the entire client bundle produced by Paseo's own compiler,
captures registrations through a synthetic client, and runs the read-only local
Paseo `plugins/timeline/model.ts` and `projection.ts`. It renders the actual
`UserMessage` component and stylesheet extracted unchanged from Paseo's source,
alongside the registered FirstMate renderer. The surrounding page, messages,
clock label, copy control, rewind hook and attachment lightbox are fixture
services. It does not exercise the full native chat shell, plugin runtime
provider/error boundary, live timeline transport or actual user sessions.

The local Paseo source revision is recorded in [results.json](results.json).
Each image labels itself as a fixture. No private messages were captured.

| Scenario | Before | After | Original text revealed |
| --- | --- | --- | --- |
| First mate, desktop dark | [Before](mate-1100-dark-main.png) | [After](mate-1100-dark-branch.png) | [Expanded](reveal-1100-dark.png) |
| First mate, phone dark | [Before](mate-390-dark-main.png) | [After](mate-390-dark-branch.png) | [Expanded](reveal-390-dark.png) |
| First mate, phone light | [Before](mate-390-light-main.png) | [After](mate-390-light-branch.png) | [Expanded](reveal-390-light.png) |
| Second agent, desktop dark | [Before](second-1100-dark-main.png) | [After](second-1100-dark-branch.png) | Unchanged |
| Second agent, phone dark | [Before](second-390-dark-main.png) | [After](second-390-dark-branch.png) | Unchanged |
| Second agent, phone light | [Before](second-390-light-main.png) | [After](second-390-light-branch.png) | Unchanged |

The three second-agent image pairs are byte-identical. They contain ordinary
text mentioning a tag, a Paseo system note, and a quoted watch example. The harness
also verifies source-object identity for assistant, reasoning, error,
permission-notification and tool fixtures and stable cached replacement identity.
It checks no horizontal overflow, renderer schema validation, Enter to expand,
Space to collapse, pointer disclosure and `aria-expanded`. React Native Web
requires the explicit ARIA prop as well as native `accessibilityState`.

Web fixture coverage: Edge at 1100×950 and 390×950. Hermes coverage: the entire
compiled client parses with React Native 0.81.5's default compiler flags, without
class syntax or bundled Pixi. Native component tests also exercise the renderer
with Android compact props. Neither Hermes parsing nor prop tests are a running
device test. Installed Electron/native chat, Android and iOS devices, screen
readers, Safari and Firefox are untested.

## Reproduce

Use `npm.cmd` / `npx.cmd` on Windows. `PASEO_SOURCE` can override the read-only
Paseo source path in `render.mjs`; `PASEO_COMPILER` can override the existing bundle
compiler path. Generated files stay in ignored `.generated` directories.

```powershell
npm.cmd ci
npm.cmd ci --prefix docs/board-list
npm.cmd run typecheck
npm.cmd test -- --maxWorkers=1
node docs/ship-deck-canvas/compile.mjs
node docs/native-chat-format/render.mjs
node docs/deck-settings/gate.mjs
```

The initial default-concurrency suite run, concurrent with compilation, hit
timing failures in `server/update-source.test.ts` (five-second timeout) and
`server/pr-watch.test.ts` (one-second process budget). The final run limits worker
concurrency without changing test timeouts or assertions. Final counts and gate
results are recorded in [verification.json](verification.json).
