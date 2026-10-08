import { FleetSchema } from "../../shared/fleet";

export const now = "2026-10-08T12:00:00.000Z";
const ago = (minutes) => new Date(Date.parse(now) - minutes * 60000).toISOString();
const agent = (id, status = "idle") => ({
  id,
  title: id,
  workspaceId: "sample",
  provider: "codex",
  model: "gpt-6.1",
  status,
  cwd: "C:/Sample/FirstMate",
  pendingPermissions: 0,
  requiresAttention: false,
  lastError: null,
  updatedAt: ago(1),
  labels: {},
});
const backlog = (id, title, section) => ({
  id,
  title,
  section,
  project: "Ariadne",
  kind: "builder",
  mode: "reviewed-PR",
  agentId: null,
  hold: null,
  blockedBy: null,
  since: "2026-10-08",
  url: null,
  reportPath: null,
  outcome: null,
});
const task = (id, title, column, extra = {}) => ({
  key: id,
  title,
  column,
  taskId: id,
  project: "Ariadne",
  kind: "builder",
  agent: null,
  backlog: backlog(id, title, column === "done" ? "done" : column === "queued" ? "queued" : "in-flight"),
  report: null,
  url: null,
  ...extra,
});
const remote = (id, title, status = "running", extra = {}) => ({
  serverId: "sample-light",
  host: "Light",
  online: true,
  clockSkewSeconds: 0,
  worker: {
    id,
    name: title,
    status,
    updatedAt: ago(1),
    pendingPermissions: 0,
    permissionDetails: [],
    recentTools: [],
    followed: false,
    ...extra,
  },
});
const working = [
  "Build the chapter-craft plan: chapter styles, pacing and introductions",
  "Brief helper: coach prompt, skill and button",
  "Tone as a first-class choice: implement the story controls",
  "Compare twelve humour-source drafts in blind review packets",
  "Check the remote heartbeat and report new worker completions",
  "Finish the chapter review: waiting for the background check",
].map((title, i) =>
  task(`work-${i}`, title, "working", {
    remote: remote(`work-${i}`, title, i === 5 ? "idle" : "running"),
    ...(i === 5 ? { note: "waiting" } : {}),
    report: {
      state: "working",
      text:
        i === 5
          ? "waiting for the background check until 12:15"
          : [
              "Chapter controls and pacing are in progress",
              "Connecting the coach to Begin a story",
              "Drafting the tone choices and preview",
              "Building the blind review packets",
              "Checking finish reports on the next heartbeat",
            ][i],
    },
  }),
);
const blocked = [
  "Install the merged board changes and check the live panel",
  "Decide the delivery mode for the next chapter review",
  "Approve the new story-opening prompt before rollout",
  "Review the workstation setup before the worker continues",
].map((title, i) =>
  task(`block-${i}`, title, "blocked", {
    project: i === 0 ? "firstmate" : "Ariadne",
    agent: agent(`block-${i}`),
    backlog: {
      ...backlog(`block-${i}`, title, "in-flight"),
      hold: [
        "run the local smoke check when you have a moment",
        "choose local-only or a reviewed pull request",
        "confirm which opening reads best",
        null,
      ][i],
    },
    report: { state: "needs-decision", text: "Waiting for the captain’s call" },
    ...(i === 3 ? { agent: { ...agent(`block-${i}`), pendingPermissions: 1 } } : {}),
  }),
);
const queued = [
  "Make the review panel a standing Ariadne workspace",
  "Archive the eight leftover chapter experiments",
].map((title, i) =>
  task(`queue-${i}`, title, "queued", {
    backlog: {
      ...backlog(`queue-${i}`, title, "queued"),
      blockedBy: i === 0 ? "chapter-review" : "story-brief",
    },
  }),
);
const completedTitles = [
  "Raise the tester allowance after the chapter check",
  "FirstMate: the boards are too dense",
  "Fix chapter timeout accounting",
  "Preserve story style between sessions",
  "Add draft export to the chapter panel",
  "Land the review helper and report its checks",
];
const done = Array.from({ length: 30 }, (_, i) => {
  const title =
    completedTitles[i % completedTitles.length] +
    (i >= completedTitles.length ? ` · iteration ${Math.floor(i / completedTitles.length) + 1}` : "");
  return task(`done-${i}`, title, "done", {
    project: i % 3 === 0 ? "firstmate" : "Ariadne",
    backlog: {
      ...backlog(`done-${i}`, title, "done"),
      outcome: `merged 2026-10-${String(8 - Math.floor(i / 6)).padStart(2, "0")}`,
    },
    report: { state: "done", text: "Landed on main; local checks passed" },
  });
});
const idle = [
  "I want to look at the beginning of a chapter and the like",
  "In another session we are going over voices and styles",
  "There are some inconsistencies in how things are described",
].map((title, i) =>
  task(`idle-${i}`, title, "idle", {
    remote: remote(`idle-${i}`, title, "idle", {
      followed: i === 0,
      updatedAt: ago(4 + i),
    }),
    ...(i === 1
      ? {
          note: "stalled",
          report: {
            state: "working",
            text: "No wait target reported after the last turn",
          },
        }
      : {}),
  }),
);
const watches = ["pr-watch", "remote-watch"].map((name) => ({
  name,
  schedule: "*/5 * * * *",
  enabled: true,
  invalid: null,
  running: false,
  lastRunAt: ago(1),
  lastResult: "silent",
  lastOutput:
    name === "remote-watch" ? 'Remote worker on "Light"\nBrief helper · running\nChapter craft · running' : null,
  lastOutputAt: ago(3),
  lastError: null,
  builtIn: true,
  outdated: false,
}));
export const fleet = FleetSchema.parse({
  home: "C:/Sample/FirstMate",
  homeReady: true,
  projects: [],
  mate: agent("first-mate"),
  mateMissing: false,
  mateInHome: true,
  agentTools: true,
  charterOutdated: false,
  cards: [...queued, ...working, ...blocked, ...done, ...idle],
  watches,
  suggestions: [
    {
      label: "Update the FirstMate panel",
      prompt: "Review the merged FirstMate layout changes with the full crew, and check the phone view.",
    },
    {
      label: "Speed: lasting fix and checks",
      prompt: "For Ariadne chapter checking: write the performance notes and run the checks before the next review.",
    },
  ],
  warnings: [],
});
export const snapshot = {
  version: 1,
  localServerId: "sample-local",
  syncedAt: now,
  syncError: null,
  hosts: [
    {
      serverId: "sample-hermes",
      label: "hermes",
      online: true,
      checkedAt: now,
      error: null,
      projects: [{}, {}],
      workspaces: [{}, {}, {}],
      providers: [{}, {}, {}],
      workers: [],
    },
    {
      serverId: "sample-light",
      label: "Light",
      online: true,
      checkedAt: now,
      error: null,
      projects: Array(6).fill({}),
      workspaces: Array(14).fill({}),
      providers: Array(6).fill({}),
      workers: [...working, ...idle].map((card) => ({
        id: card.remote.worker.id,
        name: card.title,
        status: card.remote.worker.status,
        updatedAt: card.remote.worker.updatedAt,
        permissions: 0,
        output: "",
      })),
    },
  ],
};
export const entries = [
  [
    "assistant_message",
    "**Unchanged:** spent usage was carried over, and chapter limits and every other safeguard stayed as they were.\n\n**Worth knowing:** the tester has one chapter left. Their checks should drop back to about five minutes. Say the word and we will raise the allowance.",
  ],
  ["user_message", "codex has been updated"],
  ["tool_call", "list models"],
  ["tool_call", "Check the worker settings"],
  [
    "assistant_message",
    "Captain, confirmed: the local model settings have been updated. Every new worker here or on Light uses the selected model. The workers already running finish their current tasks first.",
  ],
  [
    "assistant_message",
    "Captain, shipshape. All twelve humour-source drafts are written, and the worker is building the blind packets. The brief helper is wiring its button into Begin a story.",
  ],
  ["user_message", "The boards are very dense. Please proceed with the recommendation."],
  [
    "assistant_message",
    "Aye. Six tasks are working, four need your call, and two are queued. Thirty have landed. The idle sessions remain visible for follow-up.",
  ],
].map(([type, text], i) => ({
  provider: "codex",
  item:
    type === "tool_call"
      ? {
          type,
          callId: `tool-${i}`,
          name: text,
          detail: { type: "unknown", input: {}, output: {} },
          status: "completed",
          error: null,
        }
      : { type, text },
  timestamp: now,
  seqStart: i + 1,
  seqEnd: i + 1,
  sourceSeqRanges: [],
  collapsed: [],
}));
