/** Apply crew registration/spacing to the existing Sky pack without rebuilding other art. */
import {readFileSync,writeFileSync} from 'node:fs';import {resolve,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import {decodePng} from '../../../../test/png.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..'),pack=resolve(root,'art/settings/sky-airship'),path=resolve(pack,'setting.json'),m=JSON.parse(readFileSync(path));
for(const look of m.cast.looks){const im=decodePng(readFileSync(resolve(pack,m.images[look.image].path)));for(const p of Object.values(m.cast.lanes[look.lane])){let min=p.rect[2],max=-1;for(let y=p.rect[1];y<p.rect[1]+p.rect[3];y++)for(let x=0;x<p.rect[2];x++)if(im.rgba[(y*im.width+p.rect[0]+x)*4+3]){min=Math.min(min,x);max=Math.max(max,x)}if(max<0)throw Error('empty crew pose');p.rect[0]+=min;p.rect[2]=max-min+1;p.feet[0]-=min;}}
const positions={bow:[[114,234],[142,234],[170,234]],engine:[[212,234],[226,234],[310,234],[338,234],[366,234],[198,234]],helm:[[394,205],[408,205],[422,205]]};
for(const z of m.zones.zones)if(positions[z.id]){z.posts=z.posts.slice(0,positions[z.id].length);z.posts.forEach((p,i)=>p.at=positions[z.id][i]);z.overflow={kind:'beside',spacing:[14,40]};}
for(const p of m.floor.areas.find(a=>a.id==='deck').polygon)if(p[0]===380)p[0]=382;
writeFileSync(path,JSON.stringify(m,null,2)+'\n');
