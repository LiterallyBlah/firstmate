import { useState } from "react";
import { snapshot } from "./fixture";
export const workflowRequestId = () => crypto.randomUUID();
export function useWorkflowPlans() {
  const [activation, updateActivation] = useState(snapshot);
  return { activation, activationError: false, updateActivation };
}
