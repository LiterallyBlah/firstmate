import type { PluginTheme } from "@getpaseo/plugin";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { IconButton } from "./ui";
import { tomorrowNine, chosenWake } from "./needs-you-state";
import { thisEvening } from "./decision-copy";

/** A calendar and time choices on every platform, without a native dependency or typed date format. */
export function DecisionSnooze({
  theme,
  open,
  onClose,
  onChoose,
}: {
  theme: PluginTheme;
  open: boolean;
  onClose(): void;
  onChoose(until: number): void;
}) {
  const [custom, setCustom] = useState(false);
  const [day, setDay] = useState(() => new Date(tomorrowNine(Date.now())));
  const [month, setMonth] = useState(
    () => new Date(day.getFullYear(), day.getMonth(), 1),
  );
  const [hour, setHour] = useState(9),
    [minute, setMinute] = useState(0);
  const colors = theme.colors;
  const local = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const wake = chosenWake(local, Date.now());
  function choose(until: number) {
    onClose();
    setCustom(false);
    onChoose(until);
  }
  const option = (label: string, onPress: () => void, selected = false) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        minHeight: 44,
        minWidth: 44,
        padding: 10,
        justifyContent: "center",
        borderRadius: 6,
        backgroundColor: selected ? colors.accent : colors.surface1,
      }}
    >
      <Text
        style={{
          color: selected ? colors.accentForeground : colors.foreground,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
  return (
    <Modal
      title="Snooze decision"
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          onClose();
          setCustom(false);
        }
      }}
    >
      <Modal.Content>
        <View style={{ gap: 12 }}>
          {!custom ? (
            <>
              {option("1 hour", () => choose(Date.now() + 3600000))}
              {option(
                new Date().getHours() < 18
                  ? "This evening · 18:00"
                  : "Tomorrow evening · 18:00",
                () => choose(thisEvening(Date.now())),
              )}
              {option("Tomorrow · 09:00", () =>
                choose(tomorrowNine(Date.now())),
              )}
              {option("Pick a time…", () => setCustom(true))}
            </>
          ) : (
            <>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <IconButton
                  theme={theme}
                  icon="ChevronLeft"
                  label="Previous month"
                  onPress={() =>
                    setMonth(
                      new Date(month.getFullYear(), month.getMonth() - 1, 1),
                    )
                  }
                />
                <Text
                  accessibilityRole="header"
                  style={{ color: colors.foreground }}
                >
                  {month.toLocaleDateString(undefined, {
                    month: "long",
                    year: "numeric",
                  })}
                </Text>
                <IconButton
                  theme={theme}
                  icon="ChevronRight"
                  label="Next month"
                  onPress={() =>
                    setMonth(
                      new Date(month.getFullYear(), month.getMonth() + 1, 1),
                    )
                  }
                />
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((label) => (
                  <Text
                    key={label}
                    style={{
                      width: `${100 / 7}%`,
                      textAlign: "center",
                      color: colors.foregroundMuted,
                    }}
                  >
                    {label}
                  </Text>
                ))}
                {Array.from(
                  {
                    length:
                      month.getDay() +
                      new Date(
                        month.getFullYear(),
                        month.getMonth() + 1,
                        0,
                      ).getDate(),
                  },
                  (_, i) => {
                    const number = i - month.getDay() + 1;
                    const date = new Date(
                      month.getFullYear(),
                      month.getMonth(),
                      number,
                    );
                    const selected = date.toDateString() === day.toDateString();
                    return (
                      <View key={i} style={{ width: `${100 / 7}%` }}>
                        {number > 0 ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={date.toDateString()}
                            accessibilityState={{ selected }}
                            onPress={() => setDay(date)}
                            style={{
                              minHeight: 44,
                              alignItems: "center",
                              justifyContent: "center",
                              borderRadius: 6,
                              backgroundColor: selected
                                ? colors.accent
                                : colors.surface0,
                            }}
                          >
                            <Text
                              style={{
                                color: selected
                                  ? colors.accentForeground
                                  : colors.foreground,
                              }}
                            >
                              {number}
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    );
                  },
                )}
              </View>
              <Text style={{ color: colors.foregroundMuted }}>Hour</Text>
              <ScrollView horizontal contentContainerStyle={{ gap: 4 }}>
                {Array.from({ length: 24 }, (_, h) =>
                  option(
                    String(h).padStart(2, "0"),
                    () => setHour(h),
                    h === hour,
                  ),
                )}
              </ScrollView>
              <Text style={{ color: colors.foregroundMuted }}>Minute</Text>
              <ScrollView horizontal contentContainerStyle={{ gap: 4 }}>
                {Array.from({ length: 12 }, (_, i) =>
                  option(
                    String(i * 5).padStart(2, "0"),
                    () => setMinute(i * 5),
                    i * 5 === minute,
                  ),
                )}
              </ScrollView>
              <Text style={{ color: colors.foreground }}>
                {day.toLocaleDateString()} · {String(hour).padStart(2, "0")}:
                {String(minute).padStart(2, "0")}
              </Text>
              <IconButton
                theme={theme}
                icon="AlarmClock"
                label="Snooze until selected time"
                showLabel
                tone="accent"
                disabled={wake === null}
                onPress={() => {
                  if (wake !== null) choose(wake);
                }}
              />
              {wake === null ? (
                <Text style={{ color: colors.statusWarning }}>
                  Choose a future time.
                </Text>
              ) : null}
            </>
          )}
          <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
            Times use this device’s local time zone.
          </Text>
        </View>
      </Modal.Content>
    </Modal>
  );
}
