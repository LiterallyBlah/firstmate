/** Pure-engine crowd audit; no renderer instrumentation or runtime writes. */
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {engine} from '../diagnose-crowd.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const manifest=JSON.parse(readFileSync(resolve(here,'../../../../art/settings/sky-airship/setting.json')));
function audit(m,state='blocked'){
 const stage=engine.compileStage(m),cast=engine.compileCast(m),crew=engine.createCrew(stage,cast);
 engine.applyCrew(crew,Array.from({length:24},(_,i)=>({key:'Crew '+i,identity:'Crew '+i,state,stale:false})),{snap:true});
 const figures=engine.crewFigures(crew,0,{still:true});
 const resolved=figures.map(f=>({key:f.key,x:f.x,y:f.y,box:engine.figureBox(f,cast)}));
 const overlaps=[];for(let i=0;i<resolved.length;i++)for(let j=i+1;j<resolved.length;j++)if(engine.boxesOverlap(resolved[i].box,resolved[j].box))overlaps.push([resolved[i],resolved[j]]);
 return {state,resolved,overlaps,uniquePositions:new Set(resolved.map(f=>`${f.x},${f.y}`)).size};
}
const before=['blocked','working','waiting','idle'].map(s=>audit(manifest,s));
writeFileSync(resolve(here,'overlaps-before.json'),JSON.stringify(before,null,2)+'\n');
const trials=[];
for(const [name,positions] of [['bow-spaced',[[112,226],[144,232],[176,224]]],['full-interior-spread',[[112,226],[304,234],[416,205]]]]){
 const m=structuredClone(manifest),z=m.zones.zones.find(z=>z.id==='bow');
 z.posts.forEach((p,i)=>p.at=positions[i]);z.overflow={kind:'beside',spacing:[28,39]};
 const result=audit(m);trials.push({name,posts:z.posts,overflow:z.overflow,...result});
 console.log(JSON.stringify({name,uniquePositions:result.uniquePositions,overlapPairs:result.overlaps.length,firstCollision:result.overlaps[0]}));
}
writeFileSync(resolve(here,'spacing-trials.json'),JSON.stringify(trials,null,2)+'\n');
