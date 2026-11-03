/** Presentation choices only. The server policy and final effect guards remain authority. */
import { FEATURE_CAPABILITIES, supervisorsSetting, type FeatureCapabilities, type FeatureCapability,
  type FeatureReadResult } from "../shared/feature-settings";

/** The one saved Supervisors setting. It covers plan, project and routine-check Supervisors and replaces the
 * daemon's FIRSTMATE_* environment switches once saved. */
export const SUPERVISORS = { title: "Supervisors", on: "Turn on Supervisors", off: "Turn off Supervisors", save: "Save Supervisors setting",
  description: "Supervisors look after a plan, a project or routine checks, each with a model, permissions and limits you review first." } as const;
/** The guarded paths behind the setting, named for Help details and reviews of a partial setup. */
export const CAPABILITY_LABELS: Record<FeatureCapability, string> = {
  projectMates: "Project Supervisors", planSupervisors: "Plan execution", scopedActivation: "Plan handover controls",
  scopeUi: "Contextual conversation controls", scopeExecution: "Contextual messages and answers", maintenance: "Routine checks",
};

export function supervisorsState(snapshot: FeatureReadResult): string {
  if (snapshot.state !== "ready" || !snapshot.runtimeEnforced) return "Unavailable";
  const requested = supervisorsSetting(snapshot.requested);
  if (requested === "on") return FEATURE_CAPABILITIES.every(k => snapshot.effective[k]) ? "On" : "Partly on · review setup";
  return requested === "off" ? "Off" : "Partly on · review setup";
}
export function changedCapabilities(before: FeatureCapabilities, after: FeatureCapabilities) {
  return FEATURE_CAPABILITIES.filter(k => before[k] !== after[k]);
}
/** These counts overlap and cover only scoped records. Never add them or claim an empty fleet. */
export function retainedWork(snapshot: FeatureReadResult): string {
  const { active, pending, uncertain } = snapshot.inventory;
  const count = (n: number | null) => n === null ? "unknown" : `at least ${n}`;
  return `Active Supervisors: ${count(active)}. Pending operations: ${count(pending)}. Uncertain operations: ${count(uncertain)}. These checks cover only saved Supervisor records; other work may still be running. Pending and uncertain operations can overlap.`;
}
