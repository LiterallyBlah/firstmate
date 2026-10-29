/**
 * The watch runner wired to Paseo: which home it runs in, which watches are off, and how what they
 * print reaches the first mate.
 *
 * **The server half has no Paseo handle of its own.** The plugin API hands one to an RPC handler and
 * to a lifecycle hook, and nothing else — but it is the same object every time, one per plugin
 * process, so the first one seen is kept (`remember`) and used by the timer. Every RPC here and every
 * turn any agent starts or ends passes it on. Until one has, after a plugin start, watches still run
 * and what they print waits in the queue; the board opening, or any agent's turn, releases it.
 *
 * Delivery waits while the first mate is mid-turn, asking Paseo afresh before every send. The end of
 * its turn (`agent.turn_ended`) tries the queue a few times over the next seconds
 * (`WatchRunner.flushAfterTurn`), and every minute's tick tries again, so a turn whose end the plugin
 * missed delays a note by a minute at most.
 */
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { open } from "node:fs/promises";

import type { PluginLifecycleRegistration } from "@getpaseo/plugin/server";

import { WATCH_MESSAGE_ID_PREFIX, type FirstmateConfig, type WatchSummary } from "../shared/fleet";
import { BOARD_REVIEW_ROUTING, CURRENT_ROUTING, ManagedWatchSchema, WatchRoutingSchema, configureWatch, type ManagedWatch, type WatchRouting } from "../shared/watch-routing";
import { z } from "zod";
import { resolveHome, updateFirstmateConfig } from "./config";
import { pluginDir } from "./data-dir";
import { resolveMate } from "./fleet";
import { isHomeReady } from "./home";
import type { PaseoApi } from "./host-types";
import { isMidTurn, oneAtATime, flushMateNotes, recordNoteQueued } from "./mate";
import { sendWithoutInterrupting } from "./send";
import { serialized } from "./serialize";
import { WatchRunner, watchNote, watchOwner, type DeliveryOutcome, type WatchDelivery } from "./watches";
import { WatchConfigStore } from "./watch-config";
import { WatchInspections, inspectionChoices } from "./watch-inspections";
import { listWatches } from "./watch-files";
import { parseSchedule, isDue } from "./watch-schedule";
import { message, TEMPLATES } from "./templates";
import { processWatchRequests } from "./watch-requests";
import { cutoverGate } from "./supervision-gate";
import { digest } from "./submissions";
import { timerInventory, type TimerInventory } from "./supervision-jobs";
import type { MaintenanceJob } from "../shared/supervision-maintenance";
import type { NativeTimerInventory } from "./archive-inventory";
import { SupervisionStatusReader } from "./supervision-status-reader";

/**
 * S10 timer disposition inventory: the home's script watches, managed watches, the config's off switches, native
 * schedules/heartbeats when supplied, and the plugin's own clocks. Reads files only; nothing is created, toggled,
 * seeded or replaced. Native schedules are not read here: an absent native listing keeps the inventory incomplete.
 */
export async function readTimerInventory(home: string, config: FirstmateConfig, store: WatchConfigStore,
  native: NativeTimerInventory = { complete: false, reason: "Native schedule inventory was not read." },
  jobs: readonly MaintenanceJob[] = []): Promise<TimerInventory> {
  const [scripts, saved, configFingerprint] = await Promise.all([listWatches(home), store.read(), store.fingerprint()]);
  const described = await Promise.all(scripts.map(async s => {
    const file = await open(s.path, "r");
    try {
      if ((await file.stat()).size > 512 * 1024) throw new Error(`Timer census script ${s.name} exceeds 512 KiB; retirement remains held.`);
      const buffer = Buffer.alloc(512 * 1024 + 1), { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 512 * 1024) throw new Error(`Timer census script ${s.name} grew beyond 512 KiB; retirement remains held.`);
      return { name: s.name, scheduleText: s.scheduleText, invalid: s.invalid, fingerprint: createHash("sha256").update(buffer.subarray(0, bytesRead)).digest("hex") };
    } finally { await file.close(); }
  }));
  return timerInventory({ scripts: described,
    disabledWatches: config.disabledWatches, managed: saved.watches, native, mateAgentId: config.mateAgentId.trim(), jobs, configFingerprint });
}

/**
 * Sends to the first mate only when Paseo says it is not mid-turn, asked afresh every time, under a
 * watch message id so the chat can tell it from the captain's words.
 */
export async function deliverToMate(
  paseo: PaseoApi | null,
  config: FirstmateConfig,
  text: string,
  readConfig = async () => config,
  expected?: WatchDelivery,
): Promise<DeliveryOutcome> {
  return oneAtATime(async () => {
    // Re-read after taking the lifecycle gate: a handover may have changed the mate while we waited.
    const latest = await readConfig();
    { // Retained scoped owners keep their delivery route even when new work is off.
      const pulls = [...text.matchAll(/https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/(\d+)/gi)];
      if (pulls.length) {
        const scoped = await new SupervisionStatusReader(pluginDir()).read(resolveHome(latest));
        // Final legacy-delivery recheck closes the routing-projection race. Retain the opaque
        // original note; typed observations/direct reads serve its exact scoped owner.
        if (scoped.freshness === "held" || pulls.some(p => scoped.sources.bindings.some(b => b.state === "active" && b.repository.toLowerCase() === p[1]!.toLowerCase() && b.pr === Number(p[2])))) return "wait";
      }
    }
    if (expected && (watchOwner(cutoverGate(resolveHome(latest))) !== expected.owner || latest.mateAgentId.trim() !== expected.recipient)) return "wait";
    if (latest.migration !== null || latest.mateLaunch !== null || paseo === null) return "wait";
    const { agent } = await resolveMate(paseo, latest);
    if (agent === null || isMidTurn(agent)) return "wait";
    if (expected) {
      const current = await readConfig();
      if (agent.id !== expected.recipient || current.migration !== null || current.mateLaunch !== null ||
        watchOwner(cutoverGate(resolveHome(current))) !== expected.owner || current.mateAgentId.trim() !== expected.recipient) return "wait";
    }
    await sendWithoutInterrupting(paseo, agent.id, text, { messageId: expected?.messageId ?? `${WATCH_MESSAGE_ID_PREFIX}${randomUUID()}` },
      { channel: "watch-flush", actor: "plugin", mateRecipient: true });
    return "sent";
  });
}

export interface WatchService {
  runner: WatchRunner;
  /** Keeps the plugin's Paseo handle for the timer; see the module note. */
  remember: (paseo: PaseoApi) => void;
  /** Switches a watch off or on. */
  toggle: (name: string, enabled: boolean) => Promise<void>;
  create: (input: ManagedWatch, requestId?: string) => Promise<void>;
  configure: (input: z.infer<typeof configureWatch.input>) => Promise<void>;
  options: () => Promise<Awaited<ReturnType<typeof inspectionChoices>> & { boardReview: ManagedWatch }>;
  summaries: () => Promise<WatchSummary[]>;
  history: (name: string) => ReturnType<WatchInspections["history"]>;
  /** Read-only S10 timer inventory; unwired (no RPC). */
  timerInventory: (native?: NativeTimerInventory, jobs?: readonly MaintenanceJob[]) => Promise<TimerInventory>;
  stop: () => void;
}

export function startWatches(
  server: PluginLifecycleRegistration,
  readConfig: () => Promise<FirstmateConfig>,
  snapshot: (paseo: PaseoApi, config: FirstmateConfig) => Promise<unknown>,
): WatchService {
  let paseo: PaseoApi | null = null;
  const remember = (handle: PaseoApi) => {
    paseo = handle;
  };
  const store = new WatchConfigStore(join(pluginDir(), "watch-config.json"));
  const inspections = new WatchInspections({ root: join(pluginDir(), "watch-inspections"), paseo: () => paseo, config: readConfig, snapshot });
  const scriptRuns = new Map<string, WatchRouting>();

  const runner: WatchRunner = new WatchRunner({
    async home() {
      const home = resolveHome(await readConfig());
      return (await isHomeReady(home)) ? home : null;
    },
    async disabled() {
      return (await readConfig()).disabledWatches;
    },
    async deliver(text, expected) {
      return deliverToMate(paseo, await readConfig(), text, readConfig, expected);
    },
    async canRun(name) {
      const routing = (await store.read()).scripts[name] ?? CURRENT_ROUTING;
      if (await inspections.busy(name) || (routing.executionSession === "new" && await runner.pendingDelivery(name))) return false;
      scriptRuns.set(name, routing); return true;
    },
    async routeNote(note) {
      const routing = scriptRuns.get(note.name) ?? CURRENT_ROUTING;
      scriptRuns.delete(note.name);
      if (routing.executionSession === "current") return false;
      await inspections.queueInput(note.name, note.text, routing, note); return true;
    },
    async gate() {
      const config = await readConfig();
      return config.home === "" && config.mateAgentId === "" ? null : { gate: cutoverGate(resolveHome(config)), recipient: config.mateAgentId.trim() || "unassigned" };
    },
    stateFile: join(pluginDir(), "watches.json"),
    scriptStateRoot: join(pluginDir(), "watch-state"),
  });

  const offStarted = server.on("agent.turn_started", (_event, context) => remember(context.paseo));
  const offEnded = server.on("agent.turn_ended", async (event, context) => {
    remember(context.paseo);
    if (event.agent.id && event.agent.cwd.startsWith(join(pluginDir(), "watch-inspections", "workspaces"))) {
      inspections.endedTurn(event.agent.id, { ...event.outcome, timeline: event.timeline });
      return;
    }
    const config = await readConfig();
    await flushMateNotes(context.paseo).catch((error: unknown) => console.error("[firstmate] crew notes await delivery:", error));
    if (event.agent.id === config.mateAgentId.trim()) runner.flushAfterTurn();
  });
  const stopTimer = runner.start();
  let stopped = false;
  let lastFault: string | null = null;
  async function tickPrompts() {
    return serialized("firstmate.watch.prompts", async () => {
      if (stopped) return;
      await inspections.reconcile();
      const config = await readConfig();
      if (config.migration !== null || config.mateLaunch !== null || !(await isHomeReady(resolveHome(config)))) return;
      await processWatchRequests(resolveHome(config), async (request) => {
        if (request.operation === "create") await service.create(request.input, request.id);
        else await service.configure(request.input);
      });
      const at = new Date();
      for (const watch of (await store.read()).watches) {
        if (stopped || !watch.enabled || !isDue(parseSchedule(watch.schedule), at)) continue;
        if (await inspections.busy(watch.name) || (watch.executionSession === "new" && await runner.pendingDelivery(watch.name))) continue;
        if (watch.executionSession === "current") await runner.enqueuePrompt(watch.name, watch.prompt, at);
        else await inspections.queueInput(watch.name, watch.prompt, watch, undefined, at.toISOString().slice(0, 16));
      }
      await inspections.drainInputs();
      await runner.flush();
      lastFault = null;
    });
  }
  const inspectionTimer = setInterval(() => {
    void tickPrompts().catch(async (error: unknown) => {
      console.error("[firstmate] watch inspection recovery failed:", error);
      const reason = String(error);
      if (paseo === null || lastFault === reason) return;
      try {
        // This independent durable outbox remains usable even when the inspection ledger is corrupt.
        // Never enter the non-reentrant lifecycle gate before queuing/flushing it.
        const id = `firstmate-watch-runtime-${createHash("sha256").update(reason).digest("hex")}`;
        const text = await watchNote([{ name: "watch-runtime", ran: new Date().toISOString(), kind: "failed", reason, text: reason }], 0);
        const queued = await cutoverGate(resolveHome(await readConfig())).enqueue({ source: "watch-runtime", id, payloadHash: digest({ id, text }), text },
          () => serialized("firstmate.mate.notes", async () => {
            const config = await readConfig();
            if (config.mateNotes.some((note) => note.id === id)) return false;
            await updateFirstmateConfig({ mateNotes: [...config.mateNotes, { id, text }] });
            return true;
          }));
        if (queued) recordNoteQueued(id, "watch-runtime", text);
        lastFault = reason;
        await flushMateNotes(paseo);
      } catch (failure) { console.error("[firstmate] watch runtime failure awaits recovery:", failure); }
    });
  }, 15000);
  const noteTimer = setInterval(() => {
    if (paseo !== null) void flushMateNotes(paseo).catch((error: unknown) => console.error("[firstmate] crew notes await delivery:", error));
  }, 15000);

  const service: WatchService = {
    runner,
    remember,
    async create(input, requestId) {
      const valid = ManagedWatchSchema.parse(input);
      // A completed creation remains a successful receipt even if the mate/model later changes.
      if (requestId && (await store.read()).receipts[requestId]) { await store.create(valid, requestId); return; }
      const home = resolveHome(await readConfig());
      if ((await listWatches(home)).some((watch) => watch.name === valid.name)) throw new Error("An existing script has that watch name.");
      await validateRouting(valid); await store.create(valid, requestId);
    },
    async configure(input) {
      const routing = WatchRoutingSchema.parse({ executionSession: input.executionSession, newSessionReasoning: input.newSessionReasoning, notificationPolicy: input.notificationPolicy });
      await validateRouting(routing);
      await store.change(async (saved) => {
        const watch = saved.watches.find((entry) => entry.name === input.name);
        if (watch) { Object.assign(watch, input); ManagedWatchSchema.parse(watch); parseSchedule(watch.schedule); }
        else {
          if (input.schedule !== undefined || input.prompt !== undefined) throw new Error("Edit script text and schedule in Files.");
          if (!(await listWatches(resolveHome(await readConfig()))).some((entry) => entry.name === input.name)) throw new Error("Watch not found.");
          saved.scripts[input.name] = routing;
        }
      });
      if (input.enabled !== undefined && !(await store.read()).watches.some((entry) => entry.name === input.name)) await this.toggle(input.name, input.enabled);
    },
    options: async () => ({ ...await inspectionChoices(paseo, await readConfig()), boardReview: {
      name: "board-review", schedule: "*/10 * * * *", enabled: true, prompt: await message(TEMPLATES.boardReviewBrief), ...BOARD_REVIEW_ROUTING,
    } }),
    history: (name) => inspections.history(name),
    async timerInventory(native, jobs) {
      const config = await readConfig();
      return readTimerInventory(resolveHome(config), config, store, native, jobs);
    },
    async summaries() {
      const saved = await store.read();
      const scripts = await runner.summaries();
      const summaries: WatchSummary[] = [];
      for (const script of scripts) {
        const routing = saved.scripts[script.name] ?? CURRENT_ROUTING;
        if (routing.executionSession === "current") summaries.push({ ...script, routing });
        else {
          const inspected = await inspections.summary({ name: script.name, schedule: script.schedule ?? "* * * * *", prompt: "Script output inspection", enabled: script.enabled, ...routing });
          summaries.push({ ...script, ...inspected, managed: false, invalid: script.invalid, builtIn: script.builtIn, outdated: script.outdated, prompt: undefined });
        }
      }
      for (const watch of saved.watches) summaries.push(watch.executionSession === "new" ? await inspections.summary(watch) : await runner.promptSummary(watch));
      return summaries;
    },
    async toggle(name, enabled) {
      if ((await store.read()).watches.some((watch) => watch.name === name)) {
        await store.change((saved) => { const watch = saved.watches.find((entry) => entry.name === name); if (watch) watch.enabled = enabled; }); return;
      }
      // Read and written as one step, so two quick toggles cannot undo each other.
      return serialized("firstmate.watch.toggle", async () => {
        const off = new Set((await readConfig()).disabledWatches);
        if (enabled) off.delete(name);
        else off.add(name);
        await updateFirstmateConfig({ disabledWatches: [...off].sort() });
      });
    },
    stop() {
      stopped = true; inspections.stop(); clearInterval(inspectionTimer);
      stopTimer();
      clearInterval(noteTimer);
      offStarted();
      offEnded();
    },
  };
  return service;

  async function validateRouting(routing: WatchRouting) {
    if (routing.executionSession === "current") return;
    await oneAtATime(async () => {
      const choices = await inspectionChoices(paseo, await readConfig());
      if (!choices.available) throw new Error(choices.reason ?? "Read-only inspection unavailable.");
      if (routing.newSessionReasoning !== "inherit" && !choices.thinking.some((option) => option.id === routing.newSessionReasoning))
        throw new Error("That reasoning level is not supported by the current first mate's model.");
    });
  }
}
