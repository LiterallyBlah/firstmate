import { describe, expect, it } from "vitest";
import { resolveDiscussion, scopeConversationKey, scopeDraftKey, scopeForPlan } from "./scope-discussion";
const target = (scopeId: string) => ({ homeId: "home", scopeId, scopeVersion: 1, epoch: 1, agentId: `${scopeId}-agent` });
const scopes = [{ id: "general", title: "FirstMate", aliases: ["firstmate"], target: target("general") },
  { id: "project", title: "Reader", aliases: ["reader"], target: target("project") },
  { id: "plan", title: "Fix", aliases: ["fix"], target: target("plan") }];
const projects = [{ id: "p1", name: "reader" }, { id: "p2", name: "tools" }];
describe("captain discussion addresses", () => {
  it("routes untagged shared input to General and #project only supplies context", () => {
    expect(resolveDiscussion("Hello", scopes, projects).scope.id).toBe("general");
    expect(resolveDiscussion("#reader Please explain", scopes, projects)).toMatchObject({ scope: { id: "general" }, projectIds: ["p1"], text: "Please explain" });
  });
  it("resolves one @mate plus independent #project context in either order", () => {
    for (const text of ["@fix #reader Explain", "#reader @FIX Explain"]) expect(resolveDiscussion(text, scopes, projects)).toMatchObject({ scope: { id: "plan" }, projectIds: ["p1"], text: "Explain" });
  });
  it("keeps dedicated discussion defaults, quotes, code, later mentions and Markdown in the body", () => {
    expect(resolveDiscussion("Hello @reader #tools", scopes, projects, "plan")).toMatchObject({ scope: { id: "plan" }, text: "Hello @reader #tools", projectIds: [] });
    for (const text of ["# Heading", "> @reader quoted", "`@reader` example", "```\n@reader\n```", "\\@reader literal"]) expect(resolveDiscussion(text, scopes, projects).scope.id).toBe("general");
  });
  it("refuses unknown, ambiguous, malformed, empty and multiple recipients without broadcasting", () => {
    for (const text of ["@missing Hello", "#unknown Hello", "@fix @reader Hello", "@! Hello", "@fix"]) expect(() => resolveDiscussion(text, scopes, projects)).toThrow();
    expect(() => resolveDiscussion("@reader Hello", [...scopes, { ...scopes[2]!, aliases: ["reader"] }], projects)).toThrow(/Ambiguous/);
    expect(() => resolveDiscussion("#reader Hello", scopes, [...projects, { id: "other", name: "reader" }])).toThrow(/Ambiguous/);
    expect(() => resolveDiscussion("Hello", scopes, projects, "missing")).toThrow(/unavailable/);
  });
  it("deduplicates project aliases by identity and isolates every draft dimension", () => {
    expect(resolveDiscussion("#reader #p1 Hello", scopes, [...projects, projects[0]!]).projectIds).toEqual(["p1"]);
    const keys = [scopeDraftKey("a", "home", "plan"), scopeDraftKey("b", "home", "plan"), scopeDraftKey("a", "other", "plan"), scopeDraftKey("a", "home", "project"), scopeDraftKey("a", "home", "plan", "other")];
    expect(new Set(keys).size).toBe(keys.length);
    expect(scopeConversationKey("a:b", "c")).not.toBe(scopeConversationKey("a", "b:c"));
  });
  it("uses the same body normalization as the checked RPC while preserving interior newlines", () => {
    expect(resolveDiscussion("  #reader @fix  Explain\n  details  \n", scopes, projects)).toMatchObject({ scope: { id: "plan" }, projectIds: ["p1"], text: "Explain\n  details" });
  });
  it("retains the displayed plan home on discussion links and refuses ambiguous or cross-home cache joins", () => {
    const scope = { kind: "plan", planId: "reader", id: "scope" }, snapshot = { homeId: "original", uiEnabled: true, scopes: [scope] };
    expect(scopeForPlan(snapshot, "original", "reader")).toBe(scope);
    expect(scopeForPlan({ ...snapshot, homeId: "another" }, "original", "reader")).toBeUndefined();
    expect(scopeForPlan({ ...snapshot, scopes: [scope, { ...scope, id: "other" }] }, "original", "reader")).toBeUndefined();
    expect(scopeForPlan(snapshot, undefined, "reader")).toBeUndefined();
  });
});
