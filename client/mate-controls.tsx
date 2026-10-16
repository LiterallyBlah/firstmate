/**
 * The first mate's context, and the two things to do about it: compact it,
 * or restart the first mate from scratch. Sits at the end of the chat's
 * button row.
 *
 * Restart asks first, in a host `Modal`: it ends the conversation. The records
 * carry over, the old conversation stays readable in Paseo, and the crewmates
 * keep running — but Paseo tells only the agent that started a crewmate when
 * it finishes, so the new first mate checks on those on its heartbeat.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { useId, useMemo, useState } from "react";
import { Text, View } from "react-native";

import { compactMate, restartMate } from "../shared/fleet";
import { ContextMeter } from "./context-meter";
import { IconButton, errorText } from "./ui";
import { focusWebElement } from "./web";

export function MateControls({
  theme,
  onOpenConversation,
  usedTokens,
  maxTokens,
  running,
  onChanged,
}: {
  theme: PluginTheme;
  onOpenConversation?: (() => void) | undefined;
  usedTokens: number | null | undefined;
  maxTokens: number | null | undefined;
  /** A turn is in flight: neither a compact nor a restart may cut into it, and the daemon refuses both. */
  running: boolean;
  /** Called once the change is made, so the board picks up the new state at once. */
  onChanged: () => void;
}) {
  const compactNow = useRpc(compactMate);
  const restartNow = useRpc(restartMate);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [menu, setMenu] = useState(false);
  const triggerId = useId();
  function closeConfirmation(open: boolean): void {
    setConfirming(open);
    if (!open) focusWebElement(triggerId);
  }

  const styles = useMemo(
    () => ({
      // Keep context and session actions together at the end of the single toolbar row.
      group: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, marginLeft: "auto" as const },
      text: { color: theme.colors.foreground, fontSize: 14, lineHeight: 20 },
      muted: { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 19 },
      actions: { flexDirection: "row" as const, gap: 8, justifyContent: "flex-end" as const },
    }),
    [theme],
  );

  function run(action: () => Promise<unknown>, success: string): void {
    setBusy(true);
    action()
      .then(() => {
        toast.show(success, { variant: "success" });
        onChanged();
      })
      .catch((caught: unknown) => toast.error(errorText(caught)))
      .finally(() => setBusy(false));
  }

  return (
    <View style={styles.group}>
      <ContextMeter theme={theme} used={usedTokens} max={maxTokens} />
      <IconButton
        icon="Ellipsis"
        label="Session actions"
        theme={theme}
        nativeID={triggerId}
        tooltip="Full conversation, Compact and Restart."
        tooltipAlign="end"
        onPress={() => setMenu(true)}
      />
      <Modal title="Session actions" open={menu} onOpenChange={setMenu}>
        <Modal.Content>
          {onOpenConversation === undefined ? null : (
            <IconButton
              theme={theme}
              icon="ExternalLink"
              label="Full conversation"
              showLabel
              tooltip="Open Paseo's full chat for activity, interrupt, history and native composer tools."
              onPress={() => {
                setMenu(false);
                onOpenConversation();
              }}
            />
          )}
          <IconButton
            icon="Shrink"
            label="Compact"
            tooltip="Condense context in the current first-mate session."
            tooltipAlign="end"
            showLabel
            theme={theme}
            disabled={busy || running}
            onPress={() => {
              setMenu(false);
              run(() => compactNow({}), "The first mate is compacting its context.");
            }}
          />
          <IconButton
            icon="RotateCcw"
            label="Restart"
            tooltip="Start a fresh first mate from saved records. The prior conversation stays in Paseo history."
            tooltipAlign="end"
            showLabel
            theme={theme}
            disabled={busy || running}
            onPress={() => {
              setMenu(false);
              setConfirming(true);
            }}
          />
        </Modal.Content>
      </Modal>
      <Modal title="Restart the first mate?" open={confirming} onOpenChange={closeConfirmation}>
        <Modal.Content>
          <Text style={styles.text}>
            A new first mate starts from scratch, with the same model and settings. This conversation ends; it stays
            readable in Paseo's history.
          </Text>
          <Text style={styles.muted}>
            Its records carry over — your standing orders, the projects, the backlog — and it picks up from them.
            Workers already running keep running; the new first mate checks on them regularly, since Paseo only tells
            the agent that started a worker when it finishes.
          </Text>
          <View style={styles.actions}>
            <IconButton icon="X" label="Cancel" showLabel theme={theme} onPress={() => closeConfirmation(false)} />
            <IconButton
              icon="RotateCcw"
              label="Restart"
              showLabel
              tone="danger"
              theme={theme}
              disabled={busy || running}
              onPress={() => {
                closeConfirmation(false);
                run(() => restartNow({}), "The first mate is starting afresh.");
              }}
            />
          </View>
        </Modal.Content>
      </Modal>
    </View>
  );
}
