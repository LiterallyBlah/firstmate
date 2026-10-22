import type { ReactTestRendererJSON } from "react-test-renderer";

/** Rendered words only: no prop names, accessibility labels or serialized component data. */
export function visibleText(node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | number | null): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(visibleText).join("\n");
  return (node.children ?? []).map(visibleText).join(node.type === "Text" ? "" : "\n");
}
