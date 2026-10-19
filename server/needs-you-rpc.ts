import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  markNeedsYouSeen,
  markNeedsYouNew,
  readNeedsYou,
  recordNeedsYouAnswer,
  snoozeNeedsYou,
  unsnoozeNeedsYou,
} from "../shared/needs-you";
import type { NeedsYouService } from "./needs-you-service";

export function registerNeedsYouRpc(
  server: Pick<PluginServerContext, "handle">,
  service: NeedsYouService,
) {
  server.handle(readNeedsYou, () => service.read());
  server.handle(markNeedsYouSeen, (input) =>
    service.mutate(input, { kind: "seen" }),
  );
  server.handle(markNeedsYouNew, (input) => service.mutate(input, { kind: "new" }));
  server.handle(snoozeNeedsYou, (input) =>
    service.mutate(input, { kind: "snooze", until: input.until }),
  );
  server.handle(unsnoozeNeedsYou, (input) =>
    service.mutate(input, { kind: "unsnooze" }),
  );
  server.handle(recordNeedsYouAnswer, (input) =>
    service.mutate(input, {
      kind: "answer",
      submissionId: input.submissionId,
      outcome: input.outcome,
    }),
  );
}
