import { useRpc as original } from '../smooth-rollout/stubs';
import { scope, projects, homeId, clone, params, histories } from './data';
export * from '../smooth-rollout/stubs';
const methods = new Map();
export function useRpc(contract) {
  if (!['firstmate.mate.ask', 'firstmate.scope.read', 'firstmate.scope.conversation', 'firstmate.scope.discuss', 'firstmate.projects.setup.read', 'firstmate.projects.setup.status'].includes(contract.name)) return original(contract);
  if (!methods.has(contract.name)) methods.set(contract.name, async input => {
    window.review.calls.push({ name: contract.name, input: clone(input) });
    switch (contract.name) {
      case 'firstmate.mate.ask': return { agentId: 'first-mate' };
      case 'firstmate.scope.read':
        if (params.get('case') === 'error' || window.review.failRead) throw Error('Offline (synthetic fixture)');
        return clone(scope);
      case 'firstmate.scope.conversation': return clone(histories.get(input.scopeId) ?? { key: input.scopeId, title: 'Conversation', messages: [] });
      case 'firstmate.scope.discuss': {
        if (window.review.loseSend) throw Error('Lost response (synthetic fixture)');
        const thread = histories.get(input.route.target.scopeId) ?? { key: input.route.target.scopeId, title: input.route.recipient, messages: [] };
        thread.messages.push({ id: input.id, kind: 'discuss', text: input.text, createdAt: new Date().toISOString(), agentId: input.route.target.agentId,
          delivery: 'sent', reply: null, route: input.route });
        histories.set(input.route.target.scopeId, thread);
        return { outcome: 'recorded', thread: clone(thread) };
      }
      case 'firstmate.projects.setup.read': return { snapshot: clone(projects), models: [], sources: [], reviewed: [], problems: [], folderIssues: [] };
      case 'firstmate.projects.setup.status': return { snapshot: clone(projects), requests: [], recoverableCreates: [] };
    }
  });
  return methods.get(contract.name);
}
