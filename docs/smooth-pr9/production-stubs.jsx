export * from '../board-list/stubs';
window.review={calls:[],context:{}};
export async function rpc(name,input){
 const response=await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,input})});
 const result=await response.json();window.review.calls.push({name,input,result});
 if(!result.ok)throw Object.assign(new Error(result.error.message),{code:result.error.code});
 return result.value;
}
const methods=new Map();
export function useRpc(contract){
 if(!methods.has(contract.name))methods.set(contract.name,input=>rpc(contract.name,input));
 return methods.get(contract.name);
}
