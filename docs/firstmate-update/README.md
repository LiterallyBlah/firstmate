# FirstMate update control

The upper-right control checks FirstMate's installed source on screen launch and every five minutes.
Checking, current and unavailable are disabled and have hover/focus explanations. A verified available
revision enables the control. Clicking revalidates its immutable target and sends one explicit captain
installation request through the same sender and lifecycle guards as Bearings/Ahoy. It never installs,
reloads, changes credentials or changes a channel. Current/unavailable/stale results send nothing.
The control stays pending after sending; only a newly loaded plugin whose running revision matches
its configured source becomes current.

## Source contract inspected locally

Implementation was checked against **Paseo 0.11.0**, including the desktop `resources/app.asar`
CLI/server files and the installed npm CLI distribution:

- `cli/dist/commands/plugin/index.js` defines `plugin ls --json` and
  `plugin update firstmate --check --json`. `update.js` returns the preview before any apply call.
- `protocol/dist/messages.js` defines `PluginListItem`, installation identity/currentRevision,
  registry identity and the Git/npm immutable preview target. Runtime code projects only the fields
  it reads because protocol is a dev dependency, not a host-injected runtime module.
- `server/dist/server/server/plugins/managed-source.js` derives installed revisions from acquisition
  artifacts. Managed Git uses its configured remote's default HEAD; npm uses that package's `latest`;
  registry installs use their reviewed pin. **0.11 does not retain an original Git `--ref` or npm channel
  selector.** The detector follows those supported configured update semantics, and preserves a
  selector when a host actually supplies `ref`/`npm.requestedSpec`. It never uses an upstream constant.
- Local directory installs use only the listed installation directory's Git repository, tracked
  manifest, clean HEAD and branch upstream configuration. The remote can be any configured fork or
  remote name. `git ls-remote` reads that upstream ref without fetch/checkout or moving local refs.
  Non-Git, dirty, detached and untracked installations are unavailable rather than assumed current.

The running identity is captured once at plugin startup, before refreshes. Any later installed
path/source/revision change requires reload; it cannot turn the still-running old bundle into current.
A startup identity that cannot be established requires reload to retry. Later network/check failures
retry on the bounded refresh. Git calls have 15-second timeouts; the existing CLI path has its
30-second timeout and output bounds. Public responses suppress raw process errors and private URLs.

Requests are serialized across clients, including revalidation. The shared client send gate prevents
double clicks and concurrent Bearings/Ahoy sends. A delivery claim happens inside `askMate`, after its
no-mate/migration checks and a final source/target check. A lost response after delivery starts keeps
the identity claimed and shows uncertain delivery; it does not resend automatically. Claims last for
the plugin process, so a reload without installing can allow a new explicit request.

## Verification

Focused unit tests cover configured Git forks/refs and npm channels/artifact integrity, registry pins,
read-only directory checks, current/offline/unknown results, bounded/shared refresh, source/target races,
duplicate/concurrent requests, pre-delivery failures, uncertain delivery and post-reload identity.
The full repository suite also checks packaging/import boundaries and all existing behavior.

The browser harness mounts the real `FleetSurface`, `UpdateButton`, tooltip and `useMateSender` with
synthetic host RPCs. It asserts all status states, disabled keyboard activation, tooltip viewport bounds,
duplicate/shared-gate behavior, pending status and stale/current no-message behavior. It captures 20
labelled screenshots at **1440×1000** and **390×844**, in light/dark themes; no live daemon is used.
Initial failed evidence is retained in `failed-evidence.txt`, `failed-render.txt` and `failed-0.png`.

```sh
npm ci
npm ci --prefix docs/board-list
npm test
npm run typecheck
node docs/firstmate-update/render.mjs
```

On PowerShell use `npm.cmd`. The harness needs Microsoft Edge; its dependencies reuse `docs/board-list`.
Browser layout is covered; native iOS/Android require a device check.

| State | Desktop light | Desktop dark | Narrow light | Narrow dark |
| --- | --- | --- | --- | --- |
| Checking | [image](desktop-light-checking.png) | [image](desktop-dark-checking.png) | [image](narrow-light-checking.png) | [image](narrow-dark-checking.png) |
| Available | [image](desktop-light-available.png) | [image](desktop-dark-available.png) | [image](narrow-light-available.png) | [image](narrow-dark-available.png) |
| Current | [image](desktop-light-current.png) | [image](desktop-dark-current.png) | [image](narrow-light-current.png) | [image](narrow-dark-current.png) |
| Unavailable | [image](desktop-light-unavailable.png) | [image](desktop-dark-unavailable.png) | [image](narrow-light-unavailable.png) | [image](narrow-dark-unavailable.png) |
| No mate | [image](desktop-light-no-mate.png) | [image](desktop-dark-no-mate.png) | [image](narrow-light-no-mate.png) | [image](narrow-dark-no-mate.png) |

Self-review checked the complete diff for installation calls, writable source operations, hard-coded
upstreams, false-current paths, delivery/lifecycle races, duplicate sends and header overlap. Existing
watches and providers are unchanged. UI integration is limited to the trailing header group and shared
sender; detection/contracts/tests/templates live in dedicated files for the adjacent item-tags task.
