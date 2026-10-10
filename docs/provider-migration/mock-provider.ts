/** Installed only by daemon-check.mjs in its temporary home. No network, credentials or real agents. */
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { ProviderEvent, ProviderInput } from "@getpaseo/plugin/server/provider";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

type HistoryItem =
  | { id: string; type: "user_message"; text: string; clientMessageId: string }
  | { id: string; type: "assistant_message"; text: string };

export default function contribute(server: PluginServerContext) {
  for (const id of ["fm-test-source", "fm-test-target"])
    server.registerProvider({
      id,
      label: id,
      status: async () => ({ available: true }),
      async connect() {
        const listeners = new Set<(event: ProviderEvent) => void>();
        const heldTurns = new Map<string, string>();
        const histories = new Map<string, HistoryItem[]>();
        const capabilities = ["prompt.message", "session.archive", "session.persistence"];
        const emit = (event: ProviderEvent) => listeners.forEach((listener) => listener(event));
        const persistence = (sessionId: string) => ({
          version: 1,
          data: { synthetic: true, history: histories.get(sessionId) ?? [] },
        });
        const append = (sessionId: string, item: HistoryItem) => {
          histories.get(sessionId)!.push(item);
          emit({ type: "timeline.item", sessionId, item });
          emit({ type: "session.persistence", sessionId, persistence: persistence(sessionId) });
        };
        const catalog = {
          models: [{ id: "mock", label: "Synthetic model", thinkingOptions: [{ id: "high", label: "High" }] }],
          modes: [{ id: "safe", label: "Safe" }],
          defaultModel: "mock",
          defaultMode: "safe",
        };
        return {
          version: 1,
          capabilities,
          onEvent(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          async close() {
            listeners.clear();
          },
          async send(input: ProviderInput) {
            if (input.type === "catalog") {
              emit({ type: "catalog", requestId: input.requestId, catalog });
              return;
            }
            if (input.type === "session.open") {
              if (id === "fm-test-target" && existsSync(join(process.env.PASEO_HOME!, "fail-target-open"))) {
                emit({
                  type: "request.failed",
                  requestId: input.requestId,
                  error: { message: "Synthetic creation failure" },
                });
                return;
              }
              const data = input.persistence?.data;
              // This fixture stores its own transcript so a real daemon restart can replay it.
              const history =
                data !== null && typeof data === "object" && !Array.isArray(data) && Array.isArray(data?.history)
                  ? (data.history as HistoryItem[])
                  : [];
              histories.set(input.sessionId, history);
              emit({
                type: "session.opened",
                requestId: input.requestId,
                sessionId: input.sessionId,
                capabilities,
                restoration: "core",
                cwd: input.config.cwd,
                // Paseo sanitizes empty metadata objects away when persisting the handle.
                persistence: persistence(input.sessionId),
              });
              emit({
                type: "session.config",
                sessionId: input.sessionId,
                config: {
                  model: "mock",
                  mode: input.config.mode ?? "safe",
                  thinkingOption: input.config.thinkingOption ?? "high",
                  models: catalog.models,
                  modes: catalog.modes,
                  thinkingOptions: [{ id: "high", label: "High" }],
                  settings: [],
                },
              });
              if (input.history === "replay")
                for (const item of history) emit({ type: "timeline.item", sessionId: input.sessionId, item });
              emit({ type: "session.ready", requestId: input.requestId, sessionId: input.sessionId });
              return;
            }
            if (input.type === "session.prompt") {
              const turnId = randomUUID();
              emit({
                type: "session.prompt_result",
                sessionId: input.sessionId,
                clientMessageId: input.prompt.clientMessageId,
                result: { type: "turn", turnId },
              });
              emit({ type: "session.turn", sessionId: input.sessionId, turnId, state: "started" });
              const text =
                input.prompt.input.type === "message"
                  ? input.prompt.input.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
                  : `/${input.prompt.input.name} ${input.prompt.input.arguments}`;
              append(input.sessionId, {
                id: randomUUID(),
                type: "user_message",
                text,
                clientMessageId: input.prompt.clientMessageId,
              });
              if (
                input.prompt.input.type === "message" &&
                input.prompt.input.content.some((part) => part.type === "text" && part.text === "Hold synthetic turn")
              ) {
                heldTurns.set(input.sessionId, turnId);
                return;
              }
              setTimeout(() => {
                append(input.sessionId, {
                  id: randomUUID(),
                  type: "assistant_message",
                  text: "Synthetic reply. done: mock complete",
                });
                emit({ type: "session.turn", sessionId: input.sessionId, turnId, state: "completed" });
              }, 250);
              return;
            }
            if (input.type === "session.interrupt" || input.type === "session.close") {
              const turnId = heldTurns.get(input.sessionId);
              if (turnId !== undefined) {
                emit({ type: "session.turn", sessionId: input.sessionId, turnId, state: "canceled" });
                heldTurns.delete(input.sessionId);
              }
            }
            if ("requestId" in input) emit({ type: "request.completed", requestId: input.requestId });
          },
        };
      },
    });
  return () => {};
}
