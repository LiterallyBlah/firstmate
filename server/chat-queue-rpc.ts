import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createHash } from "node:crypto";
import { readChatQueue, submitChatMessage, changeChatQueue, queueAgent, type ChatQueueTarget } from "../shared/chat-queue";
import { displaySettings } from "../shared/settings";
import { ChatQueue, ChatQueueRefusal } from "./chat-queue";
import { readFirstmateConfig, resolveHome } from "./config";
import { dataPath } from "./data-dir";
import { askMate } from "./mate";
import type { ScopeRuntime } from "./scope-runtime";
import type { PaseoApi } from "./host-types";
import { workflowHomeIdentity } from "./workflow-ownership";

export function registerChatQueue(server: PluginServerContext, runtime: ScopeRuntime, settings: ReturnType<PluginServerContext["registerSettings"]>) {
  const queues = new Map<string, ChatQueue>();
  async function queue(paseo: PaseoApi) {
    const home = resolveHome(await readFirstmateConfig());
    let current = queues.get(home);
    if (!current) {
      const activity = async (target: ChatQueueTarget) => {
        const config = await readFirstmateConfig();
        if (resolveHome(config) !== home || (target.kind === "mate" ? config.mateAgentId !== target.agentId : target.target.homeId !== workflowHomeIdentity(home)))
          throw new Error("This conversation changed. Your message is kept; open its original conversation to continue.");
        const agentId = queueAgent(target);
        if (!agentId) return "ready" as const; // Only the existing reviewed first-send flow may create a scope.
        const agent = (await paseo.agents.ref(agentId).refresh())?.agent;
        if (!agent || agent.archivedAt || !["idle", "running", "initializing"].includes(agent.status)) throw new Error("This mate is unavailable. Your message is kept; check the full conversation.");
        return agent.status !== "idle" || agent.pendingPermissions.length > 0 ? "busy" as const : "ready" as const;
      };
      current = new ChatQueue(dataPath(`chat-queues/${createHash("sha256").update(home).digest("hex")}.json`), {
        enabled: async () => { const result = await settings.read(); if (result.status !== "ready") throw new Error("Chat settings couldn't be checked. Your message is kept."); return displaySettings.schema.parse(result.values).queueMessagesWhileBusy; },
        activity,
        deliver: async (payload, id, allowBusy) => {
          const target: ChatQueueTarget = payload.kind === "mate" ? { kind: "mate", agentId: payload.agentId } : { kind: "scope", target: payload.input.route.target };
          const check = async () => { if (await activity(target) === "busy" && !allowBusy) throw new Error("This mate started other work before sending. The message is held; it will not be resent automatically."); };
          await check();
          if (payload.kind === "mate") {
            await askMate(paseo, { ...payload.message, messageId: payload.message.messageId ?? `firstmate-captain-${id}` }, async agentId => {
              if (agentId !== payload.agentId) throw new Error("FirstMate changed before delivery. No message was sent to the new mate.");
              await check();
            });
          } else {
            const result = await runtime.execute(payload.input.route.target.homeId, payload.input.route.target.scopeId, paseo,
              services => services.discussions.result(payload.input), async agentId => {
                if (payload.input.route.target.agentId && agentId !== payload.input.route.target.agentId) throw new Error("This conversation's mate changed before sending.");
                await check();
              });
            if (result.outcome === "refused") throw new ChatQueueRefusal(result.message);
            if (result.outcome !== "recorded") throw new Error(result.message);
            const row = result.thread.messages.find(m => m.id === payload.input.id);
            if (!row || row.delivery === "uncertain") throw new Error("The message couldn't be confirmed. It will not be resent automatically.");
          }
        },
      });
      queues.set(home, current);
    }
    return current;
  }
  server.handle(readChatQueue, async ({ target }, { paseo }) => (await queue(paseo)).snapshot(target));
  server.handle(submitChatMessage, async ({ id, payload, now, replaces }, { paseo }) => (await queue(paseo)).submit(id, payload, now, replaces));
  server.handle(changeChatQueue, async ({ target, id, action }, { paseo }) => (await queue(paseo)).change(target, id, action));
  const start = server.on("agent.turn_started", async (event, { paseo }) => {
    await (await queue(paseo)).started(event.agent.id, event.turnId);
  });
  const end = server.on("agent.turn_ended", async (event, { paseo }) => {
    await (await queue(paseo)).ended(event.agent.id, event.turnId, event.outcome.kind === "completed");
  });
  return () => { start(); end(); };
}
