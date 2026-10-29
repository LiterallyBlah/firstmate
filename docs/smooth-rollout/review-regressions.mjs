import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
// Adapted from the independent review's controlled production-component probe.
const before=process.argv.includes('--before');
const root=process.cwd(),out=resolve(root,'.local/smooth-rollout-review',before?'before':'after'),req=createRequire(resolve(root,'docs/board-list/package.json')),repo=createRequire(resolve(root,'package.json'));
const {build}=req('esbuild'),{chromium}=req('playwright');
await mkdir(resolve(out,'screenshots'),{recursive:true});
await build({entryPoints:[resolve(root,'docs/smooth-rollout/panel.jsx')],outfile:resolve(out,'review.js'),bundle:true,jsx:'automatic',logLevel:'warning',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'review-host',setup(b){
 b.onResolve({filter:/^@getpaseo\/plugin$/},()=>({path:resolve(root,'docs/board-list/contracts.js')}));
 b.onResolve({filter:/^@getpaseo\/plugin\//},()=>({path:resolve(root,'docs/smooth-rollout/stubs.jsx')}));
 b.onResolve({filter:/^react($|\/)/},a=>({path:repo.resolve(a.path)}));
 b.onResolve({filter:/^react-dom($|\/)/},a=>({path:req.resolve(a.path)}));
 b.onResolve({filter:/^react-native($|-web$)/},()=>({path:req.resolve('react-native-web')}));
 b.onResolve({filter:/^lucide-react$/},()=>({path:req.resolve('lucide-react')}));
 if(before)b.onLoad({filter:/client[\\/].*\.tsx?$/},a=>({loader:'tsx',contents:execFileSync('git',['show','b2fad4e:'+a.path.slice(root.length+1).replaceAll('\\','/')],{cwd:root,encoding:'utf8'})}));
 b.onLoad({filter:/smooth-rollout[\\/]stubs.jsx$/},async a=>({loader:'jsx',contents:(await readFile(a.path,'utf8')).replace("window.review.calls.push({name:contract.name,input});",`window.review.calls.push({name:contract.name,input});
  if ((params.get('hold')||'').split(',').includes(contract.name) && !window.review.released?.includes(contract.name)) await new Promise((resolve,reject)=>{ (window.review.waiters ||= []).push({name:contract.name,resolve,reject}); });
  window.review.release=(name,error)=>{ (window.review.released ||= []).push(name); for(const w of (window.review.waiters||[]).filter(w=>w.name===name)) error?w.reject(new Error(error)):w.resolve(); window.review.waiters=(window.review.waiters||[]).filter(w=>w.name!==name); };
  `)}));
 b.onLoad({filter:/smooth-rollout[\\/]panel.jsx$/},async a=>({loader:'jsx',contents:('import {discussionSender,discussionSendKey} from "../../client/scope-send";\n'+await readFile(a.path,'utf8')).replace('function Host(){',`window.review.cache=cache;
window.review.seedUncertain=async()=>{const s=window.review.scope.scopes.find(s=>s.kind==='plan'&&s.target.agentId);const input={id:'00000000-0000-4000-8000-000000000999',text:'Keep the original recipient',addressedText:'Keep the original recipient',defaultScope:s.id,route:{target:s.target,recipient:s.title,projectIds:[],conversationId:'main',replyTo:null}};discussionSender(globalThis,discussionSendKey('local',window.review.scope.homeId,s.id)).send(input,async()=>({outcome:'uncertain',message:'Synthetic lost response'}),()=>{});await Promise.resolve();await Promise.resolve();};
function Host(){\n const [generation,setGeneration]=useState(0); window.review.remount=()=>setGeneration(g=>g+1);`).replace('const [currentRoute,setRoute]=useState(route);','const [currentRoute,setRoute]=useState(route); window.review.navigate=setRoute;').replace('<FleetSurface theme=','<FleetSurface key={generation} theme=')}));
}}]});
const server=createServer(async(req,res)=>{res.setHeader('Content-Type',req.url==='/review.js'?'application/javascript':'text/html');res.end(req.url==='/review.js'?await readFile(resolve(out,'review.js')):'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;font-family:system-ui}#root{display:flex;flex-direction:column}*{box-sizing:border-box}</style><div id="root"></div><script src="/review.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({...(process.platform==='win32'?{channel:'msedge'}:{}),headless:true,args:['--disable-gpu']}),origin=`http://127.0.0.1:${server.address().port}`,results=[];
const capture=async(page,name)=>{await page.screenshot({path:resolve(out,'screenshots',name+'.png')});const state=await page.evaluate(()=>({text:document.body.innerText,overflow:document.documentElement.scrollWidth>innerWidth,calls:window.review.calls,live:[...document.querySelectorAll('[aria-live]')].map(el=>({text:el.textContent,live:el.getAttribute('aria-live')}))}));results.push({name,...state});assert(!state.overflow,name+' overflow');return state;};
try{
 for(const theme of ['light','dark'])for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:width===390?844:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const name=`${theme}-${width}`;
  page.setDefaultTimeout(10000);await page.clock.install();
  await page.goto(origin+'/?'+new URLSearchParams({theme,home:'upgraded',features:'on',surface:'home',long:'',legacy:'',configured:'',hold:'firstmate.fleet.load,firstmate.needs-you.read'}),{waitUntil:'networkidle'});
  const input=page.getByLabel('Message the first mate',{exact:true}),scroll=page.getByTestId('firstmate-transcript');
  await input.waitFor();await page.getByText('Can you help me get the reader update ready?',{exact:true}).waitFor();
  await input.fill('Independent review: keep this draft');await page.evaluate(()=>window.review.attach());
  await page.getByRole('button',{name:'Load earlier messages',exact:true}).click();await page.getByText('Earlier reader message 1',{exact:true}).waitFor({state:'attached'});
  await page.getByRole('button',{name:'Show 2 more tool calls',exact:true}).click();
  await scroll.evaluate(el=>{el.scrollTop=225;el.dispatchEvent(new Event('scroll'));});await page.clock.runFor(200);
  await page.clock.fastForward(1000);let state=await capture(page,name+'-pending-1s');assert(!state.text.includes("Can't read decisions"));
  await page.clock.fastForward(8000);state=await capture(page,name+'-pending-9s');assert(state.text.includes('taking a little longer'));
  await page.clock.fastForward(22000);state=await capture(page,name+'-pending-31s');assert(state.text.includes('Try again'));assert(!state.text.includes("Can't connect"));
  await page.evaluate(()=>window.review.openScope(window.review.scope.scopes.find(s=>s.kind!=='general').id));await page.getByRole('button',{name:'Back to FirstMate',exact:true}).click();await page.clock.runFor(200);
  results.push({name:name+'-recovery-back-focus',focused:await input.evaluate(el=>el===document.activeElement),activeElement:await page.evaluate(()=>document.activeElement.tagName)});
  if(!before)assert.equal(await input.evaluate(el=>el===document.activeElement),true,'return from pending-recovery discussion focuses General composer');
  await page.getByRole('button',{name:'Try again',exact:true}).click();assert.equal(await page.evaluate(()=>window.review.calls.filter(c=>c.name==='firstmate.fleet.load').length),1);
  await page.evaluate(()=>{window.review.release('firstmate.fleet.load');});await page.getByText('Getting FirstMate ready…',{exact:true}).waitFor({state:'hidden'});await page.clock.runFor(200);
  state=await capture(page,name+'-fleet-ready-decisions-still-pending-31s');assert.equal(await input.inputValue(),'Independent review: keep this draft');
  if(!before){assert(state.text.includes('taking a little longer'),'decision delay explanation survives fleet completion');assert(state.text.includes('Connection details'));assert(state.text.includes('Try again'));assert(!state.text.includes("Can't connect"));}
  await page.getByRole('button',{name:/^Needs you, loading decisions/}).click();await page.clock.runFor(200);await capture(page,name+'-late-open-decisions');
  if(!before){await page.getByRole('button',{name:'Connection details',exact:true}).waitFor();await page.getByRole('button',{name:'Try again',exact:true}).click();assert.equal(await page.evaluate(()=>window.review.calls.filter(c=>c.name==='firstmate.needs-you.read').length),1);}
  await page.getByRole('button',{name:/^Back to (Home|List|First mate|Chat)$/}).click();await page.clock.runFor(200);
  if(!before){await page.getByRole('button',{name:/^Needs you, loading decisions/}).click();await page.getByRole('button',{name:'Try again',exact:true}).waitFor();await page.getByRole('button',{name:/^Back to (Home|List|First mate|Chat)$/}).click();}
  const offset=await scroll.evaluate(el=>el.scrollTop);results.push({name:name+'-recovery-handoff',offset,toolsExpanded:await page.getByRole('button',{name:'Show 2 more tool calls',exact:true}).count()===0,olderRetained:await page.getByText('Earlier reader message 1',{exact:true}).count()===1});
  await page.evaluate(()=>window.review.release('firstmate.needs-you.read'));await page.clock.runFor(200);
  await page.evaluate(()=>window.review.openScope(window.review.scope.scopes.find(s=>s.kind!=='general').id));await page.getByRole('button',{name:'Back to FirstMate',exact:true}).waitFor();assert.equal(await input.isVisible(),false);
  await capture(page,name+'-named-discussion');await page.getByRole('button',{name:'Back to FirstMate',exact:true}).click();await input.waitFor();await page.clock.runFor(200);
  assert.equal(await input.inputValue(),'Independent review: keep this draft');assert.equal(await input.evaluate(el=>el===document.activeElement),true);await capture(page,name+'-returned');
  await page.evaluate(()=>window.review.navigate({chat:'show'}));await page.clock.runFor(200);await page.evaluate(()=>window.review.remount());await input.waitFor();await page.clock.runFor(300);state=await capture(page,name+'-remounted');
  results.push({name:name+'-remount-state',offset:await scroll.evaluate(el=>el.scrollTop),draft:await input.inputValue(),older:await page.getByText('Earlier reader message 1',{exact:true}).count(),toolsCollapsed:await page.getByRole('button',{name:'Show 2 more tool calls',exact:true}).count(),errors});
  await page.evaluate(async()=>{await window.review.seedUncertain();window.review.openScope(window.review.scope.scopes.find(s=>s.kind!=='general').id);});await page.clock.runFor(200);
  const originalButton=page.getByRole('button',{name:/^Open original message to /});await originalButton.waitFor();const originalName=await originalButton.getAttribute('aria-label');
  const beforeCalls=await page.evaluate(()=>window.review.calls.filter(c=>c.name==='firstmate.scope.conversation').map(c=>c.input.scopeId));
  await originalButton.click();await page.clock.runFor(200);const uncertainState=await capture(page,name+'-open-original-uncertain');
  results.push({name:name+'-open-original-result',button:originalName,beforeCalls,afterCalls:await page.evaluate(()=>window.review.calls.filter(c=>c.name==='firstmate.scope.conversation').map(c=>c.input.scopeId)),recipientText:uncertainState.text.split('\n').filter(s=>/^To/.test(s)),originalDraft:await page.getByRole('textbox',{name:'Message recipient',exact:true}).inputValue()});
  if(!before){assert(uncertainState.text.includes('To: Reader pass'));await page.getByRole('button',{name:'Reconcile original message',exact:true}).waitFor();assert((await page.evaluate(()=>window.review.calls.filter(c=>c.name==='firstmate.scope.conversation').map(c=>c.input.scopeId))).includes('00000000-0000-4000-8000-000000000101'));assert(!uncertainState.calls.some(c=>/\.(discuss|answer|attach|create|launch)$/.test(c.name)));}
  assert.equal(errors.length,0);await page.close();
 }
}finally{await writeFile(resolve(out,'independent-results.json'),JSON.stringify(results,null,2));await browser.close();await new Promise(r=>server.close(r));}
console.log(JSON.stringify({records:results.length,out}));
