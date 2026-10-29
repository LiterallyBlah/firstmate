import type { TimelinePage } from "./transcript-rows";

export interface ChatReturnState {
  scroll?: { offset: number; pinned: boolean };
  openGroups?: ReadonlySet<string>;
  timeline?: TimelinePage;
  history?: boolean;
}
export const chatReturnKey = (host: string, home: string, agent: string) => JSON.stringify(["firstmate.chat-return/1", host, home, agent]);
const slot = Symbol.for("paseo.firstmate.chat-return/1");
/** Same lifetime as existing drafts/attachments; no disk writes or cross-device history. */
export function chatReturnState(key: string, root: object = globalThis): ChatReturnState {
  let states = Reflect.get(root, slot) as Map<string, ChatReturnState> | undefined;
  if (!states) { states = new Map(); Reflect.set(root, slot, states); }
  let state = states.get(key);
  if (!state) {
    state = {}; states.set(key, state);
    if (states.size > 16) states.delete(states.keys().next().value!);
  }
  return state;
}
