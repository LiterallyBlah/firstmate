# Queue layout review

Generated on 2026-10-30 with the real FirstMate chat surfaces and synthetic host APIs.
The before revision is e8a1c0810805b9e05c85cce20d275f52c14917d9.

| Surface | Before | After |
| --- | --- | --- |
| Main chat, dark desktop | ![Before](before-dark-desktop-home.png) | ![After](after-dark-desktop-home.png) |
| Project mate, light phone browser | ![Before](before-light-phone-project.png) | ![After](after-light-phone-project.png) |

Paseo source reference beside the real shared FirstMate queue:

![Light comparison](paseo-firstmate-light.png)
![Dark comparison](paseo-firstmate-dark.png)

The reference renders the upstream `QueuedMessageRow` and its queue styles from
Paseo revision 337e81a9c6d4551dbcede5930c21408776d06b1b in isolation, using the same
host palette. It is not a live agent session. FirstMate keeps its queue count,
positions and Remove action, and uses 44px action targets on compact layouts.

Regenerate all theme/width/surface checks with `node docs/chat-queue/render.mjs`.
Generate the source comparison with `node docs/chat-queue/reference.mjs /path/to/paseo`.
Both tools write only to ignored `.local/chat-queue/ui/`; these six selected review
images were copied here so PR screenshots remain viewable without a browser upload.
