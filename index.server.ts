import type { PluginServerContext } from "@getpaseo/plugin/server";
import { startWorkflowService, workflowStore, queuePlanNotes } from "./server/workflow-service";
import { workflowHomeId, workflowSnapshot, withWorkflowNeeds, withWorkflowFleet } from "./server/workflow-board";
import { readWorkflowPlans, actOnWorkflowPlan } from "./shared/workflow-rpc";
import { ensureSharedTerminal as ensureSharedTerminalRpc } from "./shared/native-tools";
import { ensureSharedTerminal } from "./server/native-tools";

import { migrateLegacyFiles, readConfigWithTenure, readFirstmateConfig, resolveHome, updateFirstmateConfig } from "./server/config";
import { nameHomeOnce } from "./server/home-name";
import {
  CaptainSteers,
  exitCrew,
  interruptCrew,
  registerSteerRelay,
  relaunchCrew,
  steerCrew,
} from "./server/crew";
import { registerCrewSeen } from "./server/crew-seen";
import { pageTimeline, registerReceiptObservers } from "./server/receipt-observers";
import { newAction, receiptJournal } from "./server/receipts";
import { AttentionObserver } from "./server/attention";
import { NeedsYouService, readConfiguredDecisionHome } from "./server/needs-you-service";
import { registerNeedsYouRpc } from "./server/needs-you-rpc";
import { answerDecision } from "./server/decision-answer";
import { submitDecisionAnswer } from "./shared/needs-you";
import { pluginDir } from "./server/data-dir";
import { join } from "node:path";
import { pageReceiptTimeline } from "./shared/receipts";
import { ReportCache, loadFleet, readAgentTools } from "./server/fleet";
import { listDeckSettings, readDeckEngine, readDeckSetting } from "./server/deck-settings";
import { listDeckSettings as listDeckSettingsRpc, loadDeckEngine, loadDeckSetting } from "./shared/deck-rpc";
import { findFiles, listDirectory, readTextFile, requireHome, writeTextFile } from "./server/files";
import { loadChatImage } from "./server/chat-images";
import { readChatImage } from "./shared/chat-images";
import { CHARTER_FILE, NEW_CHARTER_FILE, acknowledgeCharter, writeNewCharter } from "./server/charter-file";
import { isHomeReady, prepareHome, removeSuggestion } from "./server/home";
import {
  adoptMate,
  askMate,
  commandMessage,
  compactMate,
  launchMate,
  listCandidates,
  markMateSeen,
  releaseMate,
  restartMate,
  oneAtATime,
  requireNoMigration,
  queueBurstNote,
  flushMateNotes,
} from "./server/mate";
import { cancelMigration, migrateMate, migrationTargets } from "./server/migration";
import {
  acknowledgeCharter as acknowledgeCharterRpc,
  adoptMate as adoptMateRpc,
  askMate as askMateRpc,
  askMateCommand as askMateCommandRpc,
  compactMate as compactMateRpc,
  compareCharter as compareCharterRpc,
  enableAgentTools,
  exitCrew as exitCrewRpc,
  interruptCrew as interruptCrewRpc,
  launchMate as launchMateRpc,
  listCandidates as listCandidatesRpc,
  loadFleet as loadFleetRpc,
  markMateSeen as markMateSeenRpc,
  readConfig,
  relaunchCrew as relaunchCrewRpc,
  releaseMate as releaseMateRpc,
  removeSuggestion as removeSuggestionRpc,
  restartMate as restartMateRpc,
  migrateMate as migrateMateRpc,
  migrationTargets as migrationTargetsRpc,
  cancelMigration as cancelMigrationRpc,
  steerCrew as steerCrewRpc,
  toggleWatch,
  writeConfig,
} from "./shared/fleet";
import { findHomeFiles, listHomeFiles, readHomeFile, writeHomeFile } from "./shared/files";
import { startWatches } from "./server/watch-service";
import { createWatch, configureWatch, watchOptions, watchHistory } from "./shared/watch-routing";
import { displaySettings } from "./shared/settings";
import { taskLayoutSettings } from "./shared/task-layout";
import { editItemTag } from "./shared/item-tags";
import { readItemThread, sendItemThread } from "./shared/item-threads";
import { readThread, sendThread } from "./server/item-threads";
import { changeItemTag, findTagItem } from "./server/item-tags";
import { RemoteService } from "./server/remotes";
import { UpdateService } from "./server/update";
import { checkUpdate, requestUpdate } from "./shared/update";
import { readRemotes, syncRemotes, reportRemoteSyncError } from "./shared/remotes";
import { readBacklog } from "./server/home";
import { remoteTaskQueries } from "./server/remote-cards";
import { exitRemoteCrew, interruptRemoteCrew, remoteCrewLogs, remoteSteerMessage, remoteSteerNote, steerRemoteCrew } from "./server/remote-crew";
import {
  exitRemoteCrew as exitRemoteCrewRpc,
  interruptRemoteCrew as interruptRemoteCrewRpc,
  remoteCrewLogs as remoteCrewLogsRpc,
  steerRemoteCrew as steerRemoteCrewRpc,
} from "./shared/remote-crew";

export default function contribute(server: PluginServerContext) {
  const stopWorkflows = startWorkflowService();
  server.handle(ensureSharedTerminalRpc, ({ workspaceId }, { paseo }) => ensureSharedTerminal(paseo, workspaceId));
  const updates = new UpdateService();
  server.handle(checkUpdate, () => updates.check());
  server.handle(requestUpdate, ({ token }, { paseo }) => updates.request(token, (text, beforeSend) => askMate(paseo, { text }, beforeSend)));
  migrateLegacyFiles();
  const reports = new ReportCache();
  const attention = new AttentionObserver(readFirstmateConfig);
  const steers = new CaptainSteers();
  // The scripts in the home's watches/ folder, run on their schedules; see server/watches.ts.
  const watches = startWatches(server, readFirstmateConfig, async (paseo, config) => {
    const fleet = await loadFleet(paseo, config, reports, async () => [], () => remotes.read());
    // Crew label lookup already excludes inspectors. Watches, inspector history and role instructions stay out.
    return { capturedAt: new Date().toISOString(), cards: fleet.cards, projects: fleet.projects,
      remoteHosts: (await remotes.read()).hosts.map(({ serverId, label, online, checkedAt, error }) => ({ serverId, label, online, checkedAt, error })) };
  });
  // The backlog names the tasks whose remote worker the poll should look up by label; see server/remote-cards.ts.
  const remotes = new RemoteService(undefined, async (host) =>
    remoteTaskQueries(await readBacklog(resolveHome(await readFirstmateConfig())), host, (await remotes.read()).localServerId),
    snapshot => attention.catalog(snapshot),
  );
  remotes.start();
  const decisions = new NeedsYouService({
    root: join(pluginDir(), "needs-you"),
    home: readConfiguredDecisionHome,
    catalog: () => remotes.read(),
  });
  registerNeedsYouRpc(server, decisions, async snapshot => withWorkflowNeeds(snapshot, resolveHome(await readFirstmateConfig())));
  server.handle(readWorkflowPlans, async () => workflowSnapshot(resolveHome(await readFirstmateConfig())));
  server.handle(actOnWorkflowPlan, async ({ homeId, requestId, command }, { paseo }) => {
    await oneAtATime(async () => {
      const config = await readFirstmateConfig(); requireNoMigration(config);
      const home = resolveHome(config);
      if (homeId !== workflowHomeId(home)) throw new Error("The configured home changed. Refresh before acting.");
      const targets = command.edits?.some(e => e.kind === "model") ? (await migrationTargets(paseo)).targets : [];
      for (const edit of command.edits ?? []) {
        if (edit.kind === "model") {
          const target = targets.find(t => t.provider === edit.agent.provider);
          if (!target || !target.modes.some(m => m.id === edit.agent.modeId) || (edit.agent.thinkingOptionId && !target.thinking.some(t => t.id === edit.agent.thinkingOptionId))) throw new Error("The chosen model, mode or thinking setting is no longer available.");
        }
        if (edit.kind === "host" && edit.host !== "local" && !(await remotes.read()).hosts.some(h => h.serverId === edit.host)) throw new Error("That saved host is no longer available.");
      }
      await workflowStore(home).execute(command, requestId, "board:captain");
      await queuePlanNotes(home);
    });
    void flushMateNotes(paseo).catch(() => {});
    return workflowSnapshot(resolveHome(await readFirstmateConfig()));
  });
  server.handle(submitDecisionAnswer, (input, { paseo }) => answerDecision(paseo, decisions, input));
  decisions.start();
  server.handle(readRemotes, () => remotes.read());
  server.handle(syncRemotes, ({ hosts }) => remotes.sync(hosts));
  server.handle(reportRemoteSyncError, async ({ unavailable }) => { await remotes.syncError(unavailable); return {}; });

  server.handle(readConfig, async () => {
    const config = await readFirstmateConfig();
    return { config, resolvedHome: resolveHome(config) };
  });
  server.handle(writeConfig, async (patch) => {
    return oneAtATime(async () => {
      requireNoMigration(await readFirstmateConfig());
      const config = await updateFirstmateConfig(patch);
      const home = resolveHome(config);
      // The charter names the crew's model, so a saved change reaches the file
      // at once; a home nobody has launched in yet is left for the launch.
      if (await isHomeReady(home)) await prepareHome(home, config);
      return { config, resolvedHome: home };
    });
  });

  server.handle(loadFleetRpc, async (_input, { paseo }) => {
    attention.remember(paseo);
    const attentionSampleStart = Date.now();
    watches.remember(paseo);
    void flushMateNotes(paseo).catch((error: unknown) => console.error("[firstmate] crew notes await delivery:", error));
    const fleet = await loadFleet(
      paseo,
      await readConfigWithTenure(),
      reports,
      () => watches.summaries(),
      () => remotes.read(),
      decisions,
    );
    const decorated = await withWorkflowFleet(fleet);
    fleet.cards = decorated.cards; fleet.needsYou = decorated.needsYou; fleet.warnings = decorated.warnings;
    // A first mate launched before the plugin named its home gets its name the first time the board looks.
    const workspaceId = fleet.mate?.workspaceId ?? null;
    if (workspaceId !== null && fleet.mateInHome) nameHomeOnce(paseo, workspaceId, fleet.home);
    attention.fleet(fleet, attentionSampleStart);
    return fleet;
  });
  server.handle(enableAgentTools, async (_input, { paseo }) => {
    await paseo.config.patch({ mcp: { injectIntoAgents: true } });
    return { agentTools: (await readAgentTools(paseo)) === true };
  });

  server.handle(editItemTag, async ({ key, tag, present }, { paseo }) => {
    const fleet = await loadFleet(paseo, await readFirstmateConfig(), reports, async () => [], () => remotes.read());
    return changeItemTag(await requireHome(fleet.home), findTagItem(fleet.cards, key), tag, present, { origin: () => newAction("item-tag.edit", "captain") });
  });

  server.handle(readItemThread, async ({ key }) => readThread(await requireHome(resolveHome(await readFirstmateConfig())), key));
  server.handle(sendItemThread, async (input, { paseo }) => {
    const config = await readFirstmateConfig();
    const fleet = await loadFleet(paseo, config, reports, async () => [], () => remotes.read());
    return sendThread(await requireHome(fleet.home), findTagItem(fleet.cards, input.key), input,
      (text, messageId, beforeSend) => askMate(paseo, { text, messageId }, async (agentId) => {
        if (resolveHome(await readFirstmateConfig()) !== fleet.home) throw new Error("The first mate's home changed. Reopen the discussion.");
        await beforeSend(agentId);
      }));
  });

  server.handle(launchMateRpc, (input, { paseo }) => launchMate(paseo, input));
  server.handle(adoptMateRpc, async ({ agentId }, { paseo }) => ({ config: await adoptMate(paseo, agentId) }));
  server.handle(releaseMateRpc, async () => ({ config: await releaseMate() }));
  server.handle(restartMateRpc, (_input, { paseo }) => restartMate(paseo));
  server.handle(migrateMateRpc, (input, { paseo }) => migrateMate(paseo, input));
  server.handle(migrationTargetsRpc, (_input, { paseo }) => migrationTargets(paseo));
  server.handle(cancelMigrationRpc, ({ sourceId }, { paseo }) => cancelMigration(paseo, sourceId));
  server.handle(compactMateRpc, async (_input, { paseo }) => ({ agentId: await compactMate(paseo) }));
  server.handle(listCandidatesRpc, (_input, { paseo }) => listCandidates(paseo));
  server.handle(askMateRpc, async (message, { paseo }) => ({ agentId: await askMate(paseo, message) }));
  server.handle(askMateCommandRpc, async ({ command, args }, { paseo }) => ({
    agentId: await askMate(paseo, await commandMessage(command, args)),
  }));
  server.handle(markMateSeenRpc, (_input, { paseo }) => markMateSeen(paseo));
  server.handle(toggleWatch, async ({ name, enabled }, { paseo }) => {
    watches.remember(paseo);
    await watches.toggle(name, enabled);
    return {};
  });
  server.handle(createWatch, async (input, { paseo }) => { watches.remember(paseo); await watches.create(input); return {}; });
  server.handle(configureWatch, async (input, { paseo }) => { watches.remember(paseo); await watches.configure(input); return {}; });
  server.handle(watchOptions, (_input, { paseo }) => { watches.remember(paseo); return watches.options(); });
  server.handle(watchHistory, ({ name }) => watches.history(name));

  server.handle(steerCrewRpc, async ({ agentId, text }, { paseo }) => {
    await steerCrew(paseo, steers, agentId, text);
    return {};
  });
  server.handle(interruptCrewRpc, async ({ agentId }, { paseo }) => {
    await interruptCrew(paseo, agentId);
    return {};
  });
  server.handle(exitCrewRpc, async ({ agentId }, { paseo }) => {
    await exitCrew(paseo, agentId);
    return {};
  });
  // A remote worker's card, through the remote request path; see server/remote-crew.ts.
  server.handle(steerRemoteCrewRpc, async ({ serverId, agentId, text }, { paseo }) => {
    // A remote send carries no id of ours into that host's timeline, so its receipt says so (`carried: false`).
    const receipt = receiptJournal()?.beginSend({ channel: "remote-steer", actor: "captain", recipient: `${serverId}/${agentId}`, text: text.trim(), carried: false });
    let sent: Awaited<ReturnType<typeof steerRemoteCrew>>;
    try {
      sent = await steerRemoteCrew(remotes, serverId, agentId, text);
    } catch (error) {
      receipt?.settle("failed", error);
      throw error;
    }
    receipt?.settle("sent");
    // The plugin cannot see that worker's turn end, so the first mate hears of it without the answer, in one
    // note for the whole burst of steers to that worker; the words are already sent.
    try {
      await queueBurstNote(
        paseo,
        {
          key: `remote:${serverId}:${agentId}`,
          part: await remoteSteerMessage(sent.text),
          render: (parts) => remoteSteerNote(sent.host, sent.worker, parts),
        },
        { source: "remote-steer", relates: receipt === undefined ? [] : [receipt.messageId] },
      );
    } catch (error) {
      console.error(`[firstmate] could not tell the first mate about the captain's words to ${agentId}:`, error);
    }
    return {};
  });
  server.handle(interruptRemoteCrewRpc, async ({ serverId, agentId }) => {
    await interruptRemoteCrew(remotes, serverId, agentId);
    return {};
  });
  server.handle(exitRemoteCrewRpc, async ({ serverId, agentId }) => {
    await exitRemoteCrew(remotes, serverId, agentId);
    return {};
  });
  server.handle(remoteCrewLogsRpc, ({ serverId, agentId }) => remoteCrewLogs(remotes, serverId, agentId));
  server.handle(relaunchCrewRpc, async ({ agentId, note }, { paseo }) => ({
    agentId: await relaunchCrew(paseo, agentId, note),
  }));

  // The home as files, for the panel's file view. Confined to the home; see server/files.ts.
  async function home(): Promise<string> {
    return requireHome(resolveHome(await readFirstmateConfig()));
  }
  server.handle(listHomeFiles, async ({ path }) => {
    const root = await home();
    return { home: root, ...(await listDirectory(root, path)) };
  });
  server.handle(readHomeFile, async ({ path }) => readTextFile(await home(), path));
  server.handle(readChatImage, (input, { paseo }) => loadChatImage(paseo, input));
  server.handle(findHomeFiles, async ({ paths }) => ({ files: await findFiles(await home(), paths) }));
  server.handle(writeHomeFile, async (input) => {
    const written = await writeTextFile(await home(), input, { origin: () => newAction("files.save", "captain") });
    // The charter's source, saved in the panel, reaches AGENTS.md at once rather than at the next reload.
    if (written.path === CHARTER_FILE) await refreshCharter();
    return written;
  });

  server.handle(removeSuggestionRpc, async (suggestion) => ({
    suggestions: await removeSuggestion(await home(), suggestion, { origin: () => newAction("suggestion.remove", "captain") }),
  }));

  server.handle(compareCharterRpc, async () => ({
    path: (await writeNewCharter(await home())) ? NEW_CHARTER_FILE : null,
  }));
  server.handle(acknowledgeCharterRpc, async () => {
    await acknowledgeCharter(await home());
    return {};
  });

  // Storage lives on the host; registering the definition is what makes the
  // board's `useSettings` reads and writes valid for this installation.
  server.registerSettings(displaySettings);
  server.registerSettings(taskLayoutSettings);

  // The receipt journal's read-only timeline pages; refused while FIRSTMATE_RECEIPT_JOURNAL is off. See server/receipts.ts.
  server.handle(pageReceiptTimeline, async (input, { paseo }) => pageTimeline(paseo, await readFirstmateConfig(), input));
  // PixiJS's browser build for the Deck, and the setting packs it draws, from art/settings/. See server/deck-settings.ts.
  server.handle(loadDeckEngine, () => readDeckEngine());
  server.handle(listDeckSettingsRpc, () => listDeckSettings());
  server.handle(loadDeckSetting, ({ id }) => readDeckSetting(id));

  const unregisterRelay = registerSteerRelay(server, steers);
  // A crewmate whose finish the first mate has been told about leaves Paseo's "Ready to review"; see server/crew-seen.ts.
  const unregisterCrewSeen = registerCrewSeen(server, readFirstmateConfig);
  // The first mate's tool calls and its crew's turn ends, for the receipt journal; idle while it is off.
  const unregisterReceipts = registerReceiptObservers(server, readFirstmateConfig, attention.ended);
  const unregisterAttention = attention.register(server, (paseo, config) =>
    loadFleet(paseo, config, reports, async () => [], () => remotes.read()));

  // A charter change reaches a home already in use on the next reload, rather
  // than waiting for the next launch. Only a home a launch has prepared: this
  // never creates one.
  void refreshCharter().catch((error: unknown) => {
    console.error("[firstmate] could not rewrite the charter:", error);
  });

  return async () => {
    await stopWorkflows();
    unregisterRelay();
    unregisterCrewSeen();
    unregisterReceipts();
    unregisterAttention();
    watches.stop();
    remotes.stop();
    await decisions.stop();
  };
}

async function refreshCharter(): Promise<void> {
  const config = await readFirstmateConfig();
  const home = resolveHome(config);
  if (await isHomeReady(home)) await prepareHome(home, config);
}
