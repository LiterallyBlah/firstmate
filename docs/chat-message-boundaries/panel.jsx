import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MateChat } from "../../client/chat";
import { CrewmateView } from "../../client/crewmate";
import { fleet } from "../board-list/fixtures";
import { theme as dark } from "../board-list/theme";
import { observedBoundary } from "./fixtures";

const light = {
  colors: {
    ...dark.colors,
    surface0: "#ffffff",
    surface1: "#f5f5f5",
    surface2: "#ececec",
    border: "#d8d8d8",
    foreground: "#171717",
    foregroundMuted: "#686868",
  },
};
const theme = location.search.includes("light") ? light : dark;
const compact = innerWidth < 600;
const watch = location.search.includes("watch");
const noop = () => {};
window.boundaryObserved = observedBoundary;
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
function App() {
  const [revision, setRevision] = useState(0);
  window.boundaryRemount = () => setRevision((n) => n + 1);
  return (
    <QueryClientProvider client={client}>
      <main
        style={{
          width: "100%",
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          background: theme.colors.surface0,
          color: theme.colors.foreground,
        }}
      >
        <header
          style={{
            fontSize: 15,
            padding: 12,
            borderBottom: `1px solid ${theme.colors.border}`,
          }}
        >
          FirstMate · {watch ? "Watch" : "Chat"} · reported worker-completion boundary
        </header>
        <div
          data-testid="transcript"
          style={{
            display: "flex",
            flex: 1,
            minHeight: 0,
            flexDirection: "column",
          }}
          key={revision}
        >
          {watch ? (
            <CrewmateView
              agentId="fixture"
              card={null}
              theme={theme}
              compact={compact}
              onBack={noop}
              onOpen={null}
              onChanged={noop}
            />
          ) : (
            <MateChat mate={fleet.mate} theme={theme} compact={compact} onChanged={noop} onOpenFile={noop} />
          )}
        </div>
      </main>
    </QueryClientProvider>
  );
}
createRoot(document.getElementById("root")).render(<App />);
