/**
 * The images the captain has sent the first mate, kept by the chat so its
 * transcript can show them. The daemon records only a message's words in the
 * timeline (`submittedPromptText` in Paseo's agent manager drops every image
 * block), so a sent screenshot never comes back from it; Paseo's own app shows
 * one because it keeps the images on its local copy of the message. This is
 * the plugin's local copy: each message with images is sent with a
 * `firstmate-captain-` id, the daemon records that id as the timeline item's
 * `clientMessageId`, and the chat finds the images again by it.
 *
 * Kept on `globalThis`, like `./draft` and `./attachments`, so they survive
 * the surface unmounting and the bundle being evaluated afresh. The web chat
 * also caches these locally in IndexedDB (`image-cache`); never shared between devices.
 * The oldest are dropped past a
 * count and a size, and that message then shows its words alone, as before.
 * Pure apart from that one slot.
 */
import { CAPTAIN_MESSAGE_ID_PREFIX, type CaptainMessage, type ImagePart } from "../shared/attachments";

/** How many messages' images are kept, and how much base64 among them, before the oldest go. */
export const MAX_KEPT_MESSAGES = 50;
export const MAX_KEPT_CHARS = 128 * 1024 * 1024;

export interface SentImageStore {
  /** The images sent with the message, or none for a message this store does not know. */
  get(messageId: string | undefined): readonly ImagePart[];
  set(messageId: string, images: readonly ImagePart[]): void;
  forget(messageId: string): void;
  entries(): [string, readonly ImagePart[]][];
  /** Bumped by every change, for `useSyncExternalStore`. */
  version(): number;
  subscribe(listener: (messageId: string) => void): () => void;
}

const NONE: readonly ImagePart[] = [];

/** A registered symbol, so each evaluation of the bundle names the same slot. */
const SLOT = Symbol.for("paseo.firstmate.sent-images");
const EVENTS = Symbol.for("paseo.firstmate.sent-images.events");

/** The images kept on `root`; every store built on the same root shares them. */
export function createSentImageStore(
  root: object,
  limits: { messages: number; chars: number } = { messages: MAX_KEPT_MESSAGES, chars: MAX_KEPT_CHARS },
): SentImageStore {
  let kept = Reflect.get(root, SLOT) as Map<string, readonly ImagePart[]> | undefined;
  if (!(kept instanceof Map)) {
    kept = new Map<string, readonly ImagePart[]>();
    Reflect.set(root, SLOT, kept);
  }
  const store = kept;
  type Events = { revision: number; listeners: Set<(messageId: string) => void> };
  let events = Reflect.get(root, EVENTS) as Events | undefined;
  if (events === undefined) {
    events = { revision: 0, listeners: new Set() };
    Reflect.set(root, EVENTS, events);
  }
  const shared = events;
  function changed(messageId: string): void {
    shared.revision += 1;
    shared.listeners.forEach((listener) => listener(messageId));
  }
  function size(): number {
    let total = 0;
    store.forEach((images) => images.forEach((image) => (total += image.data.length)));
    return total;
  }
  return {
    get: (messageId) => (messageId === undefined ? NONE : (store.get(messageId) ?? NONE)),
    set: (messageId, images) => {
      store.delete(messageId);
      if (images.length > 0) store.set(messageId, images);
      // Oldest first, as a Map iterates; the newest message is always kept.
      for (const oldest of store.keys()) {
        if (store.size <= 1 || (store.size <= limits.messages && size() <= limits.chars)) break;
        store.delete(oldest);
        changed(oldest);
      }
      changed(messageId);
    },
    forget: (messageId) => {
      if (store.delete(messageId)) changed(messageId);
    },
    version: () => shared.revision,
    entries: () => [...store.entries()],
    subscribe: (listener) => {
      shared.listeners.add(listener);
      return () => shared.listeners.delete(listener);
    },
  };
}

export const sentImages = createSentImageStore(globalThis);

let nextId = 0;

/** A new id for a captain's message, within what `CaptainMessageSchema` accepts. */
export function captainMessageId(): string {
  nextId += 1;
  return `${CAPTAIN_MESSAGE_ID_PREFIX}${Date.now().toString(36)}-${nextId.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The message as it goes out: one with images gets an id, and its images are
 * kept under it, so the transcript can show them as soon as the daemon echoes
 * the message. A message without images goes as it is.
 */
export function keepSentImages(message: CaptainMessage, store: SentImageStore = sentImages): CaptainMessage {
  const images = message.images ?? [];
  if (images.length === 0) return message;
  const messageId = message.messageId ?? captainMessageId();
  store.set(messageId, images);
  return { ...message, messageId };
}
