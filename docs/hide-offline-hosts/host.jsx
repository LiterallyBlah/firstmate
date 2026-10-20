import React from "react";
import { createRoot } from "react-dom/client";
import { View } from "react-native";
import { ShipDeckView } from "../../client/ship-deck";
import { attentionCard, attentionSnapshot, attentionTheme } from "../../test/attention-deck-fixture";

const params = new URLSearchParams(location.search);
window.fixtureCalls = [];
const locals = [attentionCard("Build the feature", "working"), attentionCard("Review the patch", "ready"), attentionCard("Paused work", "parked")];
const snapshot = attentionSnapshot([]);
function Harness() {
  const [offline, setOffline] = React.useState(params.get("offline") !== "0");
  const [mounted, setMounted] = React.useState(true);
  const [setting, setSetting] = React.useState("ship");
  window.setOffline = setOffline; window.setMounted = setMounted; window.setSetting = setSetting;
  const cards = React.useMemo(() => [...locals, ...Array.from({ length: 12 }, (_, i) => ({
    ...attentionCard(`Light worker ${i + 1}`, "working", false), key: `light-${i}`,
    remote: { serverId: "light-fixture", host: "Light", online: !offline, clockSkewSeconds: 0,
      worker: { id: `worker-${i}`, name: `Light worker ${i + 1}`, status: "running", updatedAt: "2026-10-19T12:00:00Z", pendingPermissions: 0, permissionDetails: [], recentTools: [], followed: false } },
  }))], [offline]);
  const theme = params.get("theme") === "light" ? { ...attentionTheme, colors: { ...attentionTheme.colors,
    surface0: "#F4F5F3", surface1: "#FFFFFF", surface2: "#E8EBE7", foreground: "#202522", foregroundMuted: "#5B665F", border: "#C9D1CB" } } : attentionTheme;
  return <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
    {mounted ? <ShipDeckView hostId="fixture-daemon" cards={cards} theme={theme} setting={setting}
      hideDisconnectedWorkers={params.get("hide") !== "0"} needsYou={snapshot} /> : null}
  </View>;
}
createRoot(document.getElementById("root")).render(<Harness />);
