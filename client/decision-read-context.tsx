import { createContext, useContext } from "react";
import type { DecisionReadState } from "./decision-read-state";

export const DecisionReadContext = createContext<DecisionReadState>({});
export const useDecisionReadState = () => useContext(DecisionReadContext);
