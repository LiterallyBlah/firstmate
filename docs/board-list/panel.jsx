import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FleetSurface, bindSettingsOpener } from "../../client/fleet";
import { theme } from "./theme";

bindSettingsOpener(() => {});
const phone = window.innerWidth < 600;
const colors = theme.colors;
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={client}>
    <div
      style={{
        height: "100vh",
        display: "flex",
        color: colors.foreground,
        background: colors.surface0,
      }}
    >
      {phone ? null : (
        <aside
          style={{
            width: 400,
            flexShrink: 0,
            background: "#171b18",
            borderRight: `1px solid ${colors.border}`,
            padding: 24,
            boxSizing: "border-box",
          }}
        >
          {["＋ New workspace", "◷ History", "⌕ Search", "◷ Schedules", "⚓ FirstMate", "Bots"].map((text) => (
            <div
              key={text}
              style={{
                padding: "14px 8px",
                color: colors.foregroundMuted,
                fontSize: 20,
              }}
            >
              {text}
            </div>
          ))}
          <div
            style={{
              borderTop: `1px solid ${colors.border}`,
              margin: "18px -24px",
              padding: "20px 24px",
              color: colors.foregroundMuted,
            }}
          >
            Workspaces
          </div>
          {[
            "Hermes",
            "Provision Proxmox",
            "Retrieve drafts",
            "Ariadne",
            "fm/brief-helper",
            "fm/tone-controls",
            "fm/chapter-review",
            "Hecate",
            "Review panel",
          ].map((text) => (
            <div key={text} style={{ padding: "16px 8px", fontSize: 18 }}>
              {text}
              <div
                style={{
                  color: colors.foregroundMuted,
                  fontSize: 14,
                  paddingTop: 5,
                }}
              >
                Light
              </div>
            </div>
          ))}
        </aside>
      )}
      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {phone ? null : (
          <div
            style={{
              height: 70,
              flexShrink: 0,
              borderBottom: `1px solid ${colors.border}`,
              display: "flex",
              alignItems: "center",
              paddingLeft: 24,
              fontSize: 20,
            }}
          >
            FirstMate
          </div>
        )}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            zoom: phone ? 1 : 2,
          }}
        >
          <FleetSurface theme={theme} layout={{ compact: phone }} navigation={{ openAgent() {} }} />
        </div>
      </main>
    </div>
  </QueryClientProvider>,
);
