import { describe, expect, it } from "vitest";

import type { ColumnId, FleetCard, RemoteCard } from "../shared/fleet";
import { ALL_HOSTS, THIS_MACHINE, hostTabs, onTab, shownHostTab, watchKey } from "./host-tabs";
import { activeCrewCount } from "./screen";

function card(key: string, column: ColumnId, remote?: RemoteCard, local = false): FleetCard {
  return {
    key,
    column,
    taskId: null,
    title: key,
    project: null,
    kind: null,
    backlog: null,
    agent: local
      ? {
          id: `agent-${key}`,
          workspaceId: null,
          title: key,
          provider: "claude",
          model: null,
          status: column === "working" ? "running" : "idle",
          cwd: "/",
          pendingPermissions: 0,
          requiresAttention: false,
          lastError: null,
          updatedAt: "",
          labels: {},
        }
      : null,
    report: null,
    url: null,
    ...(remote === undefined ? {} : { remote }),
  };
}

const onLight = (status = "running"): RemoteCard => ({
  serverId: "srv_light",
  host: "Light",
  online: true,
  worker: { id: "w1", name: "w", status, updatedAt: "", pendingPermissions: 0 },
});
const hosts = [
  { serverId: "srv_light", label: "Light", online: true },
  { serverId: "srv_dark", label: "Dark", online: false },
];
const cards = [
  card("here", "working", undefined, true),
  card("light-busy", "working", onLight()),
  card("light-blocked", "blocked", onLight("idle")),
  card("light-failed", "failed", onLight("error")),
  card("light-queued", "queued", { serverId: "srv_light", host: "Light", online: true, worker: null }),
  card("nowhere", "idle", { serverId: null, host: "Shadow", online: false, worker: null }),
];

describe("hostTabs", () => {
  it("draws no row with no remote host saved", () => {
    expect(hostTabs(cards, [])).toEqual([]);
  });

  it("lists All, this machine, then each host, with working and needs-attention counts", () => {
    expect(hostTabs(cards, hosts)).toEqual([
      { id: ALL_HOSTS, label: "All", online: null, working: 2, attention: 2 },
      { id: THIS_MACHINE, label: "This machine", online: null, working: 1, attention: 0 },
      { id: "srv_light", label: "Light", online: true, working: 1, attention: 2 },
      { id: "srv_dark", label: "Dark", online: false, working: 0, attention: 0 },
    ]);
  });

  it("filters to a host's cards; an unsaved host's card shows only under All", () => {
    expect(cards.filter((entry) => onTab(entry, "srv_light")).map((entry) => entry.key)).toEqual([
      "light-busy",
      "light-blocked",
      "light-failed",
      "light-queued",
    ]);
    expect(cards.filter((entry) => onTab(entry, THIS_MACHINE)).map((entry) => entry.key)).toEqual(["here"]);
    expect(cards.filter((entry) => onTab(entry, ALL_HOSTS))).toHaveLength(cards.length);
  });
});

describe("shownHostTab", () => {
  it("keeps the saved tab while its host is saved, and falls back to All", () => {
    expect(shownHostTab("srv_light", hosts)).toBe("srv_light");
    expect(shownHostTab(THIS_MACHINE, hosts)).toBe(THIS_MACHINE);
    expect(shownHostTab("srv_gone", hosts)).toBe(ALL_HOSTS);
    expect(shownHostTab("srv_light", [])).toBe(ALL_HOSTS);
  });
});

describe("watchKey", () => {
  it("is the agent id here, and host plus id for a remote worker", () => {
    expect(watchKey(cards[0]!)).toBe("agent-here");
    expect(watchKey(cards[1]!)).toBe("remote:srv_light:w1");
    expect(watchKey(cards[4]!)).toBeNull();
    expect(watchKey(cards[5]!)).toBeNull();
  });
});

describe("activeCrewCount", () => {
  it("counts remote workers in Working or Idle beside local ones", () => {
    expect(
      activeCrewCount([
        ...cards,
        card("light-idle", "idle", onLight("idle")),
        card("light-closed", "idle", onLight("closed")),
      ]),
    ).toBe(3);
  });
});
