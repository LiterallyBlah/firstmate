import React from "react";
import { TextInput as Input } from "react-native-web";
import { icons } from "lucide-react";
export { FlatList, ScrollView } from "react-native-web";
export const TextInput = Input;
export const Icon = ({ name, size, color }) => { const I = icons[name] ?? icons.Circle; return <I size={size} color={color} />; };
export const SettingsRow = ({label,children}) => <div style={{display:"grid",gap:6}}><span>{label}</span>{children}</div>;
function ModalView({title,open,children}) { return open ? <section role="dialog" aria-label={title} style={{background:"var(--surface)",color:"var(--ink)",padding:16,border:"1px solid var(--border)",borderRadius:12,maxWidth:680,width:"100%",margin:"8px auto"}}><h2 style={{fontSize:20,margin:"0 0 18px"}}>{title}</h2>{children}</section> : null; }
export const Modal = Object.assign(ModalView,{Content:({children})=><div style={{display:"grid",gap:14}}>{children}</div>});
const rpcs = new Map();
export function useRpc(contract) {
  if (!rpcs.has(contract.name)) rpcs.set(contract.name,async input=>{
    window.fixtureCalls.push({name:contract.name,input});
    if(contract.name === "firstmate.mate.targets") return {targets:window.supervisorCatalog};
    throw Error("Synthetic fixture refuses effects: "+contract.name);
  });
  return rpcs.get(contract.name);
}
export function workflowRequestId() { return "00000000-0000-4000-8000-000000000009"; }
export function useWorkflowPlans() { return {}; }
