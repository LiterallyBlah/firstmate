/** The daemon owns the queue. Claims are durable BEFORE checked transport is entered.
 * A claimed/uncertain item is never retried. Completed turn IDs are durable too.
 * Network calls are outside the file lock so lifecycle hooks can record a fast turn.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { ChatQueueItemSchema, queueAgent, queueTarget, queueText, type ChatQueueItem, type ChatQueuePayload, type ChatQueueTarget } from "../shared/chat-queue";
import { serialized } from "./serialize";

const StateSchema = z.object({ items: z.array(ChatQueueItemSchema), active: z.record(z.string(), z.string()),
  barriers: z.record(z.string(), z.object({ id: z.string(), turnId: z.string().nullable() })), ended: z.array(z.string()) });
type State = z.infer<typeof StateSchema>;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const same = (a: ChatQueueTarget, b: ChatQueueTarget) => hash(a) === hash(b);
const conversation = (a: ChatQueueTarget, b: ChatQueueTarget) => a.kind === "mate" ? b.kind === "mate" && a.agentId === b.agentId : b.kind === "scope" && a.target.homeId === b.target.homeId && a.target.scopeId === b.target.scopeId;
export interface ChatQueueOptions {
  enabled(): Promise<boolean>;
  activity(target: ChatQueueTarget): Promise<"busy" | "ready">;
  deliver(payload: ChatQueuePayload, id: string, allowBusy: boolean): Promise<void>;
}
/** Only the checked discussion service can prove refusal before reservation. */
export class ChatQueueRefusal extends Error {}
export class ChatQueue {
  private cached: { identity: string; state: State } | null = null;
  constructor(readonly path: string, private options: ChatQueueOptions) {}
  private async identity() { const file = await stat(this.path); return JSON.stringify([file.dev, file.ino, file.size, file.mtimeMs, file.ctimeMs]); }
  private async read(): Promise<State> {
    try {
      const identity = await this.identity();
      if (this.cached?.identity === identity) return this.cached.state;
      const state = StateSchema.parse(JSON.parse(await readFile(this.path, "utf8")));
      this.cached = { identity, state }; return state;
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return { items: [], active: {}, barriers: {}, ended: [] }; }
  }
  private transaction<T>(run: (state: State) => T | Promise<T>): Promise<T> {
    return serialized(`chat-queue:${this.path}`, async () => {
      const state = structuredClone(await this.read()), before = JSON.stringify(state), result = await run(state);
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
  async snapshot(target: ChatQueueTarget) {
    const [state, enabled] = await Promise.all([this.read(), this.options.enabled()]);
    return { enabled, items: state.items.filter(i => conversation(i.target, target) && !["sent", "removed"].includes(i.state)).map(({ payload, ...item }) => ({ ...item,
      text: payload ? queueText(payload) : "", attachmentCount: payload?.kind === "mate" ? (payload.message.images?.length ?? 0) + (payload.message.files?.length ?? 0) : 0 })) };
  }
  private claim(state: State, item: ChatQueueItem) {
    item.state = "claimed";
    const agent = queueAgent(item.target);
    if (agent) state.barriers[agent] = { id: item.id, turnId: state.active[agent] ?? null };
    return structuredClone(item);
  }
  async submit(id: string, payload: ChatQueuePayload, now = false, replaces?: string): Promise<ChatQueueItem> {
    const target = queueTarget(payload);
    // Join serialization before any asynchronous read/check so concurrent
    // admissions retain their arrival order, including on a cold disk.
    const claimed = await this.transaction(async state => {
      const previous = state.items.find(i => i.id === id);
      if (previous) { if (previous.hash !== hash(payload)) throw new Error("This message ID already belongs to another message."); return { item: structuredClone(previous), dispatch: false, allowBusy: false }; }
      const enabled = await this.options.enabled(), activity = await this.options.activity(target);
      if (state.items.filter(i => i.state === "queued").length >= 100) throw new Error("The queue is full. Remove a message before adding another.");
      if (replaces) {
        const editing = state.items.find(i => i.id === replaces && conversation(i.target, target));
        if (!editing || !["editing", "refused"].includes(editing.state)) throw new Error("The message being edited changed. Refresh before sending.");
        editing.state = "removed"; editing.payload = null;
      }
      const item: ChatQueueItem = { id, target, payload, hash: hash(payload), state: "queued", problem: null };
      state.items.push(item);
      const agent = queueAgent(target);
      const waiting = activity === "busy" || !!(agent && state.barriers[agent]) || state.items.some(i => i.id !== id && i.state === "queued" && queueAgent(i.target) === agent);
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
    try { await this.options.deliver(item.payload!, item.id, allowBusy); }
    catch (error) { problem = error instanceof Error ? error.message : String(error); refused = error instanceof ChatQueueRefusal; }
    await this.transaction(state => {
      const saved = state.items.find(i => i.id === item.id)!;
      saved.state = refused ? "refused" : problem ? "held" : "sent"; saved.problem = problem;
      const agent = queueAgent(item.target);
      if (refused && agent && state.barriers[agent]?.id === item.id) delete state.barriers[agent];
      if (!problem) saved.payload = null;
    });
  }
  async started(agent: string, turnId: string | null) {
    if (!turnId) return;
    await this.transaction(state => { if (state.ended.includes(JSON.stringify([agent, turnId])) || !state.items.some(i => queueAgent(i.target) === agent)) return; state.active[agent] = turnId; const barrier = state.barriers[agent]; if (barrier) barrier.turnId = turnId; });
  }
  async ended(agent: string, turnId: string | null, completed: boolean) {
    // An unidentified callback cannot prove a new completed turn.
    if (!turnId) return;
    const item = await this.transaction(state => {
      if (!state.items.some(i => queueAgent(i.target) === agent)) return null;
      const token = JSON.stringify([agent, turnId]);
      if (state.ended.includes(token)) return null;
      state.ended.push(token);
      if (state.active[agent] === turnId) delete state.active[agent];
      const barrier = state.barriers[agent];
      if (!completed || (barrier && barrier.turnId !== turnId)) return null;
      delete state.barriers[agent];
      const next = state.items.find(i => i.state === "queued" && queueAgent(i.target) === agent);
      return next ? this.claim(state, next) : null;
    });
    if (item) await this.dispatch(item);
  }
}
