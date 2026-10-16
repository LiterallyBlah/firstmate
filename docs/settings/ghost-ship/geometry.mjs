/** Pure engine hit geometry, not a renderer observer. */
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
const require=createRequire(resolve(root,'docs/board-list/package.json'));
const path=resolve(here,'.generated/hit-engine.mjs');
await require('esbuild').build({stdin:{contents:`export {compileStage} from './client/deck-stage';export {compileCast} from './client/deck-cast';export {pieceDepths} from './client/deck-parts';export {createCrew,applyCrew,crewFigures} from './client/deck-crew';export {figureBox,sailorAt} from './client/deck-hover';`,resolveDir:root},outfile:path,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const e=await import(pathToFileURL(path));
export function transitDepthAudit(manifest){const depths=e.pieceDepths(e.compileStage(manifest).pieces);return {mast:depths.get('mast'),climber:depths.get('mast')+1+298/10000,sail:depths.get('sail-screen')};}
export function geometry(manifest,state){
 const cast=e.compileCast(manifest),crew=e.createCrew(e.compileStage(manifest),cast);
 e.applyCrew(crew,Array.from({length:24},(_,i)=>({key:state+' '+i,identity:state+' '+i,state,stale:false})),{snap:true});
 const figures=e.crewFigures(crew,0,{still:true});
 return figures.map(f=>{const box=e.figureBox(f,cast);let target=null;for(let y=box.top+1;y<box.bottom&&!target;y+=2)for(let x=box.left+1;x<box.right;x+=2)if(e.sailorAt(figures,cast,{x,y})?.key===f.key){target={x,y};break;}return {key:f.key,x:f.x,y:f.y,box,target};});
}
