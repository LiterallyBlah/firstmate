/**
 * Talking to an agent without cutting it off, as far as its provider allows.
 *
 * `PaseoAgentHandle.send` interrupts a running turn by default. For the first
 * mate that is the wrong thing: it may be halfway through dispatching three
 * crewmates when the captain adds a fourth request. The daemon also accepts
 * `activeTurnBehavior: "steer"`: where the provider can take a message in the
 * middle of a turn, the message joins it; where it cannot, the daemon
 * replaces the running turn with one that starts from the message; and an
 * idle agent simply starts a turn. That is exactly how Paseo delivers its own
 * finish notifications to the agent that created a crewmate, so a first mate
 * is never worse off for a message from the board than for one from Paseo.
 */
import type { PaseoApi } from "./host-types";
import { receiptJournal, type SendHandle, type SendReceipt } from "./receipts";

type SendOptions = NonNullable<Parameters<ReturnType<PaseoApi["agents"]["ref"]>["send"]>[1]>;

/**
 * What can go with the words: the send's own `images` and `attachments`, as Paseo's composer fills them,
 * and a `messageId`, which the timeline keeps as the message's `clientMessageId`.
 */
export type SendExtras = Pick<SendOptions, "images" | "attachments" | "messageId">;

/**
 * `receipt` says what the send is for the receipt journal (`server/receipts.ts`). With the journal off it
 * changes nothing; on, a send without a `messageId` gets one, and the attempt and its result are recorded
 * beside it — after it has been handed to Paseo, never in its way.
 */
export async function sendWithoutInterrupting(
  paseo: PaseoApi,
  agentId: string,
  text: string,
  extras: SendExtras = {},
  receipt?: SendReceipt & { mateRecipient?: boolean },
): Promise<void> {
  await observedSend(paseo, agentId, text, { ...extras, activeTurnBehavior: "steer" }, receipt);
}

/** A plain `send`, observed. `options` undefined is passed on as no argument at all, as the caller wrote it. */
export async function observedSend(
  paseo: PaseoApi,
  agentId: string,
  text: string,
  options: SendOptions | undefined,
  receipt?: SendReceipt & { mateRecipient?: boolean },
): Promise<void> {
  const agent = paseo.agents.ref(agentId);
  let handle: SendHandle | null = null;
  try {
    const journal = receipt === undefined ? null : receiptJournal();
    handle = journal === null || receipt === undefined ? null : journal.beginSend({
      ...receipt, recipient: agentId, text,
      attachments: (options?.images?.length ?? 0) + (options?.attachments?.length ?? 0),
      ...(options?.messageId === undefined ? {} : { messageId: options.messageId }),
    });
  } catch (error) {
    // A journal that cannot even open a receipt leaves the send exactly as it would be with the switch off.
    console.error("[firstmate] receipt journal could not open a send's receipt:", error);
  }
  if (handle === null) {
    if (options === undefined) await agent.send(text);
    else await agent.send(text, options);
    return;
  }
  try {
    await agent.send(text, { ...options, messageId: handle.messageId });
  } catch (error) {
    handle.settle("failed", error);
    throw error;
  }
  handle.settle("sent");
}
