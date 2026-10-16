import { MAX_ATTACHMENTS, rasterImageType, type ImagePart } from "../shared/attachments";
import { MAX_KEPT_CHARS, MAX_KEPT_MESSAGES, type SentImageStore } from "./sent-images";

export type CachedImages = { id: string; images: readonly ImagePart[]; savedAt: number };
export interface ImageCache {
  read(): Promise<unknown[]>;
  write(id: string, images: readonly ImagePart[]): Promise<void>;
}

/** Local storage is untrusted and may belong to an older plugin revision. */
export function cachedImages(value: unknown): CachedImages | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, images, savedAt } = value as Partial<CachedImages>;
  if (
    typeof id !== "string" ||
    !/^firstmate-captain-[A-Za-z0-9-]{1,80}$/.test(id) ||
    typeof savedAt !== "number" ||
    !Number.isFinite(savedAt) ||
    !Array.isArray(images) ||
    images.length === 0 ||
    images.length > MAX_ATTACHMENTS
  )
    return null;
  let chars = 0;
  for (const image of images) {
    if (
      typeof image !== "object" ||
      image === null ||
      typeof image.data !== "string" ||
      typeof image.mimeType !== "string" ||
      rasterImageType(image.mimeType, "") === null ||
      image.data.length === 0
    )
      return null;
    chars += image.data.length;
    if (chars > MAX_KEPT_CHARS) return null;
  }
  return { id, images, savedAt };
}

/** Oldest first; both memory and disk obey the same message and byte bounds. */
export function retainedImages(values: readonly unknown[]): CachedImages[] {
  const rows = values
    .map(cachedImages)
    .filter((row): row is CachedImages => row !== null)
    .sort((a, b) => a.savedAt - b.savedAt);
  let chars = rows.reduce((sum, row) => sum + row.images.reduce((n, image) => n + image.data.length, 0), 0);
  while (rows.length > 1 && (rows.length > MAX_KEPT_MESSAGES || chars > MAX_KEPT_CHARS)) {
    chars -= rows.shift()!.images.reduce((sum, image) => sum + image.data.length, 0);
  }
  return rows;
}

/** A failed cache never blocks sending. Changes made during hydration win over older disk data. */
export function connectImageCache(store: SentImageStore, cache: ImageCache, warn: (error: unknown) => void) {
  const changed = new Set<string>();
  let restoring = false;
  let hydrated = false;
  let tail: Promise<void> = Promise.resolve();
  const stop = store.subscribe((id) => {
    if (restoring) return;
    if (!hydrated) changed.add(id);
    const images = store.get(id);
    tail = tail.then(() => cache.write(id, images)).catch(warn);
  });
  const ready = cache
    .read()
    .then((values) => {
      const live = store.entries();
      restoring = true;
      try {
        for (const row of retainedImages(values)) {
          if (!changed.has(row.id) && store.get(row.id).length === 0) store.set(row.id, row.images);
        }
        // Preserve the newer memory entries if loading older rows crossed the retention bound.
        for (const [id, images] of live) store.set(id, images);
      } finally {
        restoring = false;
      }
      // A bundle upgrade can start caching with previews already in memory.
      // Changes observed since subscribing already have their own queued write.
      for (const [id, images] of live) {
        if (!changed.has(id)) tail = tail.then(() => cache.write(id, images)).catch(warn);
      }
    })
    .catch(warn)
    .finally(() => {
      hydrated = true;
      changed.clear();
    });
  return { ready, stop, flushed: () => tail };
}
