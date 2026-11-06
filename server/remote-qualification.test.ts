/** Every qualified remote version pair is backed by a recorded live probe whose daemon version held. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";
import { QUALIFIED_REMOTE_CLI_VERSION, QUALIFIED_REMOTE_PAIRS, qualifiedRemote, type ReceiverCapabilities } from "../shared/supervision-effects";
import { QUALIFYING_STEPS, REMOTE_QUALIFICATIONS } from "../test/remote-qualification";

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
    // The catalog was refreshed after the probe's last request, so the "after" version is the daemon's at the end.
    expect(Date.parse(snapshots.at(-1).checkedAt)).toBeGreaterThanOrEqual(Date.parse(step("archive").parsed.archivedAt) - 60_000);

    const readOnly = JSON.parse(await readFile(join(EVIDENCE, q.readOnly), "utf8"));
    expect(readOnly.host).toEqual(q.host);
    expect(readOnly.steps.find((s: { name: string }) => s.name === "local-cli-version").stdout).toBe(q.cliVersion);
    expect(readOnly.steps.find((s: { name: string }) => s.name === "catalog-hosts").entry.daemonVersion).toBe(q.daemonVersion);
  });

  it("admit only the exact pair: a neighbouring CLI or daemon version fails closed", () => {
    expect(qualifiedRemote(capabilities("0.14.0", "0.13.0"))).toBe(true);
    for (const [cli, daemon] of [["0.14.0", "0.14.0"], ["0.13.0", "0.13.0"], ["0.14.0", "0.13.1"], ["0.14.0", ""], ["", "0.13.0"]] as const)
      expect(qualifiedRemote(capabilities(cli, daemon))).toBe(false);
    expect(qualifiedRemote({ ...capabilities("0.14.0", "0.13.0"), labelBoundIdentity: false })).toBe(false);
    expect(qualifiedRemote({ ...capabilities("0.14.0", "0.13.0"), selectedAgentIds: true })).toBe(false);
  });
});
