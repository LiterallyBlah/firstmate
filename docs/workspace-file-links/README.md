# FirstMate workspace file references

FirstMate chat identifies a file's Paseo host and workspace, shows its relative
filename and optional line selection, and offers **Open workspace**. Select the
file manually in that workspace's explorer. The supported plugin navigation API
does not open a file pane or select lines. Reports and images follow the same
rules; image markup becomes a clickable reference without fetching image bytes.

The captain accepted this workspace-only fallback after the API investigation.
The original findings and four comparison screenshots remain unchanged in
[investigation.md](investigation.md), [verification.json](verification.json),
`panel.jsx`, `render.mjs` and `installed-runtime.mjs`. They describe the original
failure, not the final feature's behavior.

## Authoring convention for standing records

Use normal Markdown with exact host/workspace provenance in its title:

```markdown
[Report](<file:///C:/repo/reports/report%20one.md#L12> "firstmate:serverId=SERVER_ID&workspaceId=WORKSPACE_ID")
[Image](<reports/chart%20one.png> "firstmate:serverId=SERVER_ID&workspaceId=WORKSPACE_ID")
[Backlog](<data/backlog.md> "firstmate:home")
```

Replace `SERVER_ID` and `WORKSPACE_ID` with the exact IDs from Paseo, percent-encoded
as field values. Use the target host's ID, including for this machine; labels,
agent/task IDs and workspace ID prefixes do not count. The host must be configured
in the Paseo client. A host known only to FirstMate's daemon-side remote helper
cannot be navigated through the client until it is configured there.

The destination is either a workspace-relative filename or an absolute filename
(a `file:///` URI is recommended for absolute paths). Use `/` separators and
percent-encode each filename component once: space `%20`, percent `%25`, hash
`%23`, question mark `%3F`, parentheses `%28`/`%29`. Leave structural slashes and
a Windows drive's colon intact. Use `#L12` or `#L12-L18` for line identification;
legacy `:12` and `:12:4` suffixes also display line/column information. These
identify a manual selection; they do not move the explorer or editor cursor.

`firstmate:` title metadata is a FirstMate parsing convention, **not a Paseo deep
link**. Intentional home files require the explicit `firstmate:home` title in
FirstMate chat. They retain the existing confined home Files view. Unannotated
relative Markdown links explain the missing provenance; relative plain text and
inline code remain text. They are never guessed against the mate's home.
Other Markdown surfaces retain their existing home-file behavior. No standing
record, charter or template was rewritten by this change.

## Resolution and trust boundary

| Reference | Result |
| --- | --- |
| Exact host/workspace title | Read only that host's workspace inventory; require an exact active workspace and a filename inside its root. |
| Bare absolute path, including existing plain/code mentions | Inspect all configured hosts' complete inventories; allow only one containing workspace. |
| Same Windows path on two hosts, or nested workspace roots | Explain ambiguity; require explicit provenance. No host or most-specific-root guess. |
| Offline/incomplete host inventory | Refuse bare absolute routing. Explicit links to a different online host can still work. |
| Missing/archived/archiving workspace, unknown host, changed root | Explain the target problem. No fallback to another workspace or host. Recheck on **Open workspace**. |
| Missing workspace file or symlink | Existence and realpath are not checked. The dialog and follow-up toast say so; manual exploration remains Paseo's responsibility. |
| Explicit home link | Ask the existing `firstmate.files.find` RPC; only its confined answer enables the home Files callback. Missing/outside/not-yet-checked targets explain the problem. |
| HTTP(S) | Preserve the complete URL, query and fragment through the existing external opener, regardless of title. |

Paths are decoded once. Parent traversal, unsupported URI authorities/schemes,
drive-relative paths, malformed encoding, controls, invalid Windows filenames
and paths outside the explicit root are refused. Windows drive/UNC comparisons
ignore case; Unix comparisons preserve it. Path component boundaries prevent a
root such as `C:/repo` from claiming `C:/repo-other`.

Production uses the public `useHosts()`, `getPaseoClient(serverId)`, paginated
`client.workspaces.list(...)` and
`navigation.openWorkspace({ serverId, workspaceId })` APIs from the host-injected
plugin module. No extra file/line fields are sent.
The installed protocol accepts `idPrefix` but documents it as ignored, so the
resolver pages the unfiltered inventory and checks workspace IDs itself.

No private native callback, file stat/read/execute endpoint, credential acquisition,
arbitrary preview or new RPC is added. The existing home server's lexical and symlink confinement
is unchanged. Workspace directory ownership is lexical only; this feature does
not claim to establish a file's existence or its symlink destination.

## Verification and screenshots

```powershell
npm.cmd ci
npm.cmd ci --prefix docs/board-list
npm.cmd run typecheck
npm.cmd test
node docs/workspace-file-links/render-fallback.mjs "C:/Users/micha/AppData/Local/Programs/Paseo/resources/app-dist/_expo/static/js/web"
```

Typecheck and the full unit suite pass: **40 files, 509 passed, 3 existing skipped
(512 total)**. The 31 new routing/parser cases cover exact remote identity with
an identical local Windows path, nested roots, pagination and incomplete
inventories, cancellation/revalidation, missing/archiving targets, unsafe paths,
encoding/lines, home confinement and HTTPS preservation. These unit inventories
and navigation sinks are fixtures, not live host tests.

`render-fallback.mjs` mounts the real `FleetSurface`, `MateChat`, renderer and link
dialog at 1400×980 and 390×844 in both light and dark themes. It checks four
successful workspace selections per run plus ambiguity, missing provenance,
outside-root/missing-home/offline targets, removal after lookup, cancellation,
copying file locations, home Files routing and titled HTTPS URLs. The actual
installed 0.11.0 public navigation bridge strips the call to precisely
`serverId`/`workspaceId` before an instrumented workspace sink receives it.
[fallback-verification.json](fallback-verification.json) preserves the calls,
inventories, copies, toasts and installed bundle hash.

| Evidence | Wide | Phone |
| --- | --- | --- |
| Local report, dark | [Screenshot](fallback-local-wide-dark.png) | [Screenshot](fallback-local-phone-dark.png) |
| Local report, light | [Screenshot](fallback-local-wide-light.png) | [Screenshot](fallback-local-phone-light.png) |
| Remote image, dark | [Screenshot](fallback-remote-wide-dark.png) | [Screenshot](fallback-remote-phone-dark.png) |
| Remote image, light | [Screenshot](fallback-remote-wide-light.png) | [Screenshot](fallback-remote-phone-light.png) |
| Ambiguous absolute path | [Screenshot](fallback-ambiguous-wide.png) | [Screenshot](fallback-ambiguous-phone.png) |

The local wide/dark, remote phone/light and ambiguous phone screenshots were
visually inspected for readable identity, filenames, line information, actions
and refusal text. No clipping was found.

**Supported versus fixture evidence:** the installed public bridge and SDK API
shapes are real. Hosts, workspace inventory, transcript, home answers, clipboard,
toast and navigation destination are instrumented fixtures. The web render uses
fixture adapters for host UI primitives, including the modal wrapper; its body
and actions come from the production component. No live daemon or
native file pane was opened and no remote file availability was tested. This
does not prove live local/remote end-to-end routing in a running Paseo session.
No install, reload, live configuration change, core edit, merge or main push was
performed. A future automatic file opener still requires a supported core API
and is outside this PR.
