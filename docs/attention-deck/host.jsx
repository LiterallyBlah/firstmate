import React from "react";
import { createRoot } from "react-dom/client";
import { View, Text } from "react-native";
import { ShipDeckView } from "../../client/ship-deck";
import { attentionCards, attentionSnapshot, attentionTheme } from "../../test/attention-deck-fixture";

const params = new URLSearchParams(location.search);
window.fixtureCalls = [];
window.decisionActions = [];
function Harness() {
  const [snapshot, setSnapshot] = React.useState(attentionSnapshot());
  window.fixtureDecisionAsOf = snapshot.freshness.asOf;
  window.setDecisionSnapshot = setSnapshot;
  const theme = params.get("theme") === "light" ? { ...attentionTheme, colors: { ...attentionTheme.colors, surface0: "#F4F5F3", surface1: "#FFFFFF", surface2: "#E8EBE7", foreground: "#202522", foregroundMuted: "#5B665F", border: "#C9D1CB" } } : attentionTheme;
  return <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
    <ShipDeckView cards={attentionCards} theme={theme} setting={params.get("setting") ?? "ship"}
      needsYou={snapshot} onOpenDecision={id => window.decisionActions.push(id)}
      renderFocus={card => <Text style={{ color: theme.colors.foreground }}>{card.title}</Text>} />
  </View>;
}
createRoot(document.getElementById("root")).render(<Harness />);
