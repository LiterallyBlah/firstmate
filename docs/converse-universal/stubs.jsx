/** Real surface; only the host and its persistent thread RPC are synthetic. */
export * from "../item-tags/stubs";
import { useRpc as hostRpc } from "../item-tags/stubs";
const load = () => JSON.parse(localStorage.getItem("fixture-threads") ?? "{}");
const read = async ({ key }) => load()[key] ?? { key, title: "Item discussion", messages: [] };
const send = async (input) => {
  window.fixtureCalls.push({ name: "firstmate.item.discuss", input });
  const store = load();
  const thread = store[input.key] ?? { key: input.key, title: "Item discussion", messages: [] };
  if (!thread.messages.some((entry) => entry.id === input.id)) thread.messages.push({
    ...input, agentId: "mate", delivery: "sent", createdAt: new Date().toISOString(),
    reply: input.kind === "graduate" ? "I will carry our agreed scope into the brief." : `Scoped first-mate reply to: ${input.text}`,
  });
  store[input.key] = thread;
  localStorage.setItem("fixture-threads", JSON.stringify(store));
  return thread;
};
export function useRpc(contract) {
  const original = hostRpc(contract);
  return contract.name === "firstmate.item.thread" ? read : contract.name === "firstmate.item.discuss" ? send : original;
}
