/** S07's one ownership/cutover gate for every plugin-owned legacy delivery path.
 *
 * Every enqueue (plan notes, crew/burst notes, watch-runtime notes, watch batches) and every send
 * admission (note/watch flush, decision/discussion, inspection result and local/remote crew control)
 * passes this gate before it touches a queue or the network. Under the gate's lock a sender persists an in-flight claim, releases the lock, sends,
 * then records the claim's result before removing its queue entry. No network call holds the lock.
 *
 * Inert until a migration explicitly arms it (`.scoped/armed.json`): then it writes claims. A frozen
 * or committed cutover sidecar refuses the deliveries it owns by identity whether armed or not.
 * Cooperative and in-process: an incompatible older binary does not read this gate and must be
 * stopped before a cutover starts. That is a precondition, not a guarantee this code can give.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { CutoverSidecarSchema, MIGRATION_COMPATIBILITY, type CutoverSidecar } from "../shared/supervision-migration";
import { pluginDir } from "./data-dir";
import { serialized } from "./serialize";
import { canonical, digest, publish } from "./submissions";

/** The existing home-scoped legacy workflow store; `workflowStore` uses the same directory. */
export function legacyWorkflowRoot(home: string): string {
  return join(pluginDir(), "workflow-plans", digest(process.platform === "win32" ? resolve(home).toLowerCase() : resolve(home)));
}

const GateSourceSchema = z.enum(["plan-note", "mate-note", "burst", "watch-runtime", "watch", "decision", "crew-action", "inspection"]);
export type GateSource = z.infer<typeof GateSourceSchema>;
/** One legacy delivery as it stands, identified only by what the legacy record already holds. */
export interface GateItem {
  source: GateSource;
  /** Note id, submission id, or for a watch entry `<name>@<ran>#<kind>` (watch rows have no id). */
  id: string;
  payloadHash: string;
  plan?: string;
  actionId?: string;
  /** A burst key: the worker's agent id, or `remote:<server>:<agent>`. */
  agentKey?: string;
  task?: { taskId: string; host: string | null };
  /** Opaque text, only ever matched as a mention. Mentions never choose an owner. */
  text?: string;
}
const ClaimItemSchema = z.object({ source: GateSourceSchema, id: z.string(),
  payloadHash: z.string(), plan: z.string().optional(), actionId: z.string().optional(), agentKey: z.string().optional(),
  task: z.object({ taskId: z.string(), host: z.string().nullable() }).strict().optional(), mentions: z.array(z.string()),
  /** Inspection runs have no legacy queue inventory. Retain opaque evidence for a later freeze's mention check. */
  text: z.string().optional() }).strict();
export const ClaimSchema = z.object({ format: z.literal("firstmate.delivery-claim/1"), id: z.uuid(), at: z.string(), recipient: z.string(),
  items: z.array(ClaimItemSchema).min(1) }).strict();
export const ClaimResultSchema = z.object({ format: z.literal("firstmate.delivery-claim-result/1"), id: z.uuid(), at: z.string(),
  outcome: z.enum(["accepted", "uncertain", "failed"]), detail: z.string().max(2000) }).strict();
export type Claim = z.infer<typeof ClaimSchema>;
export type ClaimResult = z.infer<typeof ClaimResultSchema>;
export const ArmedSchema = z.object({ format: z.literal("firstmate.delivery-gate/1"), compatibility: z.literal(MIGRATION_COMPATIBILITY), at: z.string(),
  /** Queue entries present before claims existed: a send of one may have happened without a receipt. */
  preexisting: z.array(z.string()) }).strict();
export type Armed = z.infer<typeof ArmedSchema>;

/** Live in-process sends between claim and result. A claim absent here was left by a stopped process. */
const live = new Set<string>();
export const liveClaims = (): ReadonlySet<string> => live;

export const itemFingerprint = (item: Pick<GateItem, "source" | "id" | "payloadHash">) => digest({ source: item.source, id: item.id, payloadHash: item.payloadHash });
const normalHost = (host: string | null | undefined) => (host ?? "local").trim().toLowerCase() || "local";
function agentOf(key: string): string { const remote = /^remote:[^:]+:(.+)$/.exec(key); return remote ? remote[1]! : key; }

export interface CutoverTarget { plan: string; stage: CutoverSidecar["stage"]; sidecar: CutoverSidecar; drains: Set<string>; damaged: false }
/** A stage file that cannot be read. Tokens from any still-readable stage scope the block to this plan;
 * without them the block covers every delivery that cannot be proved unrelated. */
export interface DamagedTarget { plan: string; damaged: true; problem: string; tokens: CutoverSidecar["tokens"] | null; stage: CutoverSidecar["stage"] | null }

export class CutoverRefusal extends Error {
  constructor(readonly plan: string, readonly stage: string, message: string) { super(message); }
}

export class CutoverGate {
  readonly root: string;
  readonly directory: string;
  constructor(readonly home: string, root = legacyWorkflowRoot(home)) {
    this.root = resolve(root);
    this.directory = join(this.root, ".scoped");
  }
  /** The gate's in-process lock; never held across a network or model call. */
  run<T>(work: () => Promise<T>): Promise<T> { return serialized(`firstmate.supervision.cutover:${this.root}`, work); }
  async armed(): Promise<Armed | null> {
    try { return ArmedSchema.parse(JSON.parse(await readFile(join(this.directory, "armed.json"), "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
  async arm(preexisting: string[], at = new Date().toISOString()): Promise<Armed> {
    const existing = await this.armed();
    if (existing) return existing;
    const value: Armed = { format: "firstmate.delivery-gate/1", compatibility: MIGRATION_COMPATIBILITY, at, preexisting: [...new Set(preexisting)].sort() };
    await publish(join(this.directory, "armed.json"), value).catch(async (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(this.directory, { recursive: true });
      await publish(join(this.directory, "armed.json"), value);
    });
    return value;
  }
  /** Sidecar stages are exclusive files; the latest published stage is the plan's cutover state. */
  async sidecar(plan: string, stage: CutoverSidecar["stage"]): Promise<CutoverSidecar | null> {
    let text: string;
    try { text = await readFile(join(this.directory, plan, `${stage}.json`), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    const value = CutoverSidecarSchema.parse(JSON.parse(text)), { hash, ...body } = value;
    if (`${canonical(value)}\n` !== text || digest(body) !== hash || value.planId !== plan || value.stage !== stage) throw new Error(`Cutover sidecar ${plan}/${stage} is damaged.`);
    return value;
  }
  async publishSidecar(value: Omit<CutoverSidecar, "hash">): Promise<CutoverSidecar> {
    const sidecar = CutoverSidecarSchema.parse({ ...value, hash: digest(value) });
    await mkdir(join(this.directory, value.planId, "drain"), { recursive: true });
    try { await publish(join(this.directory, value.planId, `${value.stage}.json`), sidecar); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // An exclusive stage is never overwritten. Recovery accepts only the identical record.
      const saved = await this.sidecar(value.planId, value.stage);
      if (saved?.hash !== sidecar.hash) throw new Error(`A different ${value.stage} sidecar already exists for ${value.planId}; reconcile deliberately.`);
    }
    return sidecar;
  }
  async allowDrain(plan: string, fingerprint: string, dispositionId: string): Promise<void> {
    try { await publish(join(this.directory, plan, "drain", `${fingerprint}.json`), { dispositionId, fingerprint }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
  async targets(): Promise<(CutoverTarget | DamagedTarget)[]> {
    let names: string[];
    try { names = await readdir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const result: (CutoverTarget | DamagedTarget)[] = [];
    for (const plan of names.filter(n => n !== "claims" && n !== "refusals" && !n.endsWith(".json") && !n.endsWith(".tmp")).sort()) {
      const stages = new Map<CutoverSidecar["stage"], CutoverSidecar>(), problems: string[] = [];
      for (const stage of ["aborted", "committed", "prepared", "freeze"] as const) {
        try { const value = await this.sidecar(plan, stage); if (value) stages.set(stage, value); }
        catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
      }
      // A readable release returns the plan to its legacy owner; it is published last and never removed.
      if (stages.has("aborted")) continue;
      const sidecar = stages.get("committed") ?? stages.get("prepared") ?? stages.get("freeze");
      if (problems.length) { result.push({ plan, damaged: true, problem: problems.join(" "), tokens: sidecar?.tokens ?? null, stage: sidecar?.stage ?? null }); continue; }
      if (!sidecar) continue;
      let drains: string[] = [];
      try { drains = (await readdir(join(this.directory, plan, "drain"))).filter(n => /^[0-9a-f]{64}\.json$/.test(n)).map(n => n.slice(0, 64)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") { result.push({ plan, damaged: true, problem: String(error), tokens: sidecar.tokens, stage: sidecar.stage }); continue; } }
      result.push({ plan, stage: sidecar.stage, sidecar, drains: new Set(drains), damaged: false });
    }
    return result;
  }
  /** How an item relates to one target: by an authoritative identity, by a mention only, or not at all. */
  static classify(item: GateItem, target: CutoverTarget | DamagedTarget): "identity" | "mention" | null {
    if (target.damaged && !target.tokens) {
      if (item.plan !== undefined) return item.plan === target.plan ? "identity" : null;
      return ["plan-note", "burst", "decision", "crew-action", "inspection"].includes(item.source) ? "identity" : null; // Not provably unrelated.
    }
    const t = target.damaged ? target.tokens! : target.sidecar.tokens;
    if (item.plan === t.plan || (item.actionId && t.actions.includes(item.actionId))) return "identity";
    if (item.agentKey && t.agents.includes(agentOf(item.agentKey))) return "identity";
    if (item.task && t.tasks.some(x => x.task === item.task!.taskId && (item.task!.host === null || normalHost(x.host) === normalHost(item.task!.host)))) return "identity";
    if (item.text && mentions(item.text, t).length) return "mention";
    return null;
  }
  /** Gate decision for one item. Identity-owned deliveries of a frozen or committed scope never fall
   * back to the global first mate. A watch entry merely mentioning a frozen scope stays queued with
   * its legacy owner until its disposition says otherwise; after commit it keeps its original route.
   */
  async verdict(item: GateItem, mode: "enqueue" | "send", targets?: (CutoverTarget | DamagedTarget)[]): Promise<{ admit: true } | { admit: false; plan: string; stage: string; reason: string }> {
    for (const target of targets ?? await this.targets()) {
      const relation = CutoverGate.classify(item, target);
      if (!relation) continue;
      const stage = target.damaged ? "damaged" : target.stage;
      if (target.damaged && relation === "mention" && item.source !== "watch" && item.source !== "inspection") continue;
      if (target.damaged) return { admit: false, plan: target.plan, stage, reason: `A damaged cutover record (${target.plan}) may own this ${item.source === "decision" ? "answer" : "delivery"}; it is held until the main first mate reconciles that record.` };
      const drained = mode === "send" && target.drains.has(itemFingerprint(item));
      if (relation === "identity" && !drained) return { admit: false, plan: target.plan, stage, reason: `${target.plan} is ${stage === "committed" ? "owned by its scoped supervisor" : "in a held cutover"}; the legacy ${item.source} path cannot deliver it.` };
      // Pending inspection runs are not transferred by S07. Their opaque reports cannot fall through to General
      // after commit: reconcile them explicitly, rather than treating a mention as an authoritative owner.
      if (relation === "mention" && item.source === "inspection")
        return { admit: false, plan: target.plan, stage, reason: `Inspection output mentions ${target.plan} during or after its cutover; its saved result is held for reconciliation.` };
      if (relation === "mention" && item.source === "watch" && stage !== "committed" && !drained)
        return { admit: false, plan: target.plan, stage, reason: `Opaque watch output mentions ${target.plan} during its cutover; legacy delivery is held for reconciliation.` };
    }
    return { admit: true };
  }
  /** Gate-checked enqueue. The insertion runs inside the gate, so a cutover either sees it or refuses it. */
  async enqueue<T>(item: GateItem, insert: () => Promise<T>): Promise<T> {
    return this.run(async () => {
      const verdict = await this.verdict(item, "enqueue");
      if (!verdict.admit) { await this.refusal(item, verdict.reason); throw new CutoverRefusal(verdict.plan, verdict.stage, verdict.reason); }
      return insert();
    });
  }
  /** Direct legacy admission, after lifecycle checks have captured the recipient. Reservation and claim share
   * the freeze lock; the caller must perform the native operation after this returns, then settle its result. */
  admit(item: GateItem, recipient: string, options: { beforeClaim?: () => Promise<void>; stopWithUnknownOwner?: boolean } = {}): Promise<string | null> {
    return this.run(async () => {
      // Preserve the legacy safety control: an unreadable record with no worker identities cannot block a local stop.
      const targets = (await this.targets()).filter(t => !options.stopWithUnknownOwner || !t.damaged || t.tokens !== null);
      const verdict = await this.verdict(item, "send", targets);
      if (!verdict.admit) { await this.refusal(item, verdict.reason); throw new CutoverRefusal(verdict.plan, verdict.stage, verdict.reason); }
      await options.beforeClaim?.();
      return (await this.claimHeld([item], recipient, undefined, targets)).claim;
    });
  }
  /** One immediate native operation. No network call holds the gate lock, and any thrown native outcome is uncertain. */
  async deliver<T>(item: GateItem, recipient: string, send: () => Promise<T>, options?: Parameters<CutoverGate["admit"]>[2]): Promise<T> {
    const claim = await this.admit(item, recipient, options);
    let result: T;
    try { result = await send(); }
    catch (error) { await this.settle(claim, "uncertain", String(error)); throw error; }
    await this.settle(claim, "accepted");
    return result;
  }
  /** Admit the items that may be sent now and persist one claim for them before any send. `confirm`
   * rereads the queue under the gate so a claim never names an entry that has already gone.
   */
  claim(items: GateItem[], recipient: string, confirm?: (admitted: GateItem[]) => Promise<GateItem[]>): Promise<{ admitted: GateItem[]; refused: GateItem[]; claim: string | null }> {
    return this.run(() => this.claimHeld(items, recipient, confirm));
  }
  /** `claim` for a caller already inside `run` (the gate's lock is not reentrant). */
  async claimHeld(items: GateItem[], recipient: string, confirm?: (admitted: GateItem[]) => Promise<GateItem[]>, checkedTargets?: (CutoverTarget | DamagedTarget)[]): Promise<{ admitted: GateItem[]; refused: GateItem[]; claim: string | null }> {
    {
      const targets = checkedTargets ?? await this.targets(), admitted: GateItem[] = [], refused: GateItem[] = [];
      for (const item of items) ((await this.verdict(item, "send", targets)).admit ? admitted : refused).push(item);
      const confirmed = confirm ? await confirm(admitted) : admitted;
      if (!confirmed.length || !await this.armed()) return { admitted: confirmed, refused, claim: null };
      const id = randomUUID();
      const value: Claim = { format: "firstmate.delivery-claim/1", id, at: new Date().toISOString(), recipient, items: confirmed.map(item => ({
        source: item.source, id: item.id, payloadHash: item.payloadHash, ...(item.plan ? { plan: item.plan } : {}), ...(item.actionId ? { actionId: item.actionId } : {}),
        ...(item.agentKey ? { agentKey: item.agentKey } : {}), ...(item.task ? { task: item.task } : {}),
        ...(item.source === "inspection" && item.text ? { text: item.text } : {}),
        mentions: item.text ? [...new Set(targets.flatMap(t => t.damaged ? [] : mentions(item.text!, t.sidecar.tokens)))] : [] })) };
      await this.write(join("claims", `${id}.json`), value);
      live.add(id);
      return { admitted: confirmed, refused, claim: id };
    }
  }
  /** Record the send's outcome before its queue entry is removed. `failed` is only a definite non-send. */
  async settle(claim: string | null, outcome: ClaimResult["outcome"], detail = ""): Promise<void> {
    if (!claim) return;
    await this.run(async () => {
      try { await this.write(join("claims", `${claim}.result.json`), { format: "firstmate.delivery-claim-result/1", id: claim, at: new Date().toISOString(), outcome, detail: detail.slice(0, 2000) } satisfies ClaimResult); }
      finally { live.delete(claim); }
      // Pure first-mate traffic that names no plan, worker, task or migration is not evidence any
      // cutover needs. Everything that could be is retained with its result.
      const saved = await this.readClaim(claim);
      if (saved && saved.claim.items.every(i => i.source !== "inspection" && !i.plan && !i.actionId && !i.agentKey && !i.task && !i.mentions.length && !i.id.startsWith("firstmate-plan-"))) {
        await rm(join(this.directory, "claims", `${claim}.json`), { force: true });
        await rm(join(this.directory, "claims", `${claim}.result.json`), { force: true });
      }
    });
  }
  async readClaim(id: string): Promise<{ claim: Claim; result: ClaimResult | null } | null> {
    const read = async (name: string) => { try { return JSON.parse(await readFile(join(this.directory, "claims", name), "utf8")) as unknown; } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; } };
    const claim = await read(`${id}.json`);
    if (!claim) return null;
    const result = await read(`${id}.result.json`);
    return { claim: ClaimSchema.parse(claim), result: result ? ClaimResultSchema.parse(result) : null };
  }
  async claims(): Promise<{ claim: Claim; result: ClaimResult | null }[]> {
    let names: string[];
    try { names = await readdir(join(this.directory, "claims")); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
    const rows: { claim: Claim; result: ClaimResult | null }[] = [];
    for (const name of names.filter(n => /^[0-9a-f-]{36}\.json$/.test(n)).sort()) { const row = await this.readClaim(name.slice(0, 36)); if (row) rows.push(row); }
    return rows.sort((a, b) => a.claim.at.localeCompare(b.claim.at) || a.claim.id.localeCompare(b.claim.id));
  }
  /** A refused legacy delivery is accounted, never silently dropped. */
  /** One record per distinct item and reason: a retried or ticking producer never floods the directory. */
  async refusal(item: GateItem, reason: string): Promise<void> {
    await this.write(join("refusals", `${digest({ item: itemFingerprint(item), reason })}.json`), { format: "firstmate.delivery-refusal/1", at: new Date().toISOString(),
      item: { source: item.source, id: item.id, payloadHash: item.payloadHash }, reason: reason.slice(0, 2000) });
  }
  private async write(relative: string, value: unknown): Promise<void> {
    const path = join(this.directory, relative);
    try { await publish(path, value); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST" && relative.startsWith("refusals")) return;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(join(path, ".."), { recursive: true });
      await publish(path, value);
    }
  }
}

/** Plan, node and worker identities a text names as whole words. A clue for holding, never an owner. */
export function mentions(text: string, tokens: CutoverSidecar["tokens"]): string[] {
  const words = new Set(text.toLowerCase().split(/[^a-z0-9_.:-]+/).flatMap(w => [w, w.replace(/[.:]+$/, "")]));
  // Generic step names ("build", "trial") are everyday words; only distinctive ones count as a clue.
  const distinctive = (id: string) => id.length >= 10 || /[-_.:0-9]/.test(id);
  return [tokens.plan, ...tokens.nodes.filter(distinctive), ...tokens.agents].filter(token => token.length >= 3 && words.has(token.toLowerCase()));
}

/** What the board shows while a cutover holds deliveries: every damaged record and every frozen plan, with its owner. */
export async function cutoverProblems(gate: CutoverGate): Promise<{ problems: string[]; warnings: string[] }> {
  const problems: string[] = [], warnings: string[] = [];
  let targets: (CutoverTarget | DamagedTarget)[];
  try { targets = await gate.targets(); } catch (error) { return { problems: [`Cutover records are unreadable: ${String(error)}. Plan notes, crew relays and answers may be held; the main first mate reconciles.`], warnings }; }
  for (const t of targets) {
    if (t.damaged) problems.push(`Cutover record for ${t.plan} is damaged (${t.problem}). ${t.tokens ? `Deliveries that belong to ${t.plan}` : "Plan notes, crew relays and answers that cannot be proved unrelated"} are held; the main first mate reconciles the record (docs/scoped-supervision/S07.md).`);
    else if (t.stage !== "committed") warnings.push(`Plan ${t.plan} is held in a scoped cutover (${t.stage}); its legacy deliveries wait for the first mate to finish or release it.`);
  }
  return { problems, warnings };
}

const gates = new Map<string, CutoverGate>();
export function cutoverGate(home: string): CutoverGate {
  const root = legacyWorkflowRoot(home);
  let gate = gates.get(root);
  if (!gate) { gate = new CutoverGate(home, root); gates.set(root, gate); }
  return gate;
}
