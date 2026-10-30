/** Claims precede transport and are never retried. Readiness comes from fresh
 * native status, not the order or identity of lifecycle callbacks. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { ChatQueueItemSchema, queueAgent, queueTarget, queueText, type ChatQueueItem, type ChatQueuePayload, type ChatQueueTarget } from "../shared/chat-queue";
import { serialized } from "./serialize";

const StateSchema = z.object({ items: z.array(ChatQueueItemSchema), ended: z.array(z.string()),
  claims: z.record(z.string(), z.object({ owner: z.string(), at: z.number() })).default({}) });
type State = z.infer<typeof StateSchema>;
export const CHAT_CLAIM_TIMEOUT_MS = 60_000;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const same = (a: ChatQueueTarget, b: ChatQueueTarget) => hash(a) === hash(b);
const conversation = (a: ChatQueueTarget, b: ChatQueueTarget) => a.kind === "mate" ? b.kind === "mate" && a.agentId === b.agentId : b.kind === "scope" && a.target.homeId === b.target.homeId && a.target.scopeId === b.target.scopeId;
export interface ChatQueueOptions {
  enabled(): Promise<boolean>;
  activity(target: ChatQueueTarget): Promise<"busy" | "ready">;
  deliver(payload: ChatQueuePayload, id: string, allowBusy: boolean): Promise<void>;
  now?(): number;
  claimTimeoutMs?: number;
}
/** Only the checked discussion service can prove refusal before reservation. */
export class ChatQueueRefusal extends Error {}
export class ChatQueue {
  private cached: { identity: string; state: State } | null = null;
  private readonly owner = randomUUID();
  constructor(readonly path: string, private options: ChatQueueOptions) {}
  private now() { return this.options.now?.() ?? Date.now(); }
  private timeout() { return this.options.claimTimeoutMs ?? CHAT_CLAIM_TIMEOUT_MS; }
  private async identity() { const file = await stat(this.path); return JSON.stringify([file.dev, file.ino, file.size, file.mtimeMs, file.ctimeMs]); }
  private async read(): Promise<State> {
    try {
      const identity = await this.identity();
      if (this.cached?.identity === identity) return this.cached.state;
      const state = StateSchema.parse(JSON.parse(await readFile(this.path, "utf8")));
      this.cached = { identity, state }; return state;
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return { items: [], claims: {}, ended: [] }; }
  }
  private recoverState(state: State) {
    for (const item of state.items) {
      if (item.state !== "claimed") continue;
      const claim = state.claims[item.id];
      if (claim?.owner === this.owner && this.now() - claim.at < this.timeout()) continue;
      item.state = "held";
      item.problem = "Delivery couldn't be confirmed. This message will not be sent again. You can remove it after checking the conversation.";
      delete state.claims[item.id];
    }
  }
  private transaction<T>(run: (state: State) => T | Promise<T>): Promise<T> {
    return serialized(`chat-queue:${this.path}`, async () => {
      const state = structuredClone(await this.read()), before = JSON.stringify(state);
      this.recoverState(state);
      const result = await run(state);
      if (before === JSON.stringify(state)) return result;
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      const contents = JSON.stringify(state);
      if (Buffer.byteLength(contents) > 128 * 1024 * 1024) throw new Error("The saved queue is full. Remove an attachment or a message before sending.");
      await writeFile(temporary, contents, { flag: "wx", flush: true });
      await rename(temporary, this.path);
      this.cached = { identity: await this.identity(), state };
      return result;
    });
  }
  /** Startup/stale-claim maintenance only. This never dispatches a message. */
  async recover() { await this.transaction(() => undefined); }
  async snapshot(target: ChatQueueTarget) {
    await this.recover();
    const [state, enabled] = await Promise.all([this.read(), this.options.enabled()]);
    return { enabled, items: state.items.filter(i => conversation(i.target, target) && !["sent", "removed"].includes(i.state)).map(({ payload, ...item }) => ({ ...item,
      text: payload ? queueText(payload) : "", attachmentCount: payload?.kind === "mate" ? (payload.message.images?.length ?? 0) + (payload.message.files?.length ?? 0) : 0 })) };
  }
  private claim(state: State, item: ChatQueueItem) {
    item.state = "claimed";
    state.claims[item.id] = { owner: this.owner, at: this.now() };
    return structuredClone(item);
  }
  private group(target: ChatQueueTarget) { return queueAgent(target) ?? JSON.stringify(target); }
  private inFlight(state: State, target: ChatQueueTarget) {
    return state.items.some(i => i.state === "claimed" && this.group(i.target) === this.group(target));
  }
  async submit(id: string, payload: ChatQueuePayload, now = false, replaces?: string): Promise<ChatQueueItem> {
    const target = queueTarget(payload);
    // Join serialization before any asynchronous read/check so concurrent
    // admissions retain their arrival order, including on a cold disk.
    const claimed = await this.transaction(async state => {
      const previous = state.items.find(i => i.id === id);
      if (previous) { if (previous.hash !== hash(payload)) throw new Error("This message ID already belongs to another message."); return { item: structuredClone(previous), dispatch: false, allowBusy: false }; }
      const enabled = await this.options.enabled(), activity = await this.options.activity(target);
      if (replaces) {
        const editing = state.items.find(i => i.id === replaces && conversation(i.target, target));
        if (!editing || !["editing", "refused"].includes(editing.state)) throw new Error("The message being edited changed. Refresh before sending.");
        editing.state = "removed"; editing.payload = null;
      }
      const item: ChatQueueItem = { id, target, payload, hash: hash(payload), state: "queued", problem: null };
      state.items.push(item);
      const waiting = activity === "busy" || this.inFlight(state, target) || state.items.some(i => i.id !== id && i.state === "queued" && this.group(i.target) === this.group(target));
      if (enabled && !now && waiting && state.items.filter(i => i.state === "queued").length > 100) throw new Error("The queue is full. Remove a message before adding another.");
      return now || !enabled || !waiting ? { item: this.claim(state, item), dispatch: true, allowBusy: now || !enabled } : { item: structuredClone(item), dispatch: false, allowBusy: false };
    });
    if (claimed.dispatch) await this.dispatch(claimed.item, claimed.allowBusy);
    return { ...(await this.read()).items.find(i => i.id === id)!, payload: null };
  }
  async change(target: ChatQueueTarget, id: string, action: "edit" | "remove" | "now"): Promise<ChatQueueItem> {
    const item = await this.transaction(state => {
      const item = state.items.find(i => i.id === id && same(i.target, target));
      if (!item) throw new Error("This queued message is no longer available.");
      if (!["queued", "editing", "refused"].includes(item.state) && !(action === "remove" && item.state === "held")) throw new Error("This message has already left the queue. Refresh to check it.");
      if (action === "now" && item.state !== "queued") throw new Error("Send the edited message from the message box.");
      if (action === "now") return this.claim(state, item);
      if (action === "edit") { item.state = "editing"; return structuredClone(item); }
      item.state = "removed"; item.payload = null;
      return structuredClone(item);
    });
    if (action === "now") await this.dispatch(item, true);
    return action === "edit" ? item : { ...item, payload: null };
  }
  private async dispatch(item: ChatQueueItem, allowBusy = false) {
    let problem: string | null = null;
    let refused = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.options.deliver(item.payload!, item.id, allowBusy),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Delivery timed out. This message will not be sent again.")), this.timeout()); timer.unref?.(); }),
      ]);
    }
    catch (error) { problem = error instanceof Error ? error.message : String(error); refused = error instanceof ChatQueueRefusal; }
    finally { clearTimeout(timer); }
    await this.transaction(state => {
      const saved = state.items.find(i => i.id === item.id)!;
      // A recovery sweep or captain dismissal wins over a late transport reply.
      if (saved.state !== "claimed" || state.claims[item.id]?.owner !== this.owner) return;
      saved.state = refused ? "refused" : problem ? "held" : "sent"; saved.problem = problem;
      delete state.claims[item.id];
      if (!problem) saved.payload = null;
    });
  }
  /** One fresh ready observation reserves at most one oldest item per agent.
   * The claim blocks competing polls until transport settles. Active native
   * turns (including an idle status with activeTurn) block the next admission.
   */
  async reconcile(agent?: string, waitForDelivery = true) {
    const items = await this.transaction(async state => {
      const checked = new Set<string>(), ready: ChatQueueItem[] = [];
      for (const item of state.items) {
        if (item.state !== "queued" || (agent !== undefined && queueAgent(item.target) !== agent)) continue;
        const group = this.group(item.target);
        if (checked.has(group)) continue;
        checked.add(group);
        if (this.inFlight(state, item.target)) continue;
        try {
          if (await this.options.activity(item.target) === "ready") ready.push(this.claim(state, item));
        } catch (error) {
          item.state = "held"; item.problem = error instanceof Error ? error.message : String(error);
        }
      }
      return ready;
    });
    const deliveries = Promise.all(items.map(item => this.dispatch(item)));
    if (waitForDelivery) await deliveries;
    else void deliveries.catch(error => console.error("[firstmate] queued chat delivery:", error));
  }
  async started(agent: string, _turnId: string | null) { await this.reconcile(agent); }
  async ended(agent: string, turnId: string | null, completed: boolean) {
    const fresh = await this.transaction(state => {
      if (!state.items.some(i => queueAgent(i.target) === agent)) return false;
      if (turnId === null) return true;
      const token = JSON.stringify([agent, turnId]);
      if (state.ended.includes(token)) return false;
      state.ended.push(token);
      return true;
    });
    if (fresh && completed) await this.reconcile(agent);
  }
}
