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
import type { NeedsYouSnapshot } from "../shared/needs-you";

export function registerNeedsYouRpc(
  server: Pick<PluginServerContext, "handle">,
  service: NeedsYouService,
  decoratePlans: (snapshot: NeedsYouSnapshot) => Promise<NeedsYouSnapshot> = async snapshot => snapshot,
) {
  const decorate = async (snapshot: NeedsYouSnapshot): Promise<NeedsYouSnapshot> => {
    try { return await decoratePlans(snapshot); }
    catch { return { ...snapshot, planProblems: ["Workflow plans unavailable. Existing captain decisions remain available; the total is incomplete."] }; }
  };
  server.handle(readNeedsYou, () => service.read().then(decorate));
  server.handle(markNeedsYouSeen, (input) =>
    service.mutate(input, { kind: "seen" }).then(decorate),
  );
  server.handle(markNeedsYouNew, (input) => service.mutate(input, { kind: "new" }).then(decorate));
  server.handle(snoozeNeedsYou, (input) =>
    service.mutate(input, { kind: "snooze", until: input.until }).then(decorate),
  );
  server.handle(unsnoozeNeedsYou, (input) =>
    service.mutate(input, { kind: "unsnooze" }).then(decorate),
  );
  server.handle(recordNeedsYouAnswer, (input) =>
    service.mutate(input, {
      kind: "answer",
      submissionId: input.submissionId,
      outcome: input.outcome,
    }).then(decorate),
  );
}
