# Provider migration verification

The screen uses the existing FirstMate modal, searchable model picker and settings controls. It
names the transfer as a new session, explains the excerpt limits and provider-state boundary, resets
permission/thinking choices when the model changes, and offers saved recovery and old conversation
links. Full usage and limits are in the repository README.

## Reproduce

From the repository root:

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
npm.cmd ci --prefix docs/board-list
node docs/provider-migration/render.mjs
node docs/provider-migration/daemon-check.mjs C:/path/to/@getpaseo/cli/dist/index.js
```

The UI harness defaults to headless Edge (`FM_TEST_BROWSER` can select another Playwright channel).
It mounts the real FleetSurface and migration controls through react-native-web, stubbing only host
APIs, including the host modal and settings selects. It covers 1600×1200 desktop and 390×844 phone
browser layouts in light and dark themes, permission reset between providers, thinking selection,
failed transfer, recovery using the saved identity, history navigation, and running/initializing
refusal. Native phone controls still need a device check.

The daemon harness accepts an existing CLI JavaScript entry, creates a unique temporary home and
loopback port, strips inherited Paseo/provider credential environment variables, disables injected
agent MCP tools and uses two synthetic providers. Every CLI operation includes that temporary home.
It installs/reloads only there, stops that daemon and deletes its home with bounded Windows lock
retries. It never contacts the actual daemon or sends a model request to a paid provider.

Lifecycle assertions cover:

- Same-workspace child/grandchild refusal leaves the current mate, every child and config intact.
- Explicit `workspaceId` assignment places scratch crew in a separate workspace; a different cwd
  alone would inherit the parent's workspace and is not a valid preservation fixture.
- Creation failure leaves the source current. Recovery after an isolated plugin reload reuses the
  journal's replacement identity, retires only the source and preserves crew and durable orders.
- The replacement has no parent and remains live after the archive cascade; the handoff is recorded
  in its projected timeline, the source's history stays available and stale requests are refused.

Unit tests also cover invalid settings, late children, a replacement linked into a cascade,
cancellation safety, source activity changes, replacement survival, archive/config/send failures,
lost acknowledgements, concurrent requests and retained watch/crew delivery. GitHub Actions runs
typecheck and the full suite on Linux and Windows.

## Screenshots

| View | Dark | Light |
| --- | --- | --- |
| Desktop selection | [PNG](selection-wide.png) | [PNG](selection-wide-light.png) |
| Phone selection | [PNG](selection-phone.png) | [PNG](selection-phone-light.png) |
| Desktop recovery | [PNG](recovery-wide.png) | [PNG](recovery-wide-light.png) |
| Phone recovery | [PNG](recovery-phone.png) | [PNG](recovery-phone-light.png) |

## Limits and review

The handoff is a bounded excerpt plus continuing files, not a complete summary or native state
transfer. Existing local native notifications cannot be retargeted: the charter/handoff instructs
the replacement to reconcile workers and keep its heartbeat. Remote ownership uses the unchanged
daemon identity, not the supervisor agent ID; migration does not change remote workers or hosts.

The lifecycle gate serializes FirstMate actions; independent Paseo actions/native notifications
can race the last source check because the SDK has no conditional archive transaction. Checks run
before preparation, before retirement and after retirement, with a persistent journal on failure.
External archival of the replacement requires explicit repair; recovery does not silently recreate
an archived identity. Queued board notes retain stable message IDs until a successful send; an
ambiguous acknowledgement can cause a retry. Watches keep their existing bounded durable queue.

Verification uses synthetic providers and host UI contracts; it does not claim a live Claude-to-Codex
test, native-device validation or a remote-host migration exercise. The actual mate and workers were
not changed.
