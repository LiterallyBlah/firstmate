/**
 * The strip between the chat and the board. Dragging it moves the split; the
 * width is kept as a share of the surface, and saved once per drag rather
 * than once per pixel.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Platform, View } from "react-native";

import {
  bindWebKeys,
  pointerClientX,
  renderedWidth,
  trackPointerOnDocument,
  webAttributes,
} from "./web";
import {
  clampShare,
  HANDLE_WIDTH,
  keyboardShare,
  shareLimits,
} from "./resize-layout";

export function ResizeHandle({
  theme,
  share,
  totalWidth,
  onChange,
  onCommit,
}: {
  theme: PluginTheme;
  share: number;
  totalWidth: number;
  onChange: (share: number) => void;
  onCommit: (share: number) => void;
}) {
  const [active, setActive] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const handle = useRef<View>(null);
  /** Read inside the responder, which is created once and must see the latest values. */
  const latest = useRef({ share, totalWidth, onChange, onCommit });
  latest.current = { share, totalWidth, onChange, onCommit };
  const stopTracking = useRef<() => void>(() => {});
  useEffect(() => () => stopTracking.current(), []);
  useEffect(
    () =>
      bindWebKeys(handle.current, (key, shift) => {
        const current = latest.current;
        const next = keyboardShare(
          key,
          current.share,
          current.totalWidth,
          shift,
        );
        if (next === null) return false;
        current.onChange(next);
        current.onCommit(next);
        return true;
      }),
    [],
  );

  const responder = useMemo(() => {
    let start: { share: number; x: number; pointerWidth: number } | null = null;
    let moved: number | null = null;
    const apply = (dx: number, pointerWidth: number) => {
      const width = latest.current.totalWidth;
      if (start === null || width <= 0) return;
      moved = clampShare(start.share + dx / pointerWidth, width);
      latest.current.onChange(moved);
    };
    const finish = () => {
      stopTracking.current();
      stopTracking.current = () => {};
      const committed = moved;
      start = null;
      moved = null;
      setActive(false);
      if (committed !== null) latest.current.onCommit(committed);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Every scroll view the pointer crosses asks for the responder; the
      // default answer — yes — stops the drag partway.
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (event) => {
        const x = pointerClientX(event.nativeEvent.pageX);
        // Browser coordinates are rendered pixels; onLayout uses layout points
        // under desktop UI scaling. Native gestures already use layout points.
        start = {
          share: latest.current.share,
          x,
          pointerWidth: renderedWidth(
            handle.current,
            latest.current.totalWidth,
          ),
        };
        setActive(true);
        stopTracking.current = trackPointerOnDocument((clientX) => {
          if (start !== null) apply(clientX - start.x, start.pointerWidth);
        }, finish);
      },
      // On web the document listener owns movement, including over scroll
      // views; using both paths would mix rendered pixels and layout points.
      onPanResponderMove: (_event, gesture) => {
        if (Platform.OS !== "web") apply(gesture.dx, latest.current.totalWidth);
      },
      onPanResponderRelease: finish,
      onPanResponderTerminate: finish,
    });
  }, []);

  const highlighted = active || hovered || focused;
  const styles = useMemo(
    () => ({
      hit: {
        width: HANDLE_WIDTH,
        flexShrink: 0,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        backgroundColor: highlighted
          ? theme.colors.surface2
          : theme.colors.surface0,
      },
      // A width and alignSelf alone leave a child with zero height.
      line: {
        position: "absolute" as const,
        top: 0,
        bottom: 0,
        width: highlighted ? 2 : 1,
        backgroundColor: highlighted
          ? theme.colors.accent
          : theme.colors.border,
      },
      grip: {
        width: 6,
        height: 40,
        borderRadius: 3,
        backgroundColor: highlighted
          ? theme.colors.accent
          : theme.colors.foregroundMuted,
      },
    }),
    [theme, highlighted],
  );
  const limits = shareLimits(totalWidth);
  const webHandle = webAttributes(
    {
      "aria-orientation": "vertical",
      "aria-controls": "firstmate-chat-pane",
      title:
        "Drag to resize. Arrow keys adjust; Shift moves faster; Home/End set the limits.",
    },
    "col-resize",
  );

  return (
    <View
      ref={(node) => {
        handle.current = node;
        webHandle.ref?.(node);
      }}
      role={Platform.OS === "web" ? "separator" : undefined}
      accessibilityRole={Platform.OS === "web" ? undefined : "adjustable"}
      accessibilityLabel="Chat width"
      accessibilityHint="Drag to resize. Use Left and Right arrows to adjust, Home and End for the limits."
      accessibilityValue={{
        min: Math.round(limits.min * 100),
        max: Math.round(limits.max * 100),
        now: Math.round(share * 100),
        text: `${Math.round(share * 100)}% chat width`,
      }}
      aria-valuemin={Math.round(limits.min * 100)}
      aria-valuemax={Math.round(limits.max * 100)}
      aria-valuenow={Math.round(share * 100)}
      aria-valuetext={`${Math.round(share * 100)}% chat width`}
      accessibilityActions={[
        { name: "increment", label: "Widen chat" },
        { name: "decrement", label: "Narrow chat" },
      ]}
      onAccessibilityAction={(event) => {
        const key =
          event.nativeEvent.actionName === "increment"
            ? "ArrowRight"
            : event.nativeEvent.actionName === "decrement"
              ? "ArrowLeft"
              : "";
        const next = keyboardShare(key, share, totalWidth);
        if (next !== null) {
          onChange(next);
          onCommit(next);
        }
      }}
      tabIndex={0}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={styles.hit}
      {...responder.panHandlers}
    >
      <View style={styles.line} />
      <View style={styles.grip} pointerEvents="none" />
    </View>
  );
}
