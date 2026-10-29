import type { ProjectRuntimeSnapshot } from "../shared/project-runtime";
import { projectSetupAvailable } from "./ownership-state";
type Project = ProjectRuntimeSnapshot["projects"][number];
/** Expected legacy handoff context stays in the snapshot; it is not a failed project read. */
export function projectReadProblems(data: ProjectRuntimeSnapshot): string[] {
  const warnings = new Set(projectAssociationWarnings(data));
  return data.problems.filter(problem => !warnings.has(problem));
}
export function projectSetupReadable(data: ProjectRuntimeSnapshot, readError = false): boolean {
  return data.enabled && !readError && ["current", "uninitialized"].includes(data.freshness) && !projectReadProblems(data).length;
}
export function projectReadyToCreate(project: Project): boolean {
  return project.state === "admitted" && !project.reason && !!project.profile && !!project.limits &&
    !project.agentId && !project.provisionInput && !project.provisionRequestId && !project.sessions && !project.turns && !project.uncertain;
}
export function projectAssociationWarnings(data: ProjectRuntimeSnapshot): string[] {
  return data.associationWarnings ?? (data.freshness === "uninitialized" && data.sequence === 0 && data.hash === null ? data.problems.filter(p => /^Plan .+ has unresolved project or host membership; no ownership was guessed\.$/.test(p)) : []);
}
export function projectReadiness(project: Project): { label: string; description: string; setup: boolean; inspect: boolean } {
  const location = project.registryLocation ?? project.directory;
  const remote = location && !/^[A-Za-z]:[\\/]/.test(location) && (/^([^:/\\]+):[\\/](?![\\/])/.exec(location)?.[1] ?? /^ssh:\/\/(?:[^@/]+@)?([^/:]+)/.exec(location)?.[1]);
  if (remote) return { label: "On another machine — not supported yet", description: `This project is on another computer (${remote}); project mates for remote projects aren't supported yet.`, setup: false, inspect: false };
  if (location && /^[a-z][\w+.-]*:\/\//i.test(location)) return { label: "Local folder needed", description: "This entry is a repository URL. Choose its checked-out local folder in project setup; a URL cannot identify a local mate's workspace.", setup: false, inspect: true };
  if (projectSetupAvailable(project)) return { label: "Ready to set up", description: "Choose its model, permissions and limits before a mate starts.", setup: true, inspect: false };
  if (projectReadyToCreate(project)) return { label: "Ready to create", description: "Review the saved model, permissions and limits before creating its mate.", setup: false, inspect: false };
  if (project.state === "stopped" || project.reason?.startsWith("Provisioning stopped")) return { label: "Setup stopped", description: "Its saved mate and spending are kept. Open saved setup to inspect the stopped operation.", setup: false, inspect: true };
  if (project.agentId && !project.reason && !project.uncertain) return { label: "Mate active", description: "Already set up. Open its conversation to talk to this project's mate.", setup: false, inspect: false };
  if (project.uncertain || project.provisionInput || project.reason?.startsWith("Provisioning incomplete")) return { label: "Saved setup needs checking", description: "Open saved setup to check the same mate. A message with an unknown result will not be sent again.", setup: false, inspect: true };
  if (/Project (directory is unavailable|location is not a directory)/.test(project.reason ?? "")) return {
    label: project.reason?.includes("not a directory") ? "Not a folder" : "Folder not found",
    description: `${project.reason?.includes("not a directory") ? "Not a folder" : "Folder not found"}: ${location ?? "the recorded project folder"}. ${project.version > 0 ? "Restore this original folder; a saved mate cannot be moved here." : /\(clone of /i.test(location ?? "") ? "The project list includes a clone note in the folder path. Choose the actual folder in project setup to correct this entry." : "Choose its current folder in project setup to correct this entry."}`,
    setup: false, inspect: true,
  };
  if (project.reason?.includes("ambiguous")) return { label: "Duplicate project entry", description: "This name or folder appears more than once in the project list. Keep one entry for it in Home files → projects.md.", setup: false, inspect: false };
  if (!project.directory) return { label: "Local folder needed", description: `Choose a local project folder in project setup. ${location ? `Recorded location: ${location}.` : "No local folder is recorded."}`, setup: false, inspect: true };
  return { label: "Setup paused", description: `${project.reason ?? "The saved setup is incomplete."} Open saved setup to inspect its original choices.`, setup: false, inspect: true };
}
