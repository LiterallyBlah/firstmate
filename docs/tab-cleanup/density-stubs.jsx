export * from "./list-stubs.jsx";
import { fleet, snapshot } from "../board-list/fixtures.js";

// A busy pane with many plain tags and a prompt long enough to need expansion.
for (const [index, card] of fleet.cards.entries()) {
  card.tags = [...(card.tags ?? []), `review-${String(index + 1).padStart(2, "0")}`];
}
fleet.suggestions[0].prompt +=
  " Check the narrow pane, retained filters, and the full suggestion text before sending. ".repeat(8);
window.densityPrompt = fleet.suggestions[0].prompt;
const scenario = new URLSearchParams(location.search).get("scenario");
if (scenario === "empty") {
  fleet.cards = [];
  fleet.suggestions = [];
  snapshot.hosts = [];
}
if (scenario === "offline") {
  const host = snapshot.hosts[1];
  host.label = "Light with a very long machine name";
  host.online = false;
  host.error = "Connection timed out";
  host.clockSkew = { seconds: 300, measuredAt: host.checkedAt };
}
