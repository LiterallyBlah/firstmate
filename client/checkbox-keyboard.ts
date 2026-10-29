import { Platform } from "react-native";

/** Pressable handles Enter for checkbox roles on web, but needs Space explicitly.
 * No browser globals or native event props; native uses its existing accessibility action. */
export function checkboxKeyProps(onSelect: () => void, disabled: boolean) {
  if (Platform?.OS !== "web") return {};
  return { onKeyDown: (event: { key: string; preventDefault(): void }) => {
    if (!disabled && (event.key === " " || event.key === "Spacebar")) { event.preventDefault(); onSelect(); }
  } };
}
