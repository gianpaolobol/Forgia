import {createHash} from 'node:crypto';
import {closeSync,constants,fstatSync,lstatSync,openSync,readFileSync} from 'node:fs';
import {dirname} from 'node:path';

export type LocalSpecScope = {baselineSha:string;actor:string;taskId:string;provider:string;model:string};
export type LocalSpecAuthorization = (scope:LocalSpecScope,expectedDigest?:string)=>string;
const denied=()=>Error('Grant Superhandy locale non valido o revocato.');
const id=(x:unknown)=>typeof x==='string'&&/^[a-z][a-z0-9_-]{0,63}$/.test(x);
const sha=(x:unknown)=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const keys=['version','baselineSha','actor','taskId','provider','model','expiresAt'];

// Operator-owned policy file, not authentication or a credential. No network access.
// A changed or deleted grant fails closed; an already dispatched inference cannot be undone.
export function localSpecAuthorization(path:string,clock=Date.now):LocalSpecAuthorization {
 let pinned:string|undefined;
 return (scope,expectedDigest)=>{
  try{
   const dir=lstatSync(dirname(path)),entry=lstatSync(path);
   if(!dir.isDirectory()||!entry.isFile()||(process.platform!=='win32'&&((dir.mode|entry.mode)&0o077)))throw denied();
   const fd=openSync(path,constants.O_RDONLY|(process.platform==='win32'?0:constants.O_NOFOLLOW|constants.O_NONBLOCK));
   let body:Buffer;
   try{
    const s=fstatSync(fd);
    if(!s.isFile()||s.size<1||s.size>4096||(process.platform!=='win32'&&(s.mode&0o077)))throw denied();
    body=readFileSync(fd);
   }finally{closeSync(fd);}
   if(body.length>4096)throw denied();
   const g=JSON.parse(body.toString('utf8')),now=clock();
   if(!g||typeof g!=='object'||Array.isArray(g)||Object.keys(g).length!==keys.length||!keys.every(k=>Object.hasOwn(g,k))||g.version!==1||!sha(g.baselineSha)||!id(g.actor)||!id(g.taskId)||!['local','llamacpp'].includes(g.provider)||typeof g.model!=='string'||!g.model||g.model.length>150||/[\s\x00-\x1f\x7f]/.test(g.model)||!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(g.expiresAt)||g.expiresAt<=now||g.expiresAt>now+24*60*60*1000)throw denied();
   if(g.provider==='local'&&/cloud|https?:|\//i.test(g.model))throw denied();
   if(g.provider==='llamacpp'&&!/^[a-zA-Z0-9_.:-]+$/.test(g.model))throw denied();
   if(g.baselineSha!==scope.baselineSha||g.actor!==scope.actor||g.taskId!==scope.taskId||g.provider!==scope.provider||g.model!==scope.model)throw denied();
   const digest=createHash('sha256').update(body).digest('hex');
   if((pinned!==undefined&&pinned!==digest)||(expectedDigest!==undefined&&expectedDigest!==digest))throw denied();
   pinned=digest;return digest;
  }catch{throw denied();}
 };
}
