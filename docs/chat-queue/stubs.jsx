export * from '../smooth-pr11/stubs';
import { useRpc as original } from '../smooth-pr11/stubs';
const methods = new Map();
export function useRpc(contract) {
  if (!contract.name.startsWith('firstmate.chat.')) return original(contract);
  if (!methods.has(contract.name)) methods.set(contract.name, async input => {
    const response = await fetch('/rpc/' + contract.name + location.search, { method: 'POST', body: JSON.stringify(input) });
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    return result;
  });
  return methods.get(contract.name);
}
