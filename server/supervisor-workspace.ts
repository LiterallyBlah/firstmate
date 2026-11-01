/** Pure next-session context; shared by catalog capture and the existing reserved workspace intent. */
import { join } from "node:path";
import { effectLogicalKey, stableId, supervisorWorkspaceIntent } from "./supervision-effects";
export function supervisorWorkspace(root: string, scopeId: string, epoch: number) {
  const id = stableId("effect", effectLogicalKey({ scopeId, subject: `epoch:${epoch}`, operation: "workspace.open", causation: "scope.activate", objectiveRevision: 0 }));
  const intent = supervisorWorkspaceIntent(scopeId, epoch, id);
  return { intentKey: intent.key, directory: join(root, "supervisor-workspaces", intent.key) };
}
