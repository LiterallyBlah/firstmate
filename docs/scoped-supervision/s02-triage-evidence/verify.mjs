import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const ref=process.argv[2]??'HEAD',prefix='docs/scoped-supervision/';
const git=(...args)=>execFileSync('git',args,{maxBuffer:16*1024*1024});
const get=path=>git('show',(ref==='index'?'':ref)+':'+path);
const json=path=>JSON.parse(get(prefix+'s02-triage-evidence/'+path));
const sha=b=>createHash('sha256').update(b).digest('hex');
const receipt=JSON.parse(get(prefix+'s02-triage-qualification.json'));
let checks=0;
for(const[path,hash]of Object.entries(receipt.sources)){if(sha(get(path))!==hash)throw Error('Source changed '+path);checks++;}
const manifest=json('manifest.json');
for(const[name,hash]of Object.entries(manifest.files)){if(sha(get(prefix+'s02-triage-evidence/'+name))!==hash)throw Error('Evidence changed '+name);checks++;}
const before=new Map(git('ls-tree','-r',receipt.base).toString().trim().split('\n').map(l=>{const[m,p]=l.split('\t');return[p,m];}));
const after=ref==='index'?new Map(git('ls-files','-s').toString().trim().split('\n').map(l=>{const[m,p]=l.split('\t');return[p,m.replace(/ 0$/,'').replace(' ',' blob ')];})):new Map(git('ls-tree','-r',ref).toString().trim().split('\n').map(l=>{const[m,p]=l.split('\t');return[p,m];}));
for(const[path,metadata]of before){if(after.get(path)!==metadata)throw Error('Accepted file changed '+path);checks++;}
if(before.size!==receipt.preservation.acceptedFiles)throw Error('Preservation inventory mismatch');
const p=json('probe-source.json');
if(sha(get(p.path))!==p.sourceSha256)throw Error('Original case source changed');
const body=get(prefix+'s02-triage-evidence/exact-body.txt').toString().replace(/\n$/,'');
if(sha(body)!==p.exactBodySha256||p.assertions.length!==5||p.assertions.some(a=>!body.includes(a)))throw Error('Original body/assertions changed');
if(!get(prefix+'s02-triage-evidence/executed-probe.test.ts.txt').toString().includes(body))throw Error('Probe body differs');
const good=json('native-tests.json'),bad=json('held-tests.json'),native=json('native-trace.json'),deadline=json('held-deadline.json'),finished=json('held-finished.json');
if(!good.success||good.numPassedTests!==1||good.numFailedTests!==0)throw Error('Positive case not passing');
if(bad.success||bad.numFailedTests!==1||bad.numPassedTests!==0||!JSON.stringify(bad).includes('Test timed out in 5000ms'))throw Error('Negative control did not hit original deadline');
if(native.gateTriggered||native.pending.length||native.rows.length!==800)throw Error('Native trace mismatch');
if(!deadline.gateTriggered||deadline.limitMs!==5000||deadline.elapsed<5000||!deadline.pending.some(p=>p.name==='fs.sync'&&p.ancestors.includes('events.resolve#2')&&p.ancestors.includes('store.publish(event)')))throw Error('Controlled attribution missing');
if(finished.pending.length||finished.rows.some(r=>r.name.startsWith('inbox.prepare')))throw Error('Injected timeout continued original success path');
if(receipt.historicalCauseEstablished||receipt.productionCorrection)throw Error('Unestablished cause/fix claimed');
console.log(JSON.stringify({ref,checks,preserved:before.size,positive:1,expectedTimeout:1,assertions:5,historicalCauseEstablished:false,receiptSha256:sha(get(prefix+'s02-triage-qualification.json'))}));
