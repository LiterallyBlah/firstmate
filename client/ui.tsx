/**
 * The few pieces every FirstMate screen draws with. The host kit has settings
 * rows and a modal but no button, so these are built from `Pressable`, with
 * every colour taken from the theme.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ActivityIndicator, Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import { bindWebKeys, fromHiddenTooltip, hasWebFocus, tooltipPlacement, webAttributes } from "./web";

/** A fixed-width font on every platform; iOS has no font named "monospace". */
export const MONOSPACE = Platform.select({ ios: "Menlo", default: "monospace" });

export type Tone = "default" | "accent" | "danger";

/** PR10's hover/focus help, shared by buttons and tabs without changing their names or actions. */
export function ControlTooltip({
  theme,
  text,
  align = "start",
  side = "top",
  disabledLabel,
  children,
}: {
  theme: PluginTheme;
  text?: string | undefined;
  align?: "start" | "end";
  side?: "top" | "bottom";
  /** A disabled button cannot receive focus; its wrapper offers the same help without enabling it. */
  disabledLabel?: string | undefined;
  children: (description: ReturnType<typeof webAttributes>) => ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const tooltipId = useId();
  const open = text !== undefined && (hovered || focused) && !dismissed;
  const trigger = useRef<View>(null);
  const popup = useRef<View>(null);
  useLayoutEffect(() => {
    // RN Web can drop the button's blur when it becomes disabled. Keep fresh
    // wrapper focus, but clear a focus flag whose DOM focus has already left.
    if (disabledLabel !== undefined && !hasWebFocus(trigger.current)) setFocused(false);
  }, [disabledLabel]);
  const [placement, setPlacement] =
    useState<ReturnType<typeof tooltipPlacement>>(null);
  const { width, height } = useWindowDimensions();
  useLayoutEffect(() => {
    setPlacement(
      open
        ? tooltipPlacement(trigger.current, popup.current, align, side)
        : null,
    );
    // A partly visible Board column can narrow the popup. Measure its new
    // height once more before choosing whether it belongs above or below.
  }, [open, text, align, side, width, height, placement?.maxWidth]);
  useEffect(() => {
    if (!open) return;
    // TextInput stops keyboard bubbling; capture still dismisses a hovered tip.
    return bindWebKeys(undefined, (key) => {
      if (key !== "Escape") return false;
      setDismissed(true);
      return true;
    }, true);
  }, [open]);
  if (text === undefined) return children({});
  const colors = theme.colors;
  return (
    <View
      ref={(node) => {
        trigger.current = node;
        webAttributes({
          tabindex: disabledLabel === undefined ? null : "0",
          "aria-label": disabledLabel ?? null,
          "aria-disabled": disabledLabel === undefined ? null : "true",
          "aria-describedby": disabledLabel === undefined ? null : tooltipId,
        }).ref?.(node);
      }}
      style={{ zIndex: open ? 10 : 0 }}
      onPointerEnter={(event) => {
        setHovered(true);
        // RN Web's enter event retains the pointer-out's source. A hidden
        // popup exposing this control is not an intentional new hover.
        setDismissed(fromHiddenTooltip(event.nativeEvent));
      }}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => {
        setFocused(true);
        setDismissed(false);
      }}
      onBlur={() => setFocused(false)}
    >
      {children(webAttributes({ "aria-describedby": tooltipId }))}
      <View
        ref={popup}
        nativeID={tooltipId}
        role="tooltip"
        // Kept in the accessibility description even when not painted.
        style={{
          display: open ? "flex" : "none",
          position: "absolute",
          ...((placement?.side ?? side) === "bottom"
            ? { top: "100%" }
            : { bottom: "100%" }),
          ...(placement !== null
            ? { left: placement.left }
            : align === "end"
              ? { right: 0 }
              : { left: 0 }),
          width: 240,
          maxWidth: placement?.maxWidth,
          padding: 10,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface2,
        }}
      >
        <Text style={{ color: colors.foreground, fontSize: 12, lineHeight: 17 }}>
          {text}
        </Text>
      </View>
    </View>
  );
}

export function IconButton({
  icon,
  label,
  theme,
  onPress,
  tone = "default",
  disabled = false,
  showLabel = false,
  tooltip,
  tooltipAlign = "start",
  tooltipSide = "top",
}: {
  icon: string;
  label: string;
  theme: PluginTheme;
  onPress: () => void;
  tone?: Tone;
  disabled?: boolean;
  /** Draws the label beside the icon; otherwise it is only the accessibility label. */
  showLabel?: boolean;
  /** Purpose shown on hover/focus and read as an accessibility hint. */
  tooltip?: string;
  tooltipAlign?: "start" | "end";
  tooltipSide?: "top" | "bottom";
}) {
  const colors = theme.colors;
  const color =
    tone === "accent" ? colors.accentForeground : tone === "danger" ? colors.statusDanger : colors.foreground;
  const styles = useMemo(
    () => ({
      button: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: showLabel ? 10 : 7,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: tone === "accent" ? colors.accent : colors.border,
        backgroundColor: tone === "accent" ? colors.accent : colors.surface1,
        opacity: disabled ? 0.5 : 1,
      },
      label: { color, fontSize: 12, fontWeight: "500" as const },
    }),
    [colors, tone, disabled, showLabel, color],
  );
  return (
    <ControlTooltip
      theme={theme}
      text={tooltip}
      align={tooltipAlign}
      side={tooltipSide}
      disabledLabel={disabled ? label : undefined}
    >
      {(described) => (
        <Pressable
          {...described}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={tooltip}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onPress}
          style={styles.button}
        >
          <Icon name={icon} size={14} color={color} />
          {showLabel ? <Text style={styles.label}>{label}</Text> : null}
        </Pressable>
      )}
    </ControlTooltip>
  );
}

/**
 * A two-or-more-way switch, drawn to sit in a row of `IconButton`s: the same
 * 28-point height (a 14-point icon, 6 points of padding each side, a 1-point
 * border), radius and border, with the selected segment in the accent colour.
 */
export function Segmented<Value extends string>({
  theme,
  value,
  options,
  onChange,
}: {
  theme: PluginTheme;
  value: Value;
  options: ReadonlyArray<{ value: Value; label: string; tooltip?: string; }>;
  onChange: (value: Value) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const colors = theme.colors;
  const styles = useMemo(
    () => ({
      frame: {
        flexDirection: "row" as const,
        height: 28,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
      },
      segment: {
        height: 26,
        justifyContent: "center" as const,
        paddingHorizontal: 12,
      },
      selected: { backgroundColor: colors.accent },
      label: { color: colors.foreground, fontSize: 12, fontWeight: "500" as const },
      labelSelected: { color: colors.accentForeground, fontWeight: "600" as const },
    }),
    [colors],
  );
  return (
    <View
      style={[styles.frame, { zIndex: hovered || focused ? 10 : 0 }]}
      accessibilityRole="tablist"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <ControlTooltip
            key={option.value}
            theme={theme}
            text={option.tooltip}
            side="bottom"
          >
            {(described) => (
              <Pressable
                {...described}
                accessibilityRole="tab"
                accessibilityHint={option.tooltip}
                accessibilityState={{ selected }}
                aria-selected={selected}
                style={[
                  styles.segment,
                  selected ? styles.selected : null,
                  {
                    borderTopLeftRadius: index === 0 ? 7 : 0,
                    borderBottomLeftRadius: index === 0 ? 7 : 0,
                    borderTopRightRadius: index === options.length - 1 ? 7 : 0,
                    borderBottomRightRadius:
                      index === options.length - 1 ? 7 : 0,
                  },
                ]}
                onPress={() => onChange(option.value)}
              >
                <Text style={[styles.label, selected ? styles.labelSelected : null]}>{option.label}</Text>
              </Pressable>
            )}
          </ControlTooltip>
        );
      })}
    </View>
  );
}

/**
 * The round button over a transcript's foot that goes back to its end, shown
 * while the reader is scrolled away from it — as in Paseo's own agent view.
 * Its parent must be the transcript's frame; it positions itself in it.
 */
export function JumpToEnd({ theme, onPress }: { theme: PluginTheme; onPress: () => void }) {
  const colors = theme.colors;
  const styles = useMemo(
    () => ({
      frame: { position: "absolute" as const, left: 0, right: 0, bottom: 12, alignItems: "center" as const },
      button: {
        width: 36,
        height: 36,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface2,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
    }),
    [colors],
  );
  return (
    <View style={styles.frame} pointerEvents="box-none">
      <Pressable accessibilityRole="button" accessibilityLabel="Scroll to the latest" onPress={onPress} style={styles.button}>
        <Icon name="ChevronDown" size={20} color={colors.foreground} />
      </Pressable>
    </View>
  );
}

/** The box of `ActivityIndicator`'s "small" size, which the spinner is scaled down from. */
const SMALL_SPINNER = 20;

/**
 * Something running, drawn the size of the icon it stands in for. Lucide's
 * Loader is a spinner drawn standing still, and at a glance a still spinner
 * reads as broken; React Native's own `ActivityIndicator` turns on every
 * platform. It has only two sizes, so the small one is scaled into a box of
 * the icon's size, keeping the row it sits in the same height.
 */
export function Spinner({ size, color }: { size: number; color: string }) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator size="small" color={color} style={{ transform: [{ scale: size / SMALL_SPINNER }] }} />
    </View>
  );
}

/** A full-width notice under the header. */
export interface BannerAction {
  label: string;
  icon: string;
  onPress: () => void;
  disabled?: boolean;
}

export function Banner({
  theme,
  tone,
  text,
  action,
  actions,
}: {
  theme: PluginTheme;
  tone: "warning" | "danger" | "info";
  text: string;
  action?: BannerAction;
  /** More than one action, in order; drawn after `action`. */
  actions?: readonly BannerAction[];
}) {
  const colors = theme.colors;
  const color =
    tone === "danger" ? colors.statusDanger : tone === "warning" ? colors.statusWarning : colors.foregroundMuted;
  const styles = useMemo(
    () => ({
      banner: {
        flexDirection: "row" as const,
        // On a phone the buttons go to a line of their own rather than squeezing the text to a column.
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        gap: 10,
        borderWidth: 1,
        borderColor: color,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: colors.surface1,
      },
      text: { flex: 1, minWidth: 200, color: colors.foreground, fontSize: 12, lineHeight: 17 },
    }),
    [colors, color],
  );
  return (
    <View style={styles.banner}>
      <Icon name={tone === "info" ? "Info" : "AlertTriangle"} size={14} color={color} />
      <Text style={styles.text}>{text}</Text>
      {[...(action === undefined ? [] : [action]), ...(actions ?? [])].map((each) => (
        <IconButton
          key={each.label}
          icon={each.icon}
          label={each.label}
          theme={theme}
          tone="accent"
          showLabel
          disabled={each.disabled === true}
          onPress={each.onPress}
        />
      ))}
    </View>
  );
}

/** A small rounded label, coloured by what it describes. */
export function Chip({ theme, text, color }: { theme: PluginTheme; text: string; color: string }) {
  const styles = useMemo(
    () => ({
      chip: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 5,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
      },
      dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color },
      text: { color: theme.colors.foreground, fontSize: 11 },
    }),
    [theme, color],
  );
  return (
    <View style={styles.chip}>
      <View style={styles.dot} />
      <Text style={styles.text} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

/**
 * A quieter label than `Chip`, for facts rather than states — a card's project
 * and host: muted text on a faint fill, no border, an optional icon.
 */
export function Tag({
  theme,
  text,
  icon,
  color,
}: {
  theme: PluginTheme;
  text: string;
  icon?: string;
  /** The text and icon colour; muted when absent. */
  color?: string | undefined;
}) {
  const tint = color ?? theme.colors.foregroundMuted;
  const styles = useMemo(
    () => ({
      tag: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        flexShrink: 1,
        minWidth: 0,
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 6,
        backgroundColor: theme.colors.surface2,
      },
      text: { flexShrink: 1, color: tint, fontSize: 11 },
    }),
    [theme, tint],
  );
  return (
    <View style={styles.tag}>
      {icon === undefined ? null : <Icon name={icon} size={11} color={tint} />}
      <Text style={styles.text} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

export { errorText } from "./format";
