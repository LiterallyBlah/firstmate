/** Every qualified remote version pair is backed by a recorded live probe whose daemon version held. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";
import { QUALIFIED_REMOTE_CLI_VERSION, QUALIFIED_REMOTE_PAIRS, qualifiedRemote, type ReceiverCapabilities } from "../shared/supervision-effects";
import { QUALIFYING_STEPS, REMOTE_QUALIFICATIONS, SURFACE_STEPS } from "../test/remote-qualification";
import { SupervisionRemoteReceiver } from "./supervision-remote-receiver";

const EVIDENCE = join(fileURLToPath(new URL("..", import.meta.url)), "docs", "scoped-supervision", "remote-probe", "evidence");
const capabilities = (cliVersion: string, daemonVersion: string): ReceiverCapabilities => ({
  version: 1, receiver: "paseo-cli/remote-worker", qualification: "cooperative-paseo", selectedAgentIds: false,
  createReceiptLookup: false, workspaceIntentLookup: true, workspaceNotCreatedProof: false, persistedInventory: false,
  sendReceiptLookup: false, conditionalArchive: false, labelBoundIdentity: true, remoteVersions: { cliVersion, daemonVersion },
});

describe("qualified remote version pairs", () => {
  it("are exactly the pairs with recorded evidence", () => {
    expect(QUALIFIED_REMOTE_PAIRS).toEqual(REMOTE_QUALIFICATIONS.map(({ cliVersion, daemonVersion }) => ({ cliVersion, daemonVersion })));
    for (const pair of QUALIFIED_REMOTE_PAIRS) expect(pair.cliVersion).toBe(QUALIFIED_REMOTE_CLI_VERSION);
  });

  it.each(REMOTE_QUALIFICATIONS.map(q => [`${q.host.label} ${q.cliVersion}/${q.daemonVersion}`, q] as const))("%s: the live probe completed and the daemon version held", async (_name, q) => {
    const transcript = JSON.parse(await readFile(join(EVIDENCE, q.transcript), "utf8"));
    expect(transcript.mode).toBe("live");
    expect(transcript.summary).toEqual({ nonce: q.nonce, agentId: q.agentId });
    expect(transcript.steps.map((s: { name: string; code: number }) => [s.name, s.code])).toEqual(QUALIFYING_STEPS);
    const step = (name: string) => transcript.steps.find((s: { name: string }) => s.name === name);
    // The create was the only one, in the named workspace, labelled with the nonce.
    expect(step("create").args).toEqual(expect.arrayContaining(["--workspace", q.workspaceId, `firstmate.probe=${q.nonce}`]));
    expect(step("create").parsed.agentId).toBe(q.agentId);
    // The one permission denied was the probe agent's own, and it was then archived.
    expect(step("permission:listed").parsed.map((p: { agentId: string }) => p.agentId)).toEqual([q.agentId]);
    expect(step("permission:deny").args.slice(0, 3)).toEqual(["permit", "deny", q.agentId]);
    expect(step("archive").parsed).toMatchObject({ agentId: q.agentId, status: "archived" });
    expect(step("after-archive:listing").parsed).toEqual([]);

    const snapshots = (await readFile(join(EVIDENCE, q.versions), "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line));
    expect(snapshots[0].phase).toBe("before");
    expect(snapshots.at(-1).phase).toBe("after");
    expect(new Set(snapshots.map((s: { daemonVersion: string }) => s.daemonVersion))).toEqual(new Set([q.daemonVersion]));
    expect(snapshots.every((s: { online: boolean }) => s.online)).toBe(true);
    // This run's snapshots cover it from before its create through its archive request, not after it
    // (the surface run below has the strict after snapshot): exactly that, with no slack.
    const at = (s: { atMs: number; ms: number }) => Date.parse(transcript.at) + s.atMs - s.ms;
    expect(Date.parse(snapshots[0].checkedAt)).toBeLessThan(at(step("create")));
    expect(Date.parse(snapshots.at(-1).checkedAt)).toBeGreaterThanOrEqual(at(step("archive")));

    const readOnly = JSON.parse(await readFile(join(EVIDENCE, q.readOnly), "utf8"));
    expect(readOnly.host).toEqual(q.host);
    expect(readOnly.steps.find((s: { name: string }) => s.name === "local-cli-version").stdout).toBe(q.cliVersion);
    expect(readOnly.steps.find((s: { name: string }) => s.name === "catalog-hosts").entry.daemonVersion).toBe(q.daemonVersion);
  });

  it.each(REMOTE_QUALIFICATIONS.map(q => [`${q.host.label} ${q.cliVersion}/${q.daemonVersion}`, q] as const))("%s: the surface probe exercised the receiver's commands, left nothing, and the version held before to after", async (_name, q) => {
    const transcript = JSON.parse(await readFile(join(EVIDENCE, q.surface.transcript), "utf8"));
    type Step = { name: string; code?: number; stdout?: string; args?: string[]; parsed?: any; startedAt?: string; endedAt?: string; readAt?: string; checkedAt?: string; daemonVersion?: string; online?: boolean; keys?: string[] };
    const steps: Step[] = transcript.steps, step = (name: string) => steps.find(s => s.name === name)!;
    expect(transcript.mode).toBe("surface");
    expect(transcript.summary).toMatchObject({ nonce: q.surface.nonce, leftover: [] });
    expect(steps.map(s => s.name)).toEqual(SURFACE_STEPS);
    for (const s of steps.filter(s => s.code !== undefined)) expect(s.code, s.name).toBe(0);

    // Every effect names something the probe created: its throwaway repository, its worktree, its two agents.
    const { created, repo } = transcript.summary;
    expect(repo).toBe(`/tmp/fm-probe-${q.surface.nonce}`);
    const effects = steps.filter(s => s.args && !["ls", "inspect", "logs"].includes(s.args[0]!) && !(s.args[1] === "ls"));
    const ours = new Set([created.janitor, created.worker, created.worktree, created.repoProject, created.tmpWorkspace, created.tmpProject]);
    for (const s of effects) {
      if (s.args![0] === "run") expect(s.args, s.name).toEqual(expect.arrayContaining([`firstmate.probe=${q.surface.nonce}`]));
      else if (s.args![0] === "workspace" && s.args![1] === "create") expect(s.args).toEqual(expect.arrayContaining(["--path", repo]));
      else expect(ours.has(s.args![0] === "permit" || s.args![0] === "workspace" || s.args![0] === "project" ? s.args![2] : s.args![1]), s.name).toBe(true);
    }

    // workspace create, in the receiver's own argument shape; its real reply parses into a receipt.
    const create = step("workspace:create");
    expect(create.args!.slice(0, 3)).toEqual(["workspace", "create", "--isolation"]);
    expect(create.args).toEqual(expect.arrayContaining(["worktree", "--worktree-slug", `fm-probe-${q.surface.nonce}`, "--new-branch", `fm-probe/${q.surface.nonce}`, "--base", "main"]));
    const bridge = (replies: Record<string, unknown>) => ({ request: async (_host: string, args: string[]) => replies[`${args[0]} ${args[1]}`],
      discoverByAttempt: async () => [], hostInfo: async () => null });
    const intent = { key: `fm-probe-${q.surface.nonce}`, hostId: q.host.serverId, project: "probe", baseBranch: "main", branch: `fm-probe/${q.surface.nonce}`, purpose: "worker" as const };
    const opened = await new SupervisionRemoteReceiver(bridge({ "workspace create": create.parsed }), q.host.serverId, async () => repo).openWorkspace(intent);
    expect(opened).toEqual({ workspaceId: created.worktree, directory: created.worktreeCwd });
    // workspace ls on this daemon has no branch, so recovery cannot rediscover the worktree: it finds
    // nothing, and the gateway keeps the open uncertain (no not-created proof), never a second create.
    expect(step("workspace:ls").keys).not.toContain("branch");
    expect(step("workspace:ls-branch").parsed ?? step("workspace:ls-branch")).toMatchObject({ branchField: false, rowBranch: null });
    expect(step("workspace:ls").parsed).toEqual([expect.objectContaining({ workspaceId: created.worktree, cwd: created.worktreeCwd })]);
    expect(await new SupervisionRemoteReceiver(bridge({ "workspace ls": step("workspace:ls").parsed }), q.host.serverId, async () => repo).findWorkspace(intent)).toBeNull();
    expect((await new SupervisionRemoteReceiver(bridge({}), q.host.serverId, async () => repo).capabilities()).workspaceNotCreatedProof).toBe(false);

    // permit allow --input answers a Claude question; permit deny --interrupt stops the turn; stop stops a running one.
    expect(step("permit-allow:requested").parsed).toEqual([expect.objectContaining({ agentId: created.worker, name: "AskUserQuestion" })]);
    expect(step("permit-allow:answer").args).toEqual(expect.arrayContaining(["permit", "allow", created.worker, "--input"]));
    expect(step("permit-allow:answer").parsed).toEqual([expect.objectContaining({ result: "allowed" })]);
    expect(step("permit-allow:settled").parsed).toMatchObject({ Status: "idle", PendingPermissions: [] });
    expect(step("permit-deny-interrupt:deny").args).toEqual(expect.arrayContaining(["permit", "deny", created.worker, "--interrupt"]));
    expect(step("permit-deny-interrupt:deny").parsed).toEqual([expect.objectContaining({ name: "Write", result: "denied" })]);
    expect(step("permit-deny-interrupt:settled").parsed.PendingPermissions).toEqual([]);
    expect(["idle", "error"]).toContain(step("permit-deny-interrupt:settled").parsed.Status);
    expect(step("stop:running").parsed.Status).toBe("running");
    expect(step("stop").parsed).toEqual({ stoppedCount: 1, agentIds: [created.worker] });

    // Nothing is left: both agents archived, the worktree, the repository's and /tmp's workspaces and projects gone.
    for (const role of ["janitor", "worker"]) {
      const a = step(`after:${role}-inspect`).parsed; // An agent archived while idle keeps reporting idle.
      expect(a.Archived, role).toBe(true); expect(["idle", "closed"], role).toContain(a.Status); expect(a.PendingPermissions, role).toEqual([]);
    }
    expect(step("repo:remove:output").stdout!.trim()).toBe("clean"); // rm, then the repository and worktree both absent.
    expect(step("after:agents-active").parsed).toEqual([]);
    expect(step("after:workspaces").parsed).toEqual([]);
    expect(step("after:projects").parsed).toEqual([]);
    expect(step("preflight")).toMatchObject({ tmpProjects: 0, tmpWorkspaces: 0 });

    // The daemon version: read before the first effect, and from a catalog refresh strictly after the last step.
    const before = step("version:before"), after = step("version:after");
    const first = steps.find(s => s.startedAt)!, last = steps.filter(s => s.endedAt).at(-1)!;
    expect(Date.parse(before.readAt!)).toBeLessThan(Date.parse(first.startedAt!));
    expect(Date.parse(after.checkedAt!)).toBeGreaterThan(Date.parse(last.endedAt!));
    for (const v of [before, after]) expect(v).toMatchObject({ daemonVersion: q.daemonVersion, online: true });
  });

  it("the surface probe's earlier, stopped attempts tore down what they created too", async () => {
    for (const n of [1, 2, 3]) {
      const attempt = JSON.parse(await readFile(join(EVIDENCE, `surface-2026-11-06-attempt-${n}.json`), "utf8"));
      expect(attempt.mode, `attempt ${n}`).toBe("surface");
      expect(attempt.summary.leftover, `attempt ${n}`).toEqual([]);
      expect(attempt.steps.find((s: { name: string }) => s.name === "after:workspaces").parsed, `attempt ${n}`).toEqual([]);
      expect(attempt.steps.find((s: { name: string }) => s.name === "after:projects").parsed, `attempt ${n}`).toEqual([]);
    }
  });

  it("admit only the exact pair: a neighbouring CLI or daemon version fails closed", () => {
    expect(qualifiedRemote(capabilities("0.14.0", "0.13.0"))).toBe(true);
    for (const [cli, daemon] of [["0.14.0", "0.14.0"], ["0.13.0", "0.13.0"], ["0.14.0", "0.13.1"], ["0.14.0", ""], ["", "0.13.0"]] as const)
      expect(qualifiedRemote(capabilities(cli, daemon))).toBe(false);
    expect(qualifiedRemote({ ...capabilities("0.14.0", "0.13.0"), labelBoundIdentity: false })).toBe(false);
    expect(qualifiedRemote({ ...capabilities("0.14.0", "0.13.0"), selectedAgentIds: true })).toBe(false);
  });
});
