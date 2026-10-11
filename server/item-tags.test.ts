import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentSummary, FleetCard } from "../shared/fleet";
import { CREW_LABELS } from "../shared/fleet";
import type { RemoteSnapshot } from "../shared/remotes";
import {
  itemTagKey,
  ItemTagSchema,
  matchesTags,
  tagChoices,
} from "../shared/item-tags";
import { parseBacklog } from "./backlog";
import { buildCards } from "./fleet";
import {
  changeItemTag,
  findTagItem,
  ITEM_TAGS_FILE,
  readItemTags,
  withItemTags,
} from "./item-tags";

const homes: string[] = [];
async function fixture(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "firstmate-item-tags-"));
  homes.push(home);
  await mkdir(join(home, "data"));
  return home;
}
afterEach(async () => {
  await Promise.all(
    homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
  );
});

const backlog = (section = "Queued", metadata = "(project: web)"): FleetCard =>
  buildCards(
    parseBacklog(`## ${section}\n- [ ] tags - Keep the title ${metadata}`),
    [],
  )[0]!;
const worker: AgentSummary = {
  id: "a1",
  workspaceId: "w1",
  title: "Keep the title",
  provider: "codex",
  model: null,
  status: "idle",
  cwd: "fixture",
  pendingPermissions: 0,
  requiresAttention: false,
  lastError: null,
  updatedAt: "2026-10-11T00:00:00Z",
  labels: { [CREW_LABELS.task]: "tags", [CREW_LABELS.project]: "web" },
};

describe("plain item tags", () => {
  it("extends metadata without changing titles, status, unknown fields, dependencies or operational labels", () => {
    const line =
      "## In flight\r\n- [ ] tags - Keep the title (tags: Frontend, Dashboard, frontend) (tags: Docs) (project: web) (kind: ship) (agent: a1) (hold: approval) (review-head: deadbeef) (since 2026-10-10) blocked-by: other https://github.com/o/r/pull/1\r\n";
    const item = parseBacklog(line)[0]!;
    expect(item).toMatchObject({
      title: "Keep the title",
      tags: ["Frontend", "Dashboard", "Docs"],
      hold: "approval",
      blockedBy: "other",
      agentId: "a1",
      since: "2026-10-10",
      kind: "ship",
      url: "https://github.com/o/r/pull/1",
    });
    const card = withItemTags(
      buildCards(
        [item],
        [{ agent: worker, report: { state: "done", text: "PR ready" } }],
      ),
      { version: 1, items: {} },
    )[0]!;
    expect(card.column).toBe("ready");
    expect(card.tags).toEqual(item.tags);
    expect(worker.labels).toEqual({
      [CREW_LABELS.task]: "tags",
      [CREW_LABELS.project]: "web",
    });
    expect(ItemTagSchema.safeParse("a\nb").success).toBe(false);
    expect(ItemTagSchema.safeParse("Area: Frontend").success).toBe(true); // still a literal plain tag, never a named field
    expect(ItemTagSchema.safeParse("a,b").success).toBe(false);
    expect(ItemTagSchema.safeParse(" ").success).toBe(false);
    expect(ItemTagSchema.safeParse("x".repeat(41)).success).toBe(false);
  });

  it("uses task identity across section moves, reorder, title presentation and worker replacement", () => {
    const queued = backlog();
    const joined = buildCards(
      parseBacklog("## In flight\n- [ ] tags - Keep the title (project: web)"),
      [{ agent: worker, report: null }],
    )[0]!;
    const relaunch = buildCards(
      [joined.backlog!],
      [{ agent: { ...worker, id: "a2" }, report: null }],
    )[0]!;
    const done = backlog("Done");
    expect(new Set([queued, joined, relaunch, done].map(itemTagKey)).size).toBe(
      1,
    );
    const nullProject = backlog("In flight", "");
    expect(
      itemTagKey({ ...nullProject, project: "label-project", agent: worker }),
    ).toBe(itemTagKey(nullProject));
    const remote = (host: string): FleetCard => ({
      ...queued,
      remote: {
        host,
        serverId: host,
        online: true,
        clockSkewSeconds: null,
        worker: null,
      },
    });
    expect(
      new Set(
        [
          queued,
          remote("srv_one"),
          remote("srv_two"),
          {
            ...queued,
            project: "api",
            backlog: { ...queued.backlog!, project: "api" },
          },
        ].map(itemTagKey),
      ).size,
    ).toBe(4);
    expect(
      itemTagKey({
        ...queued,
        remote: { ...remote("local").remote!, serverId: null },
      }),
    ).not.toBe(itemTagKey(queued));
    const orphan = { ...joined, backlog: null, taskId: null };
    expect(itemTagKey(orphan)).not.toBe(
      itemTagKey({ ...orphan, agent: { ...worker, id: "a2" } }),
    );
  });

  it("keeps AND filtering independent of column/host filtering, including Done and untagged items", () => {
    const cards = [
      { ...backlog(), tags: ["Frontend", "Dashboard"] },
      { ...backlog("Done"), tags: ["Frontend"] },
      backlog(),
    ];
    expect(
      cards.filter((card) => matchesTags(card, ["frontend", "Dashboard"])),
    ).toEqual([cards[0]]);
    expect(cards.filter((card) => matchesTags(card, []))).toEqual(cards);
    expect(tagChoices(cards, ["Absent"])).toEqual([
      { tag: "Absent", count: 0 },
      { tag: "Dashboard", count: 1 },
      { tag: "Frontend", count: 2 },
    ]);
  });

  it("rejects stale/ambiguous edit targets but accepts a landed item with its former worker still alive", () => {
    const done = backlog("Done");
    const alive = buildCards(
      [],
      [
        {
          agent: { ...worker, title: "Operational worker title" },
          report: null,
        },
      ],
    )[0]!;
    expect(findTagItem([alive, done], itemTagKey(done))).toBe(done);
    expect(() =>
      findTagItem([done, { ...done, key: "duplicate" }], itemTagKey(done)),
    ).toThrow("ambiguous");
    expect(() =>
      findTagItem([alive], itemTagKey({ ...alive, taskId: "gone" })),
    ).toThrow("changed");
  });

  it("keeps remote tags from Queued through joined and completed cards using the resolved host", async () => {
    const home = await fixture();
    const snapshot: RemoteSnapshot = {
      version: 1,
      localServerId: "srv_here",
      syncedAt: null,
      syncError: null,
      hosts: [
        {
          serverId: "srv_light",
          label: "Light",
          online: true,
          checkedAt: null,
          error: null,
          projects: [],
          workspaces: [],
          providers: [],
          workers: [],
        },
      ],
    };
    const source =
      "- [ ] tags - Keep the title (project: web) (host: Light srv_light)";
    const queued = buildCards(
      parseBacklog(`## Queued\n${source}`),
      [],
      snapshot,
    )[0]!;
    await changeItemTag(home, queued, "Dashboard", true);
    snapshot.hosts[0]!.workers.push({
      id: "remote-a1",
      name: "Operational title",
      status: "idle",
      updatedAt: "2026-10-11T00:00:00Z",
      permissions: 0,
      output: "done: ready",
      task: "tags",
    });
    const joined = withItemTags(
      buildCards(parseBacklog(`## In flight\n${source}`), [], snapshot),
      await readItemTags(home),
    )[0]!;
    const completed = withItemTags(
      buildCards(
        parseBacklog(
          `## Done\n${source.replace("Light srv_light", "srv_light")}`,
        ),
        [],
        snapshot,
      ),
      await readItemTags(home),
    );
    expect(itemTagKey(joined)).toBe(itemTagKey(queued));
    expect(joined.tags).toEqual(["Dashboard"]);
    expect(completed.find((card) => card.column === "done")?.tags).toEqual([
      "Dashboard",
    ]);
    expect(
      withItemTags([backlog()], await readItemTags(home))[0]!.tags,
    ).toEqual([]);
  });
});

describe("durable tag edits in an isolated home", () => {
  it("merges concurrent additions/removals without writing the backlog, even while an agent changes it", async () => {
    const home = await fixture();
    const path = join(home, "data/backlog.md");
    const original =
      "## Queued\r\n- [ ] tags - Keep the title (project: web) (tags: Agent) (unknown: keep me)\r\n";
    await writeFile(path, original);
    const card = buildCards(parseBacklog(original), [])[0]!;
    const next = original
      .replace("Queued", "In flight")
      .replace(
        "(unknown: keep me)",
        "(unknown: keep me) (agent: a1) (hold: gate)",
      );
    await changeItemTag(home, card, "Frontend", true, {
      afterStaging: () => writeFile(path, next),
    });
    await Promise.all([
      changeItemTag(home, card, "Dashboard", true),
      changeItemTag(home, card, "Agent", false),
    ]);
    expect(await readFile(path, "utf8")).toBe(next);
    const readAfterReload = withItemTags(
      buildCards(parseBacklog(next), []),
      await readItemTags(home),
    )[0]!;
    expect(readAfterReload.tags).toEqual(["Frontend", "Dashboard"]);
    expect(readAfterReload).toMatchObject({
      title: "Keep the title",
      column: "blocked",
      backlog: { hold: "gate", agentId: "a1" },
    });
    const laterAgent = withItemTags(
      [backlog("Done", "(project: web) (tags: Agent, Newly written)")],
      await readItemTags(home),
    )[0]!;
    expect(laterAgent.tags).toEqual(["Frontend", "Dashboard", "Newly written"]);
    await changeItemTag(home, laterAgent, "frontend", false);
    await changeItemTag(home, laterAgent, "AGENT", true);
    expect(
      withItemTags([laterAgent], await readItemTags(home))[0]!.tags,
    ).toEqual(["Dashboard", "AGENT", "Newly written"]);
  });

  it("retries a content conflict from the new sidecar instead of clobbering another editor", async () => {
    const home = await fixture();
    const card = backlog();
    await changeItemTag(home, card, "Frontend", true);
    let raced = false;
    await changeItemTag(home, card, "Dashboard", true, {
      afterStaging: async () => {
        if (raced) return;
        raced = true;
        const store = await readItemTags(home);
        store.items[itemTagKey(card)]!.add.push("Other editor");
        await writeFile(join(home, ITEM_TAGS_FILE), JSON.stringify(store));
      },
    });
    expect(withItemTags([card], await readItemTags(home))[0]!.tags).toEqual([
      "Frontend",
      "Other editor",
      "Dashboard",
    ]);
  });

  it("refuses corrupt stores and a thirteenth tag without losing the previous file", async () => {
    const home = await fixture();
    const card = backlog();
    for (let i = 0; i < 12; i++)
      await changeItemTag(home, card, `Tag ${i}`, true);
    const path = join(home, ITEM_TAGS_FILE);
    const before = await readFile(path, "utf8");
    await expect(changeItemTag(home, card, "Extra", true)).rejects.toThrow(
      "at most 12",
    );
    expect(await readFile(path, "utf8")).toBe(before);
    await writeFile(path, "{broken");
    await expect(changeItemTag(home, card, "Extra", true)).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("{broken");
  });

  it("uses home confinement for reads and writes, refusing a sidecar symlink outside the fixture", async () => {
    const home = await fixture();
    const outside = await fixture();
    expect(await readItemTags(home)).toEqual({ version: 1, items: {} });
    await expect(
      changeItemTag(home, backlog(), "bad,tag", true),
    ).rejects.toThrow();
    expect(await readItemTags(home)).toEqual({ version: 1, items: {} });
    await rm(join(home, "data"), { recursive: true });
    await symlink(
      join(outside, "data"),
      join(home, "data"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(readItemTags(home)).rejects.toThrow();
    await expect(
      changeItemTag(home, backlog(), "Frontend", true),
    ).rejects.toThrow();
    expect(await readItemTags(outside)).toEqual({ version: 1, items: {} });
  });
});
