/** Synthetic inspection adapter for the disposable daemon check; no network or real providers. */
import base from "../provider-migration/mock-provider";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { ProviderEvent, ProviderInput } from "@getpaseo/plugin/server/provider";
import { existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export default function contribute(server: PluginServerContext) {
  return base({ ...server, registerProvider(registration) {
    return server.registerProvider({ ...registration, async connect(request) {
      const connection = await registration.connect(request);
      const runs = new Map<string, { runId: string; actionable: boolean }>();
      const listeners = new Set<(event: ProviderEvent) => void>();
      const held: ProviderEvent[] = [];
      const publish = (event: ProviderEvent) => listeners.forEach((listener) => listener(event));
      const timer = setInterval(() => {
        if (!existsSync(join(process.env.PASEO_HOME!, "hold-inspector"))) for (const event of held.splice(0)) publish(event);
      }, 100);
      const thinking = ["medium", "high", "xhigh"].map((id) => ({ id, label: id }));
      const off = connection.onEvent((event) => {
        if (event.type === "catalog") event = { ...event, catalog: { ...event.catalog,
          models: event.catalog.models.map((model) => ({ ...model, thinkingOptions: thinking })),
          modes: [...event.catalog.modes, { id: "read-only", label: "Read only" }] } };
        if (event.type === "session.config") event = { ...event, config: { ...event.config,
          models: event.config.models?.map((model) => ({ ...model, thinkingOptions: thinking })),
          modes: [...(event.config.modes ?? []), { id: "read-only", label: "Read only" }], thinkingOptions: thinking } };
        const session = "sessionId" in event ? runs.get(event.sessionId) : undefined;
        if (session && event.type === "timeline.item" && event.item.type === "assistant_message") {
          event = { ...event, item: { ...event.item, text: JSON.stringify({ version: 1, runId: session.runId,
            outcome: session.actionable ? "actionable" : "no-change", summary: session.actionable ? "Synthetic stalled task" : "No actionable changes",
            findings: session.actionable ? [{ kind: "stall", subject: "synthetic:task", evidence: "Isolated fixture requests a stall result", recommendation: "Main mate reviews the task" }] : [] }) } };
        }
        if (session && existsSync(join(process.env.PASEO_HOME!, "hold-inspector")) &&
          ((event.type === "timeline.item" && event.item.type === "assistant_message") || (event.type === "session.turn" && event.state === "completed"))) held.push(event);
        else publish(event);
      });
      return { ...connection, onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        async close() { clearInterval(timer); off(); listeners.clear(); await connection.close(); },
        async send(input: ProviderInput) {
          if (input.type === "session.open") appendFileSync(join(process.env.PASEO_HOME!, "synthetic-opens.jsonl"), `${JSON.stringify({ sessionId: input.sessionId, config: input.config })}\n`);
          if (input.type === "session.prompt" && input.prompt.input.type === "message") {
            const text = input.prompt.input.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
            const runId = /^firstmate-inspection-(.+)$/.exec(input.prompt.clientMessageId)?.[1];
            if (runId) runs.set(input.sessionId, { runId, actionable: text.includes("SYNTHETIC_ACTIONABLE") });
          }
          await connection.send(input);
        } };
    } });
  } } as PluginServerContext);
}
