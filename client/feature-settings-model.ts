/** Presentation choices only. The server policy and final effect guards remain authority. */
import { FEATURE_CAPABILITIES, type FeatureCapabilities, type FeatureCapability, type FeatureReadResult } from "../shared/feature-settings";

export type HelpKind = "projects" | "plans" | "checks";
export const HELP = {
  projects: { title: "Project mates", action: "Set up project mates", description: "A separate mate for each project, with limits you review first.",
    capabilities: ["projectMates", "scopeUi", "scopeExecution"], owners: ["projectMates"] },
  plans: { title: "Plan help", action: "Review plan help", description: "Choose help for an individual plan. Existing work stays with FirstMate until you review the change.",
    capabilities: ["planSupervisors", "scopedActivation", "scopeUi", "scopeExecution"], owners: ["planSupervisors", "scopedActivation"] },
  checks: { title: "Routine checks", action: "Review routine checks", description: "Checks report problems for review. Automatic cleanup is unavailable.",
    capabilities: ["maintenance"], owners: ["maintenance"] },
} satisfies Record<HelpKind, { title: string; action: string; description: string; capabilities: FeatureCapability[]; owners: FeatureCapability[] }>;
export const CAPABILITY_LABELS: Record<FeatureCapability, string> = {
  projectMates: "Project mates", planSupervisors: "Plan execution", scopedActivation: "Plan handover controls",
  scopeUi: "Contextual conversation controls", scopeExecution: "Contextual messages and answers", maintenance: "Routine checks",
};

/** Change only this choice's reviewed dependencies. In particular, never normalize a pilot. */
export function helpSelection(current: FeatureCapabilities, kind: HelpKind, enabled: boolean): FeatureCapabilities {
  const next = { ...current };
  for (const key of enabled ? HELP[kind].capabilities : HELP[kind].owners) next[key] = enabled;
  return next;
}
export function helpState(snapshot: FeatureReadResult, kind: HelpKind): string {
  if (snapshot.state !== "ready" || !snapshot.runtimeEnforced) return "Unavailable";
  const keys = HELP[kind].capabilities;
  if (keys.every(k => snapshot.effective[k])) return "On";
  if (HELP[kind].owners.some(k => snapshot.requested[k])) return "Partly on · review setup";
  return "Off";
}
export function changedCapabilities(before: FeatureCapabilities, after: FeatureCapabilities) {
  return FEATURE_CAPABILITIES.filter(k => before[k] !== after[k]);
}
/** These counts overlap and cover only scoped records. Never add them or claim an empty fleet. */
export function retainedWork(snapshot: FeatureReadResult): string {
  const { active, pending, uncertain } = snapshot.inventory;
  const count = (n: number | null) => n === null ? "unknown" : `at least ${n}`;
  return `Active helpers: ${count(active)}. Pending operations: ${count(pending)}. Uncertain operations: ${count(uncertain)}. These checks cover only saved helper records; other work may still be running. Pending and uncertain operations can overlap.`;
}
