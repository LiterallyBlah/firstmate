/** Bounded synchronous files only. Import is inert; errors remain caller-visible. */
import {openSync,readSync,writeFileSync,closeSync} from 'node:fs';
import {CAPS} from './contract.mjs';
export function readBounded(path,limit=CAPS.fileBytes){
 const fd=openSync(path,'r');try{const bytes=Buffer.alloc(limit+1);let size=0;
  while(size<bytes.length){const n=readSync(fd,bytes,size,bytes.length-size,null);if(!n)break;size+=n;}
  if(size>limit)throw Error('Saved file bound exceeded');return Buffer.from(bytes.subarray(0,size));
 }finally{closeSync(fd);}
}
export const decode=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
export const readJson=(path,limit)=>decode(readBounded(path,limit));
export function saveNew(path,value,limit=CAPS.fileBytes){const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value,null,2)+'\n');if(bytes.length>limit)throw Error('Saved file bound exceeded');writeFileSync(path,bytes,{flag:'wx'});return bytes;}
export function errorValue(error){
 let truncated=false,unreadable=false;
 const get=(key,fallback)=>{try{return error?.[key]??fallback;}catch{unreadable=true;return fallback;}};
 const text=(value,fallback,limit)=>{try{const valueText=String(value);if(valueText.length>limit)truncated=true;return valueText.slice(0,limit);}catch{unreadable=true;return fallback;}};
 const name=text(get('name','ThrownValue'),'[unreadable name]',80),message=text(get('message',error),'[unreadable failure]',1024),rawCode=get('code',null),code=rawCode===null?null:text(rawCode,'[unreadable code]',80);
 return{name,message,code,truncated,unreadable};
}
