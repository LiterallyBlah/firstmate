/**
 * The plank's host (`docs/ship-deck-plank/host.jsx`), with the deck's fit from the mast's top to the plank's sea:
 * the top is the page's `top` parameter, the tall mast's top row on that side (-112 on main, -80 trimmed).
 */
import "../ship-deck-plank/host.jsx";
import { deckBox, fitDeck } from "../../client/deck-pixi";

window.deckGrid = function deckGrid() {
  const canvas = document.querySelector("canvas[data-firstmate-deck]");
  const rect = canvas.getBoundingClientRect();
  const box = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  const dpr = window.devicePixelRatio;
  const top = Number(new URLSearchParams(location.search).get("top") ?? 0);
  return { box, dpr, fit: fitDeck({ width: box.width, height: box.height }, deckBox({ width: 426, height: 161 }, top), dpr) };
};
