import { act, createElement } from "react";
import { create } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { attentionSnapshot, attentionRequest, attentionTheme } from "../test/attention-deck-fixture";
import type { NeedsYouSnapshot } from "../shared/needs-you";
const state = vi.hoisted(() => ({ data: null as NeedsYouSnapshot | null, error: null as Error | null }));
vi.mock("@getpaseo/plugin/client/ui", () => ({ SidebarRow: "SidebarRow" }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ useToast: () => ({ show() {} }) }));
vi.mock("./needs-you-query", () => ({ useNeedsYou: () => state }));
vi.mock("./needs-you", () => ({ NeedsYouBadge: () => null }));
import { FleetSidebarItem } from "./sidebar";
it.each(["new", "seen", "empty", "stale", "offline"])("routes the whole sidebar row under the %s policy", async kind => {
  state.data = attentionSnapshot([attentionRequest("a")]);
  state.data.newCount = kind === "seen" || kind === "empty" ? 0 : 1;
  if (kind === "empty") state.data.actionCount = 0;
  if (kind === "stale") state.data.freshness.status = "stale";
  state.error = kind === "offline" ? new Error("Offline") : null;
  const openScreen = vi.fn(), client = new QueryClient();
  let renderer: ReturnType<typeof create>;
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client }, createElement(FleetSidebarItem, { theme: attentionTheme, openScreen } as never))); });
  try {
    await act(async () => renderer.root.findByType("SidebarRow" as never).props.onPress());
    expect(openScreen).toHaveBeenCalledWith(kind === "new" ? { screenId: "fleet", params: { decision: "next", decisionHome: state.data!.homeId } } : { screenId: "fleet" });
  } finally { await act(async () => renderer.unmount()); client.clear(); }
});
