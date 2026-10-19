import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DecisionAsk, DecisionMaterials } from "../../client/decision-context";
import { theme } from "../board-list/theme.js";

const source = { ask: "Send data/review/draft-reply.md to https://github.com/example/project/discussions/42 after reviewing data/review/spec.md?",
  specPath: "data/review/spec.md", notesPath: "data/review/notes.md", reportPath: null, url: null };
const props = { theme, source, homeId: "fixture-home", compact: innerWidth < 638, onOpenFile: path => { window.openedFile = path; } };
createRoot(document.getElementById("root")).render(<QueryClientProvider client={new QueryClient()}>
  <main style={{ maxWidth: 560, padding: 24, color: theme.colors.foreground, background: theme.colors.surface0, display: "grid", gap: 20 }}>
    <h2>Choose the reply to the maintainer</h2>
    <DecisionAsk {...props} /><DecisionMaterials {...props} />
  </main>
</QueryClientProvider>);
