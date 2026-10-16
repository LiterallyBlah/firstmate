import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { browserAddress, ensureSharedTerminal, SHARED_TERMINAL_NAME } from "../shared/native-tools";
import { errorText, IconButton } from "./ui";

/** Native resources stay in Paseo; only explicit button presses create anything. */
export function NativeToolButtons({
  theme,
  navigation,
  workspaceId,
  renderButtons,
  onNavigate,
  onBrowserOpenChange,
}: {
  theme: PluginScreenProps["theme"];
  navigation: PluginScreenProps["navigation"];
  workspaceId: string | null;
  /** Keep the browser dialog outside a containing launcher dialog. */
  renderButtons?: (buttons: ReactNode) => ReactNode;
  onNavigate?: () => void;
  onBrowserOpenChange?: (open: boolean) => void;
}) {
  const ensureTerminal = useRpc(ensureSharedTerminal);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const terminalPending = useRef(false);
  const browserPending = useRef(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const address = browserAddress(url);
  const colors = theme.colors;

  function browserDialog(open: boolean): void {
    setBrowserOpen(open);
    onBrowserOpenChange?.(open);
  }

  async function terminal(): Promise<void> {
    if (workspaceId === null || navigation === undefined || terminalPending.current) return;
    terminalPending.current = true;
    setBusy(true);
    try {
      const result = await ensureTerminal({ workspaceId });
      if (!mounted.current) return;
      toast.show(`${result.created ? "Created" : "Ready"}: ${result.name}. Select it in the workspace.`, {
        variant: "success",
      });
      navigation.openWorkspace({ workspaceId: result.workspaceId });
      onNavigate?.();
    } catch (caught) {
      if (mounted.current) toast.error(errorText(caught));
    } finally {
      terminalPending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function browser(): void {
    if (workspaceId === null || navigation?.openBrowser === undefined || address === null || browserPending.current)
      return;
    browserPending.current = true;
    setError(null);
    try {
      navigation.openBrowser({ workspaceId, url: address });
      browserDialog(false);
    } catch (caught) {
      browserPending.current = false;
      setError(errorText(caught));
    }
  }

  const buttons =
    navigation === undefined ? null : (
      <>
        <IconButton
          theme={theme}
          icon="Terminal"
          label={busy ? "Preparing terminal…" : "Shared terminal"}
          showLabel
          disabled={workspaceId === null || busy}
          tooltip={`Reuse or create "${SHARED_TERMINAL_NAME}", then select it in the workspace. The first mate can use the same terminal.`}
          onPress={() => void terminal()}
        />
        <IconButton
          theme={theme}
          icon="Globe"
          label="New browser"
          showLabel
          disabled={workspaceId === null || busy || navigation.openBrowser === undefined}
          tooltip={
            navigation.openBrowser === undefined
              ? "Browser creation is available in the Paseo desktop app."
              : "Create a native browser tab at a URL. For an existing tab, use Terminal & browser."
          }
          onPress={() => {
            browserPending.current = false;
            setError(null);
            browserDialog(true);
          }}
        />
      </>
    );
  return (
    <>
      {renderButtons === undefined ? buttons : renderButtons(buttons)}
      <Modal title="New shared browser" open={browserOpen} onOpenChange={browserDialog}>
        <Modal.Content>
          <View style={{ gap: 12 }}>
            <Text style={{ color: colors.foreground, fontSize: 14, lineHeight: 20 }}>
              Open a new browser tab in the FirstMate workspace on this desktop. The first mate can use the same page
              when Paseo browser tools are connected.
            </Text>
            <Text style={{ color: colors.foregroundMuted, fontSize: 13, lineHeight: 19 }}>
              To return to an existing tab, cancel and use Terminal & browser. Localhost refers to this desktop.
            </Text>
            <TextInput
              accessibilityLabel="Browser URL"
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="https://example.com"
              placeholderTextColor={colors.foregroundMuted}
              style={{
                color: colors.foreground,
                backgroundColor: colors.surface1,
                borderColor: colors.border,
                borderWidth: 1,
                borderRadius: 8,
                padding: 10,
              }}
            />
            {url.trim() === "" || address !== null ? null : (
              <Text accessibilityRole="alert" style={{ color: colors.statusWarning }}>
                Enter an absolute http:// or https:// URL.
              </Text>
            )}
            {error === null ? null : (
              <Text accessibilityRole="alert" style={{ color: colors.statusDanger }}>
                {error}
              </Text>
            )}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <IconButton theme={theme} icon="X" label="Cancel" showLabel onPress={() => browserDialog(false)} />
              <IconButton
                theme={theme}
                icon="Globe"
                label="Create browser tab"
                showLabel
                tone="accent"
                disabled={address === null || workspaceId === null || navigation?.openBrowser === undefined}
                onPress={browser}
              />
            </View>
          </View>
        </Modal.Content>
      </Modal>
    </>
  );
}
