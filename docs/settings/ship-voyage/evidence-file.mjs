/** Write a new file, then replace the destination atomically: no PNG/GIF is truncated in place. */
import {writeFileSync,renameSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
export function writeEvidence(path,bytes) {
 const temporary=path+'.'+randomUUID()+'.tmp';
 writeFileSync(temporary,bytes,{flag:'wx'});
 renameSync(temporary,path);
}
