import '../smooth-pr11/data';
import { fleet } from '../board-list/fixtures';
import { scope } from '../smooth-pr11/data';
fleet.mate.status = 'running';
for (const s of scope.scopes) if (s.target.agentId) s.session = 'awake';
import '../smooth-rollout/panel';
