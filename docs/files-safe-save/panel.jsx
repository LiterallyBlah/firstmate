import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FilesView } from "../../client/files";
import { theme as dark } from "../board-list/theme.js";
const params = new URLSearchParams(location.search);
const theme = params.has("light") ? { colors: { ...dark.colors, surface0: "#ffffff", surface1: "#f4f5f4", surface2: "#e9ece9", border: "#d6dbd6", foreground: "#151915", foregroundMuted: "#5b655b" } } : dark;
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById("root")).render(<QueryClientProvider client={client}>
  <FilesView theme={theme} compact={params.has("phone")} request={{ path: "data/backlog.md", at: 1 }} />
</QueryClientProvider>);
