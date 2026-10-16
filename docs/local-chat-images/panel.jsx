import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MateChat } from "../../client/chat";
import { fleet } from "../board-list/fixtures";
import { theme as dark } from "../board-list/theme";
const theme = location.search.includes("light") ? { colors: { ...dark.colors, surface0: "#fff", surface1: "#f5f5f5", surface2: "#ececec", border: "#d8d8d8", foreground: "#171717", foregroundMuted: "#686868" } } : dark;
window.fixtureTheme = theme;
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById("root")).render(<QueryClientProvider client={client}>
  <main style={{ height: "100vh", display: "flex", flexDirection: "column", background: theme.colors.surface0 }}>
    <header style={{ padding: 14, color: theme.colors.foreground, borderBottom: `1px solid ${theme.colors.border}` }}>FirstMate · Chat · file image fixture</header>
    <MateChat mate={fleet.mate} theme={theme} compact={innerWidth < 600} onChanged={() => {}} onOpenFile={() => { throw new Error("Image entered text editor"); }}
      imageContext={{ serverId: "fixture-local", home: window.imageFixture.home }} />
  </main>
</QueryClientProvider>);
