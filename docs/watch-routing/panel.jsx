import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WatchList } from "../../client/watches";
import { theme as dark } from "../board-list/theme";
const theme = location.search.includes("light") ? { colors: { surface0: "#fff", surface1: "#f5f5f5", surface2: "#ebebeb", border: "#dedede", foreground: "#171717", foregroundMuted: "#686868", accent: "#20744a", accentForeground: "#fff", statusSuccess: "#307b40", statusWarning: "#996512", statusDanger: "#b53629" } } : dark;
window.fixtureTheme = theme;
const current = { executionSession: "current", newSessionReasoning: "inherit", notificationPolicy: "never" };
window.watchRows = [{ name: "pr-watch", schedule: "*/5 * * * *", enabled: true, invalid: null, running: false, lastRunAt: "2026-10-10T12:00:00Z", lastResult: "silent", lastOutput: null, lastOutputAt: null, lastError: null, builtIn: true, outdated: false, routing: current }];
function Panel() {
  const [watches, setWatches] = useState([...window.watchRows]);
  return <div style={{ color: theme.colors.foreground, background: theme.colors.surface0, minHeight: "100vh", padding: 20, boxSizing: "border-box", fontFamily: "Segoe UI,sans-serif" }}>
    <div style={{ maxWidth: 760, margin: "0 auto" }}><h2>Watches</h2><p>Scheduled inspections and script outputs</p>
      <WatchList watches={watches} theme={theme} onChanged={() => setWatches([...window.watchRows])} onOpenFile={(path) => { window.watchOpenedFile = path; }} />
    </div>
  </div>;
}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Panel /></QueryClientProvider>);
