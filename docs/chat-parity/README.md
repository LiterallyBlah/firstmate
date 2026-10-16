# FirstMate chat parity audit

Audit date: 2026-10-16. Baseline: the installed public plugin/client/protocol SDKs **0.11.0** and
Paseo's **v0.11.0** source, commit
[`22488d4502cd0c8a4ee4619af991762f071b60a7`](https://github.com/getpaseo/paseo/tree/22488d4502cd0c8a4ee4619af991762f071b60a7).
Native behavior below is source-inspected, not a live desktop/iOS/Android test. Plugin behavior is
checked in the real React Native Web components with synthetic host APIs. No Paseo code was patched,
vendored or forked, and no plugin was installed. Stage 1 is
[PR 76](https://github.com/LiterallyBlah/firstmate/pull/76).

The filtered chat remains the same conversation in Home and the Chat workspace panel. The watch,
system-note, reasoning and tool-summary filter is unchanged. This slice changes presentation and
client-side reads only; first-mate dispatch, sends, supervision and server RPCs are unchanged.

## Findings and disposition

| Capability | Paseo native chat | Plugin before this slice / root cause | Plugin-only fix and current disposition |
| --- | --- | --- | --- |
| Pick, paste, drop images | Composer normalizes images and stores attachment metadata/bytes before submission. Native devices use platform pickers. | Web picker, paste and drop work; pending thumbnails already work. Native attach is absent because Expo pickers are not host exports. | Web path retained. **needs-decision N1** for native picker access. |
| Sent-image preview | Native `UserMessage` draws image pills using its local message's image metadata. | Stage 1 draws thumbnails from the plugin's per-message memory cache. Daemon `user_message` contains text and IDs, not image payloads. | Already shared between Home/Chat; verified again with two simultaneous composers and delayed sends. |
| Enlarge sent images | Attachment lightbox opens the image for inspection. | Fixed-size, noninteractive thumbnails. | **Fixed:** keyboard-accessible image button opens a host modal with zoom in/out, Fit and scrollable full-image inspection, including phone-browser layout. |
| Preview after full browser/app reload | Native attachment bytes have platform-local storage (IndexedDB, desktop bridge or native files); message rendering still needs a local metadata association. Its in-memory session store does not itself prove restoration of every sent association after process restart. | Plugin kept both association and bytes only on `globalThis`; full process/reload lost them. | **Fixed for web renderers:** bounded IndexedDB records keep the message ID and image together. Real page reload verified with a text-only daemon echo. Browser eviction/quota/private-mode failure leaves memory previews and sending usable. Native storage still **N1**. |
| Preview on another device / native-chat sends | Canonical timeline does not carry image/attachment metadata. Native's local submission record enriches that device's stream. | Plugin cannot reconstruct bytes or IDs it never received; native sends are not in the plugin cache. | **needs-decision N2.** A second local cache cannot provide cross-device history. |
| Assistant HTTP(S)/data image Markdown | Native Markdown/image components render images and open a viewer. | Plugin's trimmed Markdown renderer treated image syntax as a link. | **Fixed for whole-line image syntax:** HTTP(S) and raster data URLs, including lines beside prose, render and enlarge. Fenced examples remain code. Decode failures say the image is unavailable. Inline images mixed into a sentence/list, SVG and HTML remain outside this small renderer. |
| Assistant workspace-file images | Native assistant-image acquisition resolves file sources and calls its daemon file reader before caching bytes. | Public `PaseoApi` has no corresponding binary file read; plugin home Files RPC is text-oriented. A daemon path is not a browser URL. | Existing workspace-link routing remains. **needs-decision N3** for actual file-image bytes; no guessed URLs or arbitrary file reads. |
| File attachments | Native composer supports uploaded files plus workspace/context/plugin-resource attachments; native message rows retain attachment pills. | Web plugin uploads files using its existing RPC, but the response/timeline does not return the attachment receipt. Sent row may only contain text or `(attachments)`. No native picker. | Upload behavior unchanged. A filename-only local badge is possible, but is not a downloadable receipt. **N2/N3** for durable receipt/access; native picker **N1**. Limits remain 50 MB/file, 20 attachments and 64 MB/message because this RPC carries one base64 frame. |
| Basic Markdown | Native renderer covers rich Markdown, lists, headings, inline styles, tables and code. | Plugin supports headings, lists/task markers, bold, code, quotes, rules and pipe tables with its small parser. No full CommonMark/HTML/emphasis/strikethrough implementation. | Existing subset retained. Images and code copy added only when `chatTools` is enabled, so file/card renderers do not change. Richer syntax is plugin-possible, but needs a renderer/dependency choice and Hermes verification; see **N4**. |
| Code and tables | Native fence renderer has richer language/presentation handling, including Mermaid, and selectable content. | Plugin displays plain monospaced code and simple equal-width tables; long lines wrap. | **Fixed:** copy original code in one action. Syntax highlighting, Mermaid and wide-table scrolling are **N4**; no native renderer was copied into the plugin. |
| Links | Native routes workspace files and external links using host context. | Plugin has HTTP(S) opener plus workspace-aware file routing and explicitly proven home links. | Preserved. Chat tab uses a Files dialog for home links; workspace links retain their current provenance checks. No filter/link policy loosened. |
| Long replies / history | Native uses projected timeline pagination and platform-specific rendering/virtualization. | Plugin only requested the newest 150 projected entries and ignored `hasOlder`; an older visible conversation was unreachable. | **Fixed:** Load earlier messages uses public `before` cursors, retains the prefix during live-tail refresh, retries errors, resets on epoch/rewind/gap and preserves the viewport on prepend. Very large manually loaded histories still use ScrollView, not virtualization. |
| Tool/activity visibility | Native exposes reasoning, tool detail, plans and native timeline extensions. | Plugin intentionally folds or hides machinery with `transcriptRows`. | Kept exactly as specified. **Full conversation** is now directly available in either chat, opening the current mate's native chat. |
| Interrupt/cancel | Native composer exposes interrupt and shortcuts through its internal client. | `PaseoAgentHandle` exposes send/run/archive/detach but no stop/interrupt. Existing crew-interrupt RPC explicitly requires crew and must not be reused for the mate. | **needs-decision N5**. Full conversation provides the current supported route. No archive-as-interrupt or hidden behavior-changing send was substituted. |
| Edit/resend/rewind | Native message menu offers capability-gated conversation/files/both rewind. | Plugin has no native rewind API or editable past-message UI. | Copy message now supports deliberate reuse in the shared draft. Actual rewind/file rollback is **N5**, not simulated by appending a replacement message. |
| Mid-turn sends and queue | Native has a queue with edit/send-now, configurable steer/interrupt behavior and alternate send action. | Plugin always sends using existing `steer` behavior. Per-mate send gate covers delivery, not the agent's whole turn. | Behavior preserved. A local queue is possible but requires ownership/reload/cancellation decisions and could conflict with first-mate steering: **N6**. No claim that steer guarantees noninterruption for every provider. |
| Mentions and contextual attachments | Native has file suggestion/context attachment machinery in its composer. | Plugin is a plain TextInput; typed paths remain words. It has no native composer instance to embed. | **needs-decision N3/N6** for a public picker/composer integration or a deliberately smaller plugin-only mention feature. |
| Copy/select | Native messages/turns have copy controls and specialized selection handling. | Plugin had selectable paragraphs/code but no one-action whole-message/code copy. | **Fixed:** captain and mate messages copy the exact visible row source, code copies without fences. Empty image-only placeholder rows do not get an empty copy button. Uses host `copyText`, including error reporting. Rich selection-to-Markdown remains native. |
| Keyboard shortcuts | Native configurable submit/alternate-send/interrupt shortcuts; web-wide Enter sends, compact Enter does not. | Plugin had web-wide Enter, Shift+Enter and composition guards; compact input uses a send button. | Kept and fixture-checked. New copy/image/history actions are accessible buttons; modal close/focus follows the host. Configurable native shortcut access is **N6**. |
| Mobile and keyboard | Native composer has native pickers, safe-area/keyboard integration and native image UI. | Plugin has safe-area padding, measured keyboard overlap and compact controls; attachments work in phone browsers only. | Same behavior reused in both chats. Viewer and controls checked at 390×844, light/dark. Native keyboard/gesture verification still requires a device; no claim of pinch-to-zoom (viewer has zoom buttons). |
| Scroll/jump/read state | Native tail anchoring, history loading, viewed-timeline ownership, outline/find navigation. | Plugin follows while at the end, offers Scroll to the latest, reveals pending requests and marks visible mate chat seen. Each open copy has its own scroll. | Preserved plus prepend anchoring. Pagination/live-update/reset fixture checks pass. Native outline/search is a separate plugin-possible UI feature under **N4**, not part of the filter. |
| Draft/reconnect/failure | Native has draft and local submission state. | Plugin global stores survive surface/bundle remount but not full app restart. Stage 1 shares draft, attachment and send state between copies and restores failed sends. | Preserved and covered. This slice persists only **sent-image previews**, not unsent words/files. Durable draft storage across all platforms is **N1/N6**. |
| Model/mode, voice and native extensions | Native composer exposes model/mode controls, dictation and host-contributed controls. | Plugin offers its own Bearings/Ahoy, context meter, Compact/Restart; no native composer embedding. | Full conversation provides these tools. Embedding or capability exports need upstream API design (**N1/N6**); private host stores/IPC are not used. |

## Decisions left above this slice

- **N1 — Native attachment/persistence capabilities.** Options: keep phone-browser/native-chat access;
  request public picker, attachment-cache and draft-store APIs; or fork the app. Recommendation: request
  public APIs and retain the existing fallback. A fork is out of scope and was not started.
- **N2 — Canonical attachment history.** Options: upstream timeline attachment references with an
  authenticated byte-fetch API; plugin-owned server media storage/retention; or accept local-only
  previews. Recommendation: upstream canonical references. The plugin-server option needs an explicit
  storage/retention and migration decision and exceeds this task's server-behavior boundary.
- **N3 — Files and context.** Options: upstream public workspace-file reads/context attachment picker;
  narrowly scoped plugin RPCs; or native file/chat navigation. Recommendation: public APIs, native
  navigation meanwhile. Do not expose arbitrary daemon paths as browser URLs.
- **N4 — Rich rendering and large-history navigation.** Options: keep the small renderer; implement
  individual features; or expose/reuse the native renderer through a supported SDK. Recommendation:
  supported native rendering when available, with targeted plugin additions meanwhile. Selecting a
  Markdown/Mermaid dependency, search UI or virtualization strategy is larger than a safe parity patch.
- **N5 — Turn control and rewind.** Options: public `stop`/capability-gated rewind APIs; authorize new
  mate-specific plugin RPCs; or use Full conversation. Recommendation: public APIs, native action
  fallback now. Never send crew-only actions to the mate or equate archive with interrupt.
- **N6 — Composer semantics.** Options: preserve direct steering and lightweight shared draft;
  design a plugin-owned durable queue/mentions/settings; or expose the native composer as a supported
  component. Recommendation: preserve steering here and request composer integration. Queue semantics,
  cancellation after reload, provider modes and native settings require an explicit product decision.

## Implementation and evidence

`client/chat-image.tsx` supplies the shared thumbnail/viewer. `markdown-image.ts` only admits complete
whole-line image destinations the client can render. `chatTools` opts the conversation into images
and code copy without changing other Markdown consumers. `message-copy.tsx` uses the host clipboard.

`client/image-cache.ts` validates local records and hydrates the existing image store. The browser
adapter in `client/web.ts` uses a plugin-specific IndexedDB database; each write merges one message in
a transaction before pruning to **50 messages / 128 MiB of base64**. Other browser tabs do not overwrite
the whole database. This is a best-effort local cache, evicted oldest first, clearable with site data;
it is not a server backup. Failed sends remove their cached image. Live changes win over delayed
hydration, and store notifications survive bundle reevaluation. Data is not sent anywhere by the cache.

`client/use-timeline.ts` serializes history and tail reads through the existing subscription.
`timeline-history.ts` merges projected rows without duplicating overlapping boundaries, discards
stale epochs/gaps, and retains only valid older prefixes. `follow-end.ts` offsets the viewport by the
prepended height and keeps the existing latest/permission behavior.

Run `npm ci`, `npm ci --prefix docs/board-list`, then:

```powershell
$env:CHAT_PARITY='1'
node docs/chat-tabs/render.mjs
npm.cmd test -- --maxWorkers=1
npm.cmd run typecheck
npm.cmd run lint:deck-packs
node docs/shell-phase1/check-bundle.mjs
```

The browser test uses a text-only timeline with persisted fixture history, then performs a **full
page reload** to prove image restoration from IndexedDB rather than from `globalThis`. It checks
zoom/fit/close, sent and assistant images, message/code copy, native navigation, phone viewer fit,
330-entry pagination, failure/retry, viewport anchoring, hidden-only history pages, continued
streaming and epoch replacement. It also runs all
stage-1 checks, including two open chats, shared attachments, gate behavior and launch state.
Selected screenshots are generated under ignored `.generated/` and visually reviewed. Unit tests
cover invalid/cache bounds, delayed hydration vs new/failed sends, pre-cache memory previews,
reload observers, storage failure,
image-source policy, projected-history overlap, gaps and epoch replacement.

The remote helper test's earlier 10-to-14 call failure was traced on clean main `e7abadd`, with all
parity work stashed. No client code is imported by that test. `RemoteService.request()` resets
`pollAt`; the next one-second service tick issues `project ls`, `workspace ls`, `provider ls` and
the labelled crew `ls`. A temporary 1.1-second diagnostic delay reproduced exactly those calls and
was removed. The helper-only test now stubs its unrelated collector, keeping the real queue pump
and the unchanged assertion that refused commands send nothing. Existing collector tests retain
real polling. No expectation increased or production behavior changed. Chat uses the shared
`FLEET_QUERY_KEY`; remote snapshot queries share their key, and their server handlers only read the
cached snapshot, never start a remote collection. The test-isolation commit is also in the independent
[inline Deck PR](https://github.com/LiterallyBlah/firstmate/pull/77), so either PR can land first.

The full suite passes: **93 files, 1,086 tests passed, three skipped** with one worker.
Self-review covered every changed file, hydration and failure ordering, byte/count limits, shared
store subscriptions, projected history boundaries, preserved filtering, scroll anchoring and API
boundaries. Typecheck, 36 pack-lint checks, changed-code Prettier and whitespace checks pass. The
Paseo 0.11 compiler produces a 684,385-byte client with zero `class` tokens; RN 0.81 Hermes parses it
with default flags. No scene, pack, canvas or snapshot inputs changed.

## Native source references

- [Message images, copy, lightbox and rewind](https://github.com/getpaseo/paseo/blob/22488d4502cd0c8a4ee4619af991762f071b60a7/packages/app/src/components/message.tsx),
  [rewind choices](https://github.com/getpaseo/paseo/blob/22488d4502cd0c8a4ee4619af991762f071b60a7/packages/app/src/components/rewind/rewind-menu.tsx).
- [Composer queue, submission, attachment persistence and controls](https://github.com/getpaseo/paseo/blob/22488d4502cd0c8a4ee4619af991762f071b60a7/packages/app/src/composer/index.tsx),
  [keyboard/paste input](https://github.com/getpaseo/paseo/blob/22488d4502cd0c8a4ee4619af991762f071b60a7/packages/app/src/composer/input/input.tsx),
  [attachment submission](https://github.com/getpaseo/paseo/blob/22488d4502cd0c8a4ee4619af991762f071b60a7/packages/app/src/composer/attachments/submit.ts).
- [Native picker](https://github.com/getpaseo/paseo/blob/22488d4502cd0c8a4ee4619af991762f071b60a7/packages/app/src/hooks/image-attachment-picker.native.ts),
  [platform attachment stores](https://github.com/getpaseo/paseo/blob/22488d4502cd0c8a4ee4619af991762f071b60a7/packages/app/src/attachments/store.ts),
  [attachment persistence service](https://github.com/getpaseo/paseo/blob/22488d4502cd0c8a4ee4619af991762f071b60a7/packages/app/src/attachments/service.ts).
- [User-message metadata](https://github.com/getpaseo/paseo/blob/22488d4502cd0c8a4ee4619af991762f071b60a7/packages/app/src/types/stream.ts),
  [local session store](https://github.com/getpaseo/paseo/blob/22488d4502cd0c8a4ee4619af991762f071b60a7/packages/app/src/stores/session-store.ts),
  [daemon submittedPromptText/recordSubmittedPrompt](https://github.com/getpaseo/paseo/blob/22488d4502cd0c8a4ee4619af991762f071b60a7/packages/server/src/server/agent/agent-manager.ts).
- [Markdown renderer](https://github.com/getpaseo/paseo/blob/22488d4502cd0c8a4ee4619af991762f071b60a7/packages/app/src/components/markdown/renderer.tsx),
  [assistant file-image acquisition](https://github.com/getpaseo/paseo/blob/22488d4502cd0c8a4ee4619af991762f071b60a7/packages/app/src/assistant-image/file-acquisition.ts),
  [timeline synchronization and pagination](https://github.com/getpaseo/paseo/blob/22488d4502cd0c8a4ee4619af991762f071b60a7/docs/timeline-sync.md),
  [native stream view](https://github.com/getpaseo/paseo/blob/22488d4502cd0c8a4ee4619af991762f071b60a7/packages/app/src/agent-stream/view.tsx).

Public API boundaries were checked against the installed
`@getpaseo/plugin/dist/client/{index,react-native}.d.ts`,
`@getpaseo/client/dist/index.d.ts` (`PaseoAgentHandle`, timeline and workspace handles) and
`@getpaseo/protocol/dist/agent-types.d.ts` (`AgentTimelineItem`). The earlier
[image-preview investigation](../image-preview/README.md) remains the historical record of the
initial in-memory preview fix; this audit supersedes its local-cache lifetime description.
