/** Register the commissioned atlases byte-for-byte. Never repaint or resample them. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

export function waterImages(directory){
 return Object.fromEntries(['sea-far','sea-mid','sea-near','sea-deep',
  'sea-storm-far','sea-storm-mid','sea-storm-near','sea-storm-deep'].map(id=>{
  const path=id+'.png',bytes=readFileSync(resolve(directory,path));
  return [id,{path,size:[bytes.readUInt32BE(16),bytes.readUInt32BE(20)],sha256:createHash('sha256').update(bytes).digest('hex')}];
 }));
}
