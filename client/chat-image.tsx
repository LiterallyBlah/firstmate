import type { PluginTheme } from "@getpaseo/plugin";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { IconButton } from "./ui";

/** A whole thumbnail and a bounded, scrollable viewer; used for sent and assistant images. */
export function ChatImage({ uri, label, theme, viewerOnly = false, onClose }: {
  uri: string; label: string; theme: PluginTheme; viewerOnly?: boolean | undefined; onClose?: (() => void) | undefined;
}) {
  const [size, setSize] = useState({ width: 220, height: 150 });
  const [failed, setFailed] = useState(false);
  const [opened, setOpened] = useState(viewerOnly);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(280);
  const window = useWindowDimensions();
  const height = Math.max(120, Math.min(600, window.height - 260));
  useEffect(() => {
    let alive = true;
    setFailed(false);
    Image.getSize(
      uri,
      (width, height) => {
        if (alive && width > 0 && height > 0) setSize({ width, height });
      },
      () => {
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [uri]);
  const fit = Math.min(width / size.width, height / size.height, 1);
  return (
    <View style={{ maxWidth: "100%", alignSelf: "flex-start" }}>
      {viewerOnly ? null : failed ? (
        <Text style={{ color: theme.colors.foregroundMuted }}>Image unavailable: {label}</Text>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Enlarge ${label.toLowerCase()}`}
          onPress={() => {
            setZoom(1);
            setOpened(true);
          }}
        >
          <Image
            source={{ uri }}
            style={{
              width: 220,
              maxWidth: "100%",
              height: Math.min(280, Math.max(48, (220 * size.height) / size.width)),
              borderRadius: 6,
              backgroundColor: theme.colors.surface1,
            }}
            resizeMode="contain"
            accessibilityRole="image"
            accessibilityLabel={label}
            accessibilityIgnoresInvertColors
            onError={() => setFailed(true)}
          />
        </Pressable>
      )}
      <Modal title={label} open={opened} onOpenChange={value => { setOpened(value); if (!value) onClose?.(); }}>
        <Modal.Content scrollable={false}>
          {failed ? <Text style={{ color: theme.colors.foregroundMuted }}>Image unavailable: {label}</Text> : null}
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <IconButton
              theme={theme}
              icon="ZoomOut"
              label="Zoom out"
              disabled={zoom <= 1}
              onPress={() => setZoom((n) => Math.max(1, n / 2))}
            />
            <IconButton
              theme={theme}
              icon="ZoomIn"
              label="Zoom in"
              disabled={zoom >= 8}
              onPress={() => setZoom((n) => Math.min(8, n * 2))}
            />
            <IconButton theme={theme} icon="Scan" label="Fit image" showLabel onPress={() => setZoom(1)} />
            <Text style={{ color: theme.colors.foregroundMuted }}>{Math.round(fit * zoom * 100)}%</Text>
          </View>
          <View
            onLayout={(event) => setWidth(Math.max(1, event.nativeEvent.layout.width))}
            style={{ height, overflow: "hidden" }}
          >
            <ScrollView style={{ flex: 1 }}>
              <ScrollView horizontal contentContainerStyle={{ minWidth: "100%" }}>
                <Image
                  source={{ uri }}
                  style={{ width: Math.max(1, size.width * fit * zoom), height: Math.max(1, size.height * fit * zoom) }}
                  resizeMode="contain"
                  accessibilityLabel={label}
                  accessibilityIgnoresInvertColors
                />
              </ScrollView>
            </ScrollView>
          </View>
        </Modal.Content>
      </Modal>
    </View>
  );
}
