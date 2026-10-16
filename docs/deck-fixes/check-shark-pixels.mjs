/** Evidence only: the full unmasked gate remains the authority for exact screenshot hashes. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {crc32,deflateSync} from 'node:zlib';
import {decodePng} from '../../test/png.ts';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../..');
const gate=JSON.parse(readFileSync(resolve(root,'docs/deck-settings/gate-results.json'),'utf8'));
assert.equal(gate.shots,81);assert.equal(gate.maskToolbar,false);assert.deepEqual(gate.pageErrors,[]);
// A preliminary capture can be inspected before approving its exact hashes; default requires the final passed gate.
if(!process.argv.includes("--review-capture"))assert.equal(gate.passed,true);
assert.deepEqual(gate.flakes,[]);
const revision=/^compiled main ([a-f0-9]+)$/.exec(gate.base)?.[1];assert.ok(revision);
const runtime=execFileSync('git',['log','-1','--format=%h','--','client/ship-deck.tsx'],{cwd:root,encoding:'utf8'}).trim();
assert.equal(gate.compiledBranch,runtime);
const mainView=execFileSync('git',['show',revision+':client/ship-deck.tsx'],{cwd:root,encoding:'utf8'});
const branchView=readFileSync(resolve(root,'client/ship-deck.tsx'),'utf8');
const footerMarkup=s=>{const start=s.indexOf('      <View style={{ gap: 4 }}>');assert.ok(start>=0);return s.slice(start).replaceAll('\r\n','\n');};
assert.equal(footerMarkup(branchView).replace('Focus on ','Converse with ').replace('focusAttention(attentionSailor.key)','converse(attentionSailor.key)').replace('`Focus ','`Converse '),footerMarkup(mainView),'the condensed footer keeps its landed markup and styles');
const before=execFileSync('git',['show',`${revision}:art/settings/ship/setting.json`],{cwd:root});
const after=readFileSync(resolve(root,'art/settings/ship/setting.json'));
assert.deepEqual(JSON.parse(after),JSON.parse(before),'the entire ship manifest is unchanged');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest=JSON.parse(after);
for(const [id,asset] of Object.entries(manifest.images))assert.equal(hash(readFileSync(resolve(root,'art/settings/ship',asset.path))),asset.sha256,id);
const directory=resolve(root,'docs/ship-deck-canvas/.generated/gate');
// CSS pixels of the existing attention footer. This audit does not mask or accept any difference.
const footer=[12,860,800,890],crop={top:832,width:800,height:64},shots=[],pairs=[];
for(const scenario of gate.scenarios)for(const shot of scenario.shots){
  const name=`${scenario.scenario}/${shot.shot}`;assert.equal(shot.canvasMatchesMain,true,name);
  if(shot.identical){shots.push({name,identical:true,outsideFooter:0});continue;}
  const prefix=`${scenario.scenario}-${shot.shot}`;
  const read=side=>{const bytes=readFileSync(resolve(directory,`${prefix}.${side}.png`));return {sha:hash(bytes).slice(0,16),image:decodePng(bytes)};};
  const a=read('main'),b=read('branch');assert.deepEqual([a.sha,b.sha],shot.sha);
  assert.equal(a.image.width,b.image.width);assert.equal(a.image.height,b.image.height);
  const scale=a.image.width/1440;assert.equal(a.image.height,900*scale);
  let count=0,outside=0;
  for(let y=0;y<a.image.height;y++){
    const start=y*a.image.width*4,end=start+a.image.width*4;
    if(Buffer.compare(a.image.rgba.subarray(start,end),b.image.rgba.subarray(start,end))===0)continue;
    for(let x=0;x<a.image.width;x++){
      if(a.image.at(x,y)===b.image.at(x,y))continue;
      count++;
      if(x<footer[0]*scale||y<footer[1]*scale||x>=footer[2]*scale||y>=footer[3]*scale)outside++;
    }
  }
  assert.equal(count,shot.differingPixels,name);assert.equal(outside,0,name);
  shots.push({name,sha:shot.sha,differingPixels:count,box:shot.box,outsideFooter:outside});
  const rgba=Buffer.alloc(crop.width*2*crop.height*4);
  for(const [col,png] of [a.image,b.image].entries())for(let y=0;y<crop.height;y++)for(let x=0;x<crop.width;x++){
    const source=((crop.top+y)*scale*png.width+x*scale)*4;
    rgba.set(png.rgba.subarray(source,source+4),(y*crop.width*2+col*crop.width+x)*4);
  }
  pairs.push({name,rgba});
}
function encode({width,height,rgba}){
  const raw=Buffer.alloc((width*4+1)*height);
  for(let y=0;y<height;y++)raw.set(rgba.subarray(y*width*4,(y+1)*width*4),y*(width*4+1)+1);
  const chunk=(type,data)=>{const head=Buffer.alloc(8),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);head.write(type,4,'latin1');tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4),data]))>>>0);return Buffer.concat([head,data,tail]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header.set([8,6,0,0,0],8);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
// Every changed footer, main on the left and branch on the right. Sixteen rows per sheet.
const review=resolve(root,'.generated/shark-gate-review');mkdirSync(review,{recursive:true});const pages=[];
for(let start=0;start<pairs.length;start+=16){
  const group=pairs.slice(start,start+16),page={width:crop.width*2,height:group.length*crop.height,rgba:Buffer.alloc(crop.width*2*group.length*crop.height*4)};
  for(const [row,pair] of group.entries())page.rgba.set(pair.rgba,row*crop.width*2*crop.height*4);
  const file=`page-${String(pages.length+1).padStart(2,'0')}.png`;
  writeFileSync(resolve(review,file),encode(page));pages.push({file,rows:group.map(pair=>pair.name)});
}
writeFileSync(resolve(review,'index.json'),JSON.stringify(pages,null,2)+'\n');
const result={base:gate.base,compiledBranch:gate.compiledBranch,gatePassed:gate.passed,condensedFooterPreserved:true,unchangedImages:Object.keys(manifest.images).length,unchangedManifest:true,unchangedCanvasShots:shots.length,footer,outsideFooter:0,shots};
writeFileSync(resolve(here,'shark-pixels.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({shots:shots.length,unchangedCanvasShots:shots.length,unchangedImages:Object.keys(manifest.images).length,outsideFooter:0,changedFooters:pairs.length,pages:pages.length}));
