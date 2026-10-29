/** Synthetic read snapshots only. Production components still own every review/control. */
import React, { createContext, useContext, useState } from 'react';
import { workflow, activation } from '../smooth-pr2/data';
const Context = createContext({});
export const workflowRequestId = () => crypto.randomUUID();
export const useWorkflowPlans = () => useContext(Context);
export function FixtureContext({children}) {
  const [current, updateActivation] = useState(activation);
  return <Context.Provider value={{snapshot:workflow,activation:current,activationError:false,loading:false,error:null,refresh(){},open(){},updateActivation,refreshActivation(){},scope:'fixture'}}>{children}</Context.Provider>;
}
