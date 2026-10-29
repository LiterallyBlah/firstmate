/**
 * Settings › Plugins › FirstMate.
 *
 * Two stores behind one screen, split on which side reads the value: the
 * home, the first mate's id and the crew's model are the daemon's (its
 * handlers and the charter act on them), so they go through
 * `firstmate.config.*`; the refresh interval and the card spacing only draw
 * the board, so they are a host settings document the app reads itself.
 */
import { useRpc, useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useTaskLayout } from "./task-layout";
import { useToast } from "@getpaseo/plugin/client/react-native";
import {
  SettingsAction,
  SettingsGroup,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ScrollView, Text } from "react-native";

import { enableAgentTools, readConfig, releaseMate, writeConfig, type FirstmateConfig } from "../shared/fleet";
import { BOARD_DENSITIES, POLL_SECONDS, displaySettings } from "../shared/settings";
import { DEFAULT_DECK_SETTING } from "../shared/deck-rpc";
import { useDeckSettings } from "./deck-setting-query";
import { FLEET_QUERY_KEY, useFleet } from "./fleet";
import { agentStatusLabel, modelLabel } from "./format";
import { useModeOptions, useModelOptions, withCurrent } from "./models";
import { OptionPicker } from "./option-picker";
import { errorText } from "./ui";
import { WorkflowSurface } from "./workflow-plans";
import { WorkDetails } from "./work-details";

const CONFIG_QUERY_KEY = ["firstmate", "config"] as const;
const PROVIDER_DEFAULT = "";

export function SettingsScreen({ theme, layout, host, navigation }: PluginSurfaceProps) {
  const read = useRpc(readConfig);
  const write = useRpc(writeConfig);
  const release = useRpc(releaseMate);
  const enable = useRpc(enableAgentTools);
  const toast = useToast();
  const queryClient = useQueryClient();
  const display = useSettings(displaySettings);
  const taskLayout = useTaskLayout();
  const settings = useDeckSettings();
  const fleet = useFleet(display.status === "ready" ? display.values.pollSeconds : 5);

  const config = useQuery({ queryKey: CONFIG_QUERY_KEY, queryFn: () => read({}) });
  const current = config.data?.config ?? null;
  const [homeDraft, setHomeDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const models = useModelOptions();
  const crewModes = useModeOptions(current?.crewProvider ?? "");
  const crewModeOptions = useMemo(
    () => [{ label: "Provider default", value: PROVIDER_DEFAULT }, ...crewModes],
    [crewModes],
  );
  const crewModelOptions = useMemo(
    () => [
      { label: "Let the first mate choose", value: "", detail: "its own model, unless a task needs another" },
      ...withCurrent(models.options, current?.crewProvider ?? ""),
    ],
    [models.options, current],
  );

  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: layout.compact ? 12 : 20, gap: 16 },
      note: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
      value: { color: theme.colors.foreground, fontSize: 13 },
    }),
    [theme, layout.compact],
  );

  function refreshAll(): void {
    void queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: FLEET_QUERY_KEY });
  }

  function apply(patch: Partial<FirstmateConfig>, message: string): void {
    setBusy(true);
    write(patch)
      .then((result) => {
        queryClient.setQueryData(CONFIG_QUERY_KEY, result);
        void queryClient.invalidateQueries({ queryKey: FLEET_QUERY_KEY });
        toast.show(message, { variant: "success" });
      })
      .catch((caught: unknown) => toast.error(errorText(caught)))
      .finally(() => setBusy(false));
  }

  const mate = fleet.data?.mate ?? null;
  const tools = fleet.data?.agentTools ?? null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} automaticallyAdjustKeyboardInsets>
      <SettingsGroup title="Work details">
        <WorkflowSurface theme={theme} hostId={host?.id ?? "local"}>
          <WorkDetails theme={theme} compact={layout.compact} hostId={host?.id ?? "local"} {...(navigation ? { navigation } : {})} always />
        </WorkflowSurface>
      </SettingsGroup>
      <SettingsGroup title="The first mate">
        <SettingsSection title="Aboard">
          <SettingsRow
            label="First mate"
            hint={
              mate === null
                ? "None yet. Launch one from the FirstMate board."
                : `${modelLabel(mate)} · ${agentStatusLabel(mate)}`
            }
          >
            <Text style={styles.value} numberOfLines={1}>
              {mate === null ? "—" : (mate.title ?? mate.id)}
            </Text>
          </SettingsRow>
          <SettingsAction
            label="Release it"
            hint="Forgets which agent is the first mate, so another can be launched or adopted. The agent itself keeps running."
            actionLabel="Release"
            disabled={busy || current?.mateAgentId === ""}
            onPress={() => {
              setBusy(true);
              release({})
                .then(() => {
                  refreshAll();
                  toast.show("Released. The agent is still running.", { variant: "success" });
                })
                .catch((caught: unknown) => toast.error(errorText(caught)))
                .finally(() => setBusy(false));
            }}
          />
        </SettingsSection>
        <SettingsSection
          title="Home"
          info={
            <Text style={styles.note}>
              The directory the first mate runs in and the only one it writes to: its charter (AGENTS.md, rewritten on
              every launch), its standing orders (data/captain.md — yours to edit), the project registry and the
              backlog. It can only be moved while no first mate is aboard — release it first.
            </Text>
          }
        >
          {current === null ? null : (
            <SettingsInput
              key={current.home}
              label="Home directory"
              hint={`Empty means ${config.data?.resolvedHome ?? "the plugin's own directory"}.`}
              initialValue={current.home}
              placeholder={config.data?.resolvedHome ?? ""}
              onChangeText={setHomeDraft}
              disabled={busy || current.mateAgentId !== ""}
            />
          )}
          <SettingsAction
            label="Save the home"
            actionLabel="Save"
            disabled={
              busy || current?.mateAgentId !== "" || homeDraft === null || homeDraft.trim() === (current?.home ?? "")
            }
            onPress={() => {
              if (homeDraft === null) return;
              apply({ home: homeDraft.trim() }, "Home saved.");
              setHomeDraft(null);
            }}
          />
        </SettingsSection>
      </SettingsGroup>

      <SettingsGroup title="The crew">
        <SettingsSection
          title="Workers"
          info={
            <Text style={styles.note}>
              Written into the first mate's charter, so it gives every worker this model and mode unless you tell it
              otherwise for a task. A running first mate reads the change the next time it rereads its charter.
            </Text>
          }
        >
          <OptionPicker
            label="Model"
            title="The crew's model"
            value={current?.crewProvider ?? ""}
            options={crewModelOptions}
            searchPlaceholder={models.loading ? "Loading models…" : "Search models"}
            disabled={busy || current === null}
            onSelect={(value) => apply({ crewProvider: value, crewModeId: "" }, "The crew's model is saved.")}
            theme={theme}
            compact={layout.compact}
          />
          <SettingsSelect
            label="Mode"
            hint="The workers' permission mode. A mode that asks before each tool means the first mate answers a lot of permission requests."
            value={
              crewModeOptions.some((option) => option.value === current?.crewModeId)
                ? (current?.crewModeId ?? PROVIDER_DEFAULT)
                : PROVIDER_DEFAULT
            }
            options={crewModeOptions}
            disabled={busy || current === null || current.crewProvider === ""}
            onValueChange={(value) => apply({ crewModeId: value }, "The crew's mode is saved.")}
          />
        </SettingsSection>
      </SettingsGroup>

      <SettingsGroup title="Paseo">
        <SettingsSection title="Agent tools">
          <SettingsAction
            label={tools === true ? "On" : tools === false ? "Off" : "Unknown"}
            hint="The first mate starts its workers and hears back from them through Paseo's agent tools (mcp.injectIntoAgents in the daemon's config). Only sessions started afterwards get them."
            actionLabel="Turn on"
            disabled={busy || tools === true}
            onPress={() => {
              setBusy(true);
              enable({})
                .then(() => {
                  refreshAll();
                  toast.show("Agent tools are on.", { variant: "success" });
                })
                .catch((caught: unknown) => toast.error(errorText(caught)))
                .finally(() => setBusy(false));
            }}
          />
        </SettingsSection>
        <SettingsSection title="Board">
          <SettingsSelect
            label="Columns"
            hint="Detailed columns shows the previous eight columns with their saved order and folds."
            value={taskLayout.values.mode}
            options={[
              { label: "Needs you / In hand / Later / Done", value: "summary" },
              { label: "Detailed columns", value: "detailed" },
            ]}
            disabled={taskLayout.disabled}
            onValueChange={(mode) => taskLayout.save({ mode: mode === "detailed" ? "detailed" : "summary" })}
          />
          <SettingsSelect
            label="Refresh every"
            value={String(display.status === "ready" ? display.values.pollSeconds : 5)}
            options={POLL_SECONDS.map((seconds) => ({ label: `${seconds} seconds`, value: String(seconds) }))}
            disabled={display.status !== "ready"}
            onValueChange={(value) => {
              if (display.status !== "ready") return;
              void display.save({ ...display.values, pollSeconds: Number(value) }, display.revision).then((ok) => {
                if (!ok) toast.error(display.saveError ?? "The interval was not saved.");
              });
            }}
          />
          <OptionPicker
            label="Deck setting"
            title="Deck setting"
            hint={
              settings.isError ? "The installed settings could not be loaded." : "The scene used for the whole fleet."
            }
            value={display.status === "ready" ? display.values.deckSetting : DEFAULT_DECK_SETTING}
            options={(settings.data ?? []).map((pack) => ({
              label: pack.name,
              value: pack.id,
              disabled: !pack.compatible,
              detail: pack.compatible ? pack.version : (pack.reason ?? "Needs a newer FirstMate"),
              ...(pack.preview === null ? {} : { preview: `data:image/png;base64,${pack.preview}` }),
            }))}
            disabled={display.status !== "ready" || settings.data === undefined}
            theme={theme}
            compact={layout.compact}
            onSelect={(deckSetting) => {
              if (
                display.status !== "ready" ||
                !settings.data?.some((pack) => pack.id === deckSetting && pack.compatible)
              )
                return;
              void display.save({ ...display.values, deckSetting }, display.revision).then((ok) => {
                if (!ok) toast.error(display.saveError ?? "The deck setting was not saved.");
              });
            }}
          />
          <SettingsSwitch
            label="Hide workers on disconnected hosts"
            hint="Hide them from the Deck until their host reconnects. Show on the Deck reveals them for this app session."
            value={display.status === "ready" ? display.values.hideDisconnectedWorkers : true}
            disabled={display.status !== "ready"}
            onValueChange={(hideDisconnectedWorkers) => {
              if (display.status !== "ready") return;
              void display.save({ ...display.values, hideDisconnectedWorkers }, display.revision).then((ok) => {
                if (!ok) toast.error(display.saveError ?? "The worker visibility setting was not saved.");
              }).catch(() => toast.error("The worker visibility setting was not saved."));
            }}
          />
          <SettingsSelect
            label="Card spacing"
            value={display.status === "ready" ? display.values.density : "comfortable"}
            options={BOARD_DENSITIES.map((density) => ({
              label: density === "comfortable" ? "Comfortable" : "Compact",
              value: density,
            }))}
            disabled={display.status !== "ready"}
            onValueChange={(value) => {
              if (display.status !== "ready") return;
              const density = BOARD_DENSITIES.find((each) => each === value) ?? "comfortable";
              void display.save({ ...display.values, density }, display.revision).then((ok) => {
                if (!ok) toast.error(display.saveError ?? "The spacing was not saved.");
              });
            }}
          />
        </SettingsSection>
      </SettingsGroup>
    </ScrollView>
  );
}
