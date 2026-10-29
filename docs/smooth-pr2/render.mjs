/** Real components, synthetic reads only. Outputs stay in ignored .local/smooth-pr2/ui. */
import {createRequire} from 'node:module';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../..'),out=resolve(root,'.local/smooth-pr2/ui');
const repo=createRequire(resolve(root,'package.json')),local=createRequire(resolve(root,'docs/board-list/package.json'));
const {build}=local('esbuild'),{chromium}=local('playwright');
const baseline='d74a30ccdcdabffecd3afaf740acf86f074dc43c';
await mkdir(resolve(out,'screenshots'),{recursive:true});
const changed=new Set(['fleet.tsx','settings-screen.tsx','supervision-activation.tsx','project-ownership.tsx','maintenance-ownership.tsx','scope-discussion.tsx','launch.tsx','decision-drawer.tsx','decision-surface.tsx','needs-you-state.ts']);
for(const stage of ['before','after']) await build({entryPoints:[resolve(here,'panel.jsx')],outfile:resolve(out,stage+'.js'),bundle:true,jsx:'automatic',logLevel:'warning',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'isolated-host',setup(b){
 b.onResolve({filter:/^@getpaseo\/plugin$/},()=>({path:resolve(root,'docs/board-list/contracts.js')}));
 b.onResolve({filter:/^@getpaseo\/plugin\//},()=>({path:resolve(here,'stubs.jsx')}));
 b.onResolve({filter:/^react($|\/)/},a=>({path:repo.resolve(a.path)}));
 b.onResolve({filter:/^react-dom($|\/)/},a=>({path:local.resolve(a.path)}));
 b.onResolve({filter:/^react-native($|-web$)/},()=>({path:local.resolve('react-native-web')}));
 b.onResolve({filter:/^lucide-react$/},()=>({path:local.resolve('lucide-react')}));
 if(stage==='before') b.onLoad({filter:/[\\/]client[\\/][^\\/]+\.tsx?$/},args=>{
  const path=relative(root,args.path).replaceAll('\\','/');
  if(!changed.has(path.slice('client/'.length)))return;
  return {contents:execFileSync('git',['show',`${baseline}:${path}`],{cwd:root,encoding:'utf8'}),loader:path.endsWith('tsx')?'tsx':'ts'};
 });
}}]});
const server=createServer(async(req,res)=>{
 const stage=req.url.includes('before')?'before':'after';
 res.setHeader('Content-Type',req.url.endsWith('.js')?'application/javascript':'text/html');
 res.end(req.url.endsWith('.js')?await readFile(resolve(out,stage+'.js')):`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;font-family:system-ui}#root{display:flex;flex-direction:column}*{box-sizing:border-box}button,input,select{font:inherit}button{min-height:44px}</style><div id="root"></div><script src="/${stage}.js"></script>`);
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({...(process.platform==='win32'?{channel:'msedge'}:{}),headless:true,args:['--disable-gpu']});
const results=[];
const cases=[
 ['fresh-off','fresh','off','home'],['fresh-on','fresh','on','home'],
 ['fresh-details','fresh','on','home'],
 ['home','upgraded','on','home'],['board','upgraded','on','board'],['plans','upgraded','on','plans'],
 ['empty-home','upgraded','on','home','empty'],['details','upgraded','on','home'],
 ['problem-off','upgraded','off','home','problem'],['problem-details','upgraded','off','home','problem'],
 ['discussion','upgraded','on','discussion'],['discussion-details','upgraded','on','discussion'],
 ['all-empty','fresh','off','needs'],['all-pending','fresh','off','needs','startup'],['all-partial','fresh','on','needs','partial'],
 ['settings','upgraded','on','settings'],['settings-details','upgraded','on','settings'],
];
try {
 for(const stage of process.env.SMOOTH_CONFIRM?['after']:['before','after'])for(const theme of ['light','dark'])for(const [device,width,height] of process.env.SMOOTH_CONFIRM?[['phone',390,844]]:[['desktop',1440,1000],['phone',390,844]])for(const [name,home,features,surface,extra]of process.env.SMOOTH_CONFIRM?cases.filter(c=>['details','problem-details'].includes(c[0])):cases){
  const page=await browser.newPage({viewport:{width,height}}),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  const q=new URLSearchParams({stage,theme,home,features,surface});if(extra)q.set(extra,'');
  await page.goto(origin+'/?'+q,{waitUntil:'networkidle'});
  if(name==='details'||name==='problem-details'){
   if(stage==='after')await page.getByRole('button',{name:'Work details',exact:true}).click();
   const projectDetails=page.getByRole('button',{name:'Project mates and plans',exact:true});
   if(stage==='after'||await projectDetails.count())await projectDetails.click();
  }
  if(name==='discussion-details')await page.getByRole('button',{name:stage==='after'?'Details':'Show stored status',exact:true}).click();
  if(name==='fresh-details'&&stage==='after')await page.getByRole('button',{name:'FirstMate setup details',exact:true}).click();
  if(name==='settings-details'&&stage==='after')await page.getByRole('button',{name:'Advanced work details',exact:true}).click();
  assert.deepEqual(errors,[],`${stage}/${theme}/${device}/${name}`);
  const state=await page.evaluate(()=>({text:document.body.innerText,overflow:document.documentElement.scrollWidth>innerWidth,calls:window.review.calls}));
  assert.equal(state.overflow,false,`${stage}/${theme}/${device}/${name} overflows`);
  assert.equal(state.calls.filter(c=>/attach-ui|provision-ui|recover-ui|abort-ui|\.migrate$|admit-ui|\.discuss$|\.answer$/.test(c.name)).length,0,'navigation must have no effects');
  if(stage==='after'){
   if(name.startsWith('fresh-')){assert.match(state.text,/Welcome to FirstMate/);assert.equal(await page.getByRole('button',{name:'Set up FirstMate',exact:true}).count(),1);assert.doesNotMatch(state.text,/Unavailable recipient|To FirstMate|Project mates · 0/);}
   if(['home','board','plans','empty-home'].includes(name))assert.doesNotMatch(state.text,/Plan supervisors|Maintenance owners|Migration controls|Project mates · 0/);
   if(name==='details'){assert.match(state.text,/6 available to set up/);assert.doesNotMatch(state.text,/6 awaiting attention/);}
   if(name==='problem-details')for(const text of ['Journal hash mismatch','retired · opening failed','client UI (unverified)','epoch 2','Provisioning stopped; identity and spend retained'])assert.ok(state.text.includes(text),text);
   if(name==='all-empty')assert.match(state.text,/No decisions right now/);
   if(name==='all-pending'||name==='all-partial')assert.doesNotMatch(state.text,/No decisions right now/);
   if(name==='discussion')assert.doesNotMatch(state.text,/uninitialized · sequence 0|Reading starts no model turn|Show stored status/);
   if(name==='discussion-details')assert.match(state.text,/uninitialized · sequence 0/);
  }
  const key=`${theme}-${device}-${name}-${stage}`;
  await page.screenshot({path:resolve(out,'screenshots',key+'.png')});
  results.push({key,stage,theme,device,name,errors,...state});
  if(stage==='after'&&device==='phone'&&['fresh-on','details','problem-details','discussion-details','all-empty'].includes(name)){
   await page.evaluate(()=>{
    const nodes=[...document.querySelectorAll('div,span,p,button,input,select,textarea,label,small,strong')].filter(el=>[...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim()));
    const sizes=nodes.map(el=>({el,size:parseFloat(getComputedStyle(el).fontSize),line:parseFloat(getComputedStyle(el).lineHeight)}));
    for(const{el,size,line}of sizes){el.style.fontSize=`${size*2}px`;if(Number.isFinite(line))el.style.lineHeight=`${line*2}px`;}
   });
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'200% text document overflow');
   await page.screenshot({path:resolve(out,'screenshots',key+'-text200.png')});
   results.push({key:key+'-text200',stage,theme,device,name,textScale:2,errors});
  }
  if(name==='details'&&stage==='after'){
   await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog',{name:'Work details',exact:true}).count(),0);
   assert.equal(await page.getByRole('button',{name:'Work details',exact:true}).evaluate(el=>el===document.activeElement),true,'focus returns to details trigger');
  }
  if(name==='all-empty'&&stage==='after'){await page.getByRole('button',{name:'Back to FirstMate',exact:true}).click();assert.ok(await page.evaluate(()=>window.review.navigation.includes('FirstMate')));}
  console.log(key);await page.close();
 }
 await writeFile(resolve(out,process.env.SMOOTH_CONFIRM?'confirmation.json':'results.json'),JSON.stringify({passed:true,baseline,captures:results.length,results},null,2));
 console.log(JSON.stringify({passed:true,captures:results.length,out}));
}finally{await browser.close();await new Promise(done=>server.close(done));}
