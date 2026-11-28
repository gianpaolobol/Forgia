import {createHash} from 'node:crypto';
import {closeSync,constants,fstatSync,lstatSync,openSync,readFileSync} from 'node:fs';
import {dirname} from 'node:path';
export type LocalGatewayCredential=()=>{session:string;bearer:string;digest:string};
// Private operator file; no bearer in argv, ledger or generated artifacts.
export function localGatewayCredential(path:string):LocalGatewayCredential{
 let pinned:string|undefined;
 return ()=>{
  try{
   const d=lstatSync(dirname(path)),s=lstatSync(path);
   if(!d.isDirectory()||!s.isFile()||(process.platform!=='win32'&&((d.mode|s.mode)&0o077)))throw Error();
   const fd=openSync(path,constants.O_RDONLY|(process.platform==='win32'?0:constants.O_NOFOLLOW|constants.O_NONBLOCK));
   let body:Buffer;
   try{const st=fstatSync(fd);if(!st.isFile()||st.size<1||st.size>4096||(process.platform!=='win32'&&(st.mode&0o077)))throw Error();body=readFileSync(fd);}finally{closeSync(fd);}
   if(body.length>4096)throw Error();
   const v=JSON.parse(body.toString('utf8'));
   if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==2||typeof v.session!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v.session)||typeof v.bearer!=='string'||!/^[a-f0-9]{64}$/.test(v.bearer))throw Error();
   const digest=createHash('sha256').update(body).digest('hex');
   if(pinned!==undefined&&pinned!==digest)throw Error();
   pinned=digest;return {session:v.session,bearer:v.bearer,digest};
  }catch{throw Error('Credenziale gateway locale non valida o modificata.');}
 };
}
