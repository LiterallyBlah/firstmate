/**
 * The plank's host (`docs/ship-deck-plank/host.jsx`), with the deck's fit as the tall mast has it: from the
 * mast's top to the plank's sea when the page is opened with `rig=tall`, the hull's own otherwise.
 */
import "../ship-deck-plank/host.jsx";
import { deckBox, fitDeck } from "../../client/deck-pixi";

window.deckGrid = function deckGrid() {
  const canvas = document.querySelector("canvas[data-firstmate-deck]");
  const rect = canvas.getBoundingClientRect();
  const box = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  const dpr = window.devicePixelRatio;
  const top = new URLSearchParams(location.search).get("rig") === "tall" ? -112 : 0;
  return { box, dpr, fit: fitDeck({ width: box.width, height: box.height }, deckBox({ width: 426, height: 161 }, top), dpr) };
};
