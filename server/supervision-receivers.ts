/** S11 receiver adapter seams for the proposed upstream primitives U1–U3 (implementation-plan "Receiver contract
 * sketches"). These are the shapes a future adapter must return, validated on the way in. None is implemented:
 * U1–U3 are not delivered, so `bindStrongReceivers` refuses any receiver whose capability is not enabled, and no
 * private protocol message stands in for one. Unwired; nothing here writes the journal.
 */
import { z } from "zod";
import { SupervisionHash, SupervisionUuid } from "../shared/supervision";
import { requireStrong, type CapabilityReport, type StrongCapability } from "./supervision-capabilities";
import { SupervisionError } from "./supervision-store";

const text = (max = 1024) => z.string().min(1).max(max);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** U1. The receiver identifies the caller itself; `caller` here is only what it reported back. */
export const AdmissionRequestSchema = z.object({
  scopeId: SupervisionUuid, epoch: count.min(1), effectKey: text(), requestHash: SupervisionHash, targetId: text(),
  expectedTargetVersion: text().nullable(), policyEvidenceDigest: SupervisionHash,
}).strict();
export const AdmissionReceiptSchema = z.object({
  effectId: text(), effectKey: text(), state: z.enum(["admitted", "rejected", "uncertain", "succeeded", "failed", "not-admitted"]),
  receiptVersion: count.min(1), caller: text(),
  /** Why a rejection happened, as the receiver states it: a stale fence is `stale-fence`. */
  reason: z.enum(["stale-fence", "unauthenticated", "precondition", "other"]).nullable(),
}).strict();
export type AdmissionReceipt = z.infer<typeof AdmissionReceiptSchema>;
export interface EffectAdmissionReceiver {
  admitEffect(request: z.infer<typeof AdmissionRequestSchema>): Promise<unknown>;
  getEffect(effectKey: string): Promise<unknown>;
}

/** U2. Transfer is atomic on the receiver: new owner, version and replay cursor together. */
export const SubscriptionSchema = z.object({ id: text(), owner: text(), version: count.min(1), cursor: text().nullable(),
  kind: z.enum(["finish-notification", "heartbeat"]) }).strict();
export interface SubscriptionReceiver {
  list(owner: string): Promise<unknown>;
  transfer(input: { id: string; expectedOwner: string; newOwner: string; expectedVersion: number; replayAfter: string | null }): Promise<unknown>;
  cancel(input: { id: string; expectedOwner: string; expectedVersion: number }): Promise<unknown>;
}

/** U3. The inventory version must include unloaded persisted descendants; a list-then-archive is not this. */
export const ConditionalArchiveReceiptSchema = z.object({ agentId: text(), state: z.enum(["archived", "stale"]),
  inventoryVersion: text(), receipt: text().nullable() }).strict();
export interface ConditionalArchiveReceiver {
  archiveIfUnchanged(input: { agentId: string; expectedInventoryVersion: string; expectedDescendants: string[]; retainWorkspaces: true }): Promise<unknown>;
}

export interface StrongReceivers {
  admission?: EffectAdmissionReceiver;
  subscriptions?: SubscriptionReceiver;
  archive?: ConditionalArchiveReceiver;
}
const NEEDS: Record<keyof StrongReceivers, StrongCapability[]> = {
  admission: ["authenticated-caller", "receiver-fence"],
  subscriptions: ["durable-subscriptions", "heartbeat-transfer"],
  archive: ["conditional-archive"],
};

/** Bind supplied receivers only where every capability they serve is enabled. A receiver offered for a refused
 * capability is refused outright rather than ignored, so a caller can never believe it is in use. */
export function bindStrongReceivers(report: CapabilityReport, supplied: StrongReceivers): StrongReceivers {
  const bound: StrongReceivers = {};
  for (const key of Object.keys(supplied) as (keyof StrongReceivers)[]) {
    if (!supplied[key]) continue;
    for (const id of NEEDS[key]) requireStrong(report, id);
    Object.assign(bound, { [key]: supplied[key] });
  }
  return bound;
}

/** Read a U1 receipt. A malformed answer, or one for another effect, is uncertain: never admitted, never retried. */
export function readAdmission(effectKey: string, raw: unknown): AdmissionReceipt | { state: "uncertain"; reason: string } {
  const parsed = AdmissionReceiptSchema.safeParse(raw);
  if (!parsed.success) return { state: "uncertain", reason: "The receiver's answer is outside the U1 contract." };
  if (parsed.data.effectKey !== effectKey) return { state: "uncertain", reason: "The receiver answered for another effect." };
  return parsed.data;
}
/** A stale fence is final: the old holder's delayed request never becomes admitted. */
export function refuseStaleAdmission(receipt: AdmissionReceipt): void {
  if (receipt.state === "rejected") throw new SupervisionError(receipt.reason === "stale-fence" ? "STALE" : "HELD",
    `The receiver rejected effect ${receipt.effectKey} (${receipt.reason ?? "no reason"}).`);
}
