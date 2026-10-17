/** Picker thumbnail from a real rendered scene, never from a painted approximation. */
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {decodePng} from '../../../test/png.ts';
import {crop,nearest,quant} from '../japanese-ship/build-art.mjs';
import {indexed} from './indexed-png.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..'),dir=resolve(root,'art/settings/ghost-ship');
const sourcePath=resolve(root,process.argv[2]??'.local/ghost-ship-fixes/final/midday-wide.png');
const sourceBytes=readFileSync(sourcePath),source=decodePng(sourceBytes);
const width=Math.min(source.width,Math.floor(source.height*16/9)),height=Math.min(source.height,Math.floor(source.width*9/16));
const image=quant(nearest(crop(source,Math.floor((source.width-width)/2),Math.floor((source.height-height)/2),width,height),384,216),64);
const bytes=indexed(image),sha=b=>createHash('sha256').update(b).digest('hex');
writeFileSync(resolve(dir,'preview.png'),bytes);
for(const file of [resolve(dir,'setting.json'),resolve(here,'registration.json')]){
 const data=JSON.parse(readFileSync(file));data.images.preview={path:'preview.png',size:[384,216],sha256:sha(bytes)};
 if(data.sources)data.sources['preview-canvas']={renderedFrom:'compiled Ghost ship fixture, midday wide',sha256:sha(sourceBytes)};
 writeFileSync(file,JSON.stringify(data,null,2)+'\n');
}
console.log(JSON.stringify({previewBytes:bytes.length,source:sourcePath}));
