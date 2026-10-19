import { createContext, useContext } from "react";
import type { DecisionDestination } from "./needs-you-state";
/** Shared, installation/surface-owned action. Deck consumers call this; it has no send side effects. */
export type OpenDecision = (
  destination?: DecisionDestination,
  returnFocusId?: string,
) => void;
export const DecisionActionContext = createContext<OpenDecision>(() => {});
export function useOpenDecision(): OpenDecision {
  return useContext(DecisionActionContext);
}
