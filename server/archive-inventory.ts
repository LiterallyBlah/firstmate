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

/**
 * The SDK's agents.list omits unloaded sessions on unavailable providers. History includes them.
 * It is read through the existing plugin session channel because the public SDK has no history API.
 * Never substitute a partial/live listing after any protocol, request or pagination failure.
 */
export async function archiveChildren(parentId: string) {
  const children: Array<z.infer<typeof PageSchema>["entries"][number]["agent"]> = [];
  const cursors = new Set<string>();
  const ids = new Set<string>();
  let cursor: string | undefined;
  try {
    for (;;) {
      const response = await sendSessionRequest(
        {
          type: "fetch_agent_history_request",
          filter: { labels: { "paseo.parent-agent-id": parentId }, includeArchived: false },
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
        if (agent.archivedAt === null && agent.labels["paseo.parent-agent-id"] === parentId) children.push(agent);
      }
      const next = page.pageInfo.nextCursor;
      if (!page.pageInfo.hasMore) {
        if (next !== null) throw new Error("History returned an uncertain final page.");
        return children;
      }
      if (next === null || cursors.has(next) || page.entries.length === 0)
        throw new Error("History did not provide a progressing continuation.");
      cursors.add(next);
      cursor = next;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot verify the complete archive inventory; no session was archived. ${reason}`);
  }
}
