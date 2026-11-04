import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, it } from "vitest";
import { workflowFixture } from "../test/workflow-fixture";
import { PlanDefinitionSchema, decisionOwner, planMode, planOwner, type PlanDefinition, type PlanNode, type WorkflowPlan } from "../shared/workflow-plans";
import { workflowStore } from "./workflow-service";
import { planSubjectHash } from "./workflow-plans";

let home: string;
const originalHome = process.env.PASEO_HOME!;
beforeEach(async () => {
  process.env.PASEO_HOME = join(originalHome, randomUUID());
  home = join(process.env.PASEO_HOME, "home");
  for (const id of ["trial", "build", "release", "setup"]) {
    await mkdir(join(home, "data", id), { recursive: true });
    await writeFile(join(home, "data", id, "brief.md"), `Brief for ${id}`);
  }
  await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n## Done\n");
});
const store = () => workflowStore(home);
const CRITERION = "Cancel-and-continue rather than Resume";
const WORDS = `Captain: you own Ariadne's chapter loop. Bring me in on pivotal points: ${CRITERION}.`;

/** A release run behind its release decision, plus an installation run behind its own. */
function liveFixture(ownership?: PlanDefinition["ownership"], extra: PlanNode[] = []): PlanDefinition {
  const base = workflowFixture(), build = base.nodes.find(n => n.id === "build")!;
  if (build.kind !== "run") throw new Error("fixture");
  const run = (id: string, effect: "release" | "installation", gate: string) => ({ ...structuredClone(build), id, title: id, effect,
    launch: { ...structuredClone(build.launch), id, title: id, agentTitle: id, brief: { file: `data/${id}/brief.md` } },
    after: [{ node: gate, reason: "decision" as const, on: "answered" as const }] });
  const gate = (id: string, effect: "release" | "installation") => ({ kind: "decision" as const, id, title: `Approve ${effect}`, summary: `${effect} gate`, effect, after: [],
    options: [{ id: "go", label: "Go", consequence: "Proceed." }, { id: "stop", label: "Stop", consequence: "Do not proceed." }], recommendation: "go", rationale: "Evidence is ready." });
  return PlanDefinitionSchema.parse({ format: "firstmate.plan/1", id: "live", title: "Live loop", request: { text: "Release the chapter, then install the helper.", at: "2026-11-04T12:00:00Z" },
    budget: { agents: 4, turns: 4 }, ...(ownership ? { ownership } : {}),
    nodes: [gate("go-live", "release"), run("release", "release", "go-live"), gate("allow-setup", "installation"), run("setup", "installation", "allow-setup"), ...extra] });
}
async function current(id = "live"): Promise<WorkflowPlan> { return (await store().get(id))!; }
const node = (plan: WorkflowPlan, id: string) => plan.definition.nodes.find(n => n.id === id)!;
async function transfer(fields: { mode?: "firstmate" | "firstmate-pivotal" | "captain"; owner?: "firstmate" | "captain"; escalate?: string[]; liveSteps?: "pivotal" | "routine" }, text: string, by = "board:captain") {
  const p = await current();
  return store().execute({ op: "captain", plan: "live", revision: p.revision, subjectHash: planSubjectHash(p), action: "transfer", text, ...fields }, randomUUID(), by);
}
async function mateAnswer(decision: string) {
  const p = await current();
  return store().execute({ op: "progress", plan: "live", revision: p.revision, subjectHash: planSubjectHash(p), action: "answer", node: decision, option: "go", evidence: "Evidence verified" }, randomUUID(), "mate-v1");
}
async function captainAnswer(decision: string) {
  const p = await current();
  return store().execute({ op: "captain", plan: "live", revision: p.revision, subjectHash: planSubjectHash(p), action: "answer", node: decision, option: "go", text: "" }, randomUUID(), "board:captain");
}
async function approve() {
  const p = await current();
  return store().execute({ op: "captain", plan: "live", revision: p.revision, subjectHash: planSubjectHash(p), action: "approve", text: "" }, randomUUID(), "board:captain");
}
const start = (id: string) => store().execute({ op: "start", plan: "live", node: id }, randomUUID(), "mate-v1");

it("keeps existing plans' defaults: no ownership is captain mode, a recorded delegation is firstmate mode", async () => {
  await store().execute({ op: "draft", definition: workflowFixture() }, randomUUID(), "mate-v1");
  const legacy = (await store().get("scheduler"))!;
  expect(planMode(legacy)).toBe("captain");
  expect(decisionOwner(legacy, node(legacy, "database"))).toBe("captain");
});

it("keeps a delegation recorded before modes existed as firstmate mode", async () => {
  const delegated = workflowFixture(); delegated.ownership = { owner: "firstmate", evidence: "Captain: own this." };
  await store().execute({ op: "draft", definition: delegated }, randomUUID(), "mate-v1");
  const plan = (await store().get("scheduler"))!;
  expect(planMode(plan)).toBe("firstmate");
  expect(plan.mode).toBeUndefined();
  expect(decisionOwner(plan, node(plan, "database"))).toBe("firstmate");
});

it("firstmate mode: FirstMate answers live gates and starts the release; installation still waits for the captain", async () => {
  await store().execute({ op: "draft", definition: liveFixture({ owner: "firstmate", mode: "firstmate", evidence: "Captain: you own the chapter loop, release included." }) }, randomUUID(), "mate-v1");
  const plan = await current();
  expect(plan.status).toBe("active");
  expect(decisionOwner(plan, node(plan, "go-live"))).toBe("firstmate");
  expect(decisionOwner(plan, node(plan, "allow-setup"))).toBe("captain");
  await expect(start("release")).rejects.toThrow("release");
  await expect(captainAnswer("go-live")).rejects.toThrow("belongs to FirstMate");
  await mateAnswer("go-live");
  expect((await current()).nodes["go-live"]?.answer).toBe("go");
  const started: any = await start("release");
  expect(started.launch.workflow.attempt).toBeTruthy();
  await expect(mateAnswer("allow-setup")).rejects.toThrow("belongs to the captain");
  await expect(start("setup")).rejects.toThrow();
  await captainAnswer("allow-setup");
  expect((await current()).nodes["allow-setup"]?.answer).toBe("go");
});

it("captain mode: every decision, live steps included, goes to the captain", async () => {
  await store().execute({ op: "draft", definition: liveFixture() }, randomUUID(), "mate-v1");
  let plan = await current();
  expect(planMode(plan)).toBe("captain");
  for (const id of ["go-live", "allow-setup"]) expect(decisionOwner(plan, node(plan, id))).toBe("captain");
  await approve();
  await expect(mateAnswer("go-live")).rejects.toThrow("captain owns");
  await captainAnswer("go-live");
  plan = await current();
  expect(plan.nodes["go-live"]?.answer).toBe("go");
  expect(((await start("release")) as any).launch.workflow.attempt).toBeTruthy();
});

it("firstmate-pivotal mode: live steps are pivotal by default, escalated points quote the captain's criteria, reserved effects stay captain", async () => {
  const escalated: PlanNode = { kind: "decision", id: "continue", title: "Resume or cancel-and-continue", summary: "Choose how to continue the chapter.", authority: "captain", criterion: CRITERION,
    after: [], options: [{ id: "go", label: "Resume", consequence: "Resume the paused job." }, { id: "stop", label: "Cancel and continue", consequence: "Start the next chapter." }], recommendation: "go", rationale: `Pivotal: ${CRITERION}.` };
  const releaseAfterContinue = (definition: PlanDefinition) => {
    const release = definition.nodes.find(n => n.id === "release")!; release.after.push({ node: "continue", reason: "decision", on: "answered" }); return definition;
  };
  const unquoted = releaseAfterContinue(liveFixture({ owner: "firstmate", mode: "firstmate-pivotal", evidence: "Captain: you own it.", escalate: [CRITERION] }, [escalated]));
  await expect(store().execute({ op: "draft", definition: unquoted }, randomUUID(), "mate-v1")).rejects.toThrow("captain's recorded words");
  const invented = releaseAfterContinue(liveFixture({ owner: "firstmate", mode: "firstmate-pivotal", evidence: WORDS, escalate: [CRITERION] }, [{ ...escalated, criterion: "Anything FirstMate finds risky" }]));
  await expect(store().execute({ op: "draft", definition: invented }, randomUUID(), "mate-v1")).rejects.toThrow("pivotal criteria exactly");
  await expect(store().execute({ op: "draft", definition: liveFixture({ owner: "captain", mode: "firstmate-pivotal", evidence: WORDS }) }, randomUUID(), "mate-v1")).rejects.toThrow("disagrees");
  await store().execute({ op: "draft", definition: releaseAfterContinue(liveFixture({ owner: "firstmate", mode: "firstmate-pivotal", evidence: WORDS, escalate: [CRITERION] }, [escalated])) }, randomUUID(), "mate-v1");
  const plan = await current();
  expect(planOwner(plan)).toBe("firstmate");
  expect(decisionOwner(plan, node(plan, "go-live"))).toBe("captain");
  expect(decisionOwner(plan, node(plan, "continue"))).toBe("captain");
  expect(decisionOwner(plan, node(plan, "allow-setup"))).toBe("captain");
  await expect(mateAnswer("go-live")).rejects.toThrow("belongs to the captain");
  await expect(mateAnswer("continue")).rejects.toThrow("belongs to the captain");
  expect(await readFile(join(home, "data/plans/live/plan.md"), "utf8")).toContain(`pivotal points go to the Captain, including live steps: ${CRITERION}`);
  // The captain's recorded criteria can make live steps routine; installation never is.
  await transfer({ mode: "firstmate-pivotal", liveSteps: "routine" }, "Captain: releases are routine for this loop.");
  const routine = await current();
  expect(decisionOwner(routine, node(routine, "go-live"))).toBe("firstmate");
  expect(decisionOwner(routine, node(routine, "continue"))).toBe("captain");
  expect(decisionOwner(routine, node(routine, "allow-setup"))).toBe("captain");
  await mateAnswer("go-live");
});

it("switches between all three modes only through recorded transfers, which survive a restart and change who answers live steps", async () => {
  await store().execute({ op: "draft", definition: liveFixture({ owner: "firstmate", mode: "firstmate", evidence: "Captain: you own it." }) }, randomUUID(), "mate-v1");
  await expect(transfer({ mode: "firstmate" }, "Captain: still yours.")).rejects.toThrow("different owner");
  await expect(transfer({ mode: "firstmate-pivotal", escalate: [CRITERION] }, "Captain: bring me in on releases.")).rejects.toThrow("own words");
  await expect(transfer({ mode: "captain", escalate: [CRITERION] }, WORDS)).rejects.toThrow("firstmate-pivotal");
  await expect(transfer({ mode: "firstmate-pivotal", owner: "captain" }, WORDS)).rejects.toThrow("disagrees");
  await expect(transfer({ mode: "captain" }, "  ")).rejects.toThrow();
  await transfer({ mode: "firstmate-pivotal", escalate: [CRITERION] }, WORDS, "mate-v1"); // FirstMate recording the captain's chat words.
  let plan = await current();
  expect(planMode(plan)).toBe("firstmate-pivotal");
  expect(plan.status).toBe("active");
  expect(plan.ownerEvents?.at(-1)).toMatchObject({ by: "mate-v1", from: "firstmate", to: "firstmate", fromMode: "firstmate", toMode: "firstmate-pivotal", escalate: [CRITERION], evidence: WORDS });
  expect(decisionOwner(plan, node(plan, "go-live"))).toBe("captain");
  // Changing only the criteria is a recorded switch too.
  await transfer({ mode: "firstmate-pivotal", escalate: [CRITERION, "any allowance change"] }, `${WORDS} Also any allowance change.`);
  expect((await current()).escalate).toEqual([CRITERION, "any allowance change"]);
  await transfer({ mode: "captain" }, "Captain: I own this now.");
  plan = await current();
  expect([planMode(plan), planOwner(plan), plan.status]).toEqual(["captain", "captain", "review"]);
  expect(decisionOwner(plan, node(plan, "go-live"))).toBe("captain");
  await transfer({ mode: "firstmate" }, "Captain: back to you, all of it.");
  plan = await current();
  expect([planMode(plan), plan.status]).toEqual(["firstmate", "active"]);
  expect(decisionOwner(plan, node(plan, "go-live"))).toBe("firstmate");
  expect(decisionOwner(plan, node(plan, "allow-setup"))).toBe("captain");
  // A fresh store replays the same projection from the log.
  const replayed = (await workflowStore(home).get("live"))!;
  expect(planMode(replayed)).toBe("firstmate");
  expect(replayed.escalate).toEqual([CRITERION, "any allowance change"]);
  expect(replayed.ownerEvents?.map(e => e.toMode)).toEqual(["firstmate-pivotal", "firstmate-pivotal", "captain", "firstmate"]);
  expect(replayed.definition.ownership).toEqual({ owner: "firstmate", mode: "firstmate", evidence: "Captain: you own it." });
  const text = await readFile(join(home, "data/plans/live/plan.md"), "utf8");
  expect(text).toContain("FirstMate (routine plan progression)");
  expect(text).toContain("Captain: back to you, all of it.");
});

it("a revision never rewrites the mode or criteria, nor drops a live gate, and live steps need their gate", async () => {
  const ungated = liveFixture(); const release = ungated.nodes.find(n => n.id === "release")!; release.after = [];
  await expect(store().execute({ op: "draft", definition: ungated }, randomUUID(), "mate-v1")).rejects.toThrow("needs a release decision");
  await store().execute({ op: "draft", definition: liveFixture({ owner: "firstmate", mode: "firstmate", evidence: "Captain: you own it." }) }, randomUUID(), "mate-v1");
  const plan = await current();
  const rewritten = structuredClone(plan.definition); rewritten.ownership = { owner: "firstmate", mode: "firstmate-pivotal", evidence: "Captain: you own it.", liveSteps: "routine" };
  await expect(store().execute({ op: "revise", definition: rewritten, expected: plan.hash, reason: "Change who decides" }, randomUUID(), "mate-v1")).rejects.toThrow();
  const relaxed = structuredClone(plan.definition), gate = relaxed.nodes.find(n => n.id === "go-live")!;
  if (gate.kind === "decision") delete gate.effect;
  await expect(store().execute({ op: "revise", definition: relaxed, expected: plan.hash, reason: "Make the release gate routine" }, randomUUID(), "mate-v1")).rejects.toThrow("cannot change or remove");
  const detached = structuredClone(plan.definition), run = detached.nodes.find(n => n.id === "release")!;
  if (run.kind === "run") delete run.effect;
  await expect(store().execute({ op: "revise", definition: detached, expected: plan.hash, reason: "Drop the release marker" }, randomUUID(), "mate-v1")).rejects.toThrow();
});

// Regressions from the independent review of PR #197 (probes P1-P8).
const reviewCaptain = async (fields: Record<string, unknown>, text: string, by = "board:captain") => {
  const p = await current();
  return store().execute({ op: "captain", plan: "live", revision: p.revision, subjectHash: planSubjectHash(p), text, ...fields } as never, randomUUID(), by);
};
const stripEffects = (definition: PlanDefinition) => { const stripped = structuredClone(definition); for (const n of stripped.nodes) delete (n as { effect?: string }).effect; return stripped; };

it("P1: every reserved effect stays with the captain and every live effect follows the mode", async () => {
  await store().execute({ op: "draft", definition: liveFixture({ owner: "firstmate", mode: "firstmate", evidence: "Captain: you own it." }) }, randomUUID(), "mate-v1");
  const plan = await current(), gate = (effect: string) => ({ ...node(plan, "go-live"), effect }) as PlanNode;
  const reserved = ["installation", "access", "discard", "spend"], live = ["release", "deploy", "live-action"];
  for (const effect of reserved) expect(decisionOwner(plan, gate(effect)), effect).toBe("captain");
  for (const effect of live) expect(decisionOwner(plan, gate(effect)), effect).toBe("firstmate");
  const pivotal = { ...plan, mode: "firstmate-pivotal" as const }, routine = { ...pivotal, liveSteps: "routine" as const };
  for (const effect of live) { expect(decisionOwner(pivotal, gate(effect)), effect).toBe("captain"); expect(decisionOwner(routine, gate(effect)), effect).toBe("firstmate"); }
  for (const effect of reserved) expect(decisionOwner(routine, gate(effect)), effect).toBe("captain");
  // P2: on an effect gate the effect decides, as the guide says; authority does not override it.
  expect(decisionOwner(plan, { ...node(plan, "go-live"), authority: "captain" } as PlanNode)).toBe("firstmate");
});

it("P3/P8: a revision cannot strip live-step markers or gates, whoever owns the plan and whatever its posture", async () => {
  await store().execute({ op: "draft", definition: liveFixture() }, randomUUID(), "mate-v1");
  await approve();
  let plan = await current();
  await expect(store().execute({ op: "revise", definition: stripEffects(plan.definition), expected: plan.hash, reason: "Drop effect markers" }, randomUUID(), "mate-v1")).rejects.toThrow("live-step, reserved or escalated gate");
  const detached = structuredClone(plan.definition), run = detached.nodes.find(n => n.id === "release")!;
  if (run.kind === "run") delete run.effect;
  await expect(store().execute({ op: "revise", definition: detached, expected: plan.hash, reason: "Drop the release marker" }, randomUUID(), "mate-v1")).rejects.toThrow("marker");
  const reworded = structuredClone(plan.definition), gate = reworded.nodes.find(n => n.id === "go-live")!;
  if (gate.kind === "decision") gate.rationale = "Reworded";
  await expect(store().execute({ op: "revise", definition: reworded, expected: plan.hash, reason: "Reword the gate" }, randomUUID(), "mate-v1")).rejects.toThrow("gate");
  // Ordinary revisions of a captain-owned plan still work.
  const ordinary = structuredClone(plan.definition), setup = ordinary.nodes.find(n => n.id === "setup")!;
  if (setup.kind === "run") setup.summary = "Install the helper, with a recorded rollback.";
  await store().execute({ op: "revise", definition: ordinary, expected: plan.hash, reason: "Clarify setup" }, randomUUID(), "mate-v1");
  // P8: a sailing captain-owned plan, which would not return to review, is held to the same rule.
  const sail = liveFixture(); sail.id = "sail"; sail.request = { ...sail.request, posture: "sail", quote: "Captain: sail, but I decide." };
  for (const n of sail.nodes) { n.id = `${n.id}-s`; if (n.kind === "run") { n.launch.id = n.id; n.launch.brief.file = `data/${n.id}/brief.md`; } n.after = n.after.map(e => ({ ...e, node: `${e.node}-s` })); }
  for (const id of ["release-s", "setup-s"]) { await mkdir(join(home, "data", id), { recursive: true }); await writeFile(join(home, "data", id, "brief.md"), "Brief"); }
  await store().execute({ op: "draft", definition: sail }, randomUUID(), "mate-v1");
  plan = (await store().get("sail"))!;
  expect(plan.status).toBe("active");
  await expect(store().execute({ op: "revise", definition: stripEffects(plan.definition), expected: plan.hash, reason: "Drop effect markers" }, randomUUID(), "mate-v1")).rejects.toThrow("gate");
  await expect(store().execute({ op: "start", plan: "sail", node: "release-s" }, randomUUID(), "mate-v1")).rejects.toThrow();
});

it("P4: a switch changes who answers open gates, not gates already answered", async () => {
  await store().execute({ op: "draft", definition: liveFixture({ owner: "firstmate", mode: "firstmate", evidence: "Captain: you own it." }) }, randomUUID(), "mate-v1");
  await mateAnswer("go-live");
  await reviewCaptain({ action: "transfer", mode: "firstmate-pivotal", escalate: [CRITERION] }, WORDS);
  const plan = await current();
  expect(plan.nodes["go-live"]?.answer).toBe("go");
  expect(decisionOwner(plan, node(plan, "go-live"))).toBe("captain");
  expect(((await start("release")) as any).launch.workflow.attempt).toBeTruthy();
});

it("P5: an owner-only transfer naming the current owner is refused, and any mode change records both modes", async () => {
  await store().execute({ op: "draft", definition: liveFixture({ owner: "firstmate", mode: "firstmate-pivotal", evidence: WORDS, escalate: [CRITERION] }) }, randomUUID(), "mate-v1");
  await expect(reviewCaptain({ action: "transfer", owner: "firstmate" }, "Captain: keep going.")).rejects.toThrow("different owner");
  expect(planMode(await current())).toBe("firstmate-pivotal");
  // An owner-only transfer to a different owner still works, and records the mode it left.
  await reviewCaptain({ action: "transfer", owner: "captain" }, "Captain: I will take it.");
  let plan = await current();
  expect(planMode(plan)).toBe("captain");
  expect(plan.ownerEvents?.at(-1)).toMatchObject({ from: "firstmate", to: "captain", fromMode: "firstmate-pivotal", toMode: "captain" });
  await reviewCaptain({ action: "transfer", owner: "firstmate" }, "Captain: back to you.");
  plan = await current();
  expect(plan.ownerEvents?.at(-1)).toMatchObject({ fromMode: "captain", toMode: "firstmate" });
  // A plan that never had a mode keeps the old owner-only event shape.
  await store().execute({ op: "draft", definition: workflowFixture() }, randomUUID(), "mate-v1");
  const legacy = (await store().get("scheduler"))!;
  await store().execute({ op: "captain", plan: "scheduler", revision: legacy.revision, subjectHash: planSubjectHash(legacy), action: "transfer", owner: "firstmate", text: "Captain: own it." }, randomUUID(), "board:captain");
  const event = (await store().get("scheduler"))!.ownerEvents!.at(-1)!;
  expect(event).toEqual({ at: event.at, by: "board:captain", from: "captain", to: "firstmate", evidence: "Captain: own it." });
});

it("P6/P7: criteria match the captain's words ignoring case and spacing; criteria-only changes need the pivotal mode", async () => {
  await store().execute({ op: "draft", definition: liveFixture({ owner: "firstmate", mode: "firstmate-pivotal", evidence: `Captain: bring me in on:  ${CRITERION.toUpperCase()}.`, escalate: [CRITERION] }) }, randomUUID(), "mate-v1");
  expect((await current()).definition.ownership?.escalate).toEqual([CRITERION]);
  await reviewCaptain({ action: "transfer", mode: "firstmate" }, "Captain: all yours.");
  await expect(reviewCaptain({ action: "transfer", escalate: [CRITERION] }, WORDS)).rejects.toThrow("firstmate-pivotal");
  await reviewCaptain({ action: "transfer", mode: "firstmate-pivotal", escalate: [CRITERION] }, WORDS);
  await reviewCaptain({ action: "transfer", escalate: [CRITERION, "any allowance change"] }, `${WORDS} Also any allowance change.`);
  expect((await current()).escalate).toEqual([CRITERION, "any allowance change"]);
});
