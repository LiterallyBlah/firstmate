import type { PluginTheme } from "@getpaseo/plugin";
import { copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { IconButton, errorText } from "./ui";

export function MessageCopy({
  text,
  theme,
  label = "Copy message",
}: {
  text: string;
  theme: PluginTheme;
  label?: string;
}) {
  const toast = useToast();
  return (
    <IconButton
      icon="Copy"
      label={label}
      theme={theme}
      onPress={() => {
        void copyText(text)
          .then(() => toast.show("Copied", { variant: "success" }))
          .catch((error) => toast.error(errorText(error)));
      }}
    />
  );
}
