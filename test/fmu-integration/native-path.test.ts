import { randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { fixture } from "../fmu-review-runtime-fixture";
import { attentionTheme as theme } from "../attention-deck-fixture";
import { WatchSupervisors } from "../../server/watch-supervisors";
import { startWatches } from "../../server/watch-service";
import { updateFirstmateConfig, readFirstmateConfig } from "../../server/config";
import { listWatches } from "../../server/watch-files";
import { runWatchScript } from "../../server/watch-run";
import { ruleRef } from "../../server/plan-rules";
import { summarizeSupervisorCost } from "../../server/supervision-metrics";
import { oneAtATime } from "../../server/mate";
import type { WatchFact } from "../../shared/watch-routing";
import { captureAssignment } from "./browser";
const ui = vi.hoisted(() => ({ call: null as any }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: (rpc: any) => (input: any) => ui.call(rpc, input) }));
vi.mock("react-native", () => ({ Pressable: "Pressable", Text: "Text", View: "View" }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Modal: Object.assign(({ children }: { children: ReactNode }) => children, { Content: "Content" }) }));
vi.mock("../../client/workflow-plans", () => ({ workflowRequestId: () => randomUUID() }));
vi.mock("../../server/watch-run", () => ({ runWatchScript: vi.fn() }));
import { WatchSupervisorButton } from "../../client/watch-supervisors";

for (const [color, width, entry] of [["light", 1440, "home"], ["dark", 1440, "plan"], ["light", 390, "watch"], ["dark", 390, "watch"]] as const) {
  it(`A1/A5/A6/A9/A11: ${color} ${width} ${entry} native control -> registered app RPC -> script ingress -> owned effect`, async () => {
    const f = await fixture(true), scope = f.scopes[0]!, cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let tree: ReactTestRenderer | undefined, release!: () => void, entered!: () => void;
    const ready = new Promise<void>(r => { entered = r; }), general = oneAtATime(async () => { entered(); await new Promise<void>(r => { release = r; }); }); await ready;
    const watches = startWatches({ on: () => () => {} } as never, readFirstmateConfig, async () => ({ cards: [] }), { observe: fact => f.service.watch(fact) });
    watches.remember(f.api);
    const name = `checks-${randomUUID()}`;
    const handlers = new Map<string, { rpc: any; run: any }>();
    new WatchSupervisors(f.runtime, watches).register({ handle: (rpc: any, run: any) => handlers.set(rpc.name, { rpc, run }) } as never);
    const call = async (name: string, input: unknown) => { const h = handlers.get(name)!; return h.rpc.output.parse(await h.run(h.rpc.input.parse(input))); };
    ui.call = (rpc: any, input: unknown) => call(rpc.name, input);
    try {
      await updateFirstmateConfig({ mateAgentId: "" }); await updateFirstmateConfig({ home: f.home }); await updateFirstmateConfig({ mateAgentId: "general" });
      await mkdir(join(f.home, "watches"), { recursive: true }); const file = join(f.home, "watches", name);
      await writeFile(file, "#!/usr/bin/env node\n// schedule: * * * * *\n"); await chmod(file, 0o755);
      const start = await f.queue(scope, "plan", { ...await f.input(scope, { op: "start", plan: scope.planId, node: scope.nodes[0]! }), planRules: ruleRef(f.records[0]!) });
      await f.service.tick(); expect(await f.result(start)).toMatchObject({ ok: true });
      const before = await f.store.read(), snapshot: any = await call("firstmate.watch.supervisors.read", {}), target = snapshot.targets.find((t: any) => t.name === name);
      expect((await f.store.read()).sequence).toBe(before.sequence);
      const callsBefore = f.receiver.calls.length;
      if (process.env.FMU_INTEGRATION_CAPTURE === "1") await captureAssignment(call, target, color, width, entry);
      else {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        await act(async () => { tree = create(createElement(QueryClientProvider, { client: cache }, createElement(WatchSupervisorButton, { theme, ...(entry === "watch" ? { name } : entry === "plan" ? { planId: scope.planId } : {}) }))); });
        const button = (label: string) => tree!.root.find(n => n.type === "Pressable" as never && n.props.accessibilityLabel === label);
        await act(async () => button(entry === "watch" ? `Supervisor for ${name}` : "Assign watch inputs").props.onPress());
        await vi.waitFor(async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); expect(button(`Review ${name} to ${scope.planId} · ${target.taskId}`)).toBeDefined(); });
        await act(async () => button(`Review ${name} to ${scope.planId} · ${target.taskId}`).props.onPress());
        await act(async () => button("Prepare reviewed watch assignment").props.onPress());
        await vi.waitFor(async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); expect(button(`Commit exact route for ${name}`)).toBeDefined(); });
        await act(async () => button(`Commit exact route for ${name}`).props.onPress());
        await vi.waitFor(async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); expect(button(`Unassign future watch inputs for ${name}`)).toBeDefined(); });
      }
      expect(f.receiver.calls).toHaveLength(callsBefore); // Assignment never creates or sends.
      await act(async () => tree?.unmount()); tree = undefined;
      // Fixture initialization delivered the plan's existing continuation; it is a busy owner,
      // so delivery correctly waits. Complete that synthetic turn before testing fresh ingress.
      expect(f.receiver.agents.get(scope.owner.id)!.status).toBe("running");
      f.receiver.finish(scope.owner.id);
      const script = (await listWatches(f.home)).find(w => w.name === name)!;
      let fact: WatchFact = { format: "firstmate.watch-fact/1", watch: name, definitionDigest: target.definitionDigest,
        subject: "build-checks", state: "healthy", evidence: "Checked synthetic build evidence", observedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 3600000).toISOString(),
        deadline: null, coverage: "complete", policyDigest: target.policyDigest, unknownEffects: false };
      vi.mocked(runWatchScript).mockImplementation(async () => ({ code: 0, stdout: JSON.stringify(fact), stderr: "", truncated: false, timedOut: false, spawnError: null }));
      const quiet = summarizeSupervisorCost(await f.store.read(), [], { sessions: 0, turns: 0 });
      for (let n = 0; n < 100; n++) await watches.runner.runOne(f.home, script);
      expect(summarizeSupervisorCost(await f.store.read(), [], { sessions: 0, turns: 0 }).totalTurns).toBe(quiet.totalTurns);
      fact = { ...fact, state: "failed", evidence: "New exact failed build check" };
      const sends = f.receiver.sends.length; await watches.runner.runOne(f.home, script);
      expect(f.receiver.sends.slice(sends)).toEqual([expect.objectContaining({ agentId: scope.owner.id })]);
      expect(f.receiver.sends.every(s => s.agentId !== "general")).toBe(true);
      expect((await watches.runner.queued())).toEqual([]);
      const after = await f.store.read();
      expect(after.inbox.events.filter(e => e.envelope.subject.watch === name)).toHaveLength(2);
      expect(after.effects.filter(e => e.attemptId !== null).map(e => e.operation).sort()).toEqual(["agent.create", "agent.send", "workspace.open"]);
      expect(new Set(after.effects.map(e => e.logicalKey)).size).toBe(after.effects.length);
    } finally {
      release(); await general; await act(async () => tree?.unmount()); cache.clear(); watches.stop(); await f.service.stop(); await f.runtime.stop(); vi.restoreAllMocks();
    }
  }, 120000);
}
