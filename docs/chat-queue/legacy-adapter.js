/** Adapt older immediate-send visual fixtures to the queue RPC contract while
 * keeping their checked legacy calls and uncertainty assertions observable. */
export function legacyQueueAdapter(deliver) {
  const items = new Map();
  const targetFor = p => p.kind === 'mate' ? { kind: 'mate', agentId: p.agentId } : { kind: 'scope', target: p.input.route.target };
  const same = (a, b) => a.kind === b.kind && (a.kind === 'mate' ? a.agentId === b.agentId : a.target.homeId === b.target.homeId && a.target.scopeId === b.target.scopeId);
  const preview = ({ payload, ...row }) => ({ ...row, text: payload?.kind === 'mate' ? payload.message.text : payload?.input.addressedText ?? '', attachmentCount: payload?.kind === 'mate' ? (payload.message.images?.length ?? 0) + (payload.message.files?.length ?? 0) : 0 });
  return name => async input => {
    if (name === 'firstmate.chat.queue') return { enabled: true, items: [...items.values()].filter(i => same(i.target, input.target) && !['sent', 'removed'].includes(i.state)).map(preview) };
    if (name === 'firstmate.chat.queue.change') {
      const row = items.get(input.id); if (!row) throw Error('Message missing');
      row.state = input.action === 'edit' ? 'editing' : 'removed'; return structuredClone(row);
    }
    if (items.has(input.id)) return structuredClone(items.get(input.id));
    if (input.replaces) items.get(input.replaces).state = 'removed';
    const payload = input.payload, row = { id: input.id, target: targetFor(payload), payload, state: 'claimed', hash: input.id, problem: null };
    items.set(input.id, row);
    try {
      const result = await deliver(payload.kind === 'mate' ? 'firstmate.mate.ask' : 'firstmate.scope.discuss', payload.kind === 'mate' ? payload.message : payload.input);
      row.state = result?.outcome === 'refused' ? 'refused' : result?.outcome === 'uncertain' ? 'held' : 'sent'; row.problem = result?.message ?? null;
      return structuredClone(row);
    } catch (error) { row.state = 'held'; row.problem = error.message; throw error; }
  };
}
