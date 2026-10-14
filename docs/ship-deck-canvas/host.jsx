/**
 * Plays the app's part for a compiled plugin bundle: the modules the host injects, behind a `require`, and
 * the bundle evaluated from source with `(0, globalThis.eval)` and given it — what Paseo 0.11's app does
 * with the `clientBundle` the daemon sends. Then the screen the plugin contributes is rendered with the
 * board-list fixture fleet, through react-native-web and react-dom.
 */
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import * as reactNativeWeb from "react-native-web";
import * as reactQuery from "@tanstack/react-query";
import * as zod from "zod";

import * as contracts from "../board-list/contracts.js";
import { fleet } from "../board-list/fixtures";
import { theme as dark } from "../board-list/theme";
import { LANTERNS, WATERLINE } from "../../client/deck-ambient";
import { applyCrew, createCrew, crewFigures } from "../../client/deck-crew";
import { fitDeck } from "../../client/deck-pixi";
import { deckLayers, deckScene } from "../../client/deck-scene";
import * as stubs from "./stubs.jsx";

const modules = {
  react: React,
  "react/jsx-runtime": jsxRuntime,
  "react-native": reactNativeWeb,
  "@tanstack/react-query": reactQuery,
  zod,
  "@getpaseo/plugin": contracts,
  "@getpaseo/plugin/client": stubs,
  "@getpaseo/plugin/client/react-native": stubs,
  "@getpaseo/plugin/client/ui": stubs,
};

function hostRequire(name) {
  const module = modules[name];
  if (module === undefined) throw new Error(`No host module ${name}`);
  return module;
}

const light = {
  colors: {
    ...dark.colors,
    surface0: "#fff",
    surface1: "#f5f5f5",
    surface2: "#e8e8e8",
    border: "#d3d3d3",
    foreground: "#171717",
    foregroundMuted: "#646464",
    statusWarning: "#88601d",
  },
};

window.mountPlugin = function mountPlugin(source, params) {
  const theme = params.get("theme") === "light" ? light : dark;
  window.fixtureTheme = theme;
  window.fixtureFleet = params.get("deck") === "1" ? { ...structuredClone(fleet), shipDeck: true } : structuredClone(fleet);
  const factory = (0, globalThis.eval)(source);
  const plugin = factory(hostRequire);
  const screens = [];
  const client = new Proxy(
    {},
    {
      get(_target, name) {
        if (name === "addScreen") return (screen) => (screens.push(screen), () => {});
        if (name === "rpc") return () => new Promise(() => {});
        if (typeof name === "string" && name.startsWith("add")) return () => () => {};
        return () => {};
      },
    },
  );
  plugin.default(client);
  const Screen = screens[0].Component;
  const queryClient = new reactQuery.QueryClient({ defaultOptions: { queries: { retry: false } } });
  createRoot(document.getElementById("root")).render(
    <reactQuery.QueryClientProvider client={queryClient}>
      <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
        <Screen theme={theme} layout={{ compact: innerWidth < 600 }} navigation={{ openAgent() {} }} />
      </div>
    </reactQuery.QueryClientProvider>,
  );
};

/**
 * The still deck as it should look, drawn independently with a 2D canvas from the same scene, crew
 * placement, art and layer order the plugin draws with (`deckScene`, `applyCrew`, `deckLayers`, the
 * served atlas): one RGBA per art pixel, transparent where the deck draws sky or sea. Then where each art
 * pixel's centre is on the screenshot, in device pixels, from the canvas's place and the same fit the deck
 * uses. Only a still deck (reduced motion) can be held to it: a moving one bobs and sways.
 */
window.referenceDeck = async function referenceDeck() {
  const art = await (await fetch("/deck-art.json")).json();
  const image = new Image();
  image.src = `data:image/png;base64,${art.png}`;
  await image.decode();
  const { manifest } = art;
  const scene = deckScene(window.fixtureFleet.cards, window.fixtureTheme);
  const reference = document.createElement("canvas");
  reference.width = scene.width;
  reference.height = scene.height;
  const context = reference.getContext("2d");
  context.imageSmoothingEnabled = false;
  // The crew where the deck stands it: the same controller, every sailor at its anchor.
  const crew = createCrew();
  applyCrew(crew, scene.sailors, { snap: true });
  const figures = crewFigures(crew, 0, { still: true });
  const blit = (frame, x, y, flip = false) => {
    const [fx, fy, fw, fh] = frame;
    context.save();
    context.translate(x, y);
    if (flip) context.scale(-1, 1);
    context.drawImage(image, fx, fy, fw, fh, 0, 0, fw, fh);
    context.restore();
  };
  const layers = deckLayers(figures, manifest.pieces);
  for (const layer of layers) {
    if (layer.kind === "ship") blit(manifest.ship.frame, 0, 0);
    else if (layer.kind === "piece") blit(manifest.pieces[layer.name].frame, manifest.pieces[layer.name].x, manifest.pieces[layer.name].y);
    else if (layer.kind === "prop") {
      const prop = manifest.props[layer.name];
      blit(prop.frame, layer.x - prop.feet[0], layer.y - prop.feet[1]);
    } else {
      const sailor = layer.figure;
      const pose = manifest.crew[sailor.outfit][sailor.pose];
      if (sailor.flip) blit(pose.frame, sailor.x + pose.feet[0], sailor.y - pose.feet[1], true);
      else blit(pose.frame, sailor.x - pose.feet[0], sailor.y - pose.feet[1]);
    }
  }
  const pixels = Array.from(context.getImageData(0, 0, scene.width, scene.height).data);

  // Which art pixels are a sailor's, and which of those a depth piece in front of it covers.
  const opaqueIn = (frame, u, v) => {
    const [fx, fy, fw, fh] = frame;
    if (u < 0 || v < 0 || u >= fw || v >= fh) return false;
    return atlasAlpha[(fy + v) * manifest.atlas.width + fx + u] === 255;
  };
  const atlasCanvas = document.createElement("canvas");
  atlasCanvas.width = manifest.atlas.width;
  atlasCanvas.height = manifest.atlas.height;
  const atlasContext = atlasCanvas.getContext("2d");
  atlasContext.drawImage(image, 0, 0);
  const atlasData = atlasContext.getImageData(0, 0, manifest.atlas.width, manifest.atlas.height).data;
  const atlasAlpha = new Uint8Array(manifest.atlas.width * manifest.atlas.height);
  for (let index = 0; index < atlasAlpha.length; index += 1) atlasAlpha[index] = atlasData[index * 4 + 3];
  const sailors = figures.map((sailor) => {
    const pose = manifest.crew[sailor.outfit][sailor.pose];
    const [, , fw, fh] = pose.frame;
    const own = [];
    const hiddenBy = {};
    for (let v = 0; v < fh; v += 1) {
      for (let u = 0; u < fw; u += 1) {
        if (!opaqueIn(pose.frame, u, v)) continue;
        const x = sailor.flip ? sailor.x + pose.feet[0] - u - 1 : sailor.x - pose.feet[0] + u;
        const y = sailor.y - pose.feet[1] + v;
        own.push([x, y]);
        for (const [name, piece] of Object.entries(manifest.pieces)) {
          if (piece.baseline !== null && piece.baseline < sailor.row) continue;
          if (opaqueIn(piece.frame, x - piece.x, y - piece.y)) hiddenBy[name] = (hiddenBy[name] ?? 0) + 1;
        }
      }
    }
    return { key: sailor.key, state: sailor.state, x: sailor.x, y: sailor.y, pose: sailor.pose, outfit: sailor.outfit, flip: sailor.flip, pixels: own, hiddenBy };
  });

  const canvas = document.querySelector("canvas[data-firstmate-deck]");
  const box = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio;
  const fit = fitDeck({ width: box.width, height: box.height }, scene, dpr);
  return {
    counts: scene.counts,
    width: scene.width,
    height: scene.height,
    pixels,
    sailors,
    order: layers.map((layer) => (layer.kind === "sailor" ? layer.figure.key : layer.kind === "ship" ? "ship" : `${layer.kind}:${layer.name}`)),
    marks: figures.map((sailor) => ({ x: sailor.x, y: sailor.row, color: scene.palette.states[sailor.state] })),
    /** What the reference does not draw: the sea from the waterline down, and each lantern with its glow. */
    waterline: WATERLINE,
    lanterns: LANTERNS.map((lantern) => ({ x: lantern.x, y: lantern.y })),
    fit,
    dpr,
    /** Device pixel on the screenshot of art pixel (x, y)'s centre. */
    origin: { left: box.left, top: box.top },
  };
};

/** The colour of each point in a screenshot, read back through a 2D canvas. */
window.pixelsAt = async function pixelsAt(png, points) {
  const image = new Image();
  image.src = `data:image/png;base64,${png}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  return points.map(({ x, y }) => Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3)));
};

/** The screenshot at every art pixel's centre, as one flat RGB array, row by row. */
window.deckPixels = async function deckPixels(png, reference) {
  const image = new Image();
  image.src = `data:image/png;base64,${png}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, image.width, image.height).data;
  const { fit, dpr, origin } = reference;
  const out = [];
  for (let y = 0; y < reference.height; y += 1) {
    for (let x = 0; x < reference.width; x += 1) {
      const sx = Math.floor((origin.left + fit.x + (x + 0.5) * fit.scale) * dpr);
      const sy = Math.floor((origin.top + fit.y + (y + 0.5) * fit.scale) * dpr);
      const at = (sy * image.width + sx) * 4;
      out.push(data[at], data[at + 1], data[at + 2]);
    }
  }
  return out;
};

/**
 * The whole canvas at one sample per art pixel, as RGB rows: what the motion evidence's frames are made
 * of, so a moving deck can be kept small and exact. `grid` is the canvas's box and the deck's fit.
 */
window.artGrid = async function artGrid(png, grid) {
  const image = new Image();
  image.src = `data:image/png;base64,${png}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, image.width, image.height).data;
  const { box, fit, dpr } = grid;
  const left = Math.ceil(-fit.x / fit.scale);
  const top = Math.ceil(-fit.y / fit.scale);
  const width = Math.floor((box.width - fit.x) / fit.scale) - left;
  const height = Math.floor((box.height - fit.y) / fit.scale) - top;
  const rgb = [];
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      const sx = Math.floor((box.left + fit.x + (x + 0.5) * fit.scale) * dpr);
      const sy = Math.floor((box.top + fit.y + (y + 0.5) * fit.scale) * dpr);
      const at = (sy * image.width + sx) * 4;
      rgb.push(data[at], data[at + 1], data[at + 2]);
    }
  }
  return { width, height, rgb };
};

/** The canvas's box and the deck's fit in it, as the deck computes it. */
window.deckGrid = function deckGrid() {
  const canvas = document.querySelector("canvas[data-firstmate-deck]");
  const rect = canvas.getBoundingClientRect();
  const box = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  const dpr = window.devicePixelRatio;
  return { box, dpr, fit: fitDeck({ width: box.width, height: box.height }, { width: 426, height: 161 }, dpr) };
};
