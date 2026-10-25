import { readFileSync,writeFileSync } from 'node:fs';
const name=process.argv[2]??'native',trace=JSON.parse(readFileSync(`.local/s02-triage/${name}/finished.json`,'utf8'));
const groups={};
for(const row of trace.rows){
 const key=row.name.replace(/#\d+$/,'');
 const g=groups[key]??={count:0,total:0,max:0,errors:[]};g.count++;g.total+=row.duration??0;g.max=Math.max(g.max,row.duration??0);if(row.error)g.errors.push(row.error.code??row.error.name);
}
const ancestors=id=>{const chain=[];while(id!==undefined){const row=trace.rows[id];chain.push(row.name);id=row.parent;}return chain;};
const top=trace.rows.filter(r=>r.name.startsWith('fs.')).sort((a,b)=>(b.duration??0)-(a.duration??0)).slice(0,8).map(r=>({...r,ancestors:ancestors(r.id)}));
const eligible=trace.rows.filter(r=>r.name==='fs.sync'&&ancestors(r.id).includes('events.resolve#2')&&ancestors(r.id).includes('store.publish(event)')).map(r=>({id:r.id,path:r.path,duration:r.duration}));
const result={name,elapsed:trace.elapsed,gateTriggered:trace.gateTriggered,pending:trace.pending,spanCount:trace.rows.length,groups,top,gateEligible:eligible};
writeFileSync(`.local/s02-triage/${name}/summary.json`,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({name,elapsed:trace.elapsed,spanCount:trace.rows.length,groups:Object.fromEntries(Object.entries(groups).filter(([k])=>!k.startsWith('fs.'))),top,gateEligible:eligible}));
