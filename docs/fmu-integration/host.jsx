import React from "react";
export {TextInput,FlatList,ScrollView} from "react-native-web";
function Shell({title,open,children}){return open?<section role="dialog" aria-label={title} style={{padding:16,color:"inherit",maxWidth:680,minWidth:0}}><h2>{title}</h2>{children}</section>:null;}
export const Modal=Object.assign(Shell,{Content:({children})=><div style={{display:"grid",gap:14}}>{children}</div>});
const rpcs=new Map();
export function useRpc(rpc){if(!rpcs.has(rpc.name))rpcs.set(rpc.name,async input=>{const response=await fetch("/rpc",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:rpc.name,input})}),result=await response.json();window.calls.push({name:rpc.name,input,ok:result.ok});if(!result.ok)throw Error(result.error);return result.value;});return rpcs.get(rpc.name);}
export function workflowRequestId(){return crypto.randomUUID();}
