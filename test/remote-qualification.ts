/** The evidence behind each `QUALIFIED_REMOTE_PAIRS` entry: one live probe per pair, its daemon
 * version recorded before, during and after it. The transcripts are under
 * `docs/scoped-supervision/remote-probe/evidence/`; `remote-qualification.test.ts` checks them against this. */
export interface RemoteQualification {
  cliVersion: string;
  daemonVersion: string;
  host: { serverId: string; label: string };
  workspaceId: string;
  /** The probe's label nonce and its one test agent, archived at the end. */
  nonce: string;
  agentId: string;
  /** Transcript of `probe.mjs live`, and the `tools/remote.mjs hosts` snapshots taken around it. */
  transcript: string;
  versions: string;
  /** Read-only `--version`, catalog and `inspect` reads made before the probe. */
  readOnly: string;
  /** `probe.mjs surface`: the rest of the receiver's commands against a throwaway repository, torn down after. */
  surface: { transcript: string; nonce: string };
}

export const REMOTE_QUALIFICATIONS: readonly RemoteQualification[] = [
  {
    cliVersion: "0.14.0",
    daemonVersion: "0.13.0",
    host: { serverId: "srv_sY4CFeHq0_8l", label: "ariadne-dev" },
    workspaceId: "wks_029fde57422215dd",
    nonce: "s0-4c299e9b",
    agentId: "8552861a-dee4-4771-9968-a494a64d1a79",
    transcript: "live-2026-11-06.json",
    versions: "live-2026-11-06-daemon-versions.jsonl",
    readOnly: "ariadne-dev-versions-2026-11-06.json",
    surface: { transcript: "surface-2026-11-06.json", nonce: "s0-2666de49" },
  },
];

/** The steps a qualifying live probe must have completed, in order, each with its expected exit code. */
export const QUALIFYING_STEPS: readonly [string, number][] = [
  ["baseline:label-listing", 0], ["unknown-host", 1], ["create", 0], ["reconcile:label-listing", 0],
  ["reconcile:label-and-owner", 1], ["status:first-turn-settled", 0], ["completion:logs-text", 0],
  ["completion:logs-assistant", 0], ["permission:send", 0], ["permission:listed", 0], ["permission:inspect", 0],
  ["permission:deny", 0], ["permission:settled", 0], ["permission:logs-text", 0], ["archive", 0],
  ["after-archive:listing", 0], ["after-archive:listing-all", 0],
];

/** The steps a completed surface probe records, in order: setup, the receiver's commands, teardown, checks. */
export const SURFACE_STEPS: readonly string[] = [
  "version:before", "preflight", "janitor:create", "janitor:first-turn", "janitor:workspace", "janitor:project",
  "repo:create:send", "repo:create:requested", "repo:create:allow", "repo:create:settled", "repo:create:output",
  "workspace:create", "workspace:ls", "workspace:ls-branch", "workspace:project", "worker:create",
  "permit-allow:requested", "permit-allow:inspect", "permit-allow:answer", "permit-allow:settled", "permit-allow:reply",
  "permit-deny-interrupt:send", "permit-deny-interrupt:requested", "permit-deny-interrupt:deny", "permit-deny-interrupt:settled", "permit-deny-interrupt:logs",
  "stop:send", "stop:running", "stop", "stop:settled", "stop:logs",
  "teardown:worker-stop", "teardown:worker-archive", "teardown:worktree-archive", "teardown:repo-project-delete",
  "repo:remove:send", "repo:remove:requested", "repo:remove:allow", "repo:remove:settled", "repo:remove:output",
  "teardown:janitor-stop", "teardown:janitor-archive", "teardown:tmp-workspace-archive", "teardown:tmp-project-delete",
  "after:janitor-inspect", "after:worker-inspect", "after:agents", "after:agents-active", "after:workspaces", "after:projects", "version:after",
];
