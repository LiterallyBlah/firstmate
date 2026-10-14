/**
 * The ship deck's host (`docs/ship-deck-environment/host.jsx`, which brings the others'), plus what the
 * tweaks' checks need in the page: the still deck drawn again, independently, with a 2D canvas — hull,
 * sail, props, the crew in their looks, the depth pieces with the mast's occluder, the badges — from the
 * same scene, crew placement, art and layer order the plugin draws with; and where the at-ease sailors stand.
 */
import "../ship-deck-environment/host.jsx";
import { LANTERNS } from "../../client/deck-ambient";
import { badgeInk, badgePixels, BADGE_SIZE } from "../../client/deck-badges";
import { applyCrew, BREATH_ROWS, createCrew, crewFigures } from "../../client/deck-crew";
import { crewLooks, drawnSail } from "../../client/deck-extras";
import { FOAM_TOP } from "../../client/deck-environment";
import { badgeTop, figureBox, toCanvas } from "../../client/deck-hover";
import { fitDeck } from "../../client/deck-pixi";
import { deckLayers, deckScene } from "../../client/deck-scene";

async function decoded(png) {
  const image = new Image();
  image.src = `data:image/png;base64,${png}`;
  await image.decode();
  return image;
}

/** The served art and extras, decoded, and the fixture's crew placed and dressed as the deck does it. */
async function deckState() {
  const art = await (await fetch("/deck-art.json")).json();
  const served = await (await fetch("/deck-extras.json")).json();
  const images = new Map();
  for (const [path, png] of Object.entries(served.images)) images.set(path, await decoded(png));
  const extras = { manifest: served.manifest, images };
  const scene = deckScene(window.fixtureFleet.cards, window.fixtureTheme);
  const crew = createCrew(crewLooks(extras));
  applyCrew(crew, scene.sailors, { snap: true });
  return { art, atlas: await decoded(art.png), extras, scene, figures: crewFigures(crew, 0, { still: true }) };
}

/**
 * The still deck as it should look: one RGBA per art pixel, transparent where the deck draws sky or sea,
 * with the fit and place on the screenshot that `deckPixels` reads it back at. The sail is drawn over the
 * hull and under everything on deck; the mast's piece is the occluder; each sailor is cut from its look.
 */
window.tweaksReference = async function tweaksReference() {
  const { art, atlas, extras, scene, figures } = await deckState();
  const { manifest } = art;
  const sail = drawnSail(extras, manifest.pieces);
  const reference = document.createElement("canvas");
  reference.width = scene.width;
  reference.height = scene.height;
  const context = reference.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = false;
  const blit = (image, [fx, fy, fw, fh], x, y, flip = false) => {
    context.save();
    context.translate(x, y);
    if (flip) context.scale(-1, 1);
    context.drawImage(image, fx, fy, fw, fh, 0, 0, fw, fh);
    context.restore();
  };
  const lookImage = (look) => {
    const extra = extras.manifest.crew.find((each) => each.id === look);
    return extra === undefined ? atlas : extras.images.get(extra.texture);
  };
  const layers = deckLayers(figures, manifest.pieces);
  for (const layer of layers) {
    if (layer.kind === "ship") {
      blit(atlas, manifest.ship.frame, 0, 0);
      if (sail !== null) blit(extras.images.get(sail.texture), [0, 0, sail.frameSize[0], sail.frameSize[1]], sail.position[0], sail.position[1]);
    } else if (layer.kind === "piece") {
      const piece = manifest.pieces[layer.name];
      if (sail !== null && sail.occluder.replaces === layer.name) {
        blit(extras.images.get(sail.occluder.texture), [0, 0, piece.frame[2], piece.frame[3]], sail.occluder.position[0], sail.occluder.position[1]);
      } else blit(atlas, piece.frame, piece.x, piece.y);
    } else if (layer.kind === "prop") {
      const prop = manifest.props[layer.name];
      blit(atlas, prop.frame, layer.x - prop.feet[0], layer.y - prop.feet[1]);
    } else {
      const sailor = layer.figure;
      const pose = manifest.crew[sailor.outfit][sailor.pose];
      const image = lookImage(sailor.look);
      if (sailor.flip) blit(image, pose.frame, sailor.x + pose.feet[0], sailor.y - pose.feet[1], true);
      else blit(image, pose.frame, sailor.x - pose.feet[0], sailor.y - pose.feet[1]);
      const sign = scene.palette.states[sailor.state];
      const ink = `#${badgeInk(sign).toString(16).padStart(6, "0")}`;
      const left = sailor.x - Math.floor(BADGE_SIZE.width / 2);
      const top = badgeTop(sailor, manifest);
      for (const pixel of badgePixels(sailor.state)) {
        context.fillStyle = pixel.kind === "sign" ? sign : ink;
        context.fillRect(left + pixel.x, top + pixel.y, 1, 1);
      }
    }
  }
  const canvas = document.querySelector("canvas[data-firstmate-deck]");
  const box = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio;
  return {
    width: scene.width,
    height: scene.height,
    pixels: Array.from(context.getImageData(0, 0, scene.width, scene.height).data),
    looks: figures.map((figure) => ({ key: figure.key, state: figure.state, look: figure.look, pose: figure.pose, flip: figure.flip })),
    order: layers.map((layer) => (layer.kind === "sailor" ? layer.figure.key : layer.kind === "ship" ? "ship+sail" : `${layer.kind}:${layer.name}`)),
    marks: figures.map((figure) => ({ x: figure.x, y: figure.row })),
    lanterns: LANTERNS.map((lantern) => ({ x: lantern.x, y: lantern.y })),
    /** Below this row the foam and the wake are drawn over the hull, which the reference leaves out. */
    foamTop: FOAM_TOP,
    sail: sail === null ? null : { x: sail.position[0], y: sail.position[1], width: sail.frameSize[0], height: sail.frameSize[1] },
    fit: fitDeck({ width: box.width, height: box.height }, scene, dpr),
    dpr,
    origin: { left: box.left, top: box.top },
  };
};

/** Each at-ease sailor: its key, and its head-and-shoulders and its legs as boxes on the canvas, in CSS px from the canvas's corner. */
window.idleSpots = async function idleSpots() {
  const { art, figures } = await deckState();
  const canvas = document.querySelector("canvas[data-firstmate-deck]");
  const rect = canvas.getBoundingClientRect();
  const fit = fitDeck({ width: rect.width, height: rect.height }, { width: 426, height: 161 }, window.devicePixelRatio);
  const bob = { x: 0, y: 0 };
  return figures
    .filter((figure) => figure.state === "idle")
    .map((figure) => {
      const box = figureBox(figure, art.manifest);
      const corner = (x, y) => toCanvas({ x, y }, fit, bob);
      // Its own top, not the box's, which takes in the badge over its head.
      const top = figure.y - art.manifest.crew[figure.outfit][figure.pose].feet[1];
      const head = [corner(box.left - 1, top - 1), corner(box.right + 1, top + BREATH_ROWS + 1)];
      const legs = [corner(box.left - 1, box.bottom - 10), corner(box.right + 1, box.bottom)];
      const whole = [corner(box.left - 6, box.top - 14), corner(box.right + 6, box.bottom + 3)];
      const asBox = ([a, b]) => ({ x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y });
      return {
        key: figure.key,
        look: figure.look,
        head: asBox(head),
        legs: asBox(legs),
        whole: asBox(whole),
        // The same two, in deck pixels: [left, top, right, bottom).
        art: { head: [box.left - 1, top - 1, box.right + 1, top + BREATH_ROWS + 1], legs: [box.left - 1, box.bottom - 10, box.right + 1, box.bottom] },
      };
    });
};

/** Where the sail and the water astern are on the canvas, in CSS px from its corner. */
window.tweakRegions = function tweakRegions() {
  const canvas = document.querySelector("canvas[data-firstmate-deck]");
  const rect = canvas.getBoundingClientRect();
  const fit = fitDeck({ width: rect.width, height: rect.height }, { width: 426, height: 161 }, window.devicePixelRatio);
  const bob = { x: 0, y: 0 };
  const box = (left, top, right, bottom) => {
    const a = toCanvas({ x: left, y: top }, fit, bob);
    const b = toCanvas({ x: right, y: bottom }, fit, bob);
    return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
  };
  return {
    // The sail's cloth, below its yard (which is the same in both states) and above the crew's heads.
    sail: box(160, 54, 262, 70),
    // The water just astern and under the stern: the churn and the start of the stern wave.
    wake: box(380, 152, Math.min(rect.width / fit.scale, 440), 175),
    // The ship's stern quarter and the water round it, for the close-up.
    stern: box(300, 40, 440, 200),
  };
};

/** `?only=idle` keeps only the fixture's idle and parked cards, so an at-ease sailor can be watched alone. */
const mountPlugin = window.mountPlugin;
window.mountPlugin = function mountOnly(source, params) {
  mountPlugin(source, params);
  if (params.get("only") === "idle") {
    window.fixtureFleet = { ...window.fixtureFleet, cards: window.fixtureFleet.cards.filter((card) => card.column === "idle" || card.column === "parked") };
  }
};

/**
 * A canvas screenshot read back at the centre of every art pixel in each of `boxes` (deck pixels,
 * `[left, top, right, bottom)`), one string per box. At the centres, the device-pixel rounding at a sprite's
 * edge — which differs between a sailor drawn whole and drawn in two parts — does not show.
 */
window.artSample = async function artSample(png, boxes) {
  const image = new Image();
  image.src = `data:image/png;base64,${png}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, image.width, image.height).data;
  const deck = document.querySelector("canvas[data-firstmate-deck]").getBoundingClientRect();
  const dpr = window.devicePixelRatio;
  const fit = fitDeck({ width: deck.width, height: deck.height }, { width: 426, height: 161 }, dpr);
  return boxes.map(([left, top, right, bottom]) => {
    const out = [];
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const at = (Math.floor((fit.y + (y + 0.5) * fit.scale) * dpr) * image.width + Math.floor((fit.x + (x + 0.5) * fit.scale) * dpr)) * 4;
        out.push(data[at], data[at + 1], data[at + 2]);
      }
    }
    return out.join(",");
  });
};
