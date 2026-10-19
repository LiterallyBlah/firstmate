import { describe, expect, it } from "vitest";
import { parseBacklog } from "./backlog";
import {
  decisionDisposition,
  detectNeedsYou,
  normalizeAsk,
  observeNeedsYou,
} from "./needs-you-detect";
import type { RemoteHost } from "../shared/remotes";

it("carries authored spec and notes into decision context without leaking them into the ask", () => {
  const observed = observeNeedsYou("## In flight\n- [ ] task - Choose (hold: Light or Atlas) (spec: data/run-sheet.md) (notes: data/notes.md)\n## Queued\n## Done\n", null);
  expect(observed.valid).toBe(true);
  expect(observed.sources[0]).toMatchObject({ ask: "Light or Atlas", specPath: "data/run-sheet.md", notesPath: "data/notes.md" });
});

const host = (serverId: string, label: string): RemoteHost => ({
  serverId,
  label,
  online: false,
  checkedAt: null,
  error: "offline",
  projects: [],
  workspaces: [],
  providers: [],
  workers: [],
});
const catalog = {
  localServerId: "srv_here",
  hosts: [host("srv_light", "Light")],
};
const item = (fields = "", section = "Queued") =>
  parseBacklog(`## ${section}\n- [ ] task - Task ${fields}`)[0]!;
const document = (rows: string, section = "Queued") =>
  `# Backlog\n## In flight\n${section === "In flight" ? rows : ""}\n## Queued\n${section === "Queued" ? rows : ""}\n## Done\n${section === "Done" ? rows : ""}\n`;

describe("the reconciled source predicate", () => {
  it.each([
    [
      "captain question without worker",
      "(kind: captain) (hold: Choose?)",
      "Queued",
      "open",
    ],
    ["ship hold", "(kind: ship) (hold: Merge?)", "Queued", "open"],
    ["scout hold", "(kind: scout) (hold: Review findings?)", "Queued", "open"],
    ["other kind", "(kind: arbitrary) (hold: Decide?)", "Queued", "open"],
    ["no kind", "(hold: Decide?)", "Queued", "open"],
    [
      "live in-flight worker",
      "(agent: running) (hold: Merge?)",
      "In flight",
      "open",
    ],
    [
      "remote running worker",
      "(host: Light) (agent: running) (hold: Merge?)",
      "In flight",
      "open",
    ],
    [
      "held worker with needs-decision report",
      "(agent: needs-decision) (hold: Choose?)",
      "In flight",
      "open",
    ],
    [
      "conditional prose has no special meaning",
      "(hold: Merge once step 1 lands)",
      "Queued",
      "open",
    ],
    [
      "proposed attention extension is not the reconciled predicate",
      "(attention: deferred) (hold: Choose?)",
      "Queued",
      "open",
    ],
    [
      "unknown attention metadata is ignored",
      "(attention: someday) (hold: Choose?)",
      "Queued",
      "open",
    ],
    [
      "hold with dependency",
      "(hold: Choose?) (blocked-by: other)",
      "Queued",
      "parked",
    ],
    [
      "bare dependency",
      "(hold: Choose?) blocked-by: other",
      "In flight",
      "parked",
    ],
    ["captain with no question", "(kind: captain)", "Queued", "parked"],
    [
      "captain empty question",
      "(kind: captain) (hold:   )",
      "Queued",
      "parked",
    ],
    [
      "captain no hold and dependency",
      "(kind: captain) (blocked-by: other)",
      "Queued",
      "parked",
    ],
    ["ordinary queued work", "(kind: ship)", "Queued", "in-hand"],
    ["whitespace hold", "(hold:   )", "Queued", "in-hand"],
    ["empty blocker", "(hold: Ask) (blocked-by:   )", "Queued", "open"],
    ["done leftover hold", "(kind: captain) (hold: Merge?)", "Done", "done"],
    [
      "done dependency and hold",
      "(hold: Choose?) (blocked-by: other)",
      "Done",
      "done",
    ],
    ["done captain without hold", "(kind: captain)", "Done", "done"],
    ...[
      "working",
      "waiting",
      "blocked",
      "idle",
      "paused",
      "ready",
      "failed",
      "permission",
      "needs-decision",
      "done",
      "resolved",
      "stalled",
    ].map((state) => [
      `worker ${state} without hold`,
      `(agent: ${state})`,
      "In flight",
      "in-hand",
    ]),
    [
      "PR alone",
      "https://github.com/example/repo/pull/1",
      "In flight",
      "in-hand",
    ],
    ["report alone", "data/scout/report.md", "In flight", "in-hand"],
  ])("%s", (_name, fields, section, expected) => {
    expect(decisionDisposition(item(fields, section))).toBe(expected);
  });

  it("does not accept suggestions, chat or native requests as detector inputs", () => {
    expect(detectNeedsYou([], catalog)).toEqual({
      valid: true,
      problems: [],
      sources: [],
    });
  });

  it("uses host/project/task, never worker/section/order/title, and resolves aliases", () => {
    const first = detectNeedsYou(
      [item("(host: Light) (project: p) (hold: Ask?)")],
      catalog,
    ).sources[0]!;
    const second = detectNeedsYou(
      [
        item(
          "(host: srv_light) (project: p) (hold: Ask?) (agent: replacement)",
          "In flight",
        ),
      ],
      catalog,
    ).sources[0]!;
    expect(first.key).toBe(second.key);
    const different = detectNeedsYou(
      [
        item("(hold: Ask?) (project: p)"),
        item("(host: Light) (hold: Ask?) (project: q)"),
      ],
      catalog,
    );
    expect(
      new Set([first.key, ...different.sources.map((source) => source.key)])
        .size,
    ).toBe(3);
    expect(
      detectNeedsYou([item("(host: srv_here) (hold: Ask?)")], catalog)
        .sources[0]?.hostId,
    ).toBe("local");
  });

  it("quarantines duplicate scoped identities, including aliases and section moves", () => {
    for (const second of [
      item("(hold: Ask?)"),
      item("(hold: Ask?)", "In flight"),
      item("", "Done"),
    ]) {
      expect(
        detectNeedsYou([item("(hold: Ask?)"), second], catalog),
      ).toMatchObject({ valid: false, sources: [] });
    }
    expect(
      detectNeedsYou(
        [item("(host: Light)"), item("(host: srv_light)")],
        catalog,
      ).valid,
    ).toBe(false);
    expect(
      detectNeedsYou([item("(project: a)"), item("(project: b)")], catalog)
        .valid,
    ).toBe(true);
  });

  it("does not turn an unknown or ambiguous remote into local work", () => {
    expect(
      detectNeedsYou([item("(host: nowhere) (hold: Ask?)")], catalog).quarantined,
    ).toHaveLength(1);
    expect(
      detectNeedsYou([item("(host: Light) (hold: Ask?)")], {
        ...catalog,
        hosts: [...catalog.hosts, host("srv_other", "Light")],
      }).quarantined,
    ).toHaveLength(1);
    expect(
      detectNeedsYou([item("(host: Light) (hold: Ask?)")], null).quarantined,
    ).toHaveLength(1);
  });

  it("normalizes cosmetic questions, but not different questions", () => {
    expect(normalizeAsk("  MERGE  this?  ")).toBe(normalizeAsk("merge this."));
    expect(normalizeAsk("merge this")).not.toBe(normalizeAsk("deploy this"));
  });
});

describe("strict observation", () => {
  it("quarantines one row without losing a later gate token or changing physical line numbers", () => {
    const result = observeNeedsYou(document([
      "- [ ] broken - Task (hold: Choose (A)?)",
      "- [ ] cr - Task (hold: Ask?)\rstray text",
      "- [ ] remote - Task (host: missing) (hold: Ask?)",
      "- [ ] good - Task (hold: Ask?) (gate: round-2)",
    ].join("\n")), catalog);
    expect(result.valid).toBe(true);
    expect(result.quarantined?.map(row => [row.line, row.taskId, row.hasHold])).toEqual([
      [5, "broken", true], [6, "cr", true], [7, "remote", true],
    ]);
    expect(result.sources).toMatchObject([{ taskId: "good", gateToken: "round-2" }]);
    expect(result.problems.join(" ")).toContain("Line 7, task remote");
  });

  it("fails the whole observation for duplicate identities, including malformed rows and unknown hosts", () => {
    for (const fields of ["(hold: Choose (A)?)", "(host: missing) (hold: Ask?)"]) {
      const result = observeNeedsYou(document([
        `- [ ] task - Task ${fields}`,
        `- [ ] task - Task ${fields}`,
        "- [ ] good - Task (hold: Ask?)",
      ].join("\n")), catalog);
      expect(result).toMatchObject({ valid: false, sources: [] });
      expect(result.problems.join(" ")).toContain("Duplicate task identity at line 6: task");
    }
    expect(observeNeedsYou(document("- [?] task - Broken (hold: Ask?)\n- [ ] task - Duplicate\n- [ ] good - Good"), catalog))
      .toMatchObject({ valid: false, sources: [] });
  });

  it("resolves local and the saved local label, preserving ambiguous labels as unreadable", () => {
    for (const label of ["local", "LOCAL", "srv_here", "Here"]) {
      expect(observeNeedsYou(document(`- [ ] task - Task (host: ${label}) (hold: Ask?)`),
        { ...catalog, localLabel: "Here" }).sources[0]?.hostId).toBe("local");
    }
    expect(detectNeedsYou([item("(host: local)")], null).sources[0]?.hostId).toBe("local");
    expect(observeNeedsYou(document("- [ ] task - Task (host: Light) (hold: Ask?)"),
      { ...catalog, localLabel: "Light" }).quarantined).toHaveLength(1);
  });

  it.each(["(host: )", "(project: )", "blocked-by: a blocked-by: b"])(
    "rejects ambiguous identity or blocker metadata: %s",
    (fields) => {
      expect(
        observeNeedsYou(
          document(`- [ ] task - Task (hold: Ask?) ${fields}`),
          catalog,
        ).quarantined,
      ).toHaveLength(1);
    },
  );
  it.each([
    ["empty", ""],
    ["truncated headings", "## Queued\n- [ ] task - Task (hold: Ask?)"],
    [
      "unknown heading",
      document("- [ ] task - Task").replace("## Queued", "## Someday"),
    ],
    ["repeated section", document("") + "## Queued\n"],
    ["stray row", "- [ ] task - Task\n" + document("")],
    ["bad checkbox", document("- [?] task - Task (hold: Ask?)")],
    ["checked unfinished", document("- [x] task - Task (hold: Ask?)")],
    ["missing separator", document("- [ ] task Task (hold: Ask?)")],
    ["missing title", document("- [ ] task - ")],
    ["incomplete hold", document("- [ ] task - Task (hold: Ask?")],
    [
      "nested hold the board cannot parse",
      document("- [ ] task - Task (hold: Choose (A)?)"),
    ],
    ["duplicate hold", document("- [ ] task - Task (hold: A) (hold: B)")],
    [
      "conflicting project aliases",
      document("- [ ] task - Task (project: a) (repo: b)"),
    ],
    ["bare hold", document("- [ ] task - Task hold: Ask?")],
    [
      "empty bare blocker",
      document("- [ ] task - Task (hold: Ask?) blocked-by:"),
    ],
    [
      "duplicate blocker",
      document("- [ ] task - Task (blocked-by: a) blocked-by: b"),
    ],
    ["partial next row", document("- [ ] task - Task (hold: Ask?)\n- [")],
    ["prose in section", document("still writing...")],
    ["hidden example", document("<!--\n- [ ] task - Task (hold: Ask?)\n-->")],
    ["NUL", document("\0")],
  ])(
    "isolates line errors and fails closed on structural errors: %s",
    (_name, markdown) => {
      const result = observeNeedsYou(markdown, catalog);
      const structural = ["empty", "truncated headings", "unknown heading", "repeated section", "hidden example", "NUL"].includes(_name);
      expect(result.valid).toBe(!structural);
      expect(result.problems.length).toBeGreaterThan(0);
      if (structural) expect(result.sources).toEqual([]);
      else expect(result.quarantined).toHaveLength(1);
    },
  );

  it("accepts a complete empty template, optional metadata, and explicit gate tokens", () => {
    expect(observeNeedsYou(document(""), catalog).valid).toBe(true);
    const detected = observeNeedsYou(
      document(
        "- [ ] task — Task (hold: Ask?) (gate: round-2) (since yesterday) (tags: a) (tags: b)",
      ),
      catalog,
    );
    expect(detected).toMatchObject({
      valid: true,
      sources: [{ gateToken: "round-2", disposition: "open" }],
    });
  });

  it("models the anonymised design totals: six open holds and three parked choices", () => {
    const lines = [
      "merge - Merge https://github.com/example/project/pull/21 (kind: ship) (hold: Land this?) (agent: live)",
      "scout - Findings (kind: scout) (hold: Review data/scout/report.md)",
      "windows - Windows host (kind: captain) (hold: Which machine?)",
      "remote - Remote work (host: Light) (hold: Approve?)",
      "mobile - Mobile scope (kind: captain) (hold: Which scope?)",
      "heavier - Heavier steps (hold: Your word once step 1 lands)",
      "later-a - Later A (kind: captain) (hold: Choose?) (blocked-by: merge)",
      "later-b - Later B (hold: Proceed?) (blocked-by: scout)",
      "later-c - Later C (kind: captain)",
      "routine - Routine work (agent: failed)",
    ];
    const result = observeNeedsYou(
      document(lines.map((line) => `- [ ] ${line}`).join("\n")),
      catalog,
    );
    expect(result.valid).toBe(true);
    expect(
      result.sources.filter((source) => source.disposition === "open"),
    ).toHaveLength(6);
    expect(
      result.sources.filter((source) => source.disposition === "parked"),
    ).toHaveLength(3);
  });
});
