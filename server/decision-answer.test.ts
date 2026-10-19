import { mkdir, mkdtemp, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { answerDecision } from "./decision-answer";
import {
  NeedsYouService,
  readConfiguredDecisionHome,
} from "./needs-you-service";
import { updateFirstmateConfig } from "./config";
import type { PaseoApi } from "./host-types";
import type { SubmitDecisionAnswer } from "../shared/needs-you";
import { parseSuggestions, withoutSuggestion } from "./suggestions";

let home: string,
  root: string,
  now: number,
  service: NeedsYouService,
  input: SubmitDecisionAnswer;
let fail: "before" | "after" | null, recipient: string[];
const send = vi.fn();
const api = {
  agents: {
    ref: (id: string) => ({
      refresh: async () => {
        if (fail === "before") throw new Error("daemon offline");
        return { agent: { id, status: "idle", archivedAt: null } };
      },
      send: async (...args: unknown[]) => {
        recipient.push(id);
        send(...args);
        if (fail === "after") throw new Error("response lost after acceptance");
      },
    }),
  },
} as unknown as PaseoApi;
const backlog = (ask = "Choose a direction?") =>
  `# Backlog\n## In flight\n- [ ] task - Worker task (hold: ${ask}) (agent: worker-id)\n## Queued\n## Done\n`;
async function settle(instance = service) {
  await instance.read();
  now += 2000;
  return instance.read();
}
beforeEach(async () => {
  const scratch = await mkdtemp(join(process.env.PASEO_HOME!, "answer-"));
  home = join(scratch, "home");
  root = join(scratch, "ledger");
  now = 1000;
  fail = null;
  recipient = [];
  send.mockReset();
  await mkdir(join(home, "data"), { recursive: true });
  await writeFile(join(home, "data", "backlog.md"), backlog());
  await writeFile(
    join(home, "data", "suggestions.md"),
    "- General :: General action\n",
  );
  await updateFirstmateConfig({
    home,
    mateAgentId: "",
    migration: null,
    mateLaunch: null,
  });
  await updateFirstmateConfig({ mateAgentId: "mate-current" });
  service = new NeedsYouService({
    root,
    home: readConfiguredDecisionHome,
    catalog: async () => null,
    enabled: () => true,
    now: () => now,
  });
  const snapshot = await settle();
  input = {
    homeId: snapshot.homeId!,
    requestId: snapshot.requests[0]!.id,
    recordRevision: snapshot.requests[0]!.revision,
    submissionId: "submission-1",
    text: "Use the cautious option.",
  };
});
afterEach(async () => {
  await service?.stop();
});

it("uses the existing mate send with an exact envelope, not a worker, and leaves source bytes alone", async () => {
  const before = await readFile(join(home, "data", "backlog.md"), "utf8");
  const result = await answerDecision(api, service, input);
  expect(result.outcome).toBe("accepted");
  expect(result.snapshot.actionCount).toBe(0);
  expect(result.snapshot.pendingAnswerCount).toBe(1);
  expect(recipient).toEqual(["mate-current"]);
  expect(send.mock.calls[0]![0]).toContain(input.text);
  expect(send.mock.calls[0]![0]).toContain(input.requestId);
  expect(send.mock.calls[0]![0]).toContain("not to a verified PR head");
  expect(send.mock.calls[0]![1]).toMatchObject({
    activeTurnBehavior: "steer",
    messageId: "firstmate-answer-submission-1",
  });
  expect(await readFile(join(home, "data", "backlog.md"), "utf8")).toBe(before);
});
it("does not send or acknowledge on read and resolves a changed mate just before delivery", async () => {
  await service.read();
  expect(send).not.toHaveBeenCalled();
  await updateFirstmateConfig({ mateAgentId: "mate-replacement" });
  await answerDecision(api, service, input);
  expect(recipient).toEqual(["mate-replacement"]);
});
it("deduplicates concurrent clicks, another service and a restart", async () => {
  const results = await Promise.all([
    answerDecision(api, service, input),
    answerDecision(api, service, input),
  ]);
  expect(results.map((r) => r.outcome)).toEqual(["accepted", "accepted"]);
  await service.stop();
  service = new NeedsYouService({
    root,
    home: readConfiguredDecisionHome,
    catalog: async () => null,
    enabled: () => true,
    now: () => now,
  });
  expect((await answerDecision(api, service, input)).outcome).toBe("accepted");
  expect(send).toHaveBeenCalledTimes(1);
  await expect(
    answerDecision(api, service, { ...input, text: "Different answer" }),
  ).rejects.toThrow("another answer");
});
it("preserves uncertainty after an accepted send loses its response and never replays it", async () => {
  fail = "after";
  const result = await answerDecision(api, service, input);
  expect(result).toMatchObject({
    outcome: "uncertain",
    snapshot: { pendingAnswerCount: 1, actionCount: 0 },
  });
  fail = null;
  await service.stop();
  service = new NeedsYouService({
    root,
    home: readConfiguredDecisionHome,
    catalog: async () => null,
    enabled: () => true,
    now: () => now,
  });
  expect((await answerDecision(api, service, input)).outcome).toBe("uncertain");
  await expect(
    answerDecision(api, service, { ...input, submissionId: "second" }),
  ).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(1);
});
it.each(["offline", "absent"])(
  "allows an explicit retry after definite %s pre-delivery refusal",
  async (kind) => {
    if (kind === "offline") fail = "before";
    else await updateFirstmateConfig({ mateAgentId: "" });
    await expect(answerDecision(api, service, input)).rejects.toThrow();
    expect((await service.read()).pendingAnswerCount).toBe(0);
    expect(send).not.toHaveBeenCalled();
    fail = null;
    await updateFirstmateConfig({ mateAgentId: "mate-current" });
    expect((await answerDecision(api, service, input)).outcome).toBe(
      "accepted",
    );
  },
);
it.each(["revision", "home", "source"])(
  "rejects a changed %s before sending",
  async (kind) => {
    if (kind === "revision") {
      await writeFile(
        join(home, "data", "backlog.md"),
        backlog("An updated question?"),
      );
      await settle();
    }
    if (kind === "home") input.homeId = "another-home";
    if (kind === "source")
      await rename(
        join(home, "data", "backlog.md"),
        join(home, "data", "missing.md"),
      );
    await expect(answerDecision(api, service, input)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  },
);
it("reserves before sending so a crash at delivery keeps the uncertain submission durable", async () => {
  send.mockImplementation(() => {
    throw new Error("simulated crash after reservation");
  });
  expect((await answerDecision(api, service, input)).outcome).toBe("uncertain");
  expect((await service.read()).requests[0]!.submissions[0]).toMatchObject({
    submissionId: input.submissionId,
    outcome: "uncertain",
  });
});
function binding() {
  return {
    homeId: input.homeId,
    requestId: input.requestId,
    recordRevision: input.recordRevision,
    actionId: "cautious",
  };
}
function optionLine(prompt = input.text, bound = binding()) {
  return `- Cautious [decision: ${JSON.stringify(bound)}] :: ${prompt}\n`;
}
it("parses bindings backwards compatibly and removal matches the binding too", () => {
  const file = `- Cautious :: ${input.text}\n${optionLine()}`;
  const suggestions = parseSuggestions(file);
  expect(suggestions).toEqual([
    { label: "Cautious", prompt: input.text },
    { label: "Cautious", prompt: input.text, decision: binding() },
  ]);
  expect(withoutSuggestion(file, suggestions[1]!)).toBe(
    `- Cautious :: ${input.text}\n`,
  );
  expect(parseSuggestions("- Bad [decision: {broken}] :: act")).toEqual([]);
});
it("revalidates an explicitly bound answer and sends its current prompt", async () => {
  await writeFile(join(home, "data", "suggestions.md"), optionLine());
  const result = await answerDecision(api, service, {
    ...input,
    suggestion: { actionId: "cautious", label: "Cautious" },
  });
  expect(result.outcome).toBe("accepted");
  expect(send).toHaveBeenCalledTimes(1);
});
it.each(["unbound", "revised", "changed", "duplicate", "removed"])(
  "refuses a %s one-press option",
  async (kind) => {
    const line =
      kind === "unbound"
        ? `- Cautious :: ${input.text}`
        : kind === "revised"
          ? optionLine(input.text, { ...binding(), recordRevision: 2 })
          : kind === "changed"
            ? optionLine("Different words")
            : kind === "duplicate"
              ? optionLine() + optionLine()
              : "";
    await writeFile(join(home, "data", "suggestions.md"), line);
    await expect(
      answerDecision(api, service, {
        ...input,
        suggestion: { actionId: "cautious", label: "Cautious" },
      }),
    ).rejects.toThrow("option changed");
    expect(send).not.toHaveBeenCalled();
    expect((await service.read()).actionCount).toBe(1);
  },
);

it("binds a task prefix on read, sends the exact prompt only on press, and deduplicates a retry", async () => {
  const prompt = "For task: Use the cautious option, exactly as drafted.";
  await writeFile(join(home, "data", "suggestions.md"), `- Cautious :: ${prompt}\n`);
  const option = (await service.read()).answerOptions![0]!;
  expect(option).toMatchObject({ label: "Cautious", prompt, decision: {
    homeId: input.homeId, requestId: input.requestId, recordRevision: input.recordRevision,
  } });
  expect(send).not.toHaveBeenCalled();
  const answer = { ...input, text: option.prompt, suggestion: { actionId: option.decision.actionId, label: option.label } };
  expect((await answerDecision(api, service, answer)).outcome).toBe("accepted");
  expect(send.mock.calls[0]![0]).toContain(prompt);
  expect((await answerDecision(api, service, answer)).outcome).toBe("accepted");
  expect(send).toHaveBeenCalledTimes(1);
  expect((await service.read()).answerOptions).toEqual([]);
});

it.each(["prompt", "label", "removed", "hold", "ambiguous", "duplicate", "quarantined", "ambiguous-quarantine"])(
  "rejects a task-prefixed option when its %s changed before the press",
  async kind => {
    const prompt = "For task: Use the cautious option.";
    const line = `- Cautious :: ${prompt}\n`;
    await writeFile(join(home, "data", "suggestions.md"), line);
    const option = (await service.read()).answerOptions![0]!;
    if (kind === "hold") { await writeFile(join(home, "data", "backlog.md"), backlog("Choose another direction?")); await settle(); }
    else if (kind === "ambiguous") {
      await writeFile(join(home, "data", "backlog.md"), backlog().replace("## Queued", "- [ ] task - Another task (project: elsewhere) (hold: Another call)\n## Queued"));
      await settle();
    } else if (kind === "ambiguous-quarantine") {
      await writeFile(join(home, "data", "backlog.md"), backlog().replace("## Queued", "- [ ] task - Another task (project: elsewhere) (hold: Choose (A)?)\n## Queued"));
      await settle();
    } else if (kind === "quarantined") {
      await writeFile(join(home, "data", "backlog.md"), backlog().replace("(agent: worker-id)", "(hold: duplicate)"));
      await settle();
    } else await writeFile(join(home, "data", "suggestions.md"), kind === "prompt" ? line.replace("cautious", "different") :
      kind === "label" ? line.replace("Cautious", "Changed label") : kind === "duplicate" ? line + line : "");
    await expect(answerDecision(api, service, { ...input, text: option.prompt,
      suggestion: { actionId: option.decision.actionId, label: option.label } })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  },
);
