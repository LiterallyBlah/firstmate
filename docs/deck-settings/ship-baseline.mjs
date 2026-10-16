/** Frozen art inputs for the engine gate; never used by the app or installed-pack renderer. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const base=new URL('../../test/fixtures/ship-baseline/',import.meta.url);
export const provenance=JSON.parse(readFileSync(new URL('../../test/fixtures/ship-baseline.json',import.meta.url),'utf8'));
const read=path=>{
 const bytes=readFileSync(new URL(path,base));
 if(createHash('sha256').update(bytes).digest('hex')!==provenance.files[path])throw Error('Ship baseline changed: '+path);
 return bytes;
};
const manifest=JSON.parse(read('setting.json'));
const raw=Object.fromEntries(Object.entries(manifest.images).map(([id,image])=>[id,read(image.path)]));
export const baselinePack={manifest,images:Object.fromEntries(Object.entries(raw).map(([id,b])=>[id,b.toString('base64')]))};
export const baselineSummary={id:manifest.id,name:manifest.name,version:manifest.version,formatVersion:manifest.formatVersion,compatible:true,reason:null,preview:manifest.preview?baselinePack.images[manifest.preview]:null,bytes:Object.values(raw).reduce((n,b)=>n+b.length,0)};
