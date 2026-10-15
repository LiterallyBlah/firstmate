/**
 * The rest-area host (`docs/ship-deck-rest/host.jsx`: the crowded fleet and `window.deckSpots()`), plus
 * `window.focusAnchor()`: where the camera puts a focused sailor on the page, from the deck's own focus
 * layout and the canvas's size now — so a click there, after a resize, must land on the focused sailor.
 */
import "../ship-deck-rest/host.jsx";
import { focusLayout } from "../../client/deck-camera";

window.focusAnchor = function focusAnchor() {
  const rect = document.querySelector("canvas[data-firstmate-deck]").getBoundingClientRect();
  const layout = focusLayout({ width: rect.width, height: rect.height });
  return { side: layout.side, x: rect.left + layout.anchor.x, y: rect.top + layout.anchor.y };
};
