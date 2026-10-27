/** Archive traverses persisted children even when their provider is no longer registered. */
import { z } from "zod";
import { sendSessionRequest } from "./daemon-session";

const PAGE_SIZE = 200;
const PageSchema = z.object({
  entries: z.array(
    z.object({
      agent: z.object({
        id: z.string().min(1),
        labels: z.record(z.string(), z.string()),
        workspaceId: z.string().min(1).nullable().optional(),
        archivedAt: z.string().min(1).nullable(),
      }),
    }),
  ),
  pageInfo: z.object({
    nextCursor: z.string().min(1).nullable(),
    prevCursor: z.string().min(1).nullable(),
    hasMore: z.boolean(),
  }),
});

type HistoryAgent = z.infer<typeof PageSchema>["entries"][number]["agent"];
/** Every page of a history listing, or a throw. Never a partial listing after a protocol, request or pagination failure. */
async function historyAgents(filter: Record<string, unknown>): Promise<HistoryAgent[]> {
  const agents: HistoryAgent[] = [];
  const cursors = new Set<string>();
  const ids = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const response = await sendSessionRequest(
      {
        type: "fetch_agent_history_request",
        filter,
        // Updating a worker must not move it between pages during this scan.
        sort: [{ key: "created_at", direction: "asc" }],
        page: { limit: PAGE_SIZE, ...(cursor === undefined ? {} : { cursor }) },
      },
      "fetch_agent_history_response",
    );
    if (response.error != null) throw new Error(String(response.error));
    const page = PageSchema.parse(response);
    if (page.pageInfo.prevCursor !== (cursor ?? null)) throw new Error("History did not confirm the requested page.");
    for (const { agent } of page.entries) {
      if (ids.has(agent.id)) throw new Error("History repeated a session across pages.");
      ids.add(agent.id);
      agents.push(agent);
    }
    const next = page.pageInfo.nextCursor;
    if (!page.pageInfo.hasMore) {
      if (next !== null) throw new Error("History returned an uncertain final page.");
      return agents;
    }
    if (next === null || cursors.has(next) || page.entries.length === 0)
      throw new Error("History did not provide a progressing continuation.");
    cursors.add(next);
    cursor = next;
  }
}

/**
 * The SDK's agents.list omits unloaded sessions on unavailable providers. History includes them.
 * It is read through the existing plugin session channel because the public SDK has no history API.
 * Never substitute a partial/live listing after any protocol, request or pagination failure.
 */
export async function archiveChildren(parentId: string) {
  try {
    const agents = await historyAgents({ labels: { "paseo.parent-agent-id": parentId }, includeArchived: false });
    return agents.filter((agent) => agent.archivedAt === null && agent.labels["paseo.parent-agent-id"] === parentId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot verify the complete archive inventory; no session was archived. ${reason}`);
  }
}

/**
 * S10 cleanup exclusion: every workspace a persisted, unarchived session still names, unavailable providers included.
 * Unwired. A maintenance pass that cannot read this completely dispatches nothing (`planCleanup` never sees a partial set).
 */
export async function retainedWorkspaces(): Promise<string[]> {
  try {
    const agents = await historyAgents({ includeArchived: false });
    return [...new Set(agents.filter((agent) => agent.archivedAt === null && agent.workspaceId).map((agent) => agent.workspaceId!))].sort();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot verify the complete retained-workspace inventory; nothing may be cleaned. ${reason}`);
  }
}

/** The fields of a native Paseo schedule (protocol `schedule/list`) the S10 timer inventory reads. Extra fields pass. */
export const NativeScheduleSchema = z.object({
  id: z.string().min(1), name: z.string().nullable(),
  cadence: z.discriminatedUnion("type", [z.object({ type: z.literal("every"), everyMs: z.number().int().positive() }),
    z.object({ type: z.literal("cron"), expression: z.string().min(1), timezone: z.string().min(1).optional() })]),
  target: z.discriminatedUnion("type", [z.object({ type: z.literal("agent"), agentId: z.string().min(1) }),
    z.object({ type: z.literal("new-agent"), config: z.object({ cwd: z.string().min(1) }).passthrough() })]),
  status: z.enum(["active", "paused", "completed"]),
});
export type NativeSchedule = z.infer<typeof NativeScheduleSchema>;
export type NativeTimerInventory = { complete: true; schedules: NativeSchedule[] } | { complete: false; reason: string };
/**
 * Native schedules and heartbeats, read once through `schedule/list` on the plugin session channel (no pagination in
 * that protocol). Unwired and not exercised against a live daemon: S10 qualifies only the parse and the fail-closed
 * result. A failed or unparseable answer is `complete: false`, never "no timers".
 */
export async function nativeSchedules(): Promise<NativeTimerInventory> {
  try {
    const response = await sendSessionRequest({ type: "schedule/list" }, "schedule/list/response");
    if (response.error != null) throw new Error(String(response.error));
    return { complete: true, schedules: z.array(NativeScheduleSchema).parse(response.schedules) };
  } catch (error) {
    return { complete: false, reason: `Native schedule inventory unavailable: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500) };
  }
}
