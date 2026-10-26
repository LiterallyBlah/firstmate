/** Direct-child observation only. Dependency-injected controls never spawn a process. No termination authority. */
import {recorder,observeOutput,outputComplete} from '../owner-capability/capture.mjs';
import {resolve,join} from 'node:path';
import {CAPS,CASE,NONCE,NODE_PATH,SOURCE,REPO} from './contract.mjs';
import {errorValue} from './io.mjs';
const pid=value=>Number.isSafeInteger(value)&&value>0;
const status=(code,signal)=>(Number.isSafeInteger(code)&&code>=0&&code<=0xffffffff&&signal===null)||(code===null&&typeof signal==='string'&&signal.length>0&&signal.length<=80);
export function assessController(value){
 const reasons=[],need=(ok,why)=>{if(!ok)reasons.push(why);};
 need(value?.caseId===CASE&&value.nonce===NONCE,'outer-case-mismatch');
 need(value?.executable===NODE_PATH&&value.cwd===resolve(REPO)&&Array.isArray(value.args)&&value.args.length===1&&value.args[0]===join(SOURCE,'controller.mjs'),'outer-launch-binding-mismatch');
 need(value?.spawnObserved===true&&value.spawnCount===1&&pid(value.returnedPid)&&value.spawnPid===value.returnedPid,'controller-spawn-identity-unknown');
 need(value?.spawnThrown===null&&value.errorCount===0,'controller-spawn-or-error');
 need(value?.exitObserved===true&&value.exitCount===1&&status(value.exitCode,value.exitSignal),'controller-exit-unknown');
 need(value?.closeObserved===true&&value.closeCount===1&&status(value.closeCode,value.closeSignal),'controller-close-unknown');
 need(value?.exitCode===value?.closeCode&&value?.exitSignal===value?.closeSignal,'controller-exit-close-conflict');
 need([value?.spawnOrder,value?.exitOrder,value?.closeOrder].every(n=>Number.isSafeInteger(n)&&n>0)&&value.spawnOrder<value.exitOrder&&value.exitOrder<value.closeOrder,'controller-event-order');
 need(value?.deadlineFired===false&&value.graceFired===false,'controller-deadline-or-terminal-unknown');
 for(const key of ['stdout','stderr']){const stream=value?.[key];let rawOk=false;try{rawOk=stream.encoding==='base64'&&typeof stream.data==='string'&&Buffer.from(stream.data,'base64').length===stream.retained&&Buffer.from(stream.data,'base64').toString('base64')===stream.data;}catch{}need(outputComplete(stream)&&rawOk,'controller-'+key+'-incomplete');}
 need(Array.isArray(value?.errors)&&value.errors.length===0,'retained-controller-errors');
 need(value?.observation?.dropped===0&&value.observation.failures===0&&!value.observation.incomplete,'controller-observation-incomplete');
 return{complete:reasons.length===0,normalExit:reasons.length===0&&value.exitCode===0&&value.exitSignal===null,reasons,descendantClosureEstablished:false};
}
export async function captureController({spawn,executable,args,cwd,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout,sink=()=>{}}){
 const journal=recorder({sink}),start=now(),state={format:'firstmate.s02-controller-terminal/1',caseId:CASE,nonce:NONCE,executable,args:[...args],cwd,
  returnedPid:null,spawnObserved:false,spawnCount:0,spawnPid:null,spawnOrder:null,spawnThrown:null,errorCount:0,errors:[],exitObserved:false,exitCount:0,exitCode:null,exitSignal:null,exitOrder:null,closeObserved:false,closeCount:0,closeCode:null,closeSignal:null,closeOrder:null,deadlineFired:false,graceFired:false};
 let child,out,err,timer,grace,order=0,settled=false;
 const note=(kind,data)=>journal.note(kind,{atMs:now()-start,...data});
 let finish;
 const waiting=new Promise(done=>{finish=reason=>{if(settled)return;settled=true;state.finishedBecause=reason;clearTimer(timer);clearTimer(grace);done();};});
 const complete=()=>{if(state.closeObserved&&out.snapshot().drained&&out.snapshot().closed&&err.snapshot().drained&&err.snapshot().closed)finish('controller-close-and-stream-drain');};
 try{child=spawn(executable,args,{cwd,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});state.returnedPid=child.pid??null;}
 catch(error){state.spawnThrown=errorValue(error);note('controller-spawn-throw',state.spawnThrown);finish('spawn-threw');}
 if(child){
  out=observeOutput(child.stdout);err=observeOutput(child.stderr);
  child.on('spawn',()=>{state.spawnCount++;state.spawnObserved=true;state.spawnPid=child.pid??null;state.spawnOrder=++order;note('controller-spawn',{pid:state.spawnPid});});
  child.on('error',error=>{state.errorCount++;const value=errorValue(error);if(state.errors.length<8)state.errors.push(value);note('controller-error',value);});
  child.on('exit',(code,signal)=>{state.exitCount++;state.exitObserved=true;state.exitCode=code;state.exitSignal=signal;state.exitOrder=++order;note('controller-exit',{code,signal});});
  child.on('close',(code,signal)=>{state.closeCount++;state.closeObserved=true;state.closeCode=code;state.closeSignal=signal;state.closeOrder=++order;note('controller-close',{code,signal});complete();});
  for(const stream of [child.stdout,child.stderr])for(const event of ['end','close'])stream?.on(event,complete);
  timer=setTimer(()=>{state.deadlineFired=true;note('outer-observation-deadline',{pid:state.returnedPid});
   grace=setTimer(()=>{state.graceFired=true;note('controller-terminal-or-drain-unknown',{pid:state.returnedPid});
    // Only detach this observer's event-loop references. Never kill or infer closure.
    for(const[name,target]of [['controller',child],['stdout',child.stdout],['stderr',child.stderr]])try{target?.unref?.();}catch(error){note('unref-error',{name,error:errorValue(error)});}
    finish('deadline-unknown');
   },CAPS.outerGraceMs);
  },CAPS.outerDeadlineMs);
 }
 await waiting;
 const empty={bytes:0,retained:0,dropped:0,errors:1,drained:false,closed:false,encoding:'base64',data:''};
 const terminal={...state,elapsedMs:now()-start,stdout:out?.snapshot()??{...empty},stderr:err?.snapshot()??{...empty},observation:journal.snapshot()};
 terminal.assessment=assessController(terminal);return terminal;
}
