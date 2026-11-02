/** The owner's case: two bound project scopes (Ariadne, Starpath) beside the plan helper. */
import { scope, histories, clone } from '../smooth-pr11/data';
const ariadne = scope.scopes.find(s => s.kind === 'project');
ariadne.title = 'Ariadne';
const starpath = clone(ariadne);
starpath.id = '00000000-0000-4000-8000-000000000091'; starpath.title = 'Starpath';
starpath.target = { ...starpath.target, scopeId: starpath.id, agentId: 'starpath-session' };
scope.scopes.push(starpath);
histories.set(starpath.id, { key: starpath.id, title: 'Starpath', messages: [] });
window.review.ariadne = ariadne.id;
