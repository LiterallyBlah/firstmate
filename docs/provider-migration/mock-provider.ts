/** Installed only by daemon-check.mjs in its temporary home. No network, credentials or real agents. */
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { ProviderEvent, ProviderInput } from "@getpaseo/plugin/server/provider";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

export default function contribute(server: PluginServerContext) {
  for (const id of ["fm-test-source", "fm-test-target"])
    server.registerProvider({
      id,
      label: id,
      status: async () => ({ available: true }),
      async connect() {
        const listeners = new Set<(event: ProviderEvent) => void>();
        const capabilities = ["prompt.message", "session.archive", "session.persistence"];
        const emit = (event: ProviderEvent) => listeners.forEach((listener) => listener(event));
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
              emit({
                type: "session.opened",
                requestId: input.requestId,
                sessionId: input.sessionId,
                capabilities,
                restoration: "core",
                cwd: input.config.cwd,
                persistence: { version: 1, data: {} },
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
              setTimeout(() => {
                emit({
                  type: "timeline.item",
                  sessionId: input.sessionId,
                  item: { id: randomUUID(), type: "assistant_message", text: "Synthetic reply. done: mock complete" },
                });
                emit({ type: "session.turn", sessionId: input.sessionId, turnId, state: "completed" });
              }, 250);
              return;
            }
            if ("requestId" in input) emit({ type: "request.completed", requestId: input.requestId });
          },
        };
      },
    });
  return () => {};
}
