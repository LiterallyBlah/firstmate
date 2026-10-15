# Images sent to the first mate preview in the chat

The captain reported "images don't preview". The surface is the **first mate's chat**: an image
attached with the paperclip, pasted or dropped shows as a thumbnail in the composer, goes to the first
mate (it reads it), and then the transcript shows the message's words alone — or `(attachments)` for an
image sent with no words. The captain had sent screenshots that way ("I believe the angle of this trail
needs to be higher", with a picture of the deck's wake) just before reporting it.

## Trigger and cause

- **Trigger:** sending a message with an image. The composer's chip previews it (`AttachmentChip`, a
  `data:` URI in an `Image`), which is the path that works.
- **Cause:** the chat draws only what the daemon's timeline gives back, and the daemon never gives an
  image back. Paseo 0.11's `recordSubmittedPrompt` stores a sent message as
  `{ type: "user_message", text: submittedPromptText(prompt), clientMessageId }`, and
  `submittedPromptText` keeps text blocks only; the protocol's `user_message` item has no field for
  images. Paseo's own app shows a sent image because it keeps it on its local copy of the message
  (`createUserMessage({ …, images })` in the app bundle) and draws `UserMessage` with those. The
  plugin's chat kept no copy, so a sent image was gone the moment the composer cleared.
- **Not a regression.** The chat has worked this way since attachments arrived; Converse did not touch
  it. Converse's composer and Watch have no attachments, and a worker's or the first mate's messages carry
  no images in the timeline either, so the first mate's chat is the only surface affected.

## The fix

The chat keeps its own copy, the way Paseo's app does. A message carrying images gets a
`firstmate-captain-` message id (`client/sent-images.ts`), its images are kept under it on
`globalThis`, `firstmate.mate.ask` passes the id to the send, the daemon records it as the timeline
item's `clientMessageId`, and the chat draws the images in that captain's row, sized to their shape.
Like Paseo, the copy is local: it survives the chat unmounting and the bundle being evaluated afresh,
but not an app restart, and another device shows the words alone. The 50 newest messages' images
(128 MB of base64 at most) are kept.

## Reproduction and validation

```sh
npm ci
npm ci --prefix docs/board-list
node docs/image-preview/render.mjs
```

The harness bundles the real `MateChat` through React Native Web with only host APIs stubbed (the
`docs/board-list` tools), and never connects to a daemon. Its stub timeline records a sent message as
the daemon does: words only, under the send's `messageId`. The **before** bundle swaps every client and
shared file this branch changes for `origin/main`'s copy. Each run attaches a 320×200 PNG through the
chat's own file picker (headless Edge on Windows, Chromium elsewhere), checks the composer's thumbnail
loads, sends it with words, and then:

- **before:** the image reached the first mate (`images` in the ask), no message id went with it, and
  no image is drawn in the transcript;
- **after:** the message id is `firstmate-captain-…`, one loaded 320-pixel image labelled "Image you
  sent" sits under the words inside the pane, it is still there after a remount, and an image sent with
  no words shows the image instead of `(attachments)`.

Wide (980×720) and phone (390×844), dark and light: eight replays.

| Evidence | Screenshot |
| --- | --- |
| Before: the sent message, words only | [Desktop, dark](before-wide-dark.png) |
| After: the image under the words | [Desktop, dark](after-wide-dark.png) |
| After: phone | [Phone, light](after-phone-light.png) |
| After: an image sent with no words | [Desktop, dark](after-wide-dark-images-only.png) |

The regression tests are `client/sent-images.test.ts` (a sent image is found again from the daemon's
words-only echo) and `server/mate.test.ts` (the id reaches the send); both fail on main's
`transcript-rows.ts` and `server/mate.ts`. Native rendering on a device was not checked; the attach
button is web-only there anyway.
