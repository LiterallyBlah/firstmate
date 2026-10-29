/** Synthetic host only. Batch controls call their real RPC contracts. */
import { useRpc as individual } from '../smooth-pr6/stubs';
import { projects, homeId, uuid, params, clone } from '../smooth-pr2/data';
export * from '../smooth-pr6/stubs';
const scenario = params.get('batch') || 'normal', oldReview = params.get('stage') === 'review-before', methods = new Map(), batches = [];
const profile = { provider: 'fixture/model', modeId: 'full-access' }, budget = { agents: 3, turns: 20 }, limits = { supervisorSessions: 1, supervisorTurns: 8 };
const rows = projects.projects;
if (scenario !== 'capacity') {
  const invalid = rows.find(p => !p.directory), existing = rows.find(p => p.agentId), valid = rows.filter(p => p.directory && !p.agentId).slice(0, 2);
  rows.splice(0, rows.length, ...valid, { ...existing, name: 'Archive' }, { ...invalid, name: 'Remote storage' });
} else rows.forEach((p, i) => Object.assign(p, { agentId: null, workspaceId: null, directory: `C:/Projects/${p.name}`, hostId: 'local', state: 'unadmitted', sessions: 0, turns: 0, projectId: uuid(i + 1) }));
const choices = p => ({ homeId, name: p.name, profile, budget, limits, sourcePath: 'data/project-orders.md' });
export function useRpc(contract) {
  if (!methods.has(contract.name)) {
    if (contract.name === 'firstmate.projects.setup.read') methods.set(contract.name, async input => {
      const catalog = await individual(contract)(input); catalog.reviewed = rows.filter(p => p.directory && !p.agentId).map(choices); return catalog;
    });
    else if (!contract.name.startsWith('firstmate.projects.batch.')) return individual(contract);
    else methods.set(contract.name, async input => {
      window.review.calls.push({ name: contract.name, input: clone(input) });
      if (contract.name.endsWith('.status')) return clone(batches);
      if (contract.name.endsWith('.preview')) {
        const reviews = [];
        for (const c of input.choices) reviews.push(await individual({ name: 'firstmate.projects.setup.preview' })(c));
        const capacity = { slots: window.review.features.capacity.slots, generalHeadroom: window.review.features.capacity.generalHeadroom, occupied: 0,
          available: window.review.features.capacity.slots - window.review.features.capacity.generalHeadroom };
        const manifest = { version: 1, homeId, batchId: input.batchId, registryDigest: 'a'.repeat(64), policyHash: 'd'.repeat(64), capacity,
          children: reviews.map((r, i) => ({ homeId, requestId: uuid(701 + i), review: r.review, reviewDigest: r.reviewDigest })) };
        const short = input.choices.length > capacity.available;
        return { reviews, capacity, commit: short ? null : { manifest, reviewDigest: 'f'.repeat(64) }, reasons: short ? [`${input.choices.length} selected; room for ${capacity.available}. Review capacity or choose fewer projects.`] : [] };
      }
      if (contract.name.endsWith('.commit')) {
        if (scenario === 'refused' && window.review.calls.filter(c => c.name === contract.name).length === 1)
          throw Error('Available capacity changed. Keep your selection and review capacity again before creating mates.');
        const result = { commit: clone(input), problems: [], children: input.manifest.children.map((c, i) => ({ name: c.review.name, requestId: c.requestId, projectId: c.review.projectId,
          state: i && ['uncertain', 'recover-create'].includes(scenario) ? 'checking' : 'ready',
          reason: i && ['uncertain', 'recover-create'].includes(scenario) ? oldReview ? 'Checking whether setup finished. Unknown operations are never automatically repeated.' : scenario === 'recover-create' ?
            'The setup reply was lost. Continue saved batch to find the same mate and finish its first message once creation is confirmed. Its model, permissions and spending limits are kept.' :
            "Check saved setup to inspect the result. An uncertain opening stays held and won't be sent again." : 'Ready',
          // Production tests verify this service classification; fixtures show each revision's projection.
          agentId: `batch-mate-${i}`, sessions: 1, turns: 1, canContinue: !!i && scenario === 'recover-create' && !oldReview, canCancel: false })) };
        batches.push(result);
        if (scenario === 'lost') throw Error('The batch reply was lost. Check saved setup.');
        return clone(result);
      }
      if (contract.name.endsWith('.continue')) {
        const batch = batches.find(b => b.commit.manifest.batchId === input.batchId);
        if (!batch) throw Error('No saved batch');
        for (const child of batch.children) if (child.canContinue) Object.assign(child, { state: 'ready', reason: 'Ready', canContinue: false });
        return clone(batch);
      }
      throw Error('Unexpected batch RPC: ' + contract.name);
    });
  }
  return methods.get(contract.name);
}
