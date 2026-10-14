/**
 * The ship deck's host (`docs/ship-deck-canvas/host.jsx`), plus what the polish checks need in the page:
 * where each sailor is on screen, worked out with the deck's own crew placement, fit and hit boxes, and
 * the ship's drawn width read off a screenshot without any of the deck's code.
 */
import "../ship-deck-canvas/host.jsx";
import { applyCrew, createCrew, crewFigures } from "../../client/deck-crew";
import { figureBox, sailorAt, toCanvas } from "../../client/deck-hover";
import { fitDeck } from "../../client/deck-pixi";
import { deckScene } from "../../client/deck-scene";

/** Each sailor of the fixture fleet: its key, its title, and the middle of its box on screen in CSS px. */
window.sailorSpots = async function sailorSpots() {
  const art = await (await fetch("/deck-art.json")).json();
  const { manifest } = art;
  const canvas = document.querySelector("canvas[data-firstmate-deck]");
  const rect = canvas.getBoundingClientRect();
  const fit = fitDeck({ width: rect.width, height: rect.height }, { width: 426, height: 161 }, window.devicePixelRatio);
  const scene = deckScene(window.fixtureFleet.cards, window.fixtureTheme);
  const crew = createCrew();
  applyCrew(crew, scene.sailors, { snap: true });
  const figures = crewFigures(crew, 0, { still: true });
  const bob = { x: 0, y: 0 };
  return figures.map((figure) => {
    const box = figureBox(figure, manifest);
    const middle = { x: figure.x, y: (box.top + box.bottom) / 2 };
    const at = toCanvas(middle, fit, bob);
    const front = sailorAt(figures, manifest, middle);
    const sailor = scene.sailors.find((each) => each.key === figure.key);
    const frontSailor = scene.sailors.find((each) => each.key === front.key);
    return {
      key: figure.key,
      state: figure.state,
      title: sailor.caption.title,
      frontKey: front.key,
      frontTitle: frontSailor.caption.title,
      frontStatus: frontSailor.caption.status,
      x: rect.left + at.x,
      y: rect.top + at.y,
    };
  });
};

/**
 * The ship's drawn extent on a canvas screenshot, in device pixels, found by colour alone: above the
 * horizon (the first row that is not the background from edge to edge) every pixel that is not the
 * background is the ship — hull, rigging, the crew and their badges.
 */
window.shipExtent = async function shipExtent(png) {
  const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const { data, width, height } = context.getImageData(0, 0, image.width, image.height);
  const at = (x, y) => (y * width + x) * 4;
  // The frame's rounded corners show the page behind: sample the sky in the middle, and skip the edges.
  const edge = 12;
  const sky = at(Math.floor(width / 2), edge);
  const background = [data[sky], data[sky + 1], data[sky + 2]];
  const isBackground = (x, y) => {
    const index = at(x, y);
    return Math.abs(data[index] - background[0]) + Math.abs(data[index + 1] - background[1]) + Math.abs(data[index + 2] - background[2]) < 12;
  };
  let horizon = height;
  for (let y = edge; y < height; y += 1) {
    let filled = 0;
    for (let x = edge; x < width - edge; x += 1) if (!isBackground(x, y)) filled += 1;
    if (filled >= width - edge * 2 - 2) {
      horizon = y;
      break;
    }
  }
  let left = width;
  let right = -1;
  let top = height;
  for (let y = edge; y < horizon; y += 1) {
    for (let x = edge; x < width - edge; x += 1) {
      if (isBackground(x, y)) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
    }
  }
  return { canvasWidth: width, canvasHeight: height, left, right, top, horizon, shipWidth: right - left + 1 };
};
