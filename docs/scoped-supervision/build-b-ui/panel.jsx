import { createRoot } from "react-dom/client";
import { MigrationOperations } from "../../../client/migration-operations";
import { theme as dark } from "../../board-list/theme";
const light = { colors: { ...dark.colors, surface0: "#f6f8f7", surface1: "#fff", border: "#c9d2cc", foreground: "#16241b", foregroundMuted: "#52635a" } };
const theme = new URLSearchParams(location.search).get("theme") === "light" ? light : dark;
window.fixtureTheme = theme; window.migrationActions = [];
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fixture = { enabled: true, operatorEnabled: true, homeId: "fixture-home", problems: [], plans: [], audits: [], migrations: [{ id: uuid(1), planId: "scheduler", state: "prepared",
  imported: { attempts: [uuid(2), uuid(3)], budget: { agents: 3, turns: 6 } },
  prerequisites: { snapshot: { path: "C:/approved-backup/firstmate/" + uuid(1), retention: "30 days under the approved operator retention policy" } } }],
  dispositions: [{ id: uuid(4), migrationId: uuid(1), source: "worker-callback", route: "hold", removal: { state: "retained" }, reason: "Known original callback owner must be drained and explicitly reconciled; association never transfers live callbacks." }],
  resumeMigrations: [{ migrationId: uuid(1), plan: "scheduler", scopeId: uuid(5), projectId: uuid(6), prerequisites: { inventory: "known originals drained", rollbackBuild: "reviewed compatible writer", policy: "source-bound policy" } }] };
document.body.style.cssText = `margin:0;background:${theme.colors.surface0};font-family:system-ui`;
createRoot(document.getElementById("root")).render(<div style={{ maxWidth: 850, padding: 16 }}><MigrationOperations theme={theme} data={fixture} onRead={() => {}} /></div>);
