import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { DeckSettingSummary } from "../shared/deck-rpc";
import type { ShipDeckView } from "./ship-deck";
import type { PluginTheme } from "@getpaseo/plugin";
const theme = { colors: { statusWarning: "#ff0000", foregroundMuted: "#888888" } } as PluginTheme;

const state = vi.hoisted(() => ({ data: undefined as DeckSettingSummary[] | undefined, isError: false, drawn: [] as ComponentProps<typeof ShipDeckView>[] }));
vi.mock("react-native", () => ({ View: "View", Text: "Text" }));
vi.mock("./deck-setting-query", () => ({ useDeckSettings: () => state }));
vi.mock("./ship-deck", () => ({ ShipDeckView: (props: ComponentProps<typeof ShipDeckView>) => { state.drawn.push(props); return null; } }));
import { SelectedDeckView } from "./deck-setting-view";

let renderer: ReactTestRenderer | null = null;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { act(() => renderer?.unmount()); renderer = null; state.data = undefined; state.isError = false; state.drawn = []; });
const pack = (id: string, compatible = true): DeckSettingSummary => ({ id, compatible, name: id, reason: compatible ? null : "new format", version: "1.0.0", formatVersion: 1, preview: null, bytes: 0 });
const view = (setting: string) => createElement(SelectedDeckView, { setting, cards: [], theme });
const text = () => renderer!.root.findAll((node) => (node.type as unknown) === "Text").map((node) => node.children.join("")).join(" ");

it("waits for a non-default choice and passes only a compatible installed id to the engine", async () => {
  await act(async () => { renderer = create(view("studio")); });
  expect(state.drawn).toEqual([]);
  expect(text()).toContain("Loading deck settings");
  state.data = [pack("ship"), pack("studio")];
  await act(async () => renderer!.update(view("studio")));
  expect(state.drawn.at(-1)!.setting).toBe("studio");
  expect(text()).toBe("");
});

it("falls back with a notice for removed, incompatible or unreadable metadata", async () => {
  state.data = [pack("ship"), pack("future", false)];
  await act(async () => { renderer = create(view("future")); });
  expect(state.drawn.at(-1)!.setting).toBe("ship");
  expect(text()).toContain("new format");
  await act(async () => renderer!.update(view("removed")));
  expect(text()).toContain("not installed");
  state.data = undefined;
  state.isError = true;
  await act(async () => renderer!.update(view("removed")));
  expect(text()).toContain("could not be checked");
  expect(state.drawn.at(-1)!.setting).toBe("ship");
});

it("falls back once when a chosen pack fails, and retries after a later choice", async () => {
  state.data = [pack("ship"), pack("studio")];
  await act(async () => { renderer = create(view("studio")); });
  await act(async () => state.drawn.at(-1)!.onFailure!());
  expect(state.drawn.at(-1)!.setting).toBe("ship");
  expect(text()).toContain('"studio" could not start');
  const before = state.drawn.length;
  await act(async () => state.drawn.at(-1)!.onFailure!());
  expect(state.drawn).toHaveLength(before);
  await act(async () => renderer!.update(view("ship")));
  await act(async () => renderer!.update(view("studio")));
  expect(state.drawn.at(-1)!.setting).toBe("studio");
  expect(text()).toBe("");
});

it("keeps a known compatible setting during a metadata refresh failure", async () => {
  state.data = [pack("ship"), pack("studio")]; state.isError = true;
  await act(async () => { renderer = create(view("studio")); });
  expect(state.drawn.at(-1)!.setting).toBe("studio");
  expect(text()).toBe("");
});
