import { scope, projects, homeId, clone, params } from '../smooth-rollout/data';
import { threads } from '../scoped-supervision/s05-ui/fixtures';
export { scope, projects, homeId, clone, params };
export const histories = new Map([...threads].map(([id, thread]) => [id, clone(thread)]));
if (params.get('case') === 'empty') scope.scopes = scope.scopes.filter(s => s.kind === 'general');
if (params.get('case') === 'paused') scope.executionEnabled = false;
if (params.get('case') === 'off') { scope.uiEnabled = false; scope.executionEnabled = false; scope.scopes = scope.scopes.filter(s => s.kind === 'general'); }
window.review.histories = histories;
window.review.addReply = () => {
  const thread = histories.get(scope.scopes.find(s => s.kind === 'plan').id);
  const source = thread.messages.find(m => m.reply !== null);
  thread.messages.push({ ...clone(source), id: `fresh-reply-${thread.messages.length}` });
};
window.review.loseSend = false;
