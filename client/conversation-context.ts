import { createContext, useContext } from "react";
import type { ScopeSnapshot } from "../shared/supervision-rpc";
import type { MateConversation } from "./conversation-list";

export interface ConversationControls {
  snapshot: ScopeSnapshot | undefined;
  failed: boolean;
  mates: MateConversation[];
  open(mate: MateConversation, message?: string): void;
  refresh(): void;
  setup(): void;
  generalRead(ids: readonly string[], visible: boolean, complete: boolean): void;
}
export const ConversationContext = createContext<ConversationControls | null>(null);
export const useConversations = () => useContext(ConversationContext);
