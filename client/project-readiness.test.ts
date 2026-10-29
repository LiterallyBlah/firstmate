import { expect, it } from "vitest";
import { projectReadiness, projectReadProblems, projectSetupReadable } from "./project-readiness";
import type { ProjectRuntimeSnapshot } from "../shared/project-runtime";
const row: ProjectRuntimeSnapshot["projects"][number] = { name: "Starpath", projectId: null, scopeId: null, directory: "C:/Starpath", hostId: "local", state: "unadmitted", reason: "Awaiting reviewed admission and allocation.", version: 0, aliases: [], agentId: null, workspaceId: null, provisionRequestId: null, sessions: 0, turns: 0, uncertain: 0, memoryPending: 0, profile: null, limits: null, plans: [] };
const warning = "Plan remote-reader has unresolved project or host membership; no ownership was guessed.";
const snapshot: ProjectRuntimeSnapshot = { enabled: true, homeId: "fixture", registryDigest: null, sequence: 0, hash: null, freshness: "uninitialized", problems: [warning], projects: [row], general: { agentId: "general", scopeId: null, headroom: 1, slots: 4, providerAvailability: "unknown" } };
it("legacy handoff context is not a failed read, while unknown and held records remain blocking", () => {
  expect(projectReadProblems(snapshot)).toEqual([]); expect(projectSetupReadable(snapshot)).toBe(true);
  expect(projectSetupReadable({ ...snapshot, freshness: "current", sequence: 5 })).toBe(false);
  expect(projectReadProblems({ ...snapshot, freshness: "current", sequence: 5, associationWarnings: [warning] })).toEqual([]);
  expect(projectSetupReadable({ ...snapshot, problems: [warning, "Journal hash mismatch"] })).toBe(false);
  expect(projectSetupReadable({ ...snapshot, freshness: "held", associationWarnings: [warning] })).toBe(false);
  expect(projectSetupReadable(snapshot, true)).toBe(false);
});
it.each(["ariadne-dev:/home/ariadne/Projects/Aradne", "ssh://captain@ariadne-dev/home/project"])("remote identity is explained without falling back to a same-named native local project: %s", location => {
  const status = projectReadiness({ ...row, name: "Ariadne", directory: null, state: "held", registryLocation: location });
  expect(status.description).toContain("another computer (ariadne-dev)"); expect(status.setup).toBe(false); expect(status.inspect).toBe(false);
});
it("a repository URL requests a local folder rather than naming its scheme as a computer", () => {
  const status = projectReadiness({ ...row, directory: null, state: "held", registryLocation: "https://example.test/repository" });
  expect(status.description).toContain("repository URL"); expect(status.description).not.toContain("computer (https)"); expect(status.setup).toBe(false);
});
it("ready, existing, stopped and unknown openings keep separate truthful labels", () => {
  expect(projectReadiness(row).label).toBe("Ready to set up");
  const existing = { ...row, state: "admitted", version: 2, agentId: "saved", reason: null };
  expect(projectReadiness(existing).label).toBe("Mate active");
  expect(projectReadiness({ ...existing, state: "stopped" }).label).toBe("Setup stopped");
  expect(projectReadiness({ ...existing, uncertain: 1 }).label).toBe("Saved setup needs checking");
});
