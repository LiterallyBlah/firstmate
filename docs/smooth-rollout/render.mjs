import {createRequire} from 'node:module';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../..'),out=resolve(root,'.local/smooth-rollout');
const repo=createRequire(resolve(root,'package.json')),local=createRequire(resolve(root,'docs/board-list/package.json'));
const {build}=local('esbuild'),{chromium}=local('playwright');
await mkdir(resolve(out,'screenshots'),{recursive:true});
for(const version of ['before','after']) await build({entryPoints:[resolve(here,'panel.jsx')],outfile:resolve(out,version+'.js'),bundle:true,jsx:'automatic',logLevel:'warning',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'isolated-host',setup(b){
 b.onResolve({filter:/^@getpaseo\/plugin$/},()=>({path:resolve(root,'docs/board-list/contracts.js')}));
 b.onResolve({filter:/^@getpaseo\/plugin\//},()=>({path:resolve(here,'stubs.jsx')}));
 b.onResolve({filter:/^react($|\/)/},a=>({path:repo.resolve(a.path)}));
 b.onResolve({filter:/^react-dom($|\/)/},a=>({path:local.resolve(a.path)}));
 b.onResolve({filter:/^react-native($|-web$)/},()=>({path:local.resolve('react-native-web')}));
 b.onResolve({filter:/^lucide-react$/},()=>({path:local.resolve('lucide-react')}));
 if(version==='before') b.onLoad({filter:/[\\/]client[\\/].*\.(ts|tsx)$/},async args=>({contents:execFileSync('git',['show',`d74a30c:${relative(root,args.path).replaceAll('\\','/')}`],{cwd:root,encoding:'utf8'}),loader:args.path.endsWith('.tsx')?'tsx':'ts'}));
}}]});
const html=version=>`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;font-family:system-ui}#root{display:flex;flex-direction:column}*{box-sizing:border-box}</style><div id="root"></div><script src="/${version}.js"></script>`;
const server=createServer(async(req,res)=>{
 if(req.url.startsWith('/rpc/firstmate.deck.')){
  let body='';for await(const chunk of req)body+=chunk;
  const input=JSON.parse(body||'{}'),manifest=JSON.parse(await readFile(resolve(root,'art/settings/ship/setting.json'),'utf8'));
  let result;
  if(req.url.endsWith('.engine'))result={version:'8.22.0',source:await readFile(resolve(root,'vendor/pixi.min.js'),'utf8')};
  else if(req.url.endsWith('.settings'))result=[{id:'ship',name:manifest.name,version:manifest.version,formatVersion:manifest.formatVersion,compatible:true,reason:null,preview:null,bytes:0}];
  else if(req.url.endsWith('.setting')&&input.id==='ship')result={manifest,images:Object.fromEntries(await Promise.all(Object.entries(manifest.images).map(async([id,img])=>[id,(await readFile(resolve(root,'art/settings/ship',img.path))).toString('base64')])))};
  else{res.statusCode=400;result={error:'Unknown fixture asset'};}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
 }
 const script=/^\/(before|after)\.js$/.exec(req.url);res.setHeader('Content-Type',script?'application/javascript':'text/html');res.end(script?await readFile(resolve(out,script[1]+'.js')):html(req.url.includes('version=before')?'before':'after'));
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({...(process.platform==='win32'?{channel:'msedge'}:{}),headless:true,args:['--disable-gpu']});
const only=process.argv.slice(2);
const results=only.length?JSON.parse(await readFile(resolve(out,'results.json'),'utf8')).filter(r=>!only.some(s=>r.name.endsWith('-'+s))):[];
try{
 for(const version of ['before','after'])for(const theme of ['light','dark'])for(const [device,width,height]of [['desktop',1440,1000],['phone',390,844]])for(const scenario of ['home','startup','chat','fresh','needs','contextual','scope-unavailable','failure','delayed','decisions-startup','ui-only','deck-pending'].filter(s=>!only.length||only.includes(s))){
  const page=await browser.newPage({viewport:{width,height}}),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  const q=new URLSearchParams({version,theme,home:scenario==='fresh'?'fresh':'upgraded',features:'on',surface:scenario==='chat'?'discussion':scenario==='needs'||scenario==='decisions-startup'?'needs':scenario==='deck-pending'?'deck':'home'});
  if(scenario==='startup'||scenario==='delayed')q.set('startup','');
  if(scenario==='decisions-startup'||scenario==='deck-pending')q.set('decision-pending','');
  if(scenario==='failure')q.set('failure','');
  if(scenario==='contextual'){q.set('configured','');q.set('scoped','');}
  if(scenario==='scope-unavailable')q.set('scoped','');
  if(scenario==='ui-only')q.set('ui-only','');
  if(scenario==='delayed')await page.clock.install();
  await page.goto(origin+'/?'+q,{waitUntil:'networkidle'});
  if(!['startup','failure','delayed'].includes(scenario))await page.getByText('Mustering the crew…',{exact:true}).waitFor({state:'hidden'});
  if(scenario==='delayed')await page.clock.fastForward(31000);
  if(scenario==='deck-pending')await page.locator('canvas').waitFor();
  if(scenario==='delayed'&&version==='after'){
   await page.getByRole('button',{name:'Try again',exact:true}).click();
   assert.equal(await page.evaluate(()=>window.review.calls.filter(c=>c.name==='firstmate.fleet.load').length),1,'pending retry must coalesce');
  }
  if(version==='after'&&['home','chat','startup'].includes(scenario))await page.getByText('Can you help me get the reader update ready?',{exact:true}).waitFor();
  if(errors.length)throw new Error(errors.join(';'));
  const name=`${version}-${theme}-${device}-${scenario}`;
  await page.screenshot({path:resolve(out,'screenshots',name+'.png')});
  const state=await page.evaluate(()=>({text:document.body.innerText,overflow:document.documentElement.scrollWidth>innerWidth,calls:window.review.calls}));
  if(state.overflow)throw new Error('Overflow: '+name);
  results.push({name,errors,...state});console.log(name);await page.close();
 }
 for(const width of only.length?[]:[1440,390]){
  const page=await browser.newPage({viewport:{width,height:width===390?844:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/?version=after&theme=light&home=upgraded&features=off&surface=discussion&configured&long&legacy',{waitUntil:'networkidle'});
  const input=page.getByLabel('Message the first mate',{exact:true}),scroll=page.getByTestId('firstmate-transcript');
  if(errors.length)throw new Error('Interaction page: '+errors.join(';'));
  await input.fill('Please keep this unfinished question.');
  await page.evaluate(()=>window.review.attach());
  await page.getByText('reader-notes.txt',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Load earlier messages',exact:true}).click();
  await page.getByText('Earlier reader message 1',{exact:true}).waitFor({state:'attached'});
  await page.getByRole('button',{name:'Show 2 more tool calls',exact:true}).click();
  await scroll.evaluate(el=>{el.scrollTop=225;el.dispatchEvent(new Event('scroll'));});
  await page.waitForTimeout(150);
  const before=await scroll.evaluate(el=>el.scrollTop);
  await page.evaluate(async()=>{window.review.scope.uiEnabled=true;window.review.scope.executionEnabled=true;await window.review.refresh();});
  assert.equal(await input.inputValue(),'Please keep this unfinished question.');
  assert(Math.abs(await scroll.evaluate(el=>el.scrollTop)-before)<3,'enablement changed scroll');
  await page.evaluate(()=>window.review.openScope(window.review.scope.scopes.find(s=>s.kind!=='general').id));
  await page.getByRole('button',{name:'Back to FirstMate',exact:true}).waitFor();
  assert.equal(await input.isVisible(),false);
  await page.getByRole('button',{name:'Back to FirstMate',exact:true}).click();
  await input.waitFor();
  assert.equal(await input.inputValue(),'Please keep this unfinished question.');
  assert.equal(await input.evaluate(el=>el===document.activeElement),true,'return focus');
  assert(Math.abs(await scroll.evaluate(el=>el.scrollTop)-before)<3,'return changed scroll');
  assert.equal(await page.getByRole('button',{name:'Show 2 more tool calls',exact:true}).count(),0,'tool disclosure collapsed');
  assert.equal(await page.getByText('Earlier reader message 1',{exact:true}).count(),1,'older page lost');
  assert.equal(await page.getByText('reader-notes.txt',{exact:true}).count(),1);
  assert.equal(errors.length,0);
  const calls=await page.evaluate(()=>window.review.calls);
  assert(!calls.some(c=>/\.(ask|discuss|answer|attach|create|launch)$/.test(c.name)),'navigation caused a mutation');
  results.push({name:`interaction-${width}`,errors,calls,readingOffset:before,focusReturned:true,draftKept:true,attachmentsKept:true,historyKept:true,toolDisclosureKept:true});
  console.log('interaction',width,'passed');await page.close();
 }
}finally{await browser.close();await new Promise(done=>server.close(done));await writeFile(resolve(out,'results.json'),JSON.stringify(results,null,2));}
console.log(JSON.stringify({captures:results.length,errors:results.flatMap(r=>r.errors),out}));
