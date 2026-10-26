import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { MateChat } from "../../../client/chat";
import { ScopeDiscussion } from "../../../client/scope-discussion";
import { ScopedNeeds } from "../../../client/scoped-needs";
import { readScopeNeeds } from "../../../shared/supervision-rpc";
import { NEEDS_YOU_QUERY_KEY } from "../../../client/needs-you-query";
import { useRpc } from "./stubs";
import { snapshot, homeId } from "./fixtures";
import { fleet } from "../../board-list/fixtures";
import { theme as dark } from "../../board-list/theme";
const light = { colors: { surface0: "#ffffff", surface1: "#f4f6f5", surface2: "#e8ecea", border: "#ced5d1", foreground: "#17211b", foregroundMuted: "#4d5c53",
  accent: "#17603b", accentForeground: "#ffffff", statusWarning: "#79551f", statusDanger: "#a32d25", statusSuccess: "#24653d" } };
const params = new URLSearchParams(location.search), theme = params.get("theme") === "light" ? light : dark, phone = innerWidth < 600;
const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
function App() {
  const [generation, remount] = useState(0), read = useRpc(readScopeNeeds);
  window.remountScope = () => remount(v => v + 1);
  const decisions = useQuery({ queryKey: NEEDS_YOU_QUERY_KEY, queryFn: () => read({}) });
  const navigation = { openAgent: input => window.scopeActions.push({ name: "navigation.openAgent", input }) };
  const chat = params.has("absent") ? <ScopeDiscussion key={generation} snapshot={{ ...snapshot, scopes: snapshot.scopes.map(s => s.id === "general" ? { ...s, target: { ...s.target, agentId: null }, session: "not-created" } : s) }}
    hostId="local" theme={theme} compact={phone} refresh={() => {}} navigation={navigation} /> :
    <MateChat key={generation} mate={fleet.mate} theme={theme} compact={phone} onChanged={() => {}} onOpenFile={() => {}} imageContext={{ serverId: "local", home: homeId }} navigation={navigation} />;
  return <div style={{ height: "100vh", width: "100%", display: "flex", background: theme.colors.surface0, color: theme.colors.foreground }}>
    {params.has("decisions") ? <div style={{ width: "100%", maxWidth: 760, margin: "auto", padding: 16, overflow: "auto", maxHeight: "100vh" }}><ScopedNeeds snapshot={decisions.data} theme={theme} compact={phone} /></div> :
      <div style={{ display: "flex", flex: 1, maxWidth: phone ? "100%" : 960, margin: "0 auto", minWidth: 0 }}>{chat}</div>}
  </div>;
}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
