import { expect, it, vi } from "vitest";
import { cachedImages, connectImageCache, retainedImages } from "./image-cache";
import { createSentImageStore, MAX_KEPT_CHARS } from "./sent-images";

const png = { data: "aGVsbG8=", mimeType: "image/png" };
const row = (n: number) => ({ id: `firstmate-captain-${n}`, images: [png], savedAt: n });

it("reads only known raster-image records and retains the newest 50", () => {
  expect(cachedImages(null)).toBeNull();
  expect(cachedImages({ ...row(1), id: "firstmate-watch-x" })).toBeNull();
  expect(cachedImages({ ...row(1), images: [{ data: "x", mimeType: "image/svg+xml" }] })).toBeNull();
  expect(cachedImages({ ...row(1), images: [null] })).toBeNull();
  expect(cachedImages({ ...row(1), savedAt: Infinity })).toBeNull();
  expect(retainedImages(Array.from({ length: 60 }, (_, i) => row(i))).map((r) => r.id)).toEqual(
    Array.from({ length: 50 }, (_, i) => row(i + 10).id),
  );
  const big = { ...row(100), images: [{ ...png, data: "a".repeat(MAX_KEPT_CHARS) }] };
  expect(retainedImages([row(1), big]).map((r) => r.id)).toEqual([big.id]);
});

it("hydrates a new app's store, then persists deletion after a failed send", async () => {
  const disk = new Map([[row(1).id, row(1)]]);
  const cache = {
    read: async () => [...disk.values()],
    write: vi.fn(async (id, images) => {
      if (images.length) disk.set(id, { id, images, savedAt: 2 });
      else disk.delete(id);
    }),
  };
  const store = createSentImageStore({});
  const connection = connectImageCache(store, cache, (e) => {
    throw e;
  });
  await connection.ready;
  expect(store.get(row(1).id)).toEqual([png]);
  expect(cache.write).not.toHaveBeenCalled();
  store.forget(row(1).id);
  await connection.flushed();
  expect(disk.size).toBe(0);
  connection.stop();
});

it("a failure or a new send during hydration wins, and a fresh bundle hears later hydration", async () => {
  let finish!: (value: unknown[]) => void;
  const root = {};
  const store = createSentImageStore(root, { messages: 2, chars: MAX_KEPT_CHARS });
  const other = createSentImageStore(root, { messages: 2, chars: MAX_KEPT_CHARS });
  const listener = vi.fn();
  other.subscribe(listener);
  const write = vi.fn(async () => {});
  const connection = connectImageCache(
    store,
    {
      read: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      write,
    },
    vi.fn(),
  );
  store.set(row(1).id, [png]);
  store.forget(row(1).id);
  store.set(row(99).id, [png]);
  finish([row(1), row(2), row(3)]);
  await connection.ready;
  await connection.flushed();
  expect(store.get(row(1).id)).toEqual([]);
  expect(store.get(row(99).id)).toEqual([png]);
  expect(other.get(row(3).id)).toEqual([png]);
  expect(listener).toHaveBeenCalled();
  expect(other.version()).toBe(store.version());
  expect(write.mock.calls.length).toBe(3);
  connection.stop();
});

it("unavailable storage does not stop live previews or propagate rejected writes", async () => {
  const store = createSentImageStore({});
  const warn = vi.fn();
  const connection = connectImageCache(
    store,
    {
      read: async () => {
        throw Error("private mode");
      },
      write: async () => {
        throw Error("quota");
      },
    },
    warn,
  );
  await connection.ready;
  store.set(row(1).id, [png]);
  await connection.flushed();
  expect(store.get(row(1).id)).toEqual([png]);
  expect(warn).toHaveBeenCalledTimes(2);
  connection.stop();
});

it("persists previews that were already in memory when the cache starts", async () => {
  const store = createSentImageStore({});
  store.set(row(1).id, [png]);
  const write = vi.fn(async () => {});
  const connection = connectImageCache(store, { read: async () => [], write }, vi.fn());
  await connection.ready;
  await connection.flushed();
  expect(write).toHaveBeenCalledWith(row(1).id, [png]);
  connection.stop();
});
