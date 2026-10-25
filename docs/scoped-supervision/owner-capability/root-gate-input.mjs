// In-memory gate data only. No target/native/helper/controller import or execution.
import {createHash} from 'node:crypto';
export const TEST_SOURCE_SHA='c'.repeat(64);
const copy=v=>structuredClone(v),hash=b=>createHash('sha256').update(b).digest('hex');
export function gateInput({extra=0,marker=true}={}) {
  const input={scenario:'root-gate',caseId:'49ab7fc0-aa4c-41b7-acae-bdb9d13489d7',nonce:'1aff3330-6969-452c-b24f-f118b1158ed3',nodePath:'C:\\node.exe',nodeVersion:'v24.18.0',childScriptPath:'C:\\source\\child.mjs',readErrors:[]};
  const members=(pids,total,phase)=>({phase,queryOk:true,accountingOk:true,queryError:0,accountingError:0,complete:true,assigned:pids.length,listed:pids.length,active:pids.length,total,pids});
  const q=()=>({attempted:true,ok:true,win32Error:0});
  const lives=Array.from({length:1+extra},(_,i)=>{
    const bindingRef={role:i?'gate-member-'+i:'root',sequence:i+1,handle:'0x'+(256+i).toString(16)};
    const identity={pid:100+i,creationFileTime:String(134374367593176525n+BigInt(i)),image:i?'C:\\extra.exe':input.nodePath,member:true};
    const initial={phase:'initial',role:bindingRef.role,state:'acquired',bindingRef:copy(bindingRef),identity,queries:{pid:q(),creation:q(),image:q(),membership:q()},wait:{ok:true,result:258},exit:{ok:true,code:259}};
    const terminal={phase:'terminal',role:bindingRef.role,state:'acquired',bindingRef:copy(bindingRef),identity:{pid:identity.pid,creationFileTime:identity.creationFileTime,member:true},
      queries:{pid:q(),creation:q(),membership:q(),image:{attempted:false,reason:'terminal-retains-initial-binding',bindingRef:copy(bindingRef)}},wait:{ok:true,result:0},exit:{ok:true,code:197}};
    return {bindingRef,bindingComplete:true,continuous:true,initial,terminal,closed:true};
  });
  const empty=members([],0,'owner-empty'),before=members([100],1,'before-resume'),gate=members(lives.map(l=>l.initial.identity.pid),lives.length,marker?'gate-post-marker':'gate-live');
  const terminal={members:members([],lives.length,'terminal'),processes:lives.map(l=>copy(l.terminal))};
  const output=()=>({bytes:0,retained:0,dropped:0,errors:0,drained:true,closed:true,readDisposition:'closed',writeDisposition:'closed',encoding:'base64',data:''});
  const inventory={job:{acquisition:'acquired',disposition:'closed',handle:'0x300'},thread:{acquisition:'acquired',disposition:'closed',handle:'0x400'},stdin:{acquisition:'acquired',disposition:'closed',handle:'0x500'},child:{acquisition:'never-acquired',disposition:'not-attempted'}};
  for(const life of lives)inventory[life.bindingRef.role]={acquisition:'acquired',disposition:'closed',handle:life.bindingRef.handle,bindingRef:copy(life.bindingRef),observation:copy(life.terminal)};
  input.native={scenario:'root-gate',captureVersion:3,diagnosticVersion:2,expectedChild:'not-part-of-root-gate',childSpawnReachable:false,
    targetCreated:true,targetResumed:true,stopReason:extra?'unexpected-member':'marker',markerObservedBeforeStop:marker,
    markerReadback:marker?{order:'marker-observation-before-membership',marker:'root-pre-spawn.json',members:copy(gate)}:null,
    error:null,originalFailure:null,originalFailureTruncated:false,freshOwner:empty,beforeResume:before,gateSnapshot:gate,lastObservation:terminal.members,
    lifetimes:lives,memberAcquisitions:lives.slice(1).map(l=>({role:l.bindingRef.role,pid:l.initial.identity.pid,acquisition:'acquired',bindingRef:copy(l.bindingRef)})),
    lifetimeOverflow:0,replacementDetected:false,terminalEvidence:copy(terminal),terminalSamples:[copy(terminal)],handleInventory:inventory,
    observation:{failures:0,dropped:0,errors:[]},deadlineFired:false,terminateRequested:true,terminateReturned:true,terminationError:0,
    cleanup:{timerDrained:true,jobHandleClosed:true,threadHandleClosed:true},stdinClosed:true,rootOutput:{stdout:output(),stderr:output()},
    standardWiring:{useStdHandles:true,inheritHandles:true,jobInherited:false,readHandlesInherited:false,jobHandle:'0x300',handleList:['0x500','0x600','0x700']},
    events:[{kind:'membership',data:empty},{kind:'owner-acquired',data:{helperPid:50,flags:8192,members:empty}},{kind:'creation-owner-configured',data:{attribute:'PROC_THREAD_ATTRIBUTE_JOB_LIST'}},
      {kind:'deadline-armed',data:{durationMs:5000}},...lives.map(l=>({kind:'handle-observation',data:copy(l.initial)})),{kind:'membership',data:before},{kind:'root-resumed',data:{}},
      ...(marker?[{kind:'gate-marker-observed',data:{marker:'root-pre-spawn.json'}}]:[]),{kind:'membership',data:gate}]};
  input.rootPreSpawn=marker?{format:'firstmate.root-pre-spawn/1',stage:'before-child-spawn',scenario:'root-gate',caseId:input.caseId,nonce:input.nonce,pid:100,ppid:50,node:input.nodeVersion,threadId:0,isMainThread:true,childEntry:input.childScriptPath,instance:'fc22fa66-63ba-4a11-a9c8-4396f1f216d9'}:null;
  input.markerRaw=marker?Buffer.from(JSON.stringify(input.rootPreSpawn)):null;
  input.outer={helperPid:50,exitObserved:true,exitStatus:0,exitSignal:null,closed:true,status:0,signal:null,error:null,deadlineFired:false,observation:{dropped:0,failures:0,rows:[],errors:[]},stderr:output()};
  refreshGate(input); return input;
}
export function refreshGate(input,{sourceSha=TEST_SOURCE_SHA}={}) {
  const file={format:'firstmate.root-gate/1',scenario:'root-gate',caseId:input.caseId,nonce:input.nonce,sourceSha256:sourceSha,nativeResult:input.native,invocationError:null,recordingError:null};
  const bytes=Buffer.from(JSON.stringify(file));input.helperFileRaw=bytes;
  const frame={format:'firstmate.root-gate-final/1',scenario:'root-gate',caseId:input.caseId,nonce:input.nonce,sourceSha256:sourceSha,file:{name:'root-gate-helper.json',bytes:bytes.length,sha256:hash(bytes),complete:true},
    invocationError:null,recordingError:null,originalFailure:{state:typeof input.native.originalFailure==='string'?'recorded':'none-recorded',value:input.native.originalFailure,truncated:input.native.originalFailureTruncated}};
  const raw=Buffer.from(JSON.stringify(frame)+'\n');input.outer.stdout={bytes:raw.length,retained:raw.length,dropped:0,errors:0,drained:true,closed:true,encoding:'base64',data:raw.toString('base64')};return input;
}
