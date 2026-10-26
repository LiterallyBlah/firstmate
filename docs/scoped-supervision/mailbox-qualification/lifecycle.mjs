/** Public Vitest API adapter. No Vitest import, process creation or execution on import. */
import {errorValue} from './io.mjs';
export function createReporter(){
 const rows=[],errors=[];let lost=0,end=null;
 const fault=e=>{if(errors.length<8)errors.push(errorValue(e));else lost++;};
 const field=value=>{if(typeof value!=='string')throw Error('Reporter string missing');if(value.length>1024)lost++;return value.slice(0,1024);};
 const note=(kind,test)=>{try{if(rows.length>=8){lost++;return;}const row={kind,moduleId:field(test.module.moduleId),name:field(test.name),fullName:field(test.fullName)};
  if(kind==='result'){const d=test.diagnostic();row.state=test.result().state;if(!['pending','passed','failed','skipped'].includes(row.state)||!Number.isSafeInteger(d?.retryCount)||!Number.isSafeInteger(d?.repeatCount)||typeof d?.flaky!=='boolean')throw Error('Malformed public test diagnostic');row.retryCount=d.retryCount;row.repeatCount=d.repeatCount;row.flaky=d.flaky;}
  rows.push(row);
 }catch(e){fault(e);}};
 return{onTestCaseReady:t=>note('ready',t),onTestCaseResult:t=>note('result',t),
  onTestRunEnd(modules,unhandled,reason){try{if(end)throw Error('Repeated test run');if(!['passed','failed','interrupted'].includes(reason))throw Error('Unknown public test end reason');if(modules.length>2||unhandled.length>8){lost++;}
   end={reason,unhandledCount:unhandled.length,modules:modules.slice(0,2).map(m=>{const names=[];for(const test of m.children.allTests()){names.push(field(test.name));if(names.length===3){lost++;break;}}return{moduleId:field(m.moduleId),errors:m.errors().length,tests:names};})};
  }catch(e){fault(e);}},snapshot:()=>structuredClone({rows,errors,lost,end})};
}
export async function runFixedVitest(config,plan,{startVitest,readReport,exitCode=()=>process.exitCode,capture=()=>{}}){
 let context,close,primary,closing,readError,hasPrimary=false,hasCloseError=false,hasReadError=false,report=null,startState='pending',closeState='not-acquired';
 const reporter=createReporter();
 try{context=await startVitest(plan.files.map(f=>f.path),{root:config.repositoryRoot,config:plan.config,run:true,watch:false,pool:'forks',maxWorkers:2,isolate:true,fileParallelism:true,
   testTimeout:5000,retry:0,passWithNoTests:false,allowOnly:false,environment:'node',coverage:{enabled:false},reporters:['default','json',reporter],outputFile:plan.report});
  close=context?.close;if(!context||typeof close!=='function')throw Error('Missing public Vitest lifecycle');startState='fulfilled';
 }catch(error){primary=error;hasPrimary=true;startState='rejected';}
 finally{if(typeof close==='function'){try{await Reflect.apply(close,context,[]);closeState='fulfilled';}catch(error){closing=error;hasCloseError=true;closeState='rejected';}}}
 try{report=await readReport();}catch(error){readError=error;hasReadError=true;}
 let observedExit=null,exitCodeError=null;try{observedExit=exitCode()??0;}catch(error){exitCodeError=errorValue(error);}
 const record={format:'firstmate.s02-mailbox-runner/1',caseId:config.caseId,nonce:config.nonce,startState,closeState,originalError:hasPrimary?errorValue(primary):null,closeError:hasCloseError?errorValue(closing):null,
  reportReadError:hasReadError?errorValue(readError):null,exitCode:observedExit,exitCodeError,reporter:reporter.snapshot(),recordingErrors:[]};
 try{capture(record);}catch(error){record.recordingErrors.push(errorValue(error));}
 // A recording/close failure may not replace an original thrown/rejected operation.
 if(hasPrimary)throw primary;if(hasCloseError)throw closing;
 return{record,report};
}
