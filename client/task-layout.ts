import { useSettings } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useRef, useState } from "react";
import { DEFAULT_TASK_LAYOUT, taskLayoutSettings, type TaskLayout } from "../shared/task-layout";

/** A separate host document; saving here never rewrites the legacy display settings. */
export function useTaskLayout() {
  const document = useSettings(taskLayoutSettings);
  const latest = useRef(document);
  latest.current = document;
  const [pending, setPending] = useState<TaskLayout | null>(null);
  const gate = useRef(false);
  const toast = useToast();
  const values = pending ?? (document.status === "ready" ? document.values : DEFAULT_TASK_LAYOUT);
  function save(patch: Partial<TaskLayout>) {
    if (gate.current || latest.current.status !== "ready") return;
    gate.current = true;
    setPending({ ...values, ...patch });
    async function commit() {
      const current = latest.current;
      if (current.status === "ready" && (await current.save({ ...current.values, ...patch }, current.revision))) return;
      // A failed compare-and-swap must not replay an action against a stale revision.
      toast.error("The task layout changed elsewhere. Please try again.");
    }
    void commit()
      .catch(() => toast.error("Could not save the task layout."))
      .finally(() => {
        gate.current = false;
        setPending(null);
      });
  }
  return {
    values,
    save,
    disabled: document.status !== "ready" || pending !== null,
    invalid: document.status === "invalid",
  };
}
