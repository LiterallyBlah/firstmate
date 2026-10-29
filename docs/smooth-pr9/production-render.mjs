/** Bundle native host adapters only. Test starts a bridge to the actual registered server handlers. */
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {mkdir,readFile} from 'node:fs/promises';
const root=process.cwd(),repo=createRequire(resolve(root,'package.json')),local=createRequire(resolve(root,'docs/board-list/package.json'));
const {build}=local('esbuild'),out=resolve(root,'.local/smooth-pr9/production');await mkdir(out,{recursive:true});
for(const stage of ['before','after'])await build({entryPoints:[resolve(root,'docs/smooth-pr9/production-panel.jsx')],outfile:resolve(out,stage+'.js'),bundle:true,jsx:'automatic',logLevel:'warning',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'production-host-only',setup(b){
 b.onResolve({filter:/^@getpaseo\/plugin$/},()=>({path:resolve(root,'docs/board-list/contracts.js')}));
 b.onResolve({filter:/^@getpaseo\/plugin\//},()=>({path:resolve(root,'docs/smooth-pr9/production-stubs.jsx')}));
 b.onResolve({filter:/^react($|\/)/},a=>({path:repo.resolve(a.path)}));
 b.onResolve({filter:/^react-dom($|\/)/},a=>({path:local.resolve(a.path)}));
 b.onResolve({filter:/^react-native($|-web$)/},()=>({path:local.resolve('react-native-web')}));
 b.onResolve({filter:/^lucide-react$/},()=>({path:local.resolve('lucide-react')}));
 b.onResolve({filter:/^\.\/workflow-plans$/},a=>a.importer.includes('client')?{path:resolve(root,'docs/smooth-pr9/production-context.jsx')}:undefined);
 // Retain the exact reviewed source: a rebase can remove fe5c65b3 from the fetched branch ancestry.
 if(stage==='before')b.onLoad({filter:/[\\/]client[\\/]plan-help\.tsx$/},async()=>({contents:await readFile(resolve(root,'docs/smooth-pr9/baseline-plan-help.txt'),'utf8'),loader:'tsx'}));
}}]});
console.log('Production-RPC before/after bundles ready. Run PR175_CAPTURE=1 Vitest server/plan-help-wiring.test.ts.');
