import { expect, it } from "vitest";
import { sameConversationTarget } from "./conversation-target";

it("pins the logical recipient across routine scope-version updates", () => {
  const target = { homeId: "home", scopeId: "reader", scopeVersion: 1, epoch: 1, agentId: "owner" };
  expect(sameConversationTarget(target, { ...target, scopeVersion: 2 })).toBe(true);
  for (const update of [{ agentId: "other" }, { epoch: 2 }, { homeId: "other" }, { scopeId: "other" }]) expect(sameConversationTarget(target, { ...target, ...update })).toBe(false);
});
