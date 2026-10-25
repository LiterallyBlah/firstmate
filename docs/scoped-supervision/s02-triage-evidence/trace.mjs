import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { performance } from 'node:perf_hooks';

const context = new AsyncLocalStorage();
const output = join(process.cwd(), '.local/s02-triage', process.env.S02_TRIAGE_MODE ?? 'native');
const rows = [], pending = new Set(), calls = new Map();
let started = 0, enabled = false, signal, gateTriggered = false, phase = 0;
mkdirSync(output, { recursive: true });
const pathOf = path => typeof path === 'string' ? relative(process.env.PASEO_HOME ?? process.cwd(), path).replaceAll('\\','/').slice(0,240) : String(path).slice(0,80);
const chain = id => { const result=[]; while(id!==undefined){const r=rows[id];result.push(r.name);id=r.parent;}return result; };
function snapshot(label) {
  writeFileSync(join(output,label+'.json'),JSON.stringify({mode:process.env.S02_TRIAGE_MODE??'native',elapsed:performance.now()-started,
    limitMs:5000,gateTriggered,pending:[...pending].map(id=>({id,name:rows[id].name,ancestors:chain(id)})),rows},null,2)+'\n');
}
function call(name, work, metadata={}) {
  if(!enabled)return work();
  if(rows.length>=8000)throw Error('Bounded trace exceeded8000 spans');
  const id=rows.length,parent=context.getStore();
  const row={id,parent,name,at:performance.now()-started,...metadata};rows.push(row);pending.add(id);
  const end=(error)=>{row.duration=performance.now()-started-row.at;row.error=error?{name:error.name,code:error.code??null,message:String(error.message).slice(0,300)}:null;pending.delete(id);};
  return context.run(id,()=>{
    try{
      const value=work();
      if(value&&typeof value.then==='function')return value.then(result=>{end();return result;},error=>{end(error);throw error;});
      end();return value;
    }catch(error){end(error);throw error;}
  });
}
function wrapHandle(handle,path){
  return new Proxy(handle,{get(target,key){
    const value=Reflect.get(target,key,target);
    if(typeof value!=='function')return value;
    if(!['writeFile','sync','close'].includes(String(key)))return value.bind(target);
    return(...args)=>call('fs.'+String(key),async()=>{
      const ancestors=chain(context.getStore());
      if(key==='sync'&&process.env.S02_TRIAGE_MODE==='hold-resolution-sync'&&!gateTriggered&&ancestors.includes('events.resolve#2')&&ancestors.includes('store.publish(event)')){
        gateTriggered=true;snapshot('gate-entered');
        await new Promise((_,reject)=>{
          const abort=()=>reject(Error('Controlled sync gate stopped at unchanged test deadline'));
          if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
        });
      }
      return Reflect.apply(value,target,args);
    },{path:pathOf(path)});
  }});
}
export const trace={
  begin(nextSignal){started=performance.now();signal=nextSignal;enabled=true;signal.addEventListener('abort',()=>snapshot('deadline'),{once:true});},
  snapshot,
  run(work){return call('exact-source-case',work);},
  wrapFS(actual){
    const result={...actual};
    for(const name of ['mkdir','readFile','readdir','stat','link','unlink','open']){
      result[name]=(...args)=>call('fs.'+name,async()=>{
        const value=await Reflect.apply(actual[name],actual,args);
        return name==='open'?wrapHandle(value,args[0]):value;
      },{path:pathOf(args[0])});
    }
    return result;
  },
  wrapMethods(prototype,prefix,names){
    for(const name of names){
      const original=Reflect.get(prototype,name);if(typeof original!=='function')throw Error('Missing phase '+prefix+'.'+name);
      Object.defineProperty(prototype,name,{configurable:true,writable:true,value:function(...args){
        const key=prefix+'.'+name,n=(calls.get(key)??0)+1;calls.set(key,n);
        const label=name==='publish'?key+'('+args[2]+')':key+'#'+n;
        return call(label,()=>Reflect.apply(original,this,args));
      }});
    }
  },
};
