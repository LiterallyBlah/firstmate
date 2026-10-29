/** Captain-owned deltas live beside, never rewrite, the agent-owned backlog. */
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { FleetCard } from "../shared/fleet";
import {
  ItemTagSchema,
  itemTagKey,
  MAX_ITEM_TAGS,
  plainTags,
  tagIdentity,
} from "../shared/item-tags";
import {
  FileChangedError,
  replaceTextIfUnchanged,
  resolveInHome,
  writeTextFile,
  type WriteHooks,
} from "./files";
import { serialized } from "./serialize";

export const ITEM_TAGS_FILE = "data/item-tags.json";
const StoreSchema = z.object({
  version: z.literal(1),
  items: z.record(
    z.string(),
    z.object({
      add: z.array(z.string()),
      remove: z.array(z.string()),
    }),
  ),
});
export type ItemTagStore = z.infer<typeof StoreSchema>;
const emptyStore = (): ItemTagStore => ({ version: 1, items: {} });

async function readStore(
  home: string,
): Promise<{ text: string | null; store: ItemTagStore }> {
  const { absolute } = await resolveInHome(home, ITEM_TAGS_FILE);
  try {
    const text = await readFile(absolute, "utf8");
    const parsed = StoreSchema.safeParse(JSON.parse(text));
    if (!parsed.success)
      throw new Error(
        "Item tags could not be read; repair data/item-tags.json before editing tags.",
      );
    return { text, store: parsed.data };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { text: null, store: emptyStore() };
    throw error;
  }
}

export async function readItemTags(home: string): Promise<ItemTagStore> {
  return (await readStore(home)).store;
}

/** Resolve a stale client's identity from current cards; never guess between duplicate backlog rows. */
export function findTagItem(
  cards: readonly FleetCard[],
  key: string,
): FleetCard {
  const matches = cards.filter((card) => itemTagKey(card) === key);
  const items = matches.filter((card) => card.backlog !== null);
  // A completed line and a still-live worker can denote the same task; the backlog is authoritative.
  if (
    matches.length === 0 ||
    items.length > 1 ||
    (items.length === 0 && matches.length > 1)
  ) {
    throw new Error(
      "This item changed or its identity is ambiguous. Refresh before editing tags.",
    );
  }
  return items[0] ?? matches[0]!;
}

export function withItemTags(
  cards: readonly FleetCard[],
  store: ItemTagStore,
): FleetCard[] {
  return cards.map((card) => {
    const delta = store.items[itemTagKey(card)];
    const removed = new Set(delta?.remove.map(tagIdentity));
    const tags = plainTags(
      [...(delta?.add ?? []), ...(card.backlog?.tags ?? [])].filter(
        (tag) => !removed.has(tagIdentity(tag)),
      ),
    );
    return { ...card, tags };
  });
}

/** Confined, serialized and content-checked using the existing home-file save path. */
export async function changeItemTag(
  home: string,
  card: FleetCard,
  tag: string,
  present: boolean,
  hooks: WriteHooks = {},
): Promise<{ key: string; tags: string[] }> {
  tag = ItemTagSchema.parse(tag);
  const { absolute } = await resolveInHome(home, ITEM_TAGS_FILE);
  const key = itemTagKey(card);
  return serialized(`${absolute}:item-tags`, async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { text, store } = await readStore(home);
      const delta = store.items[key] ?? { add: [], remove: [] };
      const current = withItemTags([card], store)[0]!.tags!;
      const id = tagIdentity(tag);
      if (
        present &&
        !current.some((value) => tagIdentity(value) === id) &&
        current.length >= MAX_ITEM_TAGS
      ) {
        throw new Error(
          `An item can have at most ${MAX_ITEM_TAGS} tags. Remove one before adding another.`,
        );
      }
      const add = delta.add.filter((value) => tagIdentity(value) !== id);
      const remove = delta.remove.filter((value) => tagIdentity(value) !== id);
      (present ? add : remove).push(tag);
      store.items[key] = { add, remove };
      const content = `${JSON.stringify(store, null, 2)}\n`;
      try {
        if (text === null)
          await writeTextFile(
            home,
            {
              path: ITEM_TAGS_FILE,
              content,
              expectedHash: null,
              force: false,
            },
            hooks,
          );
        else
          await replaceTextIfUnchanged(
            home,
            ITEM_TAGS_FILE,
            text,
            content,
            hooks,
          );
        return { key, tags: withItemTags([card], store)[0]!.tags! };
      } catch (error) {
        if (!(error instanceof FileChangedError) || attempt === 2) throw error;
      }
    }
    throw new Error("Item tags changed repeatedly. Refresh and try again.");
  });
}
