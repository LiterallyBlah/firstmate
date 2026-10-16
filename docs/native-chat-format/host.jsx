import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import * as reactNativeWeb from "react-native-web";
import * as reactQuery from "@tanstack/react-query";
import * as zod from "zod";
import * as contracts from "../board-list/contracts.js";
import * as stubs from "../deck-settings/stubs.jsx";
import { UserMessage } from "./.generated/native-user-message";
import { darkTheme, lightTheme } from "native-theme";
import { toPluginTheme } from "native-plugin-theme";
import { projectPluginTimelineItems } from "native-projection";
import { transformTimelineItem } from "native-model";
import { board, system, watch } from "./fixtures";

const params = new URLSearchParams(location.search);
export const nativeTheme = params.get("theme") === "light" ? lightTheme : darkTheme;
window.nativeTheme = nativeTheme;
const theme = toPluginTheme(nativeTheme);
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
const timelineTransformers = [],
  timelineRenderers = [];
window.mountPlugin = function (source) {
  const plugin = (0, globalThis.eval)(source)((name) => {
    if (!(name in modules)) throw new Error(`Missing host module ${name}`);
    return modules[name];
  });
  const client = new Proxy(
    {},
    {
      get(_target, name) {
        if (name === "addTimelineTransformer") return (item) => (timelineTransformers.push(item), () => {});
        if (name === "addTimelineRenderer") return (item) => (timelineRenderers.push(item), () => {});
        if (name === "rpc") return () => new Promise(() => {});
        return () => () => {};
      },
    },
  );
  plugin.default(client);
  const installed = { id: "firstmate", timelineTransformers, timelineRenderers };
  const transform = (input) => transformTimelineItem({ ...input, plugins: [installed] });
  const message = (id, text) => ({ kind: "user_message", id, text, timestamp: new Date("2026-10-16T12:00:00Z") });
  const firstMate = [
    message("captain", "Check the crew's progress and reconcile the login fix."),
    message("watch", watch),
    message("board", board),
  ];
  const second = [
    message("second-captain", "Explain how <firstmate-board> is mentioned in documentation."),
    message("second-system", system),
    message("second-quote", `Example:\n${watch}`),
  ];
  const fixtures = params.get("agent") === "second" ? second : firstMate;
  const projected = projectPluginTimelineItems(fixtures, transform);
  // Paseo's own projection/cache must retain the second agent's source array and
  // untouched objects, and keep replacement identity on repeated projections.
  if (projectPluginTimelineItems(second, transform) !== second) throw new Error("Second-agent rows changed");
  if (projectPluginTimelineItems(fixtures, transform)[1] !== projected[1])
    throw new Error("Projection cache identity changed");
  const safety = [
    { kind: "assistant_message", id: "assistant", text: board },
    { kind: "thought", id: "reasoning", text: watch, status: "loading" },
    { kind: "notification", id: "error", message: watch, sourceType: "error", level: "error" },
    { kind: "notification", id: "permission", message: "Permission required", level: "info" },
    {
      kind: "tool_call",
      id: "tool",
      payload: {
        source: "agent",
        data: {
          callId: "c",
          name: "Read",
          status: "completed",
          error: null,
          detail: { type: "plain_text", text: watch },
        },
      },
    },
  ];
  if (projectPluginTimelineItems(safety, transform) !== safety) throw new Error("A protected source row changed");
  window.fixtureChecks = {
    registrations: timelineTransformers.length,
    secondUnchanged: true,
    protectedUnchanged: true,
    cacheStable: true,
  };
  document.body.style.backgroundColor = nativeTheme.colors.surface0;
  document.body.style.color = nativeTheme.colors.foreground;
  createRoot(document.getElementById("root")).render(
    <main
      style={{ maxWidth: 850, margin: "0 auto", padding: innerWidth < 600 ? 14 : 28, fontFamily: "Arial, sans-serif" }}
    >
      <h2 style={{ margin: "0 0 6px", fontSize: 18 }}>
        {params.get("agent") === "second" ? "Second agent" : "First mate"} · native timeline fixture
      </h2>
      <p style={{ color: nativeTheme.colors.foregroundMuted, fontSize: 12 }}>
        Paseo source user rows + timeline projection; synthetic messages. No installed plugin or live session.
      </p>
      {projected.map((row) => {
        if (row.kind !== "plugin")
          return <UserMessage key={row.id} message={row.text} timestamp={row.timestamp.getTime()} />;
        const renderer = timelineRenderers.find((r) => r.kind === row.itemKind && r.version === row.version);
        const data = renderer.schema.parse(row.data);
        return (
          <renderer.Component
            key={row.id}
            agentId="fixture-mate"
            item={{ type: "plugin", kind: row.itemKind, version: row.version, data }}
            timestamp={row.timestamp}
            theme={theme}
            host={{ id: "fixture", label: "Fixture" }}
            layout={{ platform: "web", compact: innerWidth < 600 }}
          />
        );
      })}
    </main>,
  );
};
