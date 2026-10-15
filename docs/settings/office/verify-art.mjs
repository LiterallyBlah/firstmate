/** Independent contract checks for the uninstalled office raster commission. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
const here=path.dirname(fileURLToPath(import.meta.url));
const require=createRequire(path.resolve(here,'../../../.local/office-art-tools/package.json'));
const { PNG }=require('pngjs');
const contract=JSON.parse(fs.readFileSync(path.join(here,'art-contract.json'),'utf8'));
const dir=path.join(here,'art'),rows=[],decoded=new Map(),failures=[];
const hex=c=>'#'+c.slice(0,3).map(n=>n.toString(16).padStart(2,'0')).join('').toUpperCase();
const pixel=(a,x,y)=>Array.from(a.data.subarray((y*a.width+x)*4,(y*a.width+x)*4+4));
const files=folder=>fs.readdirSync(folder,{withFileTypes:true}).flatMap(d=>d.isDirectory()?files(path.join(folder,d.name)):path.relative(dir,path.join(folder,d.name)).replaceAll('\\','/'));
assert.deepEqual(files(dir).sort(),contract.assets.map(a=>a.path).sort(),'Only the 26 contracted PNGs belong in art/');
for(const asset of contract.assets){
  try{
    const bytes=fs.readFileSync(path.join(dir,asset.path));
    assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(bytes[24],8,'8-bit channels');assert.equal(bytes[25],6,'RGBA truecolour');assert.equal(bytes[28],0,'non-interlaced');
    let srgb=false;
    for(let offset=8;offset<bytes.length;){const len=bytes.readUInt32BE(offset),name=bytes.toString('ascii',offset+4,offset+8);assert.equal(bytes.readUInt32BE(offset+8+len),crc32(bytes.subarray(offset+4,offset+8+len)),name+' CRC');if(name==='sRGB')srgb=true;offset+=len+12;}
    assert(srgb,'explicit sRGB chunk');
    const png=PNG.sync.read(bytes);decoded.set(asset.path,png);
    assert.deepEqual([png.width,png.height],asset.size,'file dimensions');
    const [w,h]=asset.frameSize;assert.equal(png.width,w*asset.frames.length,'exact horizontal stride');assert.equal(png.height,h,'no gutters or rows');
    assert(asset.anchor[0]>=0&&asset.anchor[0]<=w&&asset.anchor[1]>=0&&asset.anchor[1]<=h,'anchor inside frame or on bottom edge');
    const palette=new Set(contract.palettes[asset.palette]),used=new Set(),alpha=new Set();let visible=0;
    for(let k=0;k<png.data.length;k+=4){const a=png.data[k+3];alpha.add(a);assert(a===0||a===255,'binary alpha');if(a){const c=hex(Array.from(png.data.subarray(k,k+4)));assert(palette.has(c),'off-palette '+c);used.add(c);visible++;}else assert.equal(png.data[k]+png.data[k+1]+png.data[k+2],0,'transparent RGB cleared');}
    for(let i=0;i<asset.frames.length;i++) {let n=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++)n+=pixel(png,x+i*w,y)[3]>0;assert(n>0,'nonempty frame '+asset.frames[i]);}
    const opaque=asset.path.startsWith('city/')&&asset.path!=='city/lights.png'||asset.path.startsWith('background/')||asset.path==='preview.png';
    if(opaque)assert.deepEqual([...alpha],[255],'fully opaque background');
    rows.push({id:asset.id,path:asset.path,size:asset.size,frameSize:asset.frameSize,frames:asset.frames.length,anchor:asset.anchor,palette:asset.palette,coloursUsed:used.size,alpha:[...alpha].sort(),visiblePixels:visible,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),result:'PASS'});
  }catch(e){failures.push(asset.path+': '+e.message);}
}
function check(name,fn){try{fn();console.log('PASS '+name);}catch(e){failures.push(name+': '+e.message);}}
check('room has exactly the four contract openings',()=>{
  const a=decoded.get('room.png'),holes=[...contract.stage.windows,contract.stage.interiorGlass];
  for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++)assert.equal(pixel(a,x,y)[3],holes.some(([rx,ry,w,h])=>x>=rx&&x<rx+w&&y>=ry&&y<ry+h)?0:255,`alpha at ${x},${y}`);
  for(let y=64;y<112;y++)for(let x=388;x<420;x++)assert.deepEqual(pixel(a,x,y),[24,35,46,255],'dark lift well');
});
check('cast feet and hand-only typing changes',()=>{
  for(const name of ['navy','teal','ochre','plum','rust','slate']){
    const a=decoded.get('cast/'+name+'.png');
    for(let i=0;i<10;i++){
      const feet=Array.from({length:24},(_,x)=>x).filter(x=>pixel(a,x+i*24,31)[3]);
      assert(feet.length>0,'bottom-edge feet '+name+'/'+i);
      assert(Math.abs((Math.min(...feet)+Math.max(...feet)+1)/2-12)<=.5,'feet centred at x12 '+name+'/'+i);
    }
    let changes=0;for(let y=0;y<32;y++)for(let x=0;x<24;x++){
      const before=pixel(a,x+5*24,y),after=pixel(a,x+6*24,y);
      if(before.join()!==after.join()){changes++;assert(x>=15&&x<23&&y>=15&&y<23,'typing changes outside hands '+name);}
    }assert(changes>0,'typing pair must move '+name);
  }
});
check('six city phases have identical palette-index geometry',()=>{
  let ref;
  for(const phase of ['dawn','morning','midday','afternoon','dusk','night']){
    const a=decoded.get('city/'+phase+'.png'),p=contract.palettes['sky:'+phase],indices=[];
    for(let y=0;y<180;y++)for(let x=0;x<420;x++)indices.push(p.indexOf(hex(pixel(a,x,y))));
    if(ref)assert.deepEqual(indices,ref,phase);else ref=indices;
  }
  const lights=decoded.get('city/lights.png'),day=decoded.get('city/midday.png');
  for(let y=0;y<180;y++)for(let x=0;x<420;x++)if(pixel(lights,x,y)[3])assert.equal(hex(pixel(day,x,y)),contract.palettes['sky:midday'][9],'light registered to a window');
});
check('quiet/busy backdrop registration',()=>{
  const a=decoded.get('background/quiet.png'),b=decoded.get('background/busy.png');
  for(let y=0;y<18;y++)for(let x=0;x<248;x++)if(y<6||![25,57,94,129,165,195,223].some(rx=>x>=rx&&x<rx+6))assert.deepEqual(pixel(a,x,y),pixel(b,x,y));
});
check('twelve clock faces, minute hands at 12',()=>{
  const a=decoded.get('clock.png'),hashes=new Set();
  for(let i=0;i<12;i++){const face=[];for(let y=0;y<16;y++)for(let x=0;x<16;x++)face.push(...pixel(a,x+i*16,y));hashes.add(createHash('sha256').update(Buffer.from(face)).digest('hex'));assert.deepEqual(pixel(a,i*16+8,3),[24,35,46,255]);}
  assert.equal(hashes.size,12);
});
check('steam source and cup rim registration',()=>{
  const steam=decoded.get('coffee-steam.png'),cup=decoded.get('props/coffee-counter.png');
  for(let i=0;i<3;i++)assert.equal(pixel(steam,i*16+8,19)[3],255,'steam meets anchor');
  assert.equal(pixel(cup,16,4)[3],255,'cup rim at local source');
});
check('door openings and left-biased confetti',()=>{
  const d=decoded.get('effects/lift-doors.png');for(let y=3;y<48;y++)for(let x=2;x<30;x++)assert.equal(pixel(d,x,y)[3],0,'open door centre');
  assert.equal(pixel(d,48,24)[3],0,'half-door centre');assert.equal(pixel(d,80,24)[3],255,'closed centre');
  const c=decoded.get('effects/confetti.png');for(let i=0;i<3;i++){let xs=0,n=0;for(let y=0;y<40;y++)for(let x=0;x<48;x++)if(pixel(c,x+48*i,y)[3]){xs+=x;n++;}assert(xs/n<36,'left of threshold');}
});
const totalBytes=rows.reduce((n,a)=>n+a.bytes,0),totalFrames=rows.reduce((n,a)=>n+a.frames,0);
check('26 PNGs / 99 frames / <=1,000,000 bytes',()=>{assert.equal(rows.length,26);assert.equal(totalFrames,99);assert(totalBytes<=contract.delivery.maxImageBytes);});
const report={contract:'art-contract.json',contractSha256:createHash('sha256').update(fs.readFileSync(path.join(here,'art-contract.json'),'utf8').replaceAll('\r\n','\n')).digest('hex'),contractHashEncoding:'UTF-8, LF line endings',directory:'docs/settings/office/art',totalPNGs:rows.length,totalFrames,totalBytes,maxBytes:contract.delivery.maxImageBytes,failures,assets:rows};
fs.writeFileSync(path.join(here,'verification.json'),JSON.stringify(report,null,2)+'\n');
const table=['| Asset | File px | Frames | Anchor | Palette | PNG bytes | Result |','| --- | --- | ---: | --- | --- | ---: | --- |',...rows.map(a=>`| ${a.path} | ${a.size.join(' × ')} | ${a.frames} | [${a.anchor.join(',')}] | ${a.palette} | ${a.bytes} | ${a.result} |`)];
fs.writeFileSync(path.join(here,'CONFORMANCE.md'),`# Office raster conformance\n\n${rows.length} PNGs, ${totalFrames} frames, **${totalBytes.toLocaleString('en-US')} / 1,000,000 bytes**. ${failures.length?'FAIL: '+failures.join('; '):'All automated checks pass.'}\n\nEvery file is 8-bit truecolour RGBA, non-interlaced, explicitly sRGB, with binary alpha and only its contract palette. Strip width equals frame stride × count, with no gutters or trimming. SHA-256 digests and detailed results are in [verification.json](verification.json).\n\n${table.join('\n')}\n\nAdditional checks cover exact room transparency, opaque dark lift well, cast feet on row 31, hand-only typing changes, identical six-phase city geometry, registered night windows, unchanged quiet/busy architecture, twelve unique clock faces with fixed minute hands, open/half/closed door centres, and left-biased confetti. Visual review composites are in [review/](review/).\n\nAnchors are metadata in the unchanged contract, not embedded PNG metadata. These checks verify their bounds and the applicable raster registrations; facing, poses, depth and composition are also visually reviewed. Runtime timing remains the separate pack-wiring task.\n`);
console.log(JSON.stringify({totalPNGs:rows.length,totalFrames,totalBytes,failures},null,2));
if(failures.length)process.exitCode=1;
