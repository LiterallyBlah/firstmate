import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { checkUpdate, UPDATE_REFRESH_MS, type UpdateStatus } from "../shared/update";
import type { MateSender } from "./mate-send";
import { IconButton } from "./ui";

const QUERY_KEY = ["firstmate", "update"] as const;
export function updateControl(status: UpdateStatus, blocked: string | null) {
  const enabled = status.state === "available" && status.token !== undefined && !status.requested && blocked === null;
  const label =
    status.state === "checking"
      ? "Checking FirstMate update"
      : status.state === "current"
        ? "FirstMate is current"
        : status.state === "unavailable"
          ? "FirstMate update unavailable"
          : status.requested
            ? "FirstMate update requested"
            : `Update FirstMate to ${status.latest}`;
  return {
    enabled,
    label,
    tooltip: enabled || blocked === null ? status.explanation : `${status.explanation} ${blocked}`,
    icon:
      status.state === "checking"
        ? "Loader"
        : status.state === "current"
          ? "CircleCheck"
          : status.state === "unavailable"
            ? "Info"
            : status.requested
              ? "Clock"
              : "Download",
  };
}

export function UpdateButton({
  theme,
  mateId,
  sender,
  onSent,
  showLabel = false,
}: {
  theme: PluginTheme;
  mateId: string | null;
  sender: MateSender;
  onSent: () => void;
  showLabel?: boolean;
}) {
  const check = useRpc(checkUpdate);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => check({}),
    refetchInterval: UPDATE_REFRESH_MS,
    staleTime: UPDATE_REFRESH_MS,
    refetchOnMount: "always",
    retry: false,
  });
  const status: UpdateStatus = query.isFetching
    ? {
        state: "checking",
        explanation: "Checking FirstMate's configured source.",
      }
    : query.isError
      ? {
          state: "unavailable",
          explanation: "FirstMate's update check could not be reached. The next check will retry.",
        }
      : (query.data ?? {
          state: "checking",
          explanation: "Checking FirstMate's configured source.",
        });
  const control = updateControl(
    status,
    mateId === null
      ? "Launch a first mate to request installation."
      : sender.sending
        ? "A message to the first mate is on its way."
        : null,
  );
  return (
    <IconButton
      theme={theme}
      showLabel={showLabel}
      icon={control.icon}
      label={control.label}
      tooltip={control.tooltip}
      tooltipSide="bottom"
      tooltipAlign="end"
      tone={control.enabled ? "accent" : "default"}
      disabled={!control.enabled}
      onPress={() => {
        if (!control.enabled || !status.token) return;
        sender.update(
          status.token,
          ({ status: next, agentId }) => {
            client.setQueryData(QUERY_KEY, next);
            if (agentId !== null) onSent();
          },
          () => {
            void client.invalidateQueries({ queryKey: QUERY_KEY });
          },
        );
      }}
    />
  );
}
