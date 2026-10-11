# Workspace file links: supported navigation blocker

Investigation on `fm/workspace-file-links`, rebased onto `origin/main`
`4647135d8197be5597deaf092f9e1412bd346a9b`. **No production change; the requested
automatic file opening is blocked on a supported client navigation API.** This
folder preserves the evidence and decision boundary, rather than claiming a
fixture is a working plugin implementation.

## Trigger, symptom, and cause

Trigger: a first mate replies with a Markdown link to a report or image outside
its home, for example `[Workspace report](C:/repo/reports/report.md#L12)`.

FirstMate's `client/file-links.ts` asks only `firstmate.files.find` about home
files. A workspace target is not vouched for by that RPC. Markdown links then
become ordinary `link` tokens, whose press handler in `client/chat.tsx` calls
`openExternalUrl`. The installed client ignores non-HTTP(S) targets, without an
error, so clicking does nothing. Windows drive paths are also rejected as path
candidates by the inline tokenizer's scheme check. Its current Markdown grammar
does not handle angle-wrapped destinations or link titles.

The home-only resolver is a trust boundary, not an erroneous arbitrary-files
lookup that should be widened. `server/files.ts` confines both lexical paths and
symlink resolutions to the home. No production read RPC or filesystem behavior
has been added by this investigation.

Native conversations take another path: the installed assistant link resolver
classifies file targets, decodes a `file://` URL and line anchor, then calls the
conversation's private `onOpenWorkspaceFile(target, disposition)` callback. That
callback already has its host/workspace pane context. A link in a native mate
conversation can therefore produce a file pane there, but this does not prove
that a bare absolute path identifies the file's *associated* workspace or host.
The native resolver does not infer remote ownership from a Windows drive path.

Smallest counterfactual: keep the exact target constant and replace only the
click handler. FirstMate's real Markdown component plus the installed external
opener ignores `C:/repo/reports/report.md#L12`; the installed native resolver and
click handler produce `{ path: "C:/repo/reports/report.md", lineStart: 12 }` for
the supplied conversation context. Home `data/backlog.md` and ordinary HTTPS
links remain working controls. This disconfirms a file-specific failure and
locates the routing difference before any file read.

## Confirmed public API limit (two independent checks)

1. Installed `@getpaseo/plugin` **0.11.0**,
   `dist/client/contracts.d.ts`, lines 20–36: surface navigation has `openAgent`,
   `openWorkspace({ workspaceId, serverId? })`, and optional Electron
   `openBrowser({ url, workspaceId, serverId? })`. There is no file target or
   `openFile`. `openPanel` opens a contributed plugin panel; it has no native file
   path/line target and no cross-host option.
2. Installed Paseo Desktop **0.11.0** bundle `createPluginHostNavigation`
   (module 4771, line 18042):
   `openWorkspace` destructures only `workspaceId` and `serverId`. Supplying an
   extra `target: { kind: "file", path }` is discarded, even in untyped JS. This
   is exercised with local and remote fixtures in `verification.json`.

`openBrowser` accepts absolute HTTP(S) URLs only and opens a browser target,
not a file. `openExternalUrl` similarly accepts HTTP(S) only. The SDK's public
`PaseoApi` manages agents, projects, workspaces, terminals, providers and config;
it does not expose a file pane opener. Internal pane stores and daemon file
methods are not supported plugin navigation APIs. No deep link has been invented
and no private runtime method is used by production code.

The exact bundle hash and individual module hashes/line numbers are preserved in
`verification.json`. The extractor reads the installed code and fails if its
expected modules or private entry point have changed. Generated native source is
ignored and is not shipped or committed.

## Supported alternative and decision needed

The supported plugin-only alternative is to resolve a known, active workspace
on an explicitly identified host, call
`navigation.openWorkspace({ serverId, workspaceId })`, and explain which relative
file to select in Paseo's explorer. The captain must select the file. This is a
degraded workspace-only fallback, **not completion of automatic report/image
opening**. It can be implemented if that behavior is accepted.

For the requested automatic behavior, the host needs to expose supported file
navigation carrying `serverId`, `workspaceId`, a confined workspace-relative file
path, and optional line selection, reusing its native file pane. This is an API
requirement, not a method assumed to exist. A separate plugin file preview is a
larger product/security choice and was not added. No install, plugin reload,
live configuration change, core edit, merge, or main push was performed.

## Exact recommended authoring convention (pending router/API support)

Use a normal Markdown file destination with provenance in the title, not a new
navigation scheme. Recommended future contract:

```markdown
[Report](<file:///C:/repo/reports/report%20one.md#L12> "firstmate:serverId=SERVER_ID&workspaceId=WORKSPACE_ID")
[Image](<reports/chart%20one.png> "firstmate:serverId=SERVER_ID&workspaceId=WORKSPACE_ID")
```

`SERVER_ID` and `WORKSPACE_ID` are exact Paseo IDs, percent-encoded as field
values, never host labels, task IDs or path-derived guesses. The destination is
either a percent-encoded absolute file URI or a workspace-relative path. `/`
separates path components; spaces, `%`, `#`, and `?` in filenames must be encoded;
`#L12` (or `#L12-L18`) selects lines, separate from the filename. A plain `[Image]`
link opens a file, without automatically fetching image bytes.

**This title metadata is a proposed authoring convention, not a currently
implemented Paseo deep link or FirstMate feature. Do not add it to standing
records as working behavior yet.** No captain record, charter, or template was
rewritten. The first mate can retain this exact recommendation for the follow-up
once the supported routing choice has been made.

The follow-up resolver must handle these boundaries before navigation:

- A relative destination requires explicit workspace and host provenance; it
  must never be interpreted as a home file because the named workspace is
  unavailable. Existing intentional home-file references retain the home Files
  behavior.
- A bare absolute path can be routed only when ownership is unambiguous across
  all known hosts/workspaces. Identical Windows paths on different hosts,
  incomplete/offline host inventories, and multiple workspace identities require
  explicit provenance. Nested workspace roots must not silently choose a parent
  workspace.
- The requested workspace must exist and be active on the named host. Missing,
  archived, disconnected, or unsupported targets need a clear explanation, with
  no fallback to the current host or mate home. Missing files should use the
  host's confined file viewer's failure handling.
- Decode once; reject traversal, drive-relative paths, malformed encoding and
  targets outside the explicit root. Any file bytes must remain subject to the
  host viewer's existing authorization and confinement. Links cannot execute
  files, add arbitrary reads, or acquire remote credentials.
- HTTPS links retain their normal external behavior. Report and image links use
  the same workspace/host/file identity rules.

## Reproduction and evidence limits

```powershell
npm.cmd ci
npm.cmd ci --prefix docs/board-list
node docs/workspace-file-links/render.mjs "C:/Users/micha/AppData/Local/Programs/Paseo/resources/app-dist/_expo/static/js/web"
npm.cmd run typecheck
npm.cmd test
```

The harness uses the existing board-list browser dependencies and a loopback-only
ephemeral HTTP server. It mounts the real `Markdown` component used in FirstMate
chat. It runs the installed native resolver, private click handler and public
plugin navigation bridge in an isolated module loader. Only unavailable
environment/hook modules and external/pane sinks are stubbed; the private click
entry point is exposed solely inside this evidence harness. No daemon, credentials
or file bytes are accessed. This harness is **not** a production workaround.

`verification.json` records six ignored FirstMate file clicks, six native file
callback targets (local and remote fixtures sharing the same Windows path),
successful home/HTTPS controls, and two supported workspace callbacks that omit
the extra file target. Four PNGs capture local/remote FirstMate failures and
native callback results. The local FirstMate and remote native callback PNGs
were visually inspected: the result banner and fixture labels are readable,
with no clipping.

There was **no live end-to-end FirstMate-versus-native conversation test and no
native file pane rendered**. Browser/native app surfaces were unavailable to
the UI tool, and no plugin installation/reload was authorized. The fixture
checks prove the callback difference and installed public API boundary; they do
not prove remote file availability, file rendering, a completed routing fix, or
correct host routing in a running Paseo session.

Local validation: typecheck passed; existing full suite **39 files, 478 passed,
3 skipped (481 total)**. There are no production routing regressions to claim:
the blocker was confirmed before implementing a router. Delivery is an evidence
PR pending a navigation/product decision, not a feature PR ready to merge.
