# File images in FirstMate Chat

FirstMate's own Chat tab and Home chat now preview local Markdown images and image file links through `firstmate.images.read`. The existing `ChatImage` thumbnail/viewer receives a data URL; ordinary web/data images and sent images keep their existing path.

The RPC accepts only a relative path plus either `home` or an exact registered workspace ID. The server obtains the root from its own config or `paseo.workspaces.ref(id).refresh()`, rejects missing/mismatched/archiving workspaces, and applies `cleanRelative`, `resolveInHome`, canonical paths and `isInside`. There is no caller-supplied root or absolute-path read. Traversal, symlink escapes, Windows streams and non-files are refused. A bounded read caps source bytes at `MAX_CHAT_IMAGE_BYTES` (10 MiB). Extension and magic must agree for PNG, JPEG, GIF, WebP, BMP or AVIF; SVG must be UTF-8 text with an SVG root and no DTD/entities. SVG is only passed to an Image data URL, never inserted as markup.

Unqualified relative images resolve under the configured home. Absolute/file-URI references inside that home become home-relative requests. Other local absolute references use the existing registered-workspace resolver; relative workspace references retain the `firstmate:serverId=…&workspaceId=…` Markdown title. Explicit remote provenance is refused by this local image path. Reads never silently switch hosts. Workspace IDs and relative paths are rechecked on the server regardless of the client resolver.

## Evidence

`node docs/local-chat-images/render.mjs` mounts the real `MateChat`, Markdown renderer and image viewer through React Native Web. Only host APIs and transport are fixtures; HTTP `/rpc` calls the real server image reader against files under this isolated worktree. A copy of `docs/ship-deck-replies/still-a.png` is the preview image. The fixture does not install/reload the plugin or connect to the live daemon.

| Check | Desktop, dark | Phone viewport, light |
| --- | --- | --- |
| Inline preview | [Screenshot](wide-dark-inline.png) | [Screenshot](phone-light-inline.png) |
| Enlarged viewer | [Screenshot](wide-dark-viewer.png) | [Screenshot](phone-light-viewer.png) |
| Non-image, over cap, symlink escape, outside every workspace | [Screenshot](wide-dark-refused.png) | [Screenshot](phone-light-refused.png) |

The harness also clicks an ordinary image file link directly into its viewer, exercises zoom/fit, and requires zero page errors. `verification.json` records the actual reader results. The outside-workspace path is rejected before an RPC; direct server tests independently refuse absolute/outside paths and traversal.

Verified on Windows Edge with 1100×900 and 390×844 web viewports. The complete client bundle parses under React Native 0.81.5 Hermes with default flags. No native iOS/Android device or installed Paseo UI was tested; native image-format decoding remains platform-dependent and decoding failures show “Image unavailable.”

## Checks

- `npm.cmd run typecheck`
- `npm.cmd test -- --maxWorkers=1`: 95 files passed; 1,113 tests passed, 3 skipped.
- Focused image tests after final reader hardening: 12 passed.
- `node docs/local-chat-images/render.mjs`: both viewport sizes, previews/viewers and refusals passed.
- `node docs/ship-deck-canvas/compile.mjs`: Paseo 0.11 compilation and Hermes parse passed.
- `node docs/deck-settings/gate.mjs`: all 81 shots pixel-identical to main, no page errors or intentional differences; see `gate-results.json`.

The first unconstrained full-suite run hit timing-sensitive process tests (`pr-watch` and `update-source`) while rendering/compilation ran concurrently. The full single-worker run passed. An initial gate run was stopped after unrelated newly merged deck changes appeared on `origin/main`; the branch was rebased before the final gate.
