/**
 * The ship deck's host (`docs/ship-deck-polish/host.jsx`, which brings the canvas harness's), plus what the
 * environment checks need in the page: when the deck's gulls fly, by the deck's own `gullsAt`, and the
 * colours of a canvas screenshot at given points.
 */
import "../ship-deck-polish/host.jsx";
import { gullsAt } from "../../client/deck-ambient";

/** The first second, from `after` on, at which a gull is over the middle of the ship. */
window.gullOverShipAt = function gullOverShipAt(after) {
  for (let t = after; t < after + 600; t += 0.1) {
    if (gullsAt(t).some((gull) => gull.x > 150 && gull.x < 300)) return t;
  }
  return null;
};

/** The RGB at each `[x, y]`, as fractions of the screenshot's width and height. */
window.pixelsAt = async function pixelsAt(png, points) {
  const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  return points.map(([fx, fy]) => {
    const [r, g, b] = context.getImageData(Math.min(image.width - 1, Math.floor(fx * image.width)), Math.min(image.height - 1, Math.floor(fy * image.height)), 1, 1).data;
    return [r, g, b];
  });
};

/** How many pixels differ between two screenshots of the same size, in the band of rows `[from, to)` as fractions. */
window.changedPixels = async function changedPixels(first, second, from = 0, to = 1) {
  const read = async (png) => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, image.width, image.height);
  };
  const [a, b] = [await read(first), await read(second)];
  let changed = 0;
  const top = Math.floor(from * a.height);
  const bottom = Math.floor(to * a.height);
  for (let y = top; y < bottom; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      const index = (y * a.width + x) * 4;
      if (a.data[index] !== b.data[index] || a.data[index + 1] !== b.data[index + 1] || a.data[index + 2] !== b.data[index + 2]) changed += 1;
    }
  }
  return changed;
};
