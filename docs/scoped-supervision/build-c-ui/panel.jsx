import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DecisionDrawer } from "../../../client/decision-drawer";
import { ScopedCaptainDecisionDetails } from "../../../client/scoped-captain-decision";
import { ScopedCaptainDecisionSchema } from "../../../shared/scoped-captain-decision";
import { needs, snapshot as scopeSnapshot, projectId, planId, homeId } from "../s05-ui/fixtures";
import { theme as dark } from "../../board-list/theme";
const light = { colors: { ...dark.colors, surface0: "#ffffff", surface1: "#f4f6f5", surface2: "#e8ecea", border: "#ced5d1", foreground: "#17211b", foregroundMuted: "#4d5c53", accent: "#17603b", accentForeground: "#ffffff", statusWarning: "#79551f", statusDanger: "#a32d25" } };
const params = new URLSearchParams(location.search), theme = params.get("theme") === "light" ? light : dark, compact = innerWidth < 600;
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const directory = scopeSnapshot.scopes.map(s => ({ id: s.id, kind: s.kind, title: s.title, projectIds: s.kind === "general" ? [] : [projectId], projectNames: s.kind === "general" ? [] : ["reader"], planId: s.planId }));
directory.push({ id: "maintenance-scope", kind: "maintenance", title: "Daily checks", projectIds: [], projectNames: [], planId: null });
const source = { ...needs, scopeFiltersEnabled: true, scopeDirectory: directory,
  scopedHolds: [{ id: "00000000-0000-4000-8000-000000000777", version: 1, scopeId: planId, planId: "reader-pass", operations: ["plan.start"], reason: "Required verification evidence is missing; this plan stays held.", sourceVector: [{ kind: "workflow", id: "reader-pass", version: 1, digest: "a".repeat(64) }], state: "held" }],
  quarantined: [{ line: 12, taskId: null, key: null, hasHold: true, problem: "Unidentified task scope requires reconciliation." }], actionCount: 2 };
function decision(origin) { return ScopedCaptainDecisionSchema.parse({ format: "firstmate.scoped-captain-decision/1", homeId, scope: { kind: origin, id: `${origin}-scope` },
  origin: { kind: origin, id: `${origin}-fixture` }, decisionId: `${origin}-choice`, revision: 2, subjectHash: "b".repeat(64), title: `${origin} captain escalation (fixture)`,
  question: origin === "project" ? "Which allocation should this project use for the next trial?" : "Should the maintenance job remain in observe mode?",
  options: [{ number: 1, id: "bounded", label: "Keep the current bound" }, { number: 2, id: "review", label: "Review a revised bound" }], recommendation: "bounded",
  evidence: [{ ref: `${origin}/fixture-evidence@2`, digest: "b".repeat(64) }], projectIds: origin === "project" ? [projectId] : [], permittedActions: [] }); }
window.buildCSource = source; window.buildCNavigation = []; window.scopeSnapshot = scopeSnapshot;
function App() {
  const [destination, setDestination] = useState({ requestId: "all", homeId });
  return params.has("origins") ? <div style={{ overflow: "auto", height: "100vh", padding: 20, boxSizing: "border-box", background: theme.colors.surface0 }}>
    {["project", "maintenance"].map(origin => <section key={origin} style={{ marginBottom: 32 }}><h2 style={{ color: theme.colors.foreground, fontSize: 18 }}>{origin} captain escalation · fixture only</h2>
      <ScopedCaptainDecisionDetails decision={decision(origin)} theme={theme} /><p style={{ color: theme.colors.foregroundMuted }}>The emitting service supplies its checked outbox; this fixture sends nothing.</p></section>)}
  </div> : <DecisionDrawer theme={theme} snapshot={source} compact={compact} offline={false} modal={false} destination={destination} onSelect={setDestination}
    onClose={() => window.buildCNavigation.push("close")} mateId={null} suggestions={[]} />;
}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
