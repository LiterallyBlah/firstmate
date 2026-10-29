import React,{createContext,useContext,useEffect,useState} from 'react';
import {rpc} from './production-stubs';
const Context=createContext({loading:true,error:null});
export const workflowRequestId=()=>crypto.randomUUID();
export const useWorkflowPlans=()=>useContext(Context);
export function FixtureProvider({children}){
 const [snapshot,setSnapshot]=useState(),[activation,updateActivation]=useState(),[error,setError]=useState(null);
 const refresh=()=>rpc('firstmate.workflow.read',{}).then(setSnapshot);
 const refreshActivation=()=>rpc('firstmate.supervision.activation',{}).then(updateActivation);
 useEffect(()=>{Promise.all([refresh(),refreshActivation()]).catch(e=>setError(e.message));},[]);
 window.review.context={snapshot,activation};
 return <Context.Provider value={{snapshot,activation,updateActivation,refreshActivation,refresh,loading:!snapshot,error,activationError:false,open(){},scope:'isolated-production-home'}}>{children}</Context.Provider>;
}
