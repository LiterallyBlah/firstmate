import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const TASK_COLUMNS = ["needs-you", "in-hand", "later", "done"] as const;
export type TaskColumn = (typeof TASK_COLUMNS)[number];
/** Independent version/identity: display v1's blocked/order/folds retain their old meanings. */
export const taskLayoutSettings = defineSettings({
  id: "task-layout",
  scope: "host",
  version: 1,
  schema: z.object({
    mode: z.enum(["summary", "detailed"]).default("summary"),
    order: z.array(z.enum(TASK_COLUMNS)).default([...TASK_COLUMNS]),
    collapsed: z.array(z.enum(TASK_COLUMNS)).default(["later", "done"]),
    laterCollapsed: z.boolean().default(true),
  }),
});
export type TaskLayout = z.infer<typeof taskLayoutSettings.schema>;
export const DEFAULT_TASK_LAYOUT = taskLayoutSettings.schema.parse({});
export function orderedTaskColumns(saved: readonly string[]): TaskColumn[] {
  return [
    "needs-you",
    ...new Set(
      [...saved, ...TASK_COLUMNS].filter(
        (id): id is Exclude<TaskColumn, "needs-you"> => TASK_COLUMNS.includes(id as TaskColumn) && id !== "needs-you",
      ),
    ),
  ];
}
export function moveTaskColumn(saved: readonly string[], id: TaskColumn, delta: -1 | 1): TaskColumn[] {
  const order = orderedTaskColumns(saved),
    from = order.indexOf(id),
    to = from + delta;
  if (from <= 0 || to <= 0 || to >= order.length) return order;
  [order[from], order[to]] = [order[to]!, order[from]!];
  return order;
}
