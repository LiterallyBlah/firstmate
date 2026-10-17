# Deck image budget

`PACK_BYTES_MAX` is 2,000,000 raw PNG bytes per pack. The pack linter warns above
1,600,000 bytes (80%); it still fails above the hard cap. This admits the queued
roughly 1.4 MB Sakura pack without changing loading, art, manifests or the renderer.
The budget counts referenced images, including previews, before base64 encoding.
Manifest and envelope bytes are additional; this is an image budget, not an
absolute bound on arbitrary manifest size or decoded texture memory.

## Transport audit (Paseo 0.11.0, 2026-10-17)

The following paths are relative to the installed CLI's `node_modules`, inspected
read-only at `C:\Users\micha\AppData\Roaming\npm\node_modules\@getpaseo\cli\node_modules`.
`S` means `@getpaseo/server/dist/server/server/`, `R` means `@getpaseo/relay/dist/`.
Line numbers refer to that installed release, not an upstream checkout.

| Source | Relevant behavior / limit |
| --- | --- |
| This repo: `index.server.ts:284`, `server/deck-settings.ts:94`, `:165` | One RPC returns the manifest and every referenced image as a base64 string. The cap counts the original buffers; images are not separate requests or binary frames. |
| `S/plugins/runtime.js:104`, `:336`; `S/plugins/plugin-process.js:443` | Plugin subprocess uses Node IPC; invocation validates the contract and sends one `result` with `output`. No separate RPC byte cap is applied here. |
| `S/session.js:1589`; `S/websocket-server.js:898`; `@getpaseo/protocol/dist/messages.js:6283` | Output becomes `plugin.rpc.invoke.response`, wrapped as `{type: "session", message: ...}`. The response schema at `messages.js:5934` uses `output: z.unknown()`, with no size restriction. |
| `S/websocket-server.js:723`, `:769`; `S/websocket/physical-socket.js:74` | `JSON.stringify(message)` is passed to a single socket `send(frame)`. No pack chunking. One WebSocket message; the installed `ws` sender uses a final frame by default (`ws/lib/websocket.js:489`). |
| `S/websocket-server.js:450`; `ws/lib/websocket-server.js:74`; `ws/lib/websocket.js:688` | Paseo does not override `maxPayload`; `ws` defaults to 100 MiB (104,857,600 bytes) for **incoming messages**. This is not an outbound per-RPC limit. |
| `S/websocket/physical-socket.js:4`, `:73` | Outbound backstop: queued bytes plus the new frame must be at most 64 MiB (67,108,864 bytes). A congested socket can hit this even with small messages. |
| `S/relay-transport.js:10`, `:375`; `S/websocket/encrypted-relay-socket.js:32` | Relay connections use the same logical socket path. Before send, the socket checks encrypted wire bytes plus queued bytes against the same 64 MiB backstop. No custom `ws.maxPayload` on this relay client. |
| `R/encrypted-channel.js:50`, `:346`, `:365` | Text JSON is encrypted, then base64-encoded again: `4 * ceil((JSON bytes + 40) / 3)`. The binary-ciphertext shortcut applies only to ArrayBuffer payloads, not these text RPCs. No fragmentation/chunking. |
| `R/cloudflare-adapter.js:366`, `:391`, `:403` | The supplied Cloudflare Durable Object adapter forwards each message whole. No additional application byte limit in this adapter. |
| `@getpaseo/client/dist/daemon-client-websocket-transport.js:9`, `:18`, `:59`; `daemon-client-relay-e2ee-transport.js:71` | Browser/native factories use the platform WebSocket and pass received messages through; no extra client size option. Relay clients use the same encrypted-channel implementation. |
| This repo: `client/deck-scene.ts:291`; `client/deck-mount.ts:528` | The full Deck pack loads only for a web canvas, once per setting/session. Native mobile can receive picker previews, but does not load the full Deck pack through the normal UI. A web client can use the relay. |

Cloudflare documents a **32 MiB (33,554,432-byte) received WebSocket message limit**
for Durable Objects: [current limits](https://developers.cloudflare.com/durable-objects/platform/limits/).
The previous 1 MiB platform limit was raised on
[2025-10-31](https://developers.cloudflare.com/changelog/post/2025-10-31-increased-websocket-message-size-limit/).
This is the smallest identified message ceiling on the supplied relay path.
It is platform documentation, not a test of the deployed relay or a guarantee about
custom proxies. No live relay, pairing link or running daemon was used for this audit.

## Reproduce the measurement

Install root dependencies and `docs/board-list` dependencies with `npm ci` in each.
Run `node docs/ship-deck-canvas/compile.mjs`, then
`node docs/deck-pack-budget/measure.mjs`. Use `npm.cmd` in Windows PowerShell.
The measurement writes only under ignored `.local/deck-pack-budget/`.

The benchmark uses the existing `docs/deck-settings/host.jsx` and stubs, the compiled
plugin, the real pack-serving functions and headless Edge at 1440 × 900, DPR 1,
reduced motion, fixed noon. The synthetic Sakura copy contains valid random private
ancillary PNG chunks, distributed across its images to total **exactly 2,000,000 bytes**;
all declared digests are updated in that isolated copy. Shipped pack data is untouched.

One warmup per pack precedes seven interleaved samples, each in a fresh browser
context (cold client caches, warm server cache). Time starts at the full-pack fetch
and stops after Pixi's first actual `Application.render()` returns. A fixture-only
observer wraps that method. Every sample asserts the requested setting was drawn
without page errors. The existing host carries RPCs over loopback HTTP, so this
measures local JSON transfer/parse, PNG decode and first draw, **not WAN or relay
latency**. Envelope sizes include a 36-character request ID; relay sizes use the
installed encryption formula. Padding preserves pixel/texture workload, so these
timings do not predict the GPU cost of future 24-pose atlases or additional crew.

Measurements and gate results are recorded in the PR and the external evidence
folder `C:\Users\micha\.paseo\plugin-data\firstmate\home\data\deck-pack-budget\evidence\`.
Generated images, logs and result files are not committed.
