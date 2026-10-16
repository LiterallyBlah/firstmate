/** Dump actual engine geometry, including art boxes, badges, overlap and click winners. */
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
const require=createRequire(resolve(root,'docs/board-list/package.json'));
const path=resolve(root,'.generated/airship-hit-engine.mjs');
await require('esbuild').build({stdin:{contents:`export {compileStage} from './client/deck-stage'; export {compileCast} from './client/deck-cast'; export {createCrew,applyCrew,crewFigures} from './client/deck-crew'; export {figureBox,badgeBox,sailorAt,boxesOverlap} from './client/deck-hover';`,resolveDir:root},outfile:path,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
export const engine=await import(pathToFileURL(path));
export function diagnose(manifest){
 const stage=engine.compileStage(manifest),cast=engine.compileCast(manifest),crew=engine.createCrew(stage,cast);
 const workers=Array.from({length:24},(_,i)=>({key:'Sleeper '+i,identity:'Sleeper '+i,state:'idle',stale:false}));
 engine.applyCrew(crew,workers,{snap:true});const figures=engine.crewFigures(crew,0,{still:true});
 const resolved=figures.map(f=>({key:f.key,x:f.x,y:f.y,row:f.row,appearance:f.appearance,box:engine.figureBox(f,cast),badge:engine.badgeBox(f,cast),centreWinner:engine.sailorAt(figures,cast,{x:f.x,y:f.y-8})?.key}));
 const overlaps=[];for(let i=0;i<resolved.length;i++)for(let j=i+1;j<resolved.length;j++)if(engine.boxesOverlap(resolved[i].box,resolved[j].box))overlaps.push([resolved[i].key,resolved[j].key]);
 const nominal=Array.from({length:24},(_,i)=>({index:i,x:110+i*13,y:266,winner:engine.sailorAt(figures,cast,{x:110+i*13,y:266})?.key}));
 return {id:manifest.id,zone:manifest.zones.zones.find(z=>z.id===manifest.zones.byState.idle),resolved,overlaps,nominal};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=['sky-airship','ship'].map(id=>diagnose(JSON.parse(readFileSync(resolve(root,'art/settings',id,'setting.json')))));
 writeFileSync(resolve(here,process.argv[2]??'crowd-engine-after.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result.map(r=>({id:r.id,overlaps:r.overlaps,centres:r.resolved.map(x=>[x.key,x.x,x.y,x.centreWinner]),nominal:r.id==='sky-airship'?r.nominal:undefined})),null,2));
}
