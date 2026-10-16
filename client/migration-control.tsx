import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";

import { cancelMigration, migrateMate, migrationTargets, readConfig, type AgentSummary } from "../shared/fleet";
import { OptionPicker } from "./option-picker";
import { IconButton, errorText } from "./ui";

export function MigrationControl({
  theme,
  compact,
  mate,
  onChanged,
  onOpenAgent,
  onOpenFile,
  renderTrigger,
  onOpenChange,
}: {
  theme: PluginTheme;
  compact: boolean;
  mate: AgentSummary | null;
  onChanged: () => void;
  onOpenAgent: ((agentId: string) => void) | null;
  onOpenFile: (path: string) => void;
  /** Lets Home put the trigger in More while keeping this dialog outside it. */
  renderTrigger?: (button: ReactNode, recovering: boolean) => ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  const read = useRpc(readConfig);
  const list = useRpc(migrationTargets);
  const migrate = useRpc(migrateMate);
  const cancel = useRpc(cancelMigration);
  const toast = useToast();
  const [open, setOpenState] = useState(false);
  function setOpen(value: boolean): void {
    setOpenState(value);
    onOpenChange?.(value);
  }
  const [provider, setProvider] = useState("");
  const [modeId, setModeId] = useState("");
  const [thinkingOptionId, setThinking] = useState("");
  const [busy, setBusy] = useState(false);
  const gate = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const config = useQuery({
    queryKey: ["firstmate", "migration-config"],
    queryFn: () => read({}),
    refetchInterval: 3000,
  });
  const pending = config.data?.config.migration ?? null;
  const targets = useQuery({
    queryKey: ["firstmate", "migration-targets"],
    queryFn: () => list({}),
    enabled: open && pending === null,
  });
  const target = targets.data?.targets.find((entry) => entry.provider === provider);
  const running = mate?.status === "running" || mate?.status === "initializing" || (mate?.pendingPermissions ?? 0) > 0;
  const text = { color: theme.colors.foreground, fontSize: 14, lineHeight: 20 };
  const muted = { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 19 };
  const defaults = [{ label: "Provider default", value: "" }];

  async function transfer(keepOld = false): Promise<void> {
    if (gate.current) return;
    const sourceId = pending?.sourceId ?? mate?.id;
    if (sourceId === undefined) return;
    gate.current = true;
    setBusy(true);
    setError(null);
    try {
      if (keepOld) await cancel({ sourceId });
      else await migrate({ sourceId, ...(pending === null ? { target: { provider, modeId, thinkingOptionId } } : {}) });
      setOpen(false);
      toast.show(
        keepOld ? "Migration cancelled; the old mate keeps the role." : "The first-mate role moved to a new session.",
        { variant: "success" },
      );
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      await config.refetch();
      onChanged();
      gate.current = false;
      setBusy(false);
    }
  }

  const trigger = (
    <IconButton
      icon="ArrowRightLeft"
      label={pending === null ? "Switch provider/model" : "Recover migration"}
      tooltip={
        busy
          ? "The first-mate transfer is in progress."
          : config.isLoading
            ? "Loading the first mate's transfer status."
            : pending !== null
              ? "Review the saved first-mate transfer and its recovery options."
              : mate === null
                ? "Launch or adopt a first mate before switching provider or model."
                : "Choose a provider or model for a new first mate, carrying over saved records and a handoff."
      }
      tooltipSide="bottom"
      tooltipAlign="end"
      showLabel={renderTrigger !== undefined || pending !== null}
      theme={theme}
      tone={pending === null ? "default" : "danger"}
      disabled={busy || config.isLoading || (pending === null && mate === null)}
      onPress={() => {
        setError(null);
        setOpen(true);
      }}
    />
  );
  return (
    <>
      {renderTrigger === undefined ? trigger : renderTrigger(trigger, pending !== null)}
      <Modal
        title={pending === null ? "Transfer the first-mate role" : "Recover first-mate migration"}
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <Modal.Content>
          <Text style={text}>
            A new session takes over in the same home. Standing orders and backlog carry over, with a bounded handoff
            containing the latest 200 projected entries (up to 20,000 characters), the opening and a local crew
            snapshot.
          </Text>
          <Text style={muted}>
            Native conversation state and permissions do not transfer across providers. The old conversation stays in
            Paseo history. Existing local and remote workers keep running; the new mate checks earlier local workers on
            its heartbeat. Queued watches and crew notes wait for the handover.
          </Text>
          {pending !== null ? (
            <View style={{ gap: 8 }}>
              <Text style={text}>
                Saved target: {pending.target.provider}. Recovery resumes this replacement, without creating another
                supervisor.
              </Text>
              <Text style={muted}>
                Source: {pending.sourceId}
                {"\n"}Replacement: {pending.agentId}
              </Text>
              <Text style={muted}>
                If the source is still live, Keep old mate cancels the prepared replacement. Once the source is
                archived, recovery must continue.
              </Text>
              <IconButton
                icon="FileText"
                label="Read saved handoff"
                showLabel
                theme={theme}
                onPress={() => {
                  setOpen(false);
                  onOpenFile(pending.handoffPath);
                }}
              />
              {onOpenAgent === null ? null : (
                <IconButton
                  icon="ExternalLink"
                  label="Open source conversation"
                  showLabel
                  theme={theme}
                  onPress={() => onOpenAgent(pending.sourceId)}
                />
              )}
              <IconButton
                icon="X"
                label="Keep old mate"
                showLabel
                theme={theme}
                disabled={busy}
                onPress={() => void transfer(true)}
              />
            </View>
          ) : (
            <>
              <OptionPicker
                label="Target model"
                title="Choose the new first mate's model"
                theme={theme}
                compact={compact}
                value={provider}
                options={(targets.data?.targets ?? []).map((entry) => ({ label: entry.label, value: entry.provider }))}
                searchPlaceholder={targets.isLoading ? "Loading models…" : "Search models"}
                onSelect={(value) => {
                  setProvider(value);
                  setModeId("");
                  setThinking("");
                }}
              />
              <SettingsSelect
                label="Permission mode"
                hint="Choose for the target provider. The old permission mode is never copied."
                value={modeId}
                options={[...defaults, ...(target?.modes ?? []).map(({ id, label }) => ({ value: id, label }))]}
                onValueChange={setModeId}
                disabled={target === undefined}
              />
              {(target?.thinking.length ?? 0) === 0 ? null : (
                <SettingsSelect
                  label="Thinking"
                  value={thinkingOptionId}
                  options={[...defaults, ...target!.thinking.map(({ id, label }) => ({ value: id, label }))]}
                  onValueChange={setThinking}
                />
              )}
              {targets.error === null ? null : <Text style={text}>{errorText(targets.error)}</Text>}
              {running ? (
                <Text style={text}>Wait until the first mate is idle and any permission requests are answered.</Text>
              ) : null}
            </>
          )}
          {error === null ? null : <Text style={{ ...text, color: theme.colors.statusDanger }}>{error}</Text>}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
            <IconButton icon="X" label="Close" showLabel theme={theme} disabled={busy} onPress={() => setOpen(false)} />
            <IconButton
              icon="ArrowRightLeft"
              label={busy ? "Transferring…" : pending === null ? "Transfer role" : "Recover migration"}
              showLabel
              theme={theme}
              tone="accent"
              disabled={busy || (pending === null && (running || target === undefined))}
              onPress={() => void transfer()}
            />
          </View>
          {onOpenAgent === null
            ? null
            : config.data?.config.previousMateIds
                .slice()
                .reverse()
                .map((id) => (
                  <IconButton
                    key={id}
                    icon="History"
                    label={`Previous conversation · ${id.slice(0, 8)}`}
                    showLabel
                    theme={theme}
                    onPress={() => onOpenAgent(id)}
                  />
                ))}
        </Modal.Content>
      </Modal>
    </>
  );
}
