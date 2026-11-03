/** For a render harness's baseline build: a relative client/shared import whose file this checkout has removed
 * is read from the baseline commit, so before/after comparisons keep working as the Supervisor cleanup deletes modules. */
import { existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
/** For a harness that builds today's Home or Settings around a few baseline files: its baseline shows Work details, not Supervisors. */
export const SUPERVISORS_AS_WORK_DETAILS = { './supervisors': "export { WorkDetails as SupervisorsEntry } from './work-details';" };
export function removedAtBaseline(build, root, baseline, replaced = {}) {
  const show = path => execFileSync('git', ['show', `${baseline}:${relative(root, path).replaceAll('\\', '/')}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  build.onResolve({ filter: /^\.\.?\// }, args => {
    if (!/[\\/](client|shared)$/.test(args.resolveDir)) return undefined;
    const base = resolve(args.resolveDir, args.path);
    if (args.path in replaced) return { path: base, namespace: 'replaced-at-baseline', pluginData: replaced[args.path] };
    if (['.tsx', '.ts', '.js'].some(ext => existsSync(base + ext)) || existsSync(base)) return undefined;
    for (const ext of ['.tsx', '.ts']) { try { show(base + ext); return { path: base + ext, namespace: 'removed-at-baseline' }; } catch { /* not at the baseline either */ } }
    return undefined;
  });
  build.onLoad({ filter: /.*/, namespace: 'replaced-at-baseline' }, args => ({ contents: args.pluginData, loader: 'ts', resolveDir: dirname(args.path) }));
  build.onLoad({ filter: /.*/, namespace: 'removed-at-baseline' }, args => ({ contents: show(args.path), loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts', resolveDir: dirname(args.path) }));
}
