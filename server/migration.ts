/** A journaled handover. Creation has no prompt; only a verified retired source permits a send. */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { CREW_LABELS, type MateTarget, type FirstmateConfig } from "../shared/fleet";
import { readFirstmateConfig, resolveHome, updateFirstmateConfig } from "./config";
import { fetchLiveAgent, listAgents } from "./fleet";
import { prepareHome, readOpening } from "./home";
import type { PaseoApi, TimelineItem } from "./host-types";
import { MATE_TITLE, isMidTurn, oneAtATime } from "./mate";
import { sendWithoutInterrupting } from "./send";
import { message, TEMPLATES } from "./templates";
import { archiveChildren } from "./archive-inventory";

export async function migrationTargets(paseo: PaseoApi) {
  const home = resolveHome(await readFirstmateConfig());
  const available = await paseo.providers.listAvailable();
  const lists = await Promise.all(
    available.providers
      .filter((entry) => entry.available)
      .map(async (entry) => {
        const [models, modes] = await Promise.all([
          paseo.providers.listModels(entry.provider, { cwd: home }),
          paseo.providers.listModes(entry.provider, { cwd: home }),
        ]);
        if (models.error || modes.error) return [];
        return (models.models ?? [])
          .filter((model) => model.isSelectable !== false)
          .map((model) => ({
            provider: `${entry.provider}/${model.id}`,
            label: `${model.label} · ${entry.provider}`,
            modes: (modes.modes ?? []).map(({ id, label }) => ({ id, label })),
            thinking: (model.thinkingOptions ?? []).map(({ id, label }) => ({ id, label })),
          }));
      }),
  );
  return { targets: lists.flat() };
}

/** Whole JSON lines, newest first selected, returned chronologically within a strict character cap. */
export function handoffExcerpt(items: readonly TimelineItem[]): string {
  const lines: string[] = [];
  let size = 0;
  for (const item of [...items].reverse()) {
    // Projected tools/plans are useful dispatch evidence. Private reasoning is deliberately omitted.
    if (item.type === "reasoning") continue;
    const line = JSON.stringify(item);
    const remaining = 20000 - size;
    if (remaining <= 0) break;
    const clipped =
      line.length > remaining
        ? JSON.stringify({
            type: item.type,
            clipped: true,
            text: line.slice(0, Math.max(0, Math.floor((remaining - 100) / 6))),
          })
        : line;
    if (clipped.length + 1 > remaining) break;
    lines.unshift(clipped);
    size += clipped.length + 1;
  }
  return lines.join("\n");
}

async function validateTarget(paseo: PaseoApi, target: MateTarget): Promise<void> {
  const offered = (await migrationTargets(paseo)).targets.find((entry) => entry.provider === target.provider);
  if (offered === undefined) throw new Error("That provider/model is not available. Refresh the migration choices.");
  if (target.modeId !== "" && !offered.modes.some((mode) => mode.id === target.modeId)) {
    throw new Error("That permission mode is not offered by the target provider.");
  }
  if (target.thinkingOptionId !== "" && !offered.thinking.some((option) => option.id === target.thinkingOptionId)) {
    throw new Error("That thinking setting is not offered by the target model.");
  }
}

/** Paseo cascades archive to children in the same workspace. Never let migration end workers. */
async function requireSafeArchive(source: { id: string; workspaceId?: string | null | undefined }): Promise<void> {
  const children = await archiveChildren(source.id);
  const atRisk = children.filter(
    (child) =>
      child.labels?.["paseo.parent-agent-id"] === source.id &&
      (source.workspaceId == null || child.workspaceId == null || child.workspaceId === source.workspaceId),
  );
  if (atRisk.length > 0)
    throw new Error(
      `Paseo would archive child sessions in the first mate's workspace: ${atRisk.map((child) => child.id).join(", ")}. Detach those sessions in Paseo before migrating, or keep the old mate.`,
    );
}

async function saveHandoff(
  paseo: PaseoApi,
  config: FirstmateConfig,
  sourceId: string,
  target: MateTarget,
  preparedId?: string,
) {
  const source = await fetchLiveAgent(paseo, sourceId);
  if (source === null) throw new Error("The current first mate is no longer available.");
  if (isMidTurn(source) || source.pendingPermissions.length > 0)
    throw new Error("Wait until the first mate is idle and has no pending permissions before migrating.");
  await requireSafeArchive(source);
  await validateTarget(paseo, target);
  const home = resolveHome(config);
  await prepareHome(home, config);
  const [opening, page, crew] = await Promise.all([
    readOpening(home),
    paseo.agents.ref(sourceId).timeline.refetch({ direction: "tail", limit: 200, projection: "projected" }),
    listAgents(paseo, { labels: { [CREW_LABELS.role]: CREW_LABELS.crewRole } }),
  ]);
  if (page.error) throw new Error(`The handover transcript could not be read: ${page.error}`);
  const agentId = preparedId ?? randomUUID();
  const handoffPath = `data/handoffs/${agentId}.md`;
  const prompt = await message(TEMPLATES.migrationHandoff, {
    sourceId,
    sourceModel: `${source.provider}/${source.model ?? "default"}`,
    targetModel: target.provider,
    opening: opening.slice(0, 8000),
    excerpt: handoffExcerpt(page.entries.map((entry) => entry.item)),
    crew: JSON.stringify(crew.map(({ id, title, status, labels }) => ({ id, title, status, labels }))).slice(0, 4000),
  });
  const path = join(home, handoffPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${prompt}\n`, "utf8");
  return { sourceId, sourceRevision: source.updatedAt, agentId, target, prompt, handoffPath };
}

export function migrateMate(paseo: PaseoApi, input: { sourceId: string; target?: MateTarget | undefined }) {
  return oneAtATime(async () => {
    let config = await readFirstmateConfig();
    if (config.mateLaunch !== null) throw new Error("Resolve the reserved launch before migrating the first mate.");
    const recovering = config.migration !== null;
    if (config.migration === null) {
      if (config.mateAgentId !== input.sourceId) throw new Error("The first mate changed. Refresh before migrating.");
      if (input.target === undefined) throw new Error("Choose a target model for the migration.");
      const migration = await saveHandoff(paseo, config, input.sourceId, input.target);
      // Known ID and prompt persisted BEFORE creation: ambiguous RPC failures are recoverable.
      config = await updateFirstmateConfig({ migration });
    }
    let migration = config.migration!;
    if (
      migration.sourceId !== input.sourceId ||
      (input.target !== undefined && JSON.stringify(input.target) !== JSON.stringify(migration.target))
    ) {
      throw new Error("Another handover needs recovery. Resume the saved migration first.");
    }
    try {
      // An idle source may have worked again while a failed migration awaited recovery.
      if (recovering && (await fetchLiveAgent(paseo, migration.sourceId)) !== null) {
        migration = await saveHandoff(paseo, config, migration.sourceId, migration.target, migration.agentId);
        config = await updateFirstmateConfig({ migration });
      }
      const home = resolveHome(config);
      const workspace = await paseo.workspaces.open(home);
      let replacement = await fetchLiveAgent(paseo, migration.agentId);
      if (replacement === null) {
        const previous = await paseo.agents
          .ref(migration.agentId)
          .refresh()
          .catch((error: unknown) => {
            if (error instanceof Error && /not found|unknown agent|no agent/i.test(error.message)) return null;
            throw error;
          });
        if (previous?.agent?.archivedAt)
          throw new Error(
            "The prepared replacement was archived outside the handover; it cannot be recreated with the same identity.",
          );
        await validateTarget(paseo, migration.target);
        await workspace.agents.create({
          agentId: migration.agentId,
          idempotencyKey: migration.agentId,
          config: {
            provider: migration.target.provider,
            ...(migration.target.modeId === "" ? {} : { modeId: migration.target.modeId }),
            ...(migration.target.thinkingOptionId === ""
              ? {}
              : { thinkingOptionId: migration.target.thinkingOptionId }),
          },
          title: MATE_TITLE,
          labels: { [CREW_LABELS.role]: CREW_LABELS.mateRole },
          // No prompt: the prepared session has no authority to act yet.
        });
        replacement = await fetchLiveAgent(paseo, migration.agentId);
      }
      if (replacement === null) throw new Error("The prepared replacement is missing; recover the saved migration.");
      const expected = `${replacement.provider}/${replacement.model}`;
      if (expected !== migration.target.provider)
        throw new Error("The prepared replacement no longer matches the saved target model.");
      // A recovered/prepared session must be independent too: an inherited parent can put it
      // inside the source's archive cascade even though creation never supplied a parent.
      if (replacement.labels["paseo.parent-agent-id"])
        throw new Error("The prepared replacement has a parent session. Detach it in Paseo before recovering.");
      if (replacement.workspaceId !== workspace.id)
        throw new Error("The prepared replacement is outside the first mate's home workspace.");
      const source = await fetchLiveAgent(paseo, migration.sourceId);
      if (source !== null) {
        if (isMidTurn(source) || source.pendingPermissions.length > 0)
          throw new Error("The old first mate became busy. Wait until it is idle, then recover this migration.");
        if (source.updatedAt !== migration.sourceRevision)
          throw new Error(
            "The old first mate changed while preparing the handoff. Recover to capture its latest context.",
          );
        if (isMidTurn(replacement) || replacement.pendingPermissions.length > 0)
          throw new Error(
            "The prepared replacement was started outside the handover. Stop it in Paseo before recovering.",
          );
        await requireSafeArchive(source);
        const beforeArchive = await fetchLiveAgent(paseo, source.id);
        if (
          beforeArchive !== null &&
          (isMidTurn(beforeArchive) ||
            beforeArchive.pendingPermissions.length > 0 ||
            beforeArchive.updatedAt !== migration.sourceRevision)
        ) {
          throw new Error(
            "The old first mate changed before retirement. Recover once it is idle to capture its latest context.",
          );
        }
        await paseo.agents.ref(source.id).archive();
        // An archive failure/uncertain acknowledgement never starts the replacement.
        if ((await fetchLiveAgent(paseo, source.id)) !== null)
          throw new Error("Paseo did not confirm the old first mate was archived.");
      }
      replacement = await fetchLiveAgent(paseo, migration.agentId);
      if (replacement === null)
        throw new Error(
          "The replacement was archived during retirement. The saved handoff is retained; no prompt was sent.",
        );
      await updateFirstmateConfig({
        mateAgentId: migration.agentId,
        mateProvider: migration.target.provider,
        mateModeId: migration.target.modeId,
        previousMateIds: [...new Set([...config.previousMateIds, migration.sourceId])],
      });
      // If send succeeded but its response was lost, the transcript proves delivery on recovery.
      const messageId = `firstmate-handover-${migration.agentId}`;
      const page = await paseo.agents
        .ref(migration.agentId)
        .timeline.refetch({ direction: "after", limit: 200, projection: "projected" });
      if (page.error) throw new Error(page.error);
      const delivered = page.entries.some(
        ({ item }) => item.type === "user_message" && item.clientMessageId === messageId,
      );
      if (!delivered) {
        if (isMidTurn(replacement))
          throw new Error(
            "The replacement is busy without a recorded handover. Wait until it is idle before recovering.",
          );
        await sendWithoutInterrupting(paseo, migration.agentId, migration.prompt, { messageId });
      }
      await updateFirstmateConfig({ migration: null });
      return { agentId: migration.agentId, workspaceId: workspace.id };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Handover paused: ${reason} The saved migration and queued notes are kept. Use Recover migration; source ${migration.sourceId}, replacement ${migration.agentId}.`,
      );
    }
  });
}

export function cancelMigration(paseo: PaseoApi, sourceId: string): Promise<Record<string, never>> {
  return oneAtATime(async () => {
    const config = await readFirstmateConfig();
    const migration = config.migration;
    if (migration === null || migration.sourceId !== sourceId)
      throw new Error("That saved migration is no longer current.");
    const source = await fetchLiveAgent(paseo, sourceId);
    if (source === null || config.mateAgentId !== sourceId)
      throw new Error("The source is already retired. Recover the saved replacement instead.");
    const replacement = await fetchLiveAgent(paseo, migration.agentId);
    if (replacement !== null) {
      if (isMidTurn(replacement) || replacement.pendingPermissions.length > 0)
        throw new Error(
          "The prepared replacement became active outside the handover. Stop it in Paseo before cancelling.",
        );
      await requireSafeArchive(replacement);
      await paseo.agents.ref(replacement.id).archive();
      if ((await fetchLiveAgent(paseo, replacement.id)) !== null)
        throw new Error("Paseo did not confirm that the prepared replacement was archived.");
    }
    await updateFirstmateConfig({ migration: null });
    return {};
  });
}
