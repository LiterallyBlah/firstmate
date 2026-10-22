import type { PlanNode, WorkflowPlan } from "../shared/workflow-plans";

export type PlanEdge = PlanNode["after"][number] & { to: string };
export interface GraphNode {
  id: string; title: string; node: PlanNode | undefined; plan: WorkflowPlan | undefined;
  external: boolean; removed: boolean; level: number; x: number; y: number;
}
export interface GraphEdge extends PlanEdge { points: { x: number; y: number }[] }
export const GRAPH_CARD = { width: 224, height: 120, gap: 24, stage: 208, header: 32 };
const MAX_NODES = 60, MAX_EDGES = 120;

/** Read-only layout, including external ancestors so a path through another plan is not lost. */
export function planGraph(plan: WorkflowPlan, plans: readonly WorkflowPlan[]) {
  const catalog = new Map<string, { node: PlanNode; plan: WorkflowPlan; removed: boolean }>();
  // Match the summary's preference for this plan over automatic copies.
  for (const p of [...plans.filter(p => p.definition.implicit), ...plans.filter(p => !p.definition.implicit), plan]) {
    for (const { node } of p.removed ?? []) catalog.set(node.id, { node, plan: p, removed: true });
    for (const node of p.definition.nodes) catalog.set(node.id, { node, plan: p, removed: false });
  }
  const entries = new Map<string, GraphNode>(), edges: PlanEdge[] = [];
  const visiting = new Set<string>(), visited = new Set<string>();
  let problem = "";
  function visit(id: string): number {
    if (visiting.has(id)) { problem = "A dependency cycle prevents a graph layout."; return 0; }
    if (visited.has(id)) return entries.get(id)!.level;
    if (entries.size >= MAX_NODES) { problem = "This plan and its prerequisites are too large for a readable graph."; return 0; }
    const source = catalog.get(id);
    const entry: GraphNode = { id, title: source?.node.title ?? id, node: source?.node, plan: source?.plan,
      external: source?.plan.definition.id !== plan.definition.id, removed: source?.removed ?? false, level: 0, x: 0, y: 0 };
    entries.set(id, entry); visiting.add(id);
    // Removed definitions are historical metadata, not current dependency routes.
    for (const edge of source && !source.removed ? source.node.after : []) {
      if (edges.length >= MAX_EDGES) { problem = "This plan has too many dependencies for a readable graph."; break; }
      edges.push({ ...edge, to: id });
      entry.level = Math.max(entry.level, visit(edge.node) + 1);
      if (problem) break;
    }
    visiting.delete(id); visited.add(id);
    return entry.level;
  }
  for (const node of plan.definition.nodes) { visit(node.id); if (problem) break; }
  if (problem) return { nodes: [], levels: [], edges: [], width: 0, height: 0, problem, incomplete: false };
  const nodes = [...entries.values()];
  const levels: GraphNode[][] = [];
  // Definition order is stable, even when definitions are not topologically sorted.
  const order = new Map([...catalog.keys()].map((id, index) => [id, index]));
  for (const node of nodes) (levels[node.level] ??= []).push(node);
  for (const level of levels) level.sort((a, b) => (order.get(a.id) ?? -1) - (order.get(b.id) ?? -1));
  const { width: cardWidth, height: cardHeight, gap, stage, header } = GRAPH_CARD;
  const contentWidth = Math.max(1, ...levels.map(level => level.length)) * (cardWidth + gap) - gap;
  const skips = edges.filter(edge => entries.get(edge.to)!.level - entries.get(edge.node)!.level > 1);
  const width = contentWidth + 24 + skips.length * 8;
  for (const level of levels) level.forEach((node, i) => {
    node.x = (contentWidth - level.length * (cardWidth + gap) + gap) / 2 + i * (cardWidth + gap);
    node.y = node.level * stage + header;
  });
  const routed: GraphEdge[] = edges.map(edge => {
    const from = entries.get(edge.node)!, to = entries.get(edge.to)!;
    const sources = levels[from.level]!.filter(n => edges.some(e => e.node === n.id));
    const incoming = edges.filter(e => e.to === to.id);
    const arrivingSkips = skips.filter(e => entries.get(e.to)!.level === to.level);
    const start = { x: from.x + cardWidth / 2, y: from.y + cardHeight };
    // Incoming ports occupy the left half, distinct from every centred exit stub
    // (card positions are half a column apart). The right half stays clear for level labels.
    const end = { x: to.x + cardWidth * (0.1 + 0.35 * (incoming.indexOf(edge) + 1) / (incoming.length + 1)), y: to.y };
    // Separate sources cannot share a horizontal bus. Long-edge arrivals also
    // get their own heights, in a band above the next level's header and below exits.
    const exitY = start.y + 8 + 24 * (sources.indexOf(from) + 1) / (sources.length + 1);
    const enterY = end.y - header - 8 - 16 * (arrivingSkips.indexOf(edge) + 1) / (arrivingSkips.length + 1);
    // Long edges use the right gutter, never another step's card.
    const lane = contentWidth + 12 + skips.indexOf(edge) * 8;
    return { ...edge, points: to.level === from.level + 1 ? [start, { x: start.x, y: exitY }, { x: end.x, y: exitY }, end] :
      [start, { x: start.x, y: exitY }, { x: lane, y: exitY }, { x: lane, y: enterY }, { x: end.x, y: enterY }, end] };
  });
  return { nodes, levels, edges: routed, width, height: levels.length * stage - 24,
    problem, incomplete: nodes.some(n => !n.node) };
}
