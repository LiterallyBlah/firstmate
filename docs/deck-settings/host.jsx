/**
 * Plays the app's part for a compiled plugin bundle, as `docs/ship-deck-canvas/host.jsx` does, but imports
 * nothing of the deck's own code: the gate renders main's bundle and the branch's through this one host, so it
 * must not depend on either's modules. The screen is rendered with the board-list fixture fleet.
 *
 * - `?working=N` puts the first N live crewmates of the fleet to work and the rest to rest (Idle);
 * - `window.changeFleet(fn)` edits the fixture for the next poll; `window.fixtureFleetError` loses the feed.
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

/** A card with a live worker on deck (the deck's own `hasLiveWorker`), not on the board's Done or Queued. */
function live(card) {
  if (card.column === "done" || card.column === "queued") return false;
  if (card.agent !== null) return card.agent.status !== "closed";
  const worker = card.remote?.worker ?? null;
  return worker !== null && !worker.followed && worker.status !== "closed";
}

function withWorking(cards, count) {
  let put = 0;
  return cards.map(function (card) {
    if (!live(card)) return card;
    put += 1;
    return { ...card, column: put <= count ? "working" : "idle", note: null };
  });
}

window.changeFleet = function changeFleet(change) {
  const next = structuredClone(window.fixtureFleet);
  change(next);
  window.fixtureFleet = next;
};

window.mountPlugin = function mountPlugin(source, params) {
  const theme = params.get("theme") === "light" ? light : dark;
  window.fixtureTheme = theme;
  window.fixtureFleet = structuredClone(fleet);
  const working = params.get("working");
  if (working !== null) window.fixtureFleet.cards = withWorking(window.fixtureFleet.cards, Number(working));
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
