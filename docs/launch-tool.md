# Optional launch helper

The first mate may use `node tools/launch.mjs help` for a new task in a new
worktree. Home preparation refreshes this dependency-free helper. It does
not change local creation: the first mate calls `create_workspace` and
`create_agent` itself so Paseo can arm its native completion note.

Existing-workspace panels, promotions and relaunches use the charter's
manual routes. Unsupported request shapes are refused before writing.
No command archives, relabels or retries a create.

## Request and commands

Write a JSON request inside the home, for example `data/fix-login/request.json`:

```json
{
  "id": "fix-login",
  "title": "Fix the login redirect",
  "agentTitle": "Fix login redirect",
  "project": "web",
  "host": "local",
  "baseBranch": "main",
  "kind": "ship",
  "mode": "reviewed-PR",
  "brief": {
    "assemble": {
      "intent": "Fix the reported login redirect.",
      "spec": { "file": "data/fix-login/spec.md" },
      "rules": null
    }
  },
  "agent": {
    "provider": "codex/model-from-provider-models",
    "modeId": "full-access",
    "thinkingOptionId": "high"
  },
  "backlog": { "existing": "none", "tags": ["Frontend"] }
}
```

Choose the actual model/thinking IDs offered by `paseo provider models <provider>
--json`. Paseo validates the permission mode and base ref during creation.
`project` resolves by exact project name or ID; `host` is `local` or an exact
saved remote name/ID. Paths come from Paseo, never from the request. The
base passes through as `create_workspace.baseBranch` or remote `run --base`.

Unknown fields, including nested fields, are refused. IDs are lowercase
path-safe slugs of at most 64 characters. Titles have at most 120 characters,
without newlines or parentheses; agent titles have at most 60. Kind is `ship`
or `scout`. Mode is delivery text without backlog delimiters. Notes likewise
exclude parentheses/newlines. Tags follow the charter's 12-tag/40-character
limits, without commas or parentheses inside a tag.

Intent and spec accept text or `{ "file": "path-inside-home" }`. Rules are
`null` for the generic delivery rules or a `data/*-rules.md` path (also accepted
as `{ "file": ... }`). For a non-standard deliverable, use
`"brief": { "file": "data/fix-login/brief.md" }`; that file is used byte for
byte. Briefs must be UTF-8, contain a Status line heading, and contain neither
NUL nor `__PLACEHOLDER__` markers. Remote briefs are limited to 28,000 characters.
Records retain SHA-256 of both file bytes and the UTF-8 payload with CRLF
normalized to LF and outer whitespace trimmed. They do not prove delivery.

Use `backlog.existing: "adopt"` for an existing Queued line; its title and tags
are preserved. `(blocked-by: X)` needs `dependency: { "satisfiedBy": "concrete
artifact or other evidence" }`. No inference is made from a missing historical
item. A hold needs `captainAuthority: { "hold": "exact hold text", "authority":
"quoted instruction and date" }`. For `kind: captain` without a hold group,
the binding text is the filed title. Evidence is retained in the line's note.

```text
node tools/launch.mjs prepare --file data/fix-login/request.json [--dry-run]
node tools/launch.mjs record fix-login --attempt 1 --agent <id> --workspace <wks> [--armed]
node tools/launch.mjs unresolved fix-login --attempt 1 [--error "what happened"]
node tools/launch.mjs abandon fix-login --attempt 1 --reason "inspection evidence; duplicate risk accepted"
node tools/launch.mjs status fix-login
node tools/launch.mjs unlock fix-login [--backlog]
node tools/launch.mjs render art-ready --set task=fix-login --set branch=fm/art --set commit=<sha> --set artifacts=<paths> --set requirements=<requirements>
```

`prepare --dry-run` validates and returns the proposed local arguments without
reserving or writing. Ordinary local prepare reserves an attempt, writes the
brief and Queued line, then emits the exact MCP arguments. Call each create
once. Copy arming guidance into `--armed` only if Paseo reported it; this is a
lead report, not verification. Record even a mismatched worker so it remains
accounted for. `settings-differ` is informational: the captain may have changed
the worker's settings.

Remote prepare writes `<attempt>.remote.json` and calls `remote.mjs
--request-file` once. The request uses `--prompt-file` and an argv array,
preserving Windows paths. It supplies no reserved role/owner labels. The
existing bridge adds those and writes its existing action receipts.

## What checks mean

Local record uses all five label filters, `inspect` and `workspace ls`.
It compares the current lead parent, canonical local paths, worktree isolation,
and reported settings. Git reads the branch and merge-base against the
requested base in Paseo's reported workspace directory. Unreadable data is
`unknown`; a known mismatch is retained as a problem, without cleanup.

Remote record filters only by task and launch. It compares the daemon-reported
workspace/path and settings. Role, owner, kind and project label checks, current
branch, base ancestry and canonical filesystem identity remain **unknown**.
The parent check is not applicable. The bridge supplies ownership when it
creates a worker; this tool does not independently verify that label afterward.
A Paseo-exposed branch/ref field would enable remote branch verification without
a new transport. Ancestry and canonical identity would still need exposed data.

The CLI cannot verify an intact brief, that a notification remains armed, or
notification delivery. No logs-based substitute is attempted.

## Uncertainty, recovery and concurrency

Attempts live in `data/<id>/launches/<n>.json`, separate from task identity.
Exclusive hard-link publication reserves an attempt under a short per-task
lock. Issued/unresolved attempts prohibit a new attempt. A recorded worker that
is still live requires the manual relaunch route. Only an explicit abandonment
with a reason, a reconciled explicit remote error, or a recorded-and-gone worker
permits the next attempt. Previously written tool lines can be reused for it.
Recorded identities are inspected directly, even if relabelled. Only an explicit
archived result establishes recorded-and-gone; an omitted session or failed read
does not. Permanently removed/unreadable identities need manual reconciliation.

An error or lost answer is unresolved. Reconciliation looks for the launch
label; one worker with an identified workspace is recorded. Multiple workers
are reported. An empty listing after a timeout is never proof of failure:
creation has no registration deadline. Only an explicit remote CLI error plus
an empty reconciliation listing becomes failed, with a workspace inventory for
possible partial effects. There is no automatic second `run`.

`status` takes no lock and updates no records. It rechecks every attempt,
including abandoned labels, and flags late workers as duplicate risks. Use
`record` or `unresolved` to persist a reconciliation. A new first mate can do
so: effects recheck `role.mjs`, and records retain both launching and recording
identities. A handover warns that the native note targeted the predecessor;
the successor must check the worker on its heartbeat.

Locks contain a pid. A stale lock is reported, never silently removed.
After inspection, `unlock <id>` releases a per-task lock only when its pid is
gone; `--backlog` selects `data/.backlog.lock` instead. A live or unreadable
identity is refused. PID reuse can conservatively keep a stale lock held.

Backlog writes preserve the BOM, line endings and other lines. They stage,
compare with the initial bytes, rename, then check that the line is present.
A change before compare produces `backlog-changed`; removal after rename
produces `backlog-line-missing`. The exact intended line is saved first in the
launch record so it can be restored manually. **Another writer between compare
and rename can be overwritten without detection.** This is best-effort, not
compare-and-swap. Never run the helper in a batch with other backlog edits.

## Message templates

`data/templates/` starts with `art-ready`, `land`, `deploy-go` and
`panel-reviewer`. These are editable records, seeded only when missing.
`render` fills `{{name}}` in one pass; inserted text is never re-expanded.
It sends nothing and grants no authority. Without `--out` it only prints text.
An explicit `--out data/<id>/<message>.md` writes a new message file, refusing
existing files and the brief/backlog. There are no launch, lock or queue writes.

## Verification

`server/launch-tool.test.ts` uses a stand-in CLI and queue, real local scratch
Git repositories, the rendered role helper and the existing remote helper.
The tests cover contract rejection, concurrent attempts, lost answers,
abandonment and late registration, role handover, checks/mismatches, observable
backlog conflicts, exact Windows argv, receipts, render and template seeding.
No test claims to detect the compare-to-rename lost-update window.

Throwaway-daemon qualification remains separate: local finish note, remote
launch plus remote-watch, silent local `paseo run` worker, lost create answer,
and restart between create and record, with both Claude and Codex leads.
