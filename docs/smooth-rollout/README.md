# Smooth rollout, slice 1

[Acceptance and evidence mapping](PR1.md) · [Before/after screenshots](evidence.md)

The harness mounts actual Fleet, native chat, scoped discussion, decision and Deck
components through React Native Web. Only the Paseo host/RPC data is synthetic.
The before build reads pinned revision `d74a30c` with `git show`; the after build
uses the current files. It does not switch the checkout or access a live home.

Install root dependencies and `docs/board-list` dependencies, then run:

```powershell
& 'C:/Program Files/nodejs/node.exe' docs/smooth-rollout/render.mjs
```

Windows uses installed Edge; CI on other platforms uses Playwright Chromium.
Generated bundles, screenshots and call/assertion results stay in
`.local/smooth-rollout/`. CI publishes these as part of the existing render
artifact. The review copies under `evidence/` make every screenshot accessible
from the PR without requiring an artifact download.

Cases cover Home, Chat, fresh setup, Needs-you, named and unavailable contextual
discussions, pending fleet/decisions, confirmed failure, a 30-second delayed read,
UI-only enablement and pending Deck decisions in both themes at 1440×1000 and
390×844. Long-history interactions check enablement, old selection, drafts,
attachments, older pages, tool disclosure, scroll, return focus and no mutations.
An explicit pending retry coalesces with the original fleet read.

Passing case names as arguments reruns just those captures and retains other
results (for example `render.mjs scope-unavailable`). A full run always rebuilds
the complete matrix and the interaction checks.

The S05 harness now opens its scoped adapter explicitly and gives its restored
case an exact route. It continues to check the same sender, identity, uncertain
delivery, refusal and answer-transport boundaries. General continuity is checked
by this harness rather than relying on enabling scope UI to replace Home.
