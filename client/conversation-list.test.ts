import { expect, it } from "vitest";
import { conversationReadKey, conversationReads, mateConversations, mentionAt, sameConversationTarget } from "./conversation-list";
import type { ScopeSnapshot } from "../shared/supervision-rpc";

it("keeps a leading mention reachable while the sentence is typed, without treating email or code as a picker", () => {
  expect(mentionAt("@rea")).toEqual({ start: 0, end: 4, query: "rea" });
  expect(mentionAt("Ask @rea please", 8)).toEqual({ start: 4, end: 8, query: "rea" });
  expect(mentionAt("@reader check chapter three please")).toEqual({ start: 0, end: 7, query: "reader" });
  for (const text of ["captain@example.com", "`@reader", "```\n@reader", "hello"]) expect(mentionAt(text)).toBeNull();
  expect(mentionAt("`done` @")).toEqual({ start: 7, end: 8, query: "" });
});

it("lists only existing project/plan conversations with plain names and their context", () => {
  const scopes = [
    { id: "p", kind: "project", title: "Reader", target: { agentId: "p-owner" } },
    { id: "h", kind: "plan", title: "Phone layout", target: { agentId: "h-owner" } },
    { id: "old", kind: "project", title: "Stopped mate", state: "held", target: { agentId: "old-owner" } },
    { id: "new", kind: "plan", title: "Uncreated", target: { agentId: null } },
    { id: "g", kind: "general", title: "FirstMate", target: { agentId: "general" } },
    { id: "m", kind: "maintenance", title: "Routine", target: { agentId: "maintenance" } },
  ];
  const list = mateConversations({ scopes } as ScopeSnapshot);
  expect(list.map(m => [m.name, m.context])).toEqual([["Phone layout helper", "Plan: Phone layout"], ["Reader mate", "Project: Reader"], ["Stopped mate", "Project: Stopped mate"]]);
  expect(mateConversations(undefined)).toEqual([]);
});

it("keeps unread replies independent by host/home/owner and survives a fresh store instance", () => {
  const root = {}, a = conversationReads(root), target = { scopeId: "reader", epoch: 1, agentId: "owner" };
  const key = conversationReadKey("host", "home", target);
  a.observe(key, []);
  expect(a.unread(key, ["reply-1", "reply-2"])).toBe(2);
  a.mark(key, ["reply-1"]);
  const b = conversationReads(root);
  expect(b.unread(key, ["reply-1", "reply-2"])).toBe(1);
  for (const other of [conversationReadKey("other-host", "home", target), conversationReadKey("host", "other-home", target), conversationReadKey("host", "home", { ...target, epoch: 2 })]) {
    b.observe(other, []); expect(b.unread(other, ["reply-1"])).toBe(1);
  }
  const before = b.version(); b.mark(key, ["reply-1"]); expect(b.version()).toBe(before);
});

it("baselines old replies once per cold session, including an empty first observation", () => {
  const reads = conversationReads({});
  expect(reads.unread("history", ["old"])).toBe(0);
  reads.observe("history", ["old"]);
  reads.observe("history", ["old", "new"]);
  expect(reads.unread("history", ["old", "new"])).toBe(1);
  reads.observe("empty", []);
  expect(reads.unread("empty", ["first"])).toBe(1);
  expect(conversationReads({}).unread("history", ["old", "new"])).toBe(0);
});

it("pins recipient identity while leaving fresh version checks to the existing sender", () => {
  const target = { homeId: "home", scopeId: "reader", scopeVersion: 1, epoch: 1, agentId: "owner" };
  expect(sameConversationTarget(target, { ...target, scopeVersion: 2 })).toBe(true);
  for (const update of [{ agentId: "other" }, { epoch: 2 }, { homeId: "other" }, { scopeId: "other" }]) expect(sameConversationTarget(target, { ...target, ...update })).toBe(false);
});
