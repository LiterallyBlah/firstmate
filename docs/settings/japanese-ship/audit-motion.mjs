/** Compare the animation revision with the approved broadside, including unchanged coast pixels. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodePng} from '../../../test/png.ts';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
const dir='art/settings/japanese-ship/',ref='815bcca39e91f9775d2ee975ce7286da71225fc6';
const oldfile=f=>execFileSync('git',['show',ref+':'+dir+f],{cwd:root});
const read=f=>readFileSync(resolve(root,dir,f));
const hash=b=>createHash('sha256').update(b).digest('hex');
const audit=JSON.parse(readFileSync(resolve(here,'motion-art-audit.json')));
audit.unchangedImages=Object.fromEntries(['ship','crew-indigo','crew-russet','sleep-window','ripples','wake','reply-shark'].map(n=>{
  const current=read(n+'.png');assert.ok(current.equals(oldfile(n+'.png')),n+' changed');return [n,hash(current)];
}));
const old=JSON.parse(oldfile('setting.json')),now=JSON.parse(read('setting.json'));
audit.unchangedManifestFields=['copy','floor','zones','portals','dayCycle','palette'].filter(k=>{
  assert.deepEqual(now[k],old[k],k+' changed');return true;
});
assert.deepEqual(now.stage.motion,old.stage.motion);
assert.deepEqual(now.stage.pieces,old.stage.pieces);
audit.coastChanges={};
for(const name of ['coast','coast-night']){
  const original=decodePng(oldfile(name+'.png')),next=decodePng(read(name+'.png'));let changed=0;
  for(let y=0;y<400;y++)for(let x=0;x<600;x++){
    const i=(y*600+x)*4;
    if(!original.rgba.subarray(i,i+4).every((v,k)=>v===next.rgba[i+k])){
      changed++;
      assert.ok(audit.cloudPatchBoxes.some(([l,t,w,h])=>x>=l&&x<l+w&&y>=t&&y<t+h),'non-cloud pixel changed');
    }
  }
  audit.coastChanges[name]={changedPixels:changed,outsideCloudBoxes:0};
}
audit.protectedPathsChanged=execFileSync('git',['diff','--name-only','origin/main','--','client','server','shared','index.client.tsx','index.server.ts','art/settings/ship'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean);
assert.deepEqual(audit.protectedPathsChanged,[]);
audit.imageCount=Object.keys(now.images).length;
audit.imageBytes=Object.values(now.images).reduce((n,image)=>n+read(image.path).length,0);
writeFileSync(resolve(here,'motion-art-audit.json'),JSON.stringify(audit,null,2)+'\n');
console.log(JSON.stringify({coastChanges:audit.coastChanges,images:audit.imageCount,bytes:audit.imageBytes,protectedPathsChanged:audit.protectedPathsChanged}));
