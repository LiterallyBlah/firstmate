import { scope, projects, homeId, clone, params } from '../smooth-rollout/data';
import { threads } from '../scoped-supervision/s05-ui/fixtures';
export { scope, projects, homeId, clone, params };
export const histories = new Map([...threads].map(([id, thread]) => [id, clone(thread)]));
if (params.get('case') === 'empty') scope.scopes = scope.scopes.filter(s => s.kind === 'general');
if (params.get('case') === 'paused') scope.executionEnabled = false;
window.review.histories = histories;
window.review.loseSend = false;
