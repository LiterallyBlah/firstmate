/** Plain item tags, independent of crew labels and workflow columns. */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import type { FleetCard } from "./fleet";

export const MAX_ITEM_TAGS = 12;
export const MAX_TAG_LENGTH = 40;
export const tagName = (text: string): string =>
  text.trim().replace(/\s+/g, " ");
export const tagIdentity = (text: string): string =>
  tagName(text).toLowerCase();

export const ItemTagSchema = z
  .string()
  .refine((text) => !/[\r\n\x00-\x1f]/.test(text), "Use a single-line tag.")
  .transform(tagName)
  .pipe(
    z
      .string()
      .min(1)
      .max(MAX_TAG_LENGTH)
      .refine(
        (text) => !/[(),\r\n\x00-\x1f]/.test(text),
        "Use a plain tag without commas or parentheses.",
      ),
  );

/** Agent-written metadata stays lenient; duplicate spellings denote one tag. */
export function plainTags(values: readonly string[]): string[] {
  const result = new Map<string, string>();
  for (const value of values) {
    const parsed = ItemTagSchema.safeParse(value);
    if (parsed.success && !result.has(tagIdentity(parsed.data)))
      result.set(tagIdentity(parsed.data), parsed.data);
  }
  return [...result.values()].slice(0, MAX_ITEM_TAGS);
}

/** Section, file position, title and current worker are deliberately absent from task identity. */
export function itemTagKey(card: FleetCard): string {
  const host =
    card.remote === undefined
      ? ["local"]
      : ["remote", card.remote.serverId ?? tagIdentity(card.remote.host)];
  const task = card.backlog?.id ?? card.taskId;
  return JSON.stringify(
    task === null
      ? ["worker", host, card.agent?.id ?? card.remote?.worker?.id ?? card.key]
      : [
          "task",
          host,
          (card.backlog === null ? card.project : card.backlog.project) ?? "",
          task,
        ],
  );
}

export function cardTags(card: FleetCard): string[] {
  return card.tags ?? card.backlog?.tags ?? [];
}

export function matchesTags(
  card: FleetCard,
  selected: readonly string[],
): boolean {
  const present = new Set(cardTags(card).map(tagIdentity));
  return selected.every((tag) => present.has(tagIdentity(tag)));
}

/** Choices count the host's visible work, before tag matching; saved selections are kept by tagChoices. */
export function tagScopeCards(cards: readonly FleetCard[], showDone: boolean): FleetCard[] {
  return cards.filter((card) => showDone || card.column !== "done");
}

export function tagChoices(
  cards: readonly FleetCard[],
  selected: readonly string[] = [],
): Array<{ tag: string; count: number }> {
  const choices = new Map<string, { tag: string; count: number }>();
  for (const tag of selected) choices.set(tagIdentity(tag), { tag, count: 0 });
  for (const card of cards) {
    for (const tag of plainTags(cardTags(card))) {
      const key = tagIdentity(tag);
      const choice = choices.get(key) ?? { tag, count: 0 };
      choice.count++;
      choices.set(key, choice);
    }
  }
  return [...choices.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}

/** One add/remove operation; stale clients never replace another client's whole tag set. */
export const editItemTag = defineRpc({
  name: "firstmate.item.tag",
  input: z.object({
    key: z.string().min(1).max(2048),
    tag: ItemTagSchema,
    present: z.boolean(),
  }),
  output: z.object({ key: z.string(), tags: z.array(z.string()) }),
});
