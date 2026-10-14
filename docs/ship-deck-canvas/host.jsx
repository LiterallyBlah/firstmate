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
import { deckScene } from "../../client/deck-scene";
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

/** Where each sailor's body should be on screen, from the same scene code the plugin draws with. */
window.expectedSailors = function expectedSailors() {
  const canvas = document.querySelector("canvas[data-firstmate-deck]");
  const box = canvas.getBoundingClientRect();
  const scene = deckScene(window.fixtureFleet.cards, window.fixtureTheme);
  const scale = Math.min(box.width / scene.width, box.height / scene.height);
  const left = box.left + (box.width - scene.width * scale) / 2;
  const top = box.top + (box.height - scene.height * scale) / 2;
  return {
    counts: scene.counts,
    deckColor: scene.palette.deck,
    // A point on the open deck, between the quarterdeck and the mast, clear of every zone's sailors.
    deckPoint: { x: Math.round(left + 280 * scale), y: Math.round(top + 100 * scale) },
    sailors: scene.sailors.map((sailor) => ({
      key: sailor.key,
      state: sailor.state,
      color: scene.palette.states[sailor.state],
      x: Math.round(left + sailor.x * scale),
      y: Math.round(top + (sailor.y + 4) * scale),
    })),
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
